import crypto from "node:crypto";
import { BrevoClient, BrevoError } from "@getbrevo/brevo";
import { Router, type Request, type Response } from "express";
import type { AppEnv } from "../config/env";
import { pool } from "../db/mysql";

type GoogleUserInfo = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name: string;
  picture?: string;
};

type AuthUser = {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
};

type UserRow = {
  id: number;
  google_sub: string | null;
  email: string;
  name: string;
  password_hash: string | null;
  avatar_url: string | null;
  email_verified_at: Date | string | null;
  email_verification_token_hash: string | null;
  email_verification_code_hash: string | null;
  email_verification_expires_at: Date | string | null;
  email_verification_sent_at: Date | string | null;
  password_reset_token_hash: string | null;
  password_reset_code_hash: string | null;
  password_reset_expires_at: Date | string | null;
  password_reset_sent_at: Date | string | null;
};

type PasswordFields = {
  name: string;
  email: string;
  password: string;
};

type PasswordResetFields = {
  email: string;
  code: string;
  password: string;
};

type SignupResponse =
  | {
      requiresVerification: false;
      user: AuthUser;
    }
  | {
      requiresVerification: true;
      email: string;
      message: string;
      deliveryStatus: "sent" | "failed";
    };

type SessionConfig = {
  cookieName: string;
  durationDays: number;
  tableName: string;
};

const PBKDF2_ITERATIONS = 120_000;
const PBKDF2_KEY_LENGTH = 32;
const PBKDF2_DIGEST = "sha256";
const PASSWORD_HASH_PREFIX = "pbkdf2";
const VERIFICATION_ROUTE = "/verify-otp";
const PASSWORD_RESET_ROUTE = "/reset-password";

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function getPrimarySessionConfig(appEnv: AppEnv): SessionConfig {
  return {
    cookieName: appEnv.auth.sessionCookieName,
    durationDays: appEnv.auth.sessionDurationDays,
    tableName: "sessions",
  };
}

function getVaultSessionConfig(appEnv: AppEnv): SessionConfig {
  return {
    cookieName: appEnv.auth.vaultSessionCookieName,
    durationDays: appEnv.auth.vaultSessionDurationDays,
    tableName: "vault_sessions",
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(";").reduce<Record<string, string>>((cookies, pair) => {
    const separatorIndex = pair.indexOf("=");

    if (separatorIndex === -1) {
      return cookies;
    }

    const name = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();

    if (name) {
      cookies[name] = decodeURIComponent(value);
    }

    return cookies;
  }, {});
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAgeSeconds?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none";
    path?: string;
  } = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  parts.push(`Path=${options.path ?? "/"}`);

  if (typeof options.maxAgeSeconds === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  }

  if (options.httpOnly ?? true) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite[0].toUpperCase()}${options.sameSite.slice(1)}`);
  }

  return parts.join("; ");
}

function readCookie(req: Request, name: string): string | undefined {
  return parseCookies(req.headers.cookie)[name];
}

function setCookie(
  res: Response,
  name: string,
  value: string,
  options: Parameters<typeof serializeCookie>[2],
) {
  res.append("Set-Cookie", serializeCookie(name, value, options));
}

function clearCookie(
  res: Response,
  name: string,
  options: {
    path?: string;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none";
  } = {},
) {
  res.append(
    "Set-Cookie",
    serializeCookie(name, "", {
      path: options.path ?? "/",
      maxAgeSeconds: 0,
      httpOnly: true,
      secure: options.secure,
      sameSite: options.sameSite ?? "lax",
    }),
  );
}

function sendAuthError(res: Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

function generateOtpCode(length: number): string {
  const max = 10 ** length;
  const value = crypto.randomInt(0, max);

  return value.toString().padStart(length, "0");
}

function buildGoogleAuthUrl(appEnv: AppEnv, state: string): string {
  if (!appEnv.auth.googleClientId || !appEnv.auth.googleRedirectUri) {
    throw new Error("Google OAuth is not configured.");
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  authUrl.searchParams.set("client_id", appEnv.auth.googleClientId);
  authUrl.searchParams.set("redirect_uri", appEnv.auth.googleRedirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");

  return authUrl.toString();
}

function buildVerificationUrl(
  appEnv: AppEnv,
  email: string,
  deliveryStatus?: "sent" | "failed",
): string {
  const url = new URL(VERIFICATION_ROUTE, appEnv.auth.frontendUrl);

  url.searchParams.set("email", email);
  if (deliveryStatus) {
    url.searchParams.set("delivery", deliveryStatus);
  }

  return url.toString();
}

function buildVerificationEmailMessage(
  appEnv: AppEnv,
  email: string,
  code: string,
): {
  subject: string;
  htmlContent: string;
} {
  const subject = "Your Workspace verification code";
  const expiryMinutes = appEnv.auth.verificationCodeExpiryMinutes;

  return {
    subject,
    htmlContent: `
      <div style="font-family: Inter, Arial, sans-serif; color: #111827; line-height: 1.6;">
        <h2 style="margin: 0 0 12px; font-size: 24px;">Verify your Workspace account</h2>
        <p style="margin: 0 0 16px;">Use this code to finish creating your Workspace account for <strong>${email}</strong>.</p>
        <div style="display: inline-block; padding: 16px 22px; border-radius: 14px; background: #111827; color: #f9fafb; font-size: 28px; letter-spacing: 0.28em; font-weight: 700;">
          ${code}
        </div>
        <p style="margin: 16px 0 0;">This code expires in <strong>${expiryMinutes} minutes</strong>.</p>
        <p style="margin: 8px 0 0; color: #6b7280;">If you did not request this, you can ignore this email.</p>
      </div>
    `,
  };
}

function buildPasswordResetEmailMessage(
  appEnv: AppEnv,
  email: string,
  code: string,
): {
  subject: string;
  htmlContent: string;
} {
  const subject = "Your Workspace password reset code";
  const expiryMinutes = appEnv.auth.verificationCodeExpiryMinutes;

  return {
    subject,
    htmlContent: `
      <div style="font-family: Inter, Arial, sans-serif; color: #111827; line-height: 1.6;">
        <h2 style="margin: 0 0 12px; font-size: 24px;">Reset your Workspace password</h2>
        <p style="margin: 0 0 16px;">Use this code to confirm the password reset for <strong>${email}</strong>.</p>
        <div style="display: inline-block; padding: 16px 22px; border-radius: 14px; background: #111827; color: #f9fafb; font-size: 28px; letter-spacing: 0.28em; font-weight: 700;">
          ${code}
        </div>
        <p style="margin: 16px 0 0;">This code expires in <strong>${expiryMinutes} minutes</strong>.</p>
        <p style="margin: 8px 0 0; color: #6b7280;">If you did not request this, you can ignore this email.</p>
      </div>
    `,
  };
}

async function sendBrevoEmail(
  appEnv: AppEnv,
  toEmail: string,
  toName: string,
  payload: {
    subject: string;
    htmlContent: string;
  },
) {
  const brevo = new BrevoClient({
    apiKey: appEnv.mail.apiKey,
  });

  try {
    await brevo.transactionalEmails.sendTransacEmail({
      sender: {
        name: appEnv.mail.fromName,
        email: appEnv.mail.fromEmail,
      },
      to: [
        {
          email: toEmail,
          name: toName,
        },
      ],
      subject: payload.subject,
      htmlContent: payload.htmlContent,
    });
  } catch (error) {
    throw new Error(formatBrevoEmailError(error));
  }
}

function formatBrevoEmailError(error: unknown): string {
  if (error instanceof BrevoError) {
    const body = error.body;
    const bodyMessage =
      body &&
      typeof body === "object" &&
      "message" in body &&
      typeof body.message === "string"
        ? body.message
        : undefined;

    return bodyMessage ?? error.message;
  }

  return error instanceof Error ? error.message : "Unknown Brevo API error";
}

function toAuthUser(row: {
  id: number;
  name: string;
  email: string;
  avatar_url: string | null;
}): AuthUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url,
  };
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");

  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    crypto.pbkdf2(
      password,
      salt,
      PBKDF2_ITERATIONS,
      PBKDF2_KEY_LENGTH,
      PBKDF2_DIGEST,
      (error, key) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(key);
      },
    );
  });

  return [
    PASSWORD_HASH_PREFIX,
    PBKDF2_DIGEST,
    PBKDF2_ITERATIONS.toString(),
    salt,
    derivedKey.toString("hex"),
  ].join("$");
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [prefix, digest, iterationsValue, salt, expectedHex] = storedHash.split("$");

  if (
    prefix !== PASSWORD_HASH_PREFIX ||
    digest !== PBKDF2_DIGEST ||
    !iterationsValue ||
    !salt ||
    !expectedHex
  ) {
    return false;
  }

  const iterations = Number(iterationsValue);

  if (!Number.isInteger(iterations) || iterations <= 0) {
    return false;
  }

  const expected = Buffer.from(expectedHex, "hex");

  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, expected.length, digest, (error, key) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(key);
    });
  });

  return (
    derivedKey.length === expected.length &&
    crypto.timingSafeEqual(derivedKey, expected)
  );
}

function isVerificationPending(row: Pick<UserRow, "email_verified_at">): boolean {
  return row.email_verified_at === null;
}

function isVerificationExpired(
  row: Pick<UserRow, "email_verification_expires_at">,
): boolean {
  if (!row.email_verification_expires_at) {
    return true;
  }

  return parseDatabaseTimestampMillis(row.email_verification_expires_at) <= Date.now();
}

function isPasswordResetExpired(
  row: Pick<UserRow, "password_reset_expires_at">,
): boolean {
  if (!row.password_reset_expires_at) {
    return true;
  }

  return parseDatabaseTimestampMillis(row.password_reset_expires_at) <= Date.now();
}

function parseDatabaseTimestampMillis(value: Date | string): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  const normalized = value.includes("T")
    ? value
    : value.replace(" ", "T");
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const parsed = new Date(hasTimezone ? normalized : `${normalized}Z`).getTime();

  return Number.isNaN(parsed) ? 0 : parsed;
}

function setPendingVerificationCookie(
  res: Response,
  appEnv: AppEnv,
  token: string,
) {
  setCookie(res, appEnv.auth.pendingVerificationCookieName, token, {
    path: "/auth",
    maxAgeSeconds: appEnv.auth.verificationCodeExpiryMinutes * 60,
    httpOnly: true,
    secure: appEnv.auth.cookieSecure,
    sameSite: "lax",
  });
}

function clearPendingVerificationCookie(res: Response, appEnv: AppEnv) {
  clearCookie(res, appEnv.auth.pendingVerificationCookieName, {
    path: "/auth",
    secure: appEnv.auth.cookieSecure,
    sameSite: "lax",
  });
}

function setPendingPasswordResetCookie(
  res: Response,
  appEnv: AppEnv,
  token: string,
) {
  setCookie(res, appEnv.auth.pendingPasswordResetCookieName, token, {
    path: "/auth",
    maxAgeSeconds: appEnv.auth.verificationCodeExpiryMinutes * 60,
    httpOnly: true,
    secure: appEnv.auth.cookieSecure,
    sameSite: "lax",
  });
}

function clearPendingPasswordResetCookie(res: Response, appEnv: AppEnv) {
  clearCookie(res, appEnv.auth.pendingPasswordResetCookieName, {
    path: "/auth",
    secure: appEnv.auth.cookieSecure,
    sameSite: "lax",
  });
}

function setPendingPasswordResetConfirmedCookie(
  res: Response,
  appEnv: AppEnv,
  token: string,
) {
  setCookie(
    res,
    appEnv.auth.pendingPasswordResetConfirmedCookieName,
    token,
    {
      path: "/auth",
      maxAgeSeconds: appEnv.auth.verificationCodeExpiryMinutes * 60,
      httpOnly: true,
      secure: appEnv.auth.cookieSecure,
      sameSite: "lax",
    },
  );
}

function clearPendingPasswordResetConfirmedCookie(
  res: Response,
  appEnv: AppEnv,
) {
  clearCookie(res, appEnv.auth.pendingPasswordResetConfirmedCookieName, {
    path: "/auth",
    secure: appEnv.auth.cookieSecure,
    sameSite: "lax",
  });
}

function readPendingPasswordResetToken(req: Request, appEnv: AppEnv) {
  return readCookie(req, appEnv.auth.pendingPasswordResetCookieName);
}

function readConfirmedPasswordResetToken(req: Request, appEnv: AppEnv) {
  return readCookie(req, appEnv.auth.pendingPasswordResetConfirmedCookieName);
}

async function sendVerificationChallengeEmail(
  appEnv: AppEnv,
  user: { email: string; name: string },
  code: string,
) {
  const emailMessage = buildVerificationEmailMessage(appEnv, user.email, code);

  await sendBrevoEmail(appEnv, user.email, user.name, emailMessage);
}

async function sendPasswordResetChallengeEmail(
  appEnv: AppEnv,
  user: { email: string; name: string },
  code: string,
) {
  const emailMessage = buildPasswordResetEmailMessage(appEnv, user.email, code);

  await sendBrevoEmail(appEnv, user.email, user.name, emailMessage);
}

async function issueVerificationChallenge(
  appEnv: AppEnv,
  user: { id: number; email: string; name: string },
  res: Response,
): Promise<{ deliveryStatus: "sent" | "failed"; message: string }> {
  const token = randomToken(32);
  const code = generateOtpCode(appEnv.auth.verificationCodeLength);
  const tokenHash = sha256(token);
  const codeHash = sha256(code);

  await pool.execute(
    `
      UPDATE users
      SET email_verification_token_hash = ?,
          email_verification_code_hash = ?,
          email_verification_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE),
          email_verification_sent_at = UTC_TIMESTAMP()
      WHERE id = ?
    `,
    [tokenHash, codeHash, appEnv.auth.verificationCodeExpiryMinutes, user.id],
  );

  setPendingVerificationCookie(res, appEnv, token);

  try {
    await sendVerificationChallengeEmail(appEnv, user, code);

    return {
      deliveryStatus: "sent",
      message: `We sent a verification code to ${user.email}.`,
    };
  } catch (error) {
    const details =
      error instanceof Error ? error.message : "Unknown email delivery failure";

    return {
      deliveryStatus: "failed",
      message: `We prepared your verification code, but the email could not be sent right now. ${details}`,
    };
  }
}

async function issuePasswordResetChallenge(
  appEnv: AppEnv,
  user: { id: number; email: string; name: string },
  res: Response,
): Promise<{ deliveryStatus: "sent" | "failed"; message: string }> {
  const token = randomToken(32);
  const code = generateOtpCode(appEnv.auth.verificationCodeLength);
  const tokenHash = sha256(token);
  const codeHash = sha256(code);

  await pool.execute(
    `
      UPDATE users
      SET password_reset_token_hash = ?,
          password_reset_code_hash = ?,
          password_reset_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE),
          password_reset_sent_at = UTC_TIMESTAMP()
      WHERE id = ?
    `,
    [tokenHash, codeHash, appEnv.auth.verificationCodeExpiryMinutes, user.id],
  );

  setPendingPasswordResetCookie(res, appEnv, token);
  clearPendingPasswordResetConfirmedCookie(res, appEnv);

  try {
    await sendPasswordResetChallengeEmail(appEnv, user, code);

    return {
      deliveryStatus: "sent",
      message: `We sent a password reset code to ${user.email}.`,
    };
  } catch (error) {
    const details =
      error instanceof Error ? error.message : "Unknown email delivery failure";

    return {
      deliveryStatus: "failed",
      message: `We prepared your password reset code, but the email could not be sent right now. ${details}`,
    };
  }
}

async function findPendingVerificationUser(appEnv: AppEnv, req: Request) {
  const pendingToken = readCookie(req, appEnv.auth.pendingVerificationCookieName);

  if (!pendingToken) {
    return null;
  }

  const pendingTokenHash = sha256(pendingToken);

  const [rows] = (await pool.execute(
    `
      SELECT id, google_sub, email, name, password_hash, avatar_url,
             email_verified_at, email_verification_token_hash,
             email_verification_code_hash, email_verification_expires_at,
             email_verification_sent_at
      FROM users
      WHERE email_verification_token_hash = ?
      LIMIT 1
    `,
    [pendingTokenHash],
  )) as [UserRow[], unknown];

  return rows[0] ?? null;
}

async function findPendingPasswordResetUser(appEnv: AppEnv, req: Request) {
  const pendingToken = readPendingPasswordResetToken(req, appEnv);

  if (!pendingToken) {
    return null;
  }

  const pendingTokenHash = sha256(pendingToken);

  const [rows] = (await pool.execute(
    `
      SELECT id, google_sub, email, name, password_hash, avatar_url,
             email_verified_at, email_verification_token_hash,
             email_verification_code_hash, email_verification_expires_at,
             email_verification_sent_at, password_reset_token_hash,
             password_reset_code_hash, password_reset_expires_at,
             password_reset_sent_at
      FROM users
      WHERE password_reset_token_hash = ?
      LIMIT 1
    `,
    [pendingTokenHash],
  )) as [UserRow[], unknown];

  return rows[0] ?? null;
}

function hasConfirmedPasswordReset(appEnv: AppEnv, req: Request): boolean {
  const pendingToken = readPendingPasswordResetToken(req, appEnv);
  const confirmedToken = readConfirmedPasswordResetToken(req, appEnv);

  return Boolean(pendingToken && confirmedToken && pendingToken === confirmedToken);
}

async function completeVerification(
  appEnv: AppEnv,
  res: Response,
  user: UserRow,
): Promise<AuthUser> {
  await pool.execute(
    `
      UPDATE users
      SET email_verified_at = UTC_TIMESTAMP(),
          email_verification_token_hash = NULL,
          email_verification_code_hash = NULL,
          email_verification_expires_at = NULL,
          email_verification_sent_at = NULL
      WHERE id = ?
    `,
    [user.id],
  );

  clearPendingVerificationCookie(res, appEnv);
  await attachSession(res, appEnv, user.id);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatar_url,
  };
}

async function completePasswordReset(
  appEnv: AppEnv,
  res: Response,
  req: Request,
  user: UserRow,
  password: string,
): Promise<AuthUser> {
  const passwordHash = await hashPassword(password);

  await pool.execute(
    `
      UPDATE users
      SET password_hash = ?,
          password_reset_token_hash = NULL,
          password_reset_code_hash = NULL,
          password_reset_expires_at = NULL,
          password_reset_sent_at = NULL
      WHERE id = ?
    `,
    [passwordHash, user.id],
  );

  await pool.execute("DELETE FROM sessions WHERE user_id = ?", [user.id]);
  await pool.execute("DELETE FROM vault_sessions WHERE user_id = ?", [user.id]);
  clearPendingPasswordResetCookie(res, appEnv);
  clearPendingPasswordResetConfirmedCookie(res, appEnv);
  await clearSession(res, appEnv, req, getVaultSessionConfig(appEnv));
  await attachSession(res, appEnv, user.id);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatar_url,
  };
}

async function exchangeCodeForTokens(appEnv: AppEnv, code: string) {
  if (
    !appEnv.auth.googleClientId ||
    !appEnv.auth.googleClientSecret ||
    !appEnv.auth.googleRedirectUri
  ) {
    throw new Error("Google OAuth is not configured.");
  }

  const body = new URLSearchParams({
    code,
    client_id: appEnv.auth.googleClientId,
    client_secret: appEnv.auth.googleClientSecret,
    redirect_uri: appEnv.auth.googleRedirectUri,
    grant_type: "authorization_code",
  });

  console.log("Redirect URI being sent:", appEnv.auth.googleRedirectUri);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Google token exchange failed: ${details}`);
  }

  return (await response.json()) as {
    access_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
    id_token?: string;
  };
}

async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Google userinfo request failed: ${details}`);
  }

  return (await response.json()) as GoogleUserInfo;
}

async function createSession(
  appEnv: AppEnv,
  userId: number,
  sessionConfig: SessionConfig = getPrimarySessionConfig(appEnv),
): Promise<string> {
  const sessionToken = randomToken(32);
  const sessionTokenHash = sha256(sessionToken);
  const expiresAt = new Date(
    Date.now() + sessionConfig.durationDays * 24 * 60 * 60 * 1000,
  );

  await pool.execute(
    `DELETE FROM ${sessionConfig.tableName} WHERE expires_at < UTC_TIMESTAMP()`,
  );

  await pool.execute(
    `
      INSERT INTO ${sessionConfig.tableName} (user_id, session_token_hash, expires_at)
      VALUES (?, ?, ?)
    `,
    [userId, sessionTokenHash, expiresAt],
  );

  return sessionToken;
}

async function findUserFromSession(
  appEnv: AppEnv,
  req: Request,
  sessionConfig: SessionConfig = getPrimarySessionConfig(appEnv),
): Promise<AuthUser | null> {
  const sessionToken = readCookie(req, sessionConfig.cookieName);

  if (!sessionToken) {
    return null;
  }

  const sessionTokenHash = sha256(sessionToken);

  const [rows] = (await pool.execute(
    `
      SELECT id, name, email, avatar_url
      FROM users
      WHERE id = (
        SELECT user_id
        FROM ${sessionConfig.tableName}
        WHERE session_token_hash = ?
          AND expires_at > UTC_TIMESTAMP()
        LIMIT 1
      )
      AND email_verified_at IS NOT NULL
      LIMIT 1
    `,
    [sessionTokenHash],
  )) as [
    Array<{
      id: number;
      name: string;
      email: string;
      avatar_url: string | null;
    }>,
    unknown,
  ];

  const user = rows[0];

  if (!user) {
    return null;
  }

  return toAuthUser(user);
}

async function upsertGoogleUser(profile: GoogleUserInfo): Promise<UserRow> {
  const [rows] = (await pool.execute(
    `
      SELECT id, google_sub, email, name, password_hash, avatar_url,
             email_verified_at, email_verification_token_hash,
             email_verification_code_hash, email_verification_expires_at,
             email_verification_sent_at
      FROM users
      WHERE google_sub = ? OR email = ?
      LIMIT 1
    `,
    [profile.sub, profile.email],
  )) as [UserRow[], unknown];

  const existingUser = rows[0];
  const avatarUrl = profile.picture ?? null;
  const verifiedAt = new Date();

  if (existingUser) {
    await pool.execute(
      `
        UPDATE users
        SET google_sub = ?, email = ?, name = ?, avatar_url = ?, email_verified_at = ?
        WHERE id = ?
      `,
      [profile.sub, profile.email, profile.name, avatarUrl, verifiedAt, existingUser.id],
    );

    return {
      id: existingUser.id,
      google_sub: profile.sub,
      email: profile.email,
      name: profile.name,
      password_hash: existingUser.password_hash,
      avatar_url: avatarUrl,
      email_verified_at: verifiedAt,
      email_verification_token_hash: existingUser.email_verification_token_hash,
      email_verification_code_hash: existingUser.email_verification_code_hash,
      email_verification_expires_at:
        existingUser.email_verification_expires_at,
      email_verification_sent_at: existingUser.email_verification_sent_at,
      password_reset_token_hash: existingUser.password_reset_token_hash,
      password_reset_code_hash: existingUser.password_reset_code_hash,
      password_reset_expires_at: existingUser.password_reset_expires_at,
      password_reset_sent_at: existingUser.password_reset_sent_at,
    };
  }

  const [result] = (await pool.execute(
    `
      INSERT INTO users (
        google_sub,
        email,
        name,
        password_hash,
        avatar_url,
        email_verified_at
      )
      VALUES (?, ?, ?, NULL, ?, ?)
    `,
    [profile.sub, profile.email, profile.name, avatarUrl, verifiedAt],
  )) as [{ insertId: number }, unknown];

  return {
    id: Number(result.insertId),
    google_sub: profile.sub,
    name: profile.name,
    email: profile.email,
    password_hash: null,
    avatar_url: avatarUrl,
    email_verified_at: verifiedAt,
    email_verification_token_hash: null,
    email_verification_code_hash: null,
    email_verification_expires_at: null,
    email_verification_sent_at: null,
    password_reset_token_hash: null,
    password_reset_code_hash: null,
    password_reset_expires_at: null,
    password_reset_sent_at: null,
  };
}

async function signupPasswordUser(fields: PasswordFields): Promise<UserRow> {
  const email = normalizeEmail(fields.email);
  const passwordHash = await hashPassword(fields.password);

  const [rows] = (await pool.execute(
    `
      SELECT id, google_sub, email, name, password_hash, avatar_url,
             email_verified_at, email_verification_token_hash,
             email_verification_code_hash, email_verification_expires_at,
             email_verification_sent_at
      FROM users
      WHERE email = ?
      LIMIT 1
    `,
    [email],
  )) as [UserRow[], unknown];

  const existingUser = rows[0];

  if (existingUser) {
    if (existingUser.password_hash && existingUser.email_verified_at !== null) {
      throw new Error("An account with this email already exists.");
    }

    const name = fields.name.trim();

    await pool.execute(
      `
        UPDATE users
        SET name = ?, password_hash = ?
        WHERE id = ?
      `,
      [name, passwordHash, existingUser.id],
    );

    return {
      id: existingUser.id,
      google_sub: existingUser.google_sub,
      name,
      email: existingUser.email,
      password_hash: passwordHash,
      avatar_url: existingUser.avatar_url,
      email_verified_at: existingUser.email_verified_at,
      email_verification_token_hash:
        existingUser.email_verification_token_hash,
      email_verification_code_hash:
        existingUser.email_verification_code_hash,
      email_verification_expires_at:
        existingUser.email_verification_expires_at,
      email_verification_sent_at: existingUser.email_verification_sent_at,
      password_reset_token_hash: existingUser.password_reset_token_hash,
      password_reset_code_hash: existingUser.password_reset_code_hash,
      password_reset_expires_at: existingUser.password_reset_expires_at,
      password_reset_sent_at: existingUser.password_reset_sent_at,
    };
  }

  const [result] = (await pool.execute(
    `
      INSERT INTO users (
        google_sub,
        email,
        name,
        password_hash,
        avatar_url,
        email_verified_at
      )
      VALUES (NULL, ?, ?, ?, NULL, NULL)
    `,
    [email, fields.name.trim(), passwordHash],
  )) as [{ insertId: number }, unknown];

  return {
    id: Number(result.insertId),
    google_sub: null,
    name: fields.name.trim(),
    email,
    password_hash: passwordHash,
    avatar_url: null,
    email_verified_at: null,
    email_verification_token_hash: null,
    email_verification_code_hash: null,
    email_verification_expires_at: null,
    email_verification_sent_at: null,
    password_reset_token_hash: null,
    password_reset_code_hash: null,
    password_reset_expires_at: null,
    password_reset_sent_at: null,
  };
}

async function loginPasswordUser(email: string, password: string): Promise<UserRow> {
  const [rows] = (await pool.execute(
    `
      SELECT id, google_sub, email, name, password_hash, avatar_url,
             email_verified_at, email_verification_token_hash,
             email_verification_code_hash, email_verification_expires_at,
             email_verification_sent_at
      FROM users
      WHERE email = ?
      LIMIT 1
    `,
    [normalizeEmail(email)],
  )) as [UserRow[], unknown];

  const user = rows[0];

  if (!user) {
    throw new Error("Invalid email or password.");
  }

  if (!user.password_hash) {
    throw new Error("This account uses Google sign-in. Try Google login instead.");
  }

  if (user.email_verified_at === null) {
    throw new Error("Please verify your email before signing in.");
  }

  const isValid = await verifyPassword(password, user.password_hash);

  if (!isValid) {
    throw new Error("Invalid email or password.");
  }

  return user;
}

function authUnavailableMessage(appEnv: AppEnv): string {
  const missing = [
    !appEnv.auth.googleClientId ? "GOOGLE_CLIENT_ID" : null,
    !appEnv.auth.googleClientSecret ? "GOOGLE_CLIENT_SECRET" : null,
    !appEnv.auth.googleRedirectUri ? "GOOGLE_REDIRECT_URI" : null,
  ].filter(Boolean);

  return `Google OAuth is not configured yet. Set ${missing.join(", ")} and FRONTEND_URL in server/.env.`;
}

function validatePasswordFields(
  payload: Partial<PasswordFields>,
  requireName: boolean,
): PasswordFields {
  const name = (payload.name ?? "").trim();
  const email = (payload.email ?? "").trim();
  const password = payload.password ?? "";

  if (requireName && name.length < 2) {
    throw new Error("Please enter your name.");
  }

  if (!email) {
    throw new Error("Please enter your email.");
  }

  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  return {
    name,
    email,
    password,
  };
}

async function attachSession(
  res: Response,
  appEnv: AppEnv,
  userId: number,
  sessionConfig: SessionConfig = getPrimarySessionConfig(appEnv),
) {
  const sessionToken = await createSession(appEnv, userId, sessionConfig);

  setCookie(res, sessionConfig.cookieName, sessionToken, {
    path: "/",
    maxAgeSeconds: sessionConfig.durationDays * 24 * 60 * 60,
    httpOnly: true,
    secure: appEnv.auth.cookieSecure,
    sameSite: "lax",
  });
}

async function clearSession(
  res: Response,
  appEnv: AppEnv,
  req: Request,
  sessionConfig: SessionConfig,
) {
  const sessionToken = readCookie(req, sessionConfig.cookieName);

  if (sessionToken) {
    await pool.execute(
      `DELETE FROM ${sessionConfig.tableName} WHERE session_token_hash = ?`,
      [sha256(sessionToken)],
    );
  }

  clearCookie(res, sessionConfig.cookieName, {
    path: "/",
    secure: appEnv.auth.cookieSecure,
    sameSite: "lax",
  });
}

export function createAuthRouter(appEnv: AppEnv): Router {
  const router = Router();

  router.get("/google", (_req, res) => {
    if (!appEnv.auth.enabled) {
      return res.status(503).send(authUnavailableMessage(appEnv));
    }

    const state = randomToken(24);

    setCookie(res, appEnv.auth.stateCookieName, state, {
      path: "/auth/google",
      maxAgeSeconds: 10 * 60,
      httpOnly: true,
      secure: appEnv.auth.cookieSecure,
      sameSite: "lax",
    });

    return res.redirect(buildGoogleAuthUrl(appEnv, state));
  });

  router.get("/google/callback", async (req, res) => {
    if (!appEnv.auth.enabled) {
      return res.status(503).send(authUnavailableMessage(appEnv));
    }

    const { code, state, error } = req.query;

    if (typeof error === "string") {
      return res.status(400).send(`Google sign-in was cancelled: ${error}`);
    }

    if (typeof code !== "string" || typeof state !== "string") {
      return res.status(400).send("Missing OAuth code or state.");
    }

    const storedState = readCookie(req, appEnv.auth.stateCookieName);
    const vaultStoredState = readCookie(req, appEnv.auth.vaultStateCookieName);
    const isPrimaryFlow = storedState === state;
    const isVaultFlow = vaultStoredState === state;

    if (!isPrimaryFlow && !isVaultFlow) {
      return res.status(400).send("Invalid OAuth state. Please try again.");
    }

    clearCookie(res, appEnv.auth.stateCookieName, {
      path: "/auth/google",
      secure: appEnv.auth.cookieSecure,
      sameSite: "lax",
    });
    clearCookie(res, appEnv.auth.vaultStateCookieName, {
      path: "/auth/google",
      secure: appEnv.auth.cookieSecure,
      sameSite: "lax",
    });

    const tokenSet = await exchangeCodeForTokens(appEnv, code);
    const profile = await fetchGoogleUserInfo(tokenSet.access_token);

    if (!profile.email_verified) {
      return res.status(403).send("Google account email is not verified.");
    }

    if (isVaultFlow) {
      const primaryUser = await findUserFromSession(appEnv, req);

      if (!primaryUser) {
        return sendAuthError(
          res,
          401,
          "Please sign in to unlock the vault.",
        );
      }

      if (normalizeEmail(profile.email) !== normalizeEmail(primaryUser.email)) {
        return sendAuthError(
          res,
          403,
          "Use the same Google account as your signed-in workspace account.",
        );
      }

      await attachSession(
        res,
        appEnv,
        primaryUser.id,
        getVaultSessionConfig(appEnv),
      );

      return res.redirect(
        new URL("/dashboard/vault", appEnv.auth.frontendUrl).toString(),
      );
    }

    const user = await upsertGoogleUser(profile);

    await attachSession(res, appEnv, user.id);

    return res.redirect(
      new URL(
        isVaultFlow ? "/dashboard/vault" : "/dashboard",
        appEnv.auth.frontendUrl,
      ).toString(),
    );
  });

  router.post("/signup", async (req, res) => {
    try {
      const fields = validatePasswordFields(req.body ?? {}, true);
      const user = await signupPasswordUser(fields);

      if (!isVerificationPending(user)) {
        await attachSession(res, appEnv, user.id);

        return res.status(201).json({
          requiresVerification: false,
          user: toAuthUser(user),
        } satisfies SignupResponse);
      }

      const challenge = await issueVerificationChallenge(
        appEnv,
        {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        res,
      );

      return res.status(202).json({
        requiresVerification: true,
        email: user.email,
        message: challenge.message,
        deliveryStatus: challenge.deliveryStatus,
      } satisfies SignupResponse);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to create account.";

      return sendAuthError(res, 400, message);
    }
  });

  router.post("/forgot-password/request", async (req, res) => {
    try {
      const email = normalizeEmail(String(req.body?.email ?? ""));

      if (!email) {
        return sendAuthError(res, 400, "Please enter your email address.");
      }

      const [rows] = (await pool.execute(
        `
          SELECT id, google_sub, email, name, password_hash, avatar_url,
                 email_verified_at, email_verification_token_hash,
                 email_verification_code_hash, email_verification_expires_at,
                 email_verification_sent_at, password_reset_token_hash,
                 password_reset_code_hash, password_reset_expires_at,
                 password_reset_sent_at
          FROM users
          WHERE email = ?
          LIMIT 1
        `,
        [email],
      )) as [UserRow[], unknown];

      const user = rows[0];

      if (!user) {
        return res.json({
          ok: true,
          email,
          message: `If an account exists for ${email}, we sent a password reset code.`,
          deliveryStatus: "sent",
        });
      }

      const challenge = await issuePasswordResetChallenge(
        appEnv,
        {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        res,
      );

      return res.json({
        ok: true,
        email: user.email,
        message: challenge.message,
        deliveryStatus: challenge.deliveryStatus,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to start password recovery.";

      return sendAuthError(res, 400, message);
    }
  });

  router.post("/login", async (req, res) => {
    try {
      const fields = validatePasswordFields(req.body ?? {}, false);
      const user = await loginPasswordUser(fields.email, fields.password);

      await attachSession(res, appEnv, user.id);

      return res.json({
        user: toAuthUser(user),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to sign in.";

      const status =
        error instanceof Error && error.message === "Please verify your email before signing in."
          ? 403
          : 401;

      return sendAuthError(res, status, message);
    }
  });

  router.post("/verify-otp", async (req, res) => {
    try {
      const pendingUser = await findPendingVerificationUser(appEnv, req);

      if (!pendingUser) {
        return sendAuthError(
          res,
          400,
          "Your verification session expired. Please request a new code.",
        );
      }

      if (!pendingUser.email_verification_code_hash) {
        return sendAuthError(
          res,
          400,
          "Your verification code expired. Please request a new code.",
        );
      }

      const code = String(req.body?.code ?? "").trim();

      if (!code || code.length !== appEnv.auth.verificationCodeLength) {
        return sendAuthError(res, 400, "Please enter the full verification code.");
      }

      if (isVerificationExpired(pendingUser)) {
        return sendAuthError(
          res,
          400,
          "Your verification code expired. Please request a new code.",
        );
      }

      if (sha256(code) !== pendingUser.email_verification_code_hash) {
        return sendAuthError(res, 400, "That code is incorrect. Please try again.");
      }

      const user = await completeVerification(appEnv, res, pendingUser);

      return res.json({ user });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to verify account.";

      return sendAuthError(res, 400, message);
    }
  });

  router.post("/resend-otp", async (req, res) => {
    try {
      const pendingUser = await findPendingVerificationUser(appEnv, req);

      if (!pendingUser) {
        return sendAuthError(
          res,
          400,
          "Your verification session expired. Please sign up again.",
        );
      }

      if (!isVerificationPending(pendingUser)) {
        return sendAuthError(res, 400, "Your account is already verified.");
      }

      if (
        pendingUser.email_verification_sent_at &&
        Date.now() -
          parseDatabaseTimestampMillis(pendingUser.email_verification_sent_at) <
          appEnv.auth.verificationResendCooldownSeconds * 1000
      ) {
        return sendAuthError(
          res,
          429,
          "Please wait a moment before requesting another code.",
        );
      }

      const challenge = await issueVerificationChallenge(
        appEnv,
        {
          id: pendingUser.id,
          email: pendingUser.email,
          name: pendingUser.name,
        },
        res,
      );

      return res.json({
        ok: true,
        deliveryStatus: challenge.deliveryStatus,
        message: challenge.message,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to resend code.";

      return sendAuthError(res, 400, message);
    }
  });

  router.post("/forgot-password/resend", async (req, res) => {
    try {
      const pendingUser = await findPendingPasswordResetUser(appEnv, req);

      if (!pendingUser) {
        return sendAuthError(
          res,
          400,
          "Your password reset session expired. Please start again.",
        );
      }

      if (
        pendingUser.password_reset_sent_at &&
        Date.now() -
          parseDatabaseTimestampMillis(pendingUser.password_reset_sent_at) <
          appEnv.auth.verificationResendCooldownSeconds * 1000
      ) {
        return sendAuthError(
          res,
          429,
          "Please wait a moment before requesting another code.",
        );
      }

      const challenge = await issuePasswordResetChallenge(
        appEnv,
        {
          id: pendingUser.id,
          email: pendingUser.email,
          name: pendingUser.name,
        },
        res,
      );

      return res.json({
        ok: true,
        deliveryStatus: challenge.deliveryStatus,
        message: challenge.message,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to resend password reset code.";

      return sendAuthError(res, 400, message);
    }
  });

  router.post("/forgot-password/confirm", async (req, res) => {
    try {
      const pendingUser = await findPendingPasswordResetUser(appEnv, req);

      if (!pendingUser) {
        return sendAuthError(
          res,
          400,
          "Your password reset session expired. Please start again.",
        );
      }

      if (!pendingUser.password_reset_code_hash) {
        return sendAuthError(
          res,
          400,
          "Your reset code expired. Please request a new code.",
        );
      }

        if (isPasswordResetExpired(pendingUser)) {
        return sendAuthError(
          res,
          400,
          "Your reset code expired. Please request a new code.",
        );
      }

      const code = String(req.body?.code ?? "").trim();

      if (!code || code.length !== appEnv.auth.verificationCodeLength) {
        return sendAuthError(res, 400, "Please enter the full reset code.");
      }

      if (sha256(code) !== pendingUser.password_reset_code_hash) {
        return sendAuthError(res, 400, "That code is incorrect. Please try again.");
      }

      const pendingToken = readPendingPasswordResetToken(req, appEnv);

      if (!pendingToken) {
        return sendAuthError(
          res,
          400,
          "Your password reset session expired. Please start again.",
        );
      }

      setPendingPasswordResetConfirmedCookie(res, appEnv, pendingToken);

      return res.json({
        ok: true,
        message: "Code confirmed. You can now choose a new password.",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to verify the reset code.";

      return sendAuthError(res, 400, message);
    }
  });

  router.post("/reset-password", async (req, res) => {
    try {
      const pendingUser = await findPendingPasswordResetUser(appEnv, req);

      if (!pendingUser) {
        return sendAuthError(
          res,
          400,
          "Your password reset session expired. Please start again.",
        );
      }

      const password = String(req.body?.password ?? "");

      if (password.length < 8) {
        return sendAuthError(res, 400, "Password must be at least 8 characters long.");
      }

      if (!hasConfirmedPasswordReset(appEnv, req)) {
        return sendAuthError(
          res,
          400,
          "Please confirm the reset code before choosing a new password.",
        );
      }

      const user = await completePasswordReset(appEnv, res, req, pendingUser, password);

      return res.json({ user });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to reset password.";

      return sendAuthError(res, 400, message);
    }
  });

  router.get("/me", async (req, res) => {
    const user = await findUserFromSession(appEnv, req);

    if (!user) {
      return res.status(401).json({ user: null });
    }

    return res.json({ user });
  });

  router.post("/logout", async (req, res) => {
    const sessionToken = readCookie(req, appEnv.auth.sessionCookieName);

    if (sessionToken) {
      await pool.execute(
        "DELETE FROM sessions WHERE session_token_hash = ?",
        [sha256(sessionToken)],
      );
    }

    clearCookie(res, appEnv.auth.sessionCookieName, {
      path: "/",
      secure: appEnv.auth.cookieSecure,
      sameSite: "lax",
    });

    await clearSession(res, appEnv, req, getVaultSessionConfig(appEnv));

    clearPendingVerificationCookie(res, appEnv);

    return res.json({ ok: true });
  });

  return router;
}

export function createVaultAuthRouter(appEnv: AppEnv): Router {
  const router = Router();
  const sessionConfig = getVaultSessionConfig(appEnv);

  async function requirePrimaryUser(
    req: Request,
    res: Response,
  ): Promise<AuthUser | null> {
    const primaryUser = await findUserFromSession(appEnv, req);

    if (!primaryUser) {
      sendAuthError(res, 401, "Please sign in to unlock the vault.");
      return null;
    }

    return primaryUser;
  }

  router.get("/google", (_req, res) => {
    if (!appEnv.auth.enabled) {
      return res.status(503).send(authUnavailableMessage(appEnv));
    }

    const state = randomToken(24);

    setCookie(res, appEnv.auth.vaultStateCookieName, state, {
      path: "/auth/google",
      maxAgeSeconds: 10 * 60,
      httpOnly: true,
      secure: appEnv.auth.cookieSecure,
      sameSite: "lax",
    });

    return res.redirect(buildGoogleAuthUrl(appEnv, state));
  });

  router.get("/google/callback", async (req, res) => {
    if (!appEnv.auth.enabled) {
      return res.status(503).send(authUnavailableMessage(appEnv));
    }

    const { code, state, error } = req.query;

    if (typeof error === "string") {
      return res.status(400).send(`Google sign-in was cancelled: ${error}`);
    }

    if (typeof code !== "string" || typeof state !== "string") {
      return res.status(400).send("Missing OAuth code or state.");
    }

    const storedState = readCookie(req, appEnv.auth.vaultStateCookieName);

    if (!storedState || storedState !== state) {
      return res.status(400).send("Invalid OAuth state. Please try again.");
    }

    clearCookie(res, appEnv.auth.vaultStateCookieName, {
      path: "/auth/google",
      secure: appEnv.auth.cookieSecure,
      sameSite: "lax",
    });

    const tokenSet = await exchangeCodeForTokens(appEnv, code);
    const profile = await fetchGoogleUserInfo(tokenSet.access_token);

    if (!profile.email_verified) {
      return res.status(403).send("Google account email is not verified.");
    }

    const primaryUser = await requirePrimaryUser(req, res);

    if (!primaryUser) {
      return;
    }

    if (normalizeEmail(profile.email) !== normalizeEmail(primaryUser.email)) {
      return sendAuthError(
        res,
        403,
        "Use the same Google account as your signed-in workspace account.",
      );
    }

    await attachSession(res, appEnv, primaryUser.id, sessionConfig);

    return res.redirect(
      new URL("/dashboard/vault", appEnv.auth.frontendUrl).toString(),
    );
  });

  router.post("/login", async (req, res) => {
    try {
      const primaryUser = await requirePrimaryUser(req, res);

      if (!primaryUser) {
        return;
      }

      const fields = validatePasswordFields(req.body ?? {}, false);

      if (normalizeEmail(fields.email) !== normalizeEmail(primaryUser.email)) {
        return sendAuthError(
          res,
          403,
          "Use the same email as your signed-in workspace account.",
        );
      }

      const user = await loginPasswordUser(primaryUser.email, fields.password);

      await attachSession(res, appEnv, user.id, sessionConfig);

      return res.json({
        user: toAuthUser(user),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to sign in.";

      const status =
        error instanceof Error &&
        error.message === "Please verify your email before signing in."
          ? 403
          : 401;

      return sendAuthError(res, status, message);
    }
  });

  router.get("/me", async (req, res) => {
    const primaryUser = await requirePrimaryUser(req, res);

    if (!primaryUser) {
      await clearSession(res, appEnv, req, sessionConfig);
      return;
    }

    const user = await findUserFromSession(appEnv, req, sessionConfig);

    if (!user || normalizeEmail(user.email) !== normalizeEmail(primaryUser.email)) {
      await clearSession(res, appEnv, req, sessionConfig);
      return res.status(401).json({ user: null });
    }

    return res.json({ user });
  });

  router.post("/logout", async (req, res) => {
    await clearSession(res, appEnv, req, sessionConfig);

    return res.json({ ok: true });
  });

  return router;
}

export const createGoogleAuthRouter = createAuthRouter;
export const createVaultGoogleAuthRouter = createVaultAuthRouter;

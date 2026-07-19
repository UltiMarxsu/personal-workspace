import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Zap,
  CheckSquare,
  FileText,
  Calendar,
  BarChart2,
  ArrowRight,
  ChevronDown,
  Target,
  Clock,
  Flame,
} from "lucide-react";

const features = [
  {
    icon: CheckSquare,
    color: "#8b7cf8",
    bg: "bg-[#8b7cf8]/10",
    title: "Task management",
    desc: "Prioritize, tag, and complete tasks with a frictionless interface. No extra clicks, no clutter — just your work.",
  },
  {
    icon: FileText,
    color: "#f5a623",
    bg: "bg-[#f5a623]/10",
    title: "Linked notes",
    desc: "Capture thoughts mid-flow without leaving your context. Notes live next to your tasks, connected and searchable.",
  },
  {
    icon: Calendar,
    color: "#5ecfb0",
    bg: "bg-[#5ecfb0]/10",
    title: "Unified calendar",
    desc: "Your schedule, focus blocks, and events in one view. See where your time is going before it's gone.",
  },
  {
    icon: BarChart2,
    color: "#7ec8e3",
    bg: "bg-[#7ec8e3]/10",
    title: "Focus analytics",
    desc: "Track deep work hours across the week. Understand your patterns and protect the time that matters most.",
  },
  {
    icon: Target,
    color: "#e05252",
    bg: "bg-[#e05252]/10",
    title: "Goal tracking",
    desc: "Set quarterly targets and break them into daily momentum. Progress compounds when it's visible every day.",
  },
  {
    icon: Flame,
    color: "#f5a623",
    bg: "bg-[#f5a623]/10",
    title: "Streak system",
    desc: "Build habits with a streak tracker that rewards consistency, not just completion. Show up, and the work follows.",
  },
];


const faqs = [
  {
    q: "Is there a mobile app?",
    a: "Yes — iOS and Android apps are available for all plans. They sync in real time with your desktop workspace.",
  },
  {
    q: "Can I import from Notion or Todoist?",
    a: "One-click imports are available for Notion, Todoist, Linear, and Asana. Your data, your history, no starting over.",
  },
  {
    q: "What happens after my trial ends?",
    a: "You'll drop to the Solo plan automatically. No charge, no card required until you decide to upgrade.",
  },
  {
    q: "Is my data private?",
    a: "Your workspace is encrypted at rest and in transit. We don't train on your data and never will.",
  },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden" style={{ fontFamily: "'Figtree', sans-serif" }}>

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 h-[60px] flex items-center justify-between px-8 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-primary/20 border border-primary/30 flex items-center justify-center">
            <Zap size={14} className="text-primary" />
          </div>
          <span className="text-[15px] font-semibold text-foreground tracking-tight" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>
            Workspace
          </span>
        </div>

        <div className="flex items-center gap-6">
          {["Features", "About"].map((item) => (
            <a key={item} href={`#${item.toLowerCase()}`} className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-150">
              {item}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/login")}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-150"
          >
            Sign in
          </button>
          <button
            onClick={() => navigate("/login")}
            className="flex items-center gap-2 h-8 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all duration-150"
          >
            Get started
            <ArrowRight size={13} />
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-[140px] pb-24 px-8 text-center overflow-hidden">
        {/* Radial glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full bg-primary/8 blur-[120px] pointer-events-none" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[400px] h-[300px] rounded-full bg-accent/10 blur-[80px] pointer-events-none" />

        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/20 bg-primary/5 text-xs text-primary font-mono mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Now in public beta · 2,400+ workspaces created
          </div>

          <h1
            className="text-[56px] md:text-[72px] font-semibold text-foreground leading-[1.05] tracking-tight mb-6"
            style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
          >
            One workspace.
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
              All your work.
            </span>
          </h1>

          <p className="text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto mb-10">
            Tasks, notes, calendar, and focus analytics — unified in a single dark, distraction-free environment built for deep work.
          </p>

          <div className="flex items-center justify-center gap-3 flex-wrap">
            <button
              onClick={() => navigate("/login")}
              className="flex items-center gap-2 h-11 px-6 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all duration-150"
            >
              Start for free
              <ArrowRight size={15} />
            </button>
            <button
              onClick={() => navigate("/login")}
              className="flex items-center gap-2 h-11 px-6 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all duration-150"
            >
              View login UI
            </button>
          </div>

          <p className="text-xs text-muted-foreground mt-4">No credit card required · Free plan, always</p>
        </div>

        {/* Dashboard preview */}
        <div className="relative mt-16 max-w-5xl mx-auto">
          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-[0_0_80px_rgba(139,124,248,0.08)]">
            {/* Fake titlebar */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-[#0a0a0f]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#e05252]/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#f5a623]/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#5ecfb0]/60" />
              <span className="ml-4 text-[10px] font-mono text-muted-foreground">workspace.app / dashboard</span>
            </div>

            {/* Miniature dashboard mock */}
            <div className="flex h-[320px]">
              {/* Sidebar */}
              <div className="w-[140px] shrink-0 border-r border-border bg-[#0a0a0f] py-4 px-3">
                <div className="flex items-center gap-2 px-2 mb-5">
                  <div className="w-4 h-4 rounded bg-primary/20 border border-primary/30 flex items-center justify-center">
                    <Zap size={8} className="text-primary" />
                  </div>
                  <span className="text-[10px] font-semibold text-foreground" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>Workspace</span>
                </div>
                {["Overview", "Tasks", "Notes", "Calendar", "Focus"].map((item, i) => (
                  <div key={item} className={`flex items-center gap-2 px-2 py-1.5 rounded text-[9px] mb-0.5 ${i === 0 ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}>
                    <div className="w-2 h-2 rounded-sm bg-current opacity-60" />
                    {item}
                  </div>
                ))}
              </div>

              {/* Content */}
              <div className="flex-1 p-4 overflow-hidden">
                <div className="mb-3">
                  <div className="h-4 w-48 bg-foreground/10 rounded mb-1.5" />
                  <div className="h-2.5 w-64 bg-muted-foreground/20 rounded" />
                </div>

                <div className="grid grid-cols-4 gap-2 mb-3">
                  {["#8b7cf8", "#f5a623", "#5ecfb0", "#7ec8e3"].map((c) => (
                    <div key={c} className="bg-card border border-border rounded-md px-2.5 py-2">
                      <div className="w-3 h-3 rounded-sm mb-1.5" style={{ background: c, opacity: 0.6 }} />
                      <div className="h-1.5 w-10 bg-foreground/10 rounded mb-1" />
                      <div className="h-3 w-8 rounded" style={{ background: c, opacity: 0.3 }} />
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-[1fr_120px] gap-2">
                  <div className="bg-card border border-border rounded-md p-2.5">
                    <div className="h-2 w-20 bg-foreground/10 rounded mb-2" />
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="flex items-center gap-2 py-1 border-b border-border last:border-0">
                        <div className="w-2.5 h-2.5 rounded-full border border-muted-foreground/30 shrink-0" />
                        <div className="h-1.5 rounded bg-foreground/10 flex-1" style={{ width: `${60 + i * 8}%` }} />
                        <div className="w-6 h-1.5 rounded bg-primary/20 shrink-0" />
                      </div>
                    ))}
                  </div>
                  <div className="bg-card border border-border rounded-md p-2.5">
                    <div className="h-2 w-12 bg-foreground/10 rounded mb-2" />
                    <div className="grid grid-cols-7 gap-0.5">
                      {Array.from({ length: 7 }).map((_, i) => (
                        <div key={i} className={`h-4 rounded-sm text-center text-[6px] flex items-center justify-center ${i === 1 ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground"}`}>
                          {[30, 1, 2, 3, 4, 5, 6][i]}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Floating stat badges */}
          <div className="absolute -left-8 top-1/3 hidden md:flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
            <Clock size={12} className="text-[#5ecfb0]" />
            <div>
              <p className="text-[9px] font-mono text-muted-foreground">Focus today</p>
              <p className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>4.2h</p>
            </div>
          </div>

          <div className="absolute -right-8 top-1/4 hidden md:flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
            <Flame size={12} className="text-[#f5a623]" />
            <div>
              <p className="text-[9px] font-mono text-muted-foreground">Streak</p>
              <p className="text-sm font-semibold text-foreground" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>7 days</p>
            </div>
          </div>
        </div>
      </section>

      {/* Social proof strip */}
      <div className="border-y border-border py-4 px-8 overflow-hidden bg-card/30">
        <div className="flex items-center justify-center gap-8 flex-wrap">
          {["Linear", "Vercel", "Notion", "Figma", "Stripe", "Arc"].map((co) => (
            <span key={co} className="text-xs font-mono text-muted-foreground/50 tracking-widest uppercase">{co}</span>
          ))}
        </div>
        <p className="text-center text-[10px] font-mono text-muted-foreground/30 mt-2 tracking-wider">USED BY PEOPLE AT</p>
      </div>

      {/* Features */}
      <section id="features" className="py-24 px-8 max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-[10px] font-mono text-primary uppercase tracking-widest mb-3">What's inside</p>
          <h2 className="text-[40px] font-semibold text-foreground tracking-tight" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>
            Built for how you actually work
          </h2>
          <p className="text-muted-foreground mt-3 max-w-lg mx-auto">
            Six interconnected modules that share your context, so you're never context-switching between tools.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map(({ icon: Icon, color, bg, title, desc }) => (
            <div
              key={title}
              className="group bg-card border border-border rounded-xl p-6 hover:border-primary/20 transition-all duration-200 hover:bg-card/80"
            >
              <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center mb-4`}>
                <Icon size={16} style={{ color }} />
              </div>
              <h3 className="text-sm font-semibold text-foreground mb-2" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>


      {/* FAQ */}
      <section className="py-20 px-8 bg-card/20 border-t border-border">
        <div className="max-w-2xl mx-auto">
          <p className="text-center text-[10px] font-mono text-primary uppercase tracking-widest mb-12">FAQ</p>
          <div className="space-y-2">
            {faqs.map(({ q, a }, i) => (
              <div key={q} className="border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-secondary/40 transition-all duration-150"
                >
                  <span className="text-sm font-medium text-foreground">{q}</span>
                  <ChevronDown
                    size={15}
                    className={`text-muted-foreground shrink-0 transition-transform duration-200 ${openFaq === i ? "rotate-180" : ""}`}
                  />
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4">
                    <p className="text-sm text-muted-foreground leading-relaxed">{a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-28 px-8 text-center overflow-hidden border-t border-border">
        <div className="absolute inset-0 bg-gradient-to-b from-background to-[#0a0a14] pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full bg-primary/10 blur-[100px] pointer-events-none" />

        <div className="relative max-w-xl mx-auto">
          <h2
            className="text-[42px] font-semibold text-foreground tracking-tight leading-tight mb-4"
            style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
          >
            Your workspace
            <br />is waiting.
          </h2>
          <p className="text-muted-foreground mb-8">
            Join 2,400+ people who replaced their scattered tools with one focused environment.
          </p>
          <button
            onClick={() => navigate("/login")}
            className="inline-flex items-center gap-2 h-11 px-8 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all duration-150"
          >
            Get started for free
            <ArrowRight size={15} />
          </button>
          <p className="text-xs text-muted-foreground mt-4 font-mono">No card required · Cancel anytime</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-8 py-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Zap size={10} className="text-primary" />
            </div>
            <span className="text-xs font-semibold text-muted-foreground" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>Workspace</span>
          </div>
          <div className="flex items-center gap-5">
            {["Privacy", "Terms", "Status", "Changelog"].map((item) => (
              <a key={item} href="#" className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150">
                {item}
              </a>
            ))}
          </div>
          <p className="text-xs text-muted-foreground font-mono">© 2026 Workspace Inc.</p>
        </div>
      </footer>
    </div>
  );
}

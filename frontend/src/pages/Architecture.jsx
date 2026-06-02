import { Link } from "react-router-dom";
import {
  Sparkles, ArrowLeft, ArrowRight, Smartphone, MessageCircle, Globe,
  Webhook, Mic2, Image as ImageIcon, Activity, Brain, ShieldAlert, Languages,
  Database, Bell, FileText, ClipboardList, Stethoscope, Users, KeyRound, Lock,
  Server, ChevronDown,
} from "lucide-react";

/* =====================================================================
   PROJECT CARE — SYSTEM ARCHITECTURE
   Standalone, zero-API, presentation-ready.
   ===================================================================== */

const LAYERS = [
  {
    id: "patient",
    title: "Patient Layer",
    blurb: "Where care begins — multi-channel, voice-first, language-agnostic.",
    accent: "#3CC97C",
    accentSoft: "rgba(60,201,124,0.10)",
    items: [
      { icon: MessageCircle, title: "WhatsApp", sub: "Voice notes + text · 24/7 access" },
      { icon: Globe, title: "Web Chat", sub: "Browser-native, mic-enabled" },
      { icon: Smartphone, title: "Mobile / Desktop", sub: "Responsive PWA-ready UI" },
    ],
  },
  {
    id: "comms",
    title: "Communication Layer",
    blurb: "Real-time message routing between every channel and the AI engine.",
    accent: "#F2994A",
    accentSoft: "rgba(242,153,74,0.12)",
    items: [
      { icon: Webhook, title: "Twilio Webhooks", sub: "Inbound + outbound WhatsApp" },
      { icon: Mic2, title: "Audio Pipeline", sub: "Auth-fetch → transcode → Whisper" },
      { icon: ImageIcon, title: "Media Pipeline", sub: "Image / PDF / lab report intake" },
      { icon: Activity, title: "Smart Routing", sub: "Per-tab session, per-thread context" },
    ],
  },
  {
    id: "ai",
    title: "AI Processing Engine",
    blurb: "The clinical brain. Where symptoms become structured triage.",
    accent: "#7C4DFF",
    accentSoft: "rgba(124,77,255,0.12)",
    items: [
      { icon: Mic2, title: "Whisper STT", sub: "Multilingual speech → text" },
      { icon: Brain, title: "Clinical Reasoning", sub: "GPT-4o + rule overlays" },
      { icon: ShieldAlert, title: "Emergency Detection", sub: "Red-flag heuristics + LLM" },
      { icon: Activity, title: "Triage Classifier", sub: "Emergency · High · Medium · Low" },
      { icon: Languages, title: "Multilingual NLU", sub: "EN · HI · TE · TA replies" },
    ],
  },
  {
    id: "data",
    title: "Data Layer",
    blurb: "Persistent, structured, auditable. Every turn is traceable.",
    accent: "#5B7CFA",
    accentSoft: "rgba(91,124,250,0.12)",
    items: [
      { icon: Database, title: "MongoDB Core", sub: "Patients · Conversations · Summaries" },
      { icon: Bell, title: "Alerts Store", sub: "Open / cleared / corrected alerts" },
      { icon: FileText, title: "Clinical Records", sub: "Rx · Vitals · Vision extractions" },
      { icon: ClipboardList, title: "Audit Trail", sub: "Every AI + doctor action logged" },
    ],
  },
  {
    id: "doctor",
    title: "Doctor Interface",
    blurb: "Clinician control plane. Built around how doctors actually think.",
    accent: "#0F1836",
    accentSoft: "rgba(15,24,54,0.07)",
    items: [
      { icon: Stethoscope, title: "Dashboard", sub: "Queue · alerts · summaries" },
      { icon: Bell, title: "Notifications", sub: "Real-time red-flag escalation" },
      { icon: Users, title: "Clinical Handoff", sub: "AI intake → doctor review" },
      { icon: ClipboardList, title: "Patient Manager", sub: "Rx draft · reschedule · follow-up" },
    ],
  },
  {
    id: "integration",
    title: "Integration & Security Layer",
    blurb: "Cross-cutting trust fabric. APIs, auth, and compliance.",
    accent: "#E85A5A",
    accentSoft: "rgba(232,90,90,0.10)",
    items: [
      { icon: Server, title: "REST APIs", sub: "FastAPI · /api/* contracts" },
      { icon: Webhook, title: "Webhooks", sub: "Twilio · WhatsApp · third-party" },
      { icon: KeyRound, title: "Auth & Sessions", sub: "JWT · per-tab session storage" },
      { icon: Lock, title: "HIPAA-aware", sub: "PHI scoping · audit logs · encryption" },
    ],
  },
];

const PRINCIPLES = [
  { t: "Voice-first by default", d: "Whisper STT on every channel — patients shouldn't have to type when they're unwell." },
  { t: "Doctor-in-the-loop", d: "AI drafts, doctor signs. Every prescription, every alert resolution stays clinician-controlled." },
  { t: "Continuous, not episodic", d: "The consultation is the start, not the end. 24h Care AI follow-up keeps eyes on every patient." },
  { t: "Defensive triage", d: "Every patient turn is re-classified. Downgrades clear false alerts; upgrades escalate instantly." },
  { t: "Multilingual at the brain layer", d: "Language is a first-class context — replies localize, urgency stays universal." },
  { t: "Minimal trust surface", d: "Per-tab sessions, server-issued JWTs, scoped PHI access. No client-stored secrets." },
];

export default function Architecture() {
  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(180deg,#F4F6FF 0%,#EDF1FF 50%,#F8F4FF 100%)" }}>
      {/* Top nav */}
      <nav className="px-6 sm:px-12 py-5 flex items-center justify-between max-w-[1240px] mx-auto" data-testid="arch-nav">
        <Link to="/" className="flex items-center gap-2.5" data-testid="arch-home-link">
          <div className="w-9 h-9 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}>
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <div className="font-display font-bold text-[16px]" style={{ color: "#0F1836" }}>Project Care</div>
            <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#7C4DFF" }}>System Architecture</div>
          </div>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link to="/" className="hidden md:inline text-[13px]" style={{ color: "#2A3558" }} data-testid="arch-back-link">← Home</Link>
          <Link to="/demo" className="btn-primary inline-flex items-center gap-2 text-[13px] px-4 py-2" data-testid="arch-demo-link">
            <Sparkles size={13} /> Live Demo
          </Link>
        </div>
      </nav>

      {/* Header */}
      <header className="px-6 sm:px-12 pt-6 pb-10 max-w-[1240px] mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold mb-4" style={{ background: "rgba(124,77,255,0.10)", color: "#7C4DFF" }}>
          <Server size={11} /> Production-grade reference architecture
        </div>
        <h1 className="font-display font-bold leading-[1.05] text-4xl sm:text-5xl lg:text-6xl mb-4" style={{ color: "#0F1836" }}>
          Project Care · <span style={{ background: "linear-gradient(90deg,#5B7CFA,#7C4DFF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>System Architecture</span>
        </h1>
        <p className="text-base sm:text-lg max-w-[760px]" style={{ color: "#2A3558" }}>
          A voice-first, multilingual, clinician-in-the-loop care platform. Every patient interaction — on web or WhatsApp — flows through a real-time AI triage engine, lands in a structured doctor view, and continues as 24-hour AI-monitored follow-up.
        </p>
      </header>

      {/* Diagram */}
      <section className="px-4 sm:px-12 pb-14 max-w-[1240px] mx-auto" data-testid="arch-diagram">
        <div className="flex flex-col gap-3.5">
          {LAYERS.slice(0, 5).map((layer, idx) => (
            <Layer key={layer.id} layer={layer} idx={idx} />
          ))}

          {/* Cross-cutting integration band */}
          <div className="mt-2 rounded-3xl p-5 sm:p-6 border-2 border-dashed flex flex-col gap-3" style={{ borderColor: LAYERS[5].accent + "55", background: LAYERS[5].accentSoft }} data-testid="arch-layer-integration">
            <div className="flex flex-wrap items-baseline gap-3">
              <div className="font-display font-bold text-[18px] sm:text-[20px]" style={{ color: LAYERS[5].accent }}>
                {LAYERS[5].title}
              </div>
              <div className="text-[12.5px]" style={{ color: "#2A3558" }}>{LAYERS[5].blurb} <span style={{ color: "#6B7595" }}>· wraps every layer above</span></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {LAYERS[5].items.map((it) => (
                <Item key={it.title} it={it} accent={LAYERS[5].accent} accentSoft="rgba(255,255,255,0.7)" compact />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Flow tagline */}
      <section className="px-6 sm:px-12 pb-14 max-w-[1240px] mx-auto">
        <div className="glass-card flex flex-col md:flex-row items-center gap-4 md:gap-6 text-center md:text-left" data-testid="arch-flow-band">
          <FlowPill color="#3CC97C" label="Patient" />
          <Arrow />
          <FlowPill color="#F2994A" label="Twilio + Pipelines" />
          <Arrow />
          <FlowPill color="#7C4DFF" label="AI Triage" />
          <Arrow />
          <FlowPill color="#5B7CFA" label="Mongo + Audit" />
          <Arrow />
          <FlowPill color="#0F1836" label="Doctor" />
        </div>
      </section>

      {/* Design principles */}
      <section className="px-6 sm:px-12 pb-14 max-w-[1240px] mx-auto" data-testid="arch-principles">
        <div className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "#5B7CFA" }}>Design principles</div>
        <h2 className="font-display font-bold text-3xl sm:text-4xl mb-6" style={{ color: "#0F1836" }}>What this architecture optimises for</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {PRINCIPLES.map((p) => (
            <div key={p.t} className="glass-soft p-4 flex flex-col gap-1.5">
              <div className="font-display font-semibold text-[15px]" style={{ color: "#0F1836" }}>{p.t}</div>
              <div className="text-[12.5px] leading-relaxed" style={{ color: "#6B7595" }}>{p.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Stack at a glance */}
      <section className="px-6 sm:px-12 pb-16 max-w-[1240px] mx-auto" data-testid="arch-stack">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
          <StackCard
            title="Frontend"
            color="#5B7CFA"
            items={["React 19 + React Router 7", "Tailwind + shadcn/ui (glassmorphism)", "Web Speech API (mic input)", "Per-tab sessionStorage auth"]}
          />
          <StackCard
            title="Backend"
            color="#7C4DFF"
            items={["FastAPI + Pydantic", "MongoDB (Motor, async)", "Emergent LLM Key (GPT-4o · Whisper · TTS)", "Twilio (WhatsApp + media)"]}
          />
          <StackCard
            title="Operational"
            color="#3CC97C"
            items={["Supervisor-managed services", "Kubernetes ingress (`/api/*`)", "Hot-reload dev pods", "HIPAA-aware data scoping"]}
          />
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 sm:px-12 pb-20 max-w-[1240px] mx-auto">
        <div className="glass-card text-center p-8 sm:p-12" style={{ background: "linear-gradient(135deg,#5B7CFA0d,#7C4DFF0d)" }}>
          <h2 className="font-display font-bold text-3xl sm:text-4xl mb-3" style={{ color: "#0F1836" }}>See the architecture in action</h2>
          <p className="text-base mb-6 max-w-[520px] mx-auto" style={{ color: "#6B7595" }}>
            A 2-minute, fully scripted clinical walkthrough — patient intake, AI hypoglycemia detection, doctor handoff, prescription, and follow-up — exactly as the diagram describes.
          </p>
          <Link to="/demo" className="btn-primary inline-flex items-center gap-2 text-[14px] px-5 py-3" data-testid="arch-cta-demo">
            <Sparkles size={16} /> Experience Live Demo <ArrowRight size={16} />
          </Link>
          <div className="text-[12px] mt-3" style={{ color: "#6B7595" }}>No login required · 2-minute guided experience</div>
        </div>
      </section>

      <footer className="px-6 sm:px-12 py-6 text-[11px] text-center" style={{ color: "#6B7595" }}>
        © 2026 Project Care · Built by a practicing MBBS doctor. Architecture reference for evaluation.
      </footer>
    </div>
  );
}

/* ===== Reusable bits ===== */
function gridColsClass(n) {
  if (n >= 5) return "md:grid-cols-5";
  if (n === 4) return "md:grid-cols-4";
  if (n === 3) return "md:grid-cols-3";
  return "md:grid-cols-2";
}

function Layer({ layer, idx }) {
  return (
    <div className="flex flex-col items-stretch">
      <div
        className="rounded-3xl p-5 sm:p-6 border flex flex-col gap-4"
        style={{
          background: layer.accentSoft,
          borderColor: layer.accent + "33",
        }}
        data-testid={`arch-layer-${layer.id}`}
      >
        <div className="flex flex-wrap items-baseline gap-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10.5px] font-bold uppercase tracking-widest" style={{ background: "rgba(255,255,255,0.7)", color: layer.accent }}>
            Layer {idx + 1}
          </div>
          <div className="font-display font-bold text-[18px] sm:text-[20px]" style={{ color: layer.accent }}>
            {layer.title}
          </div>
          <div className="text-[12.5px]" style={{ color: "#2A3558" }}>{layer.blurb}</div>
        </div>
        <div className={`grid grid-cols-2 ${gridColsClass(layer.items.length)} gap-2.5`}>
          {layer.items.map((it) => (
            <Item key={it.title} it={it} accent={layer.accent} accentSoft="rgba(255,255,255,0.7)" />
          ))}
        </div>
      </div>
      {idx < 4 && (
        <div className="self-center my-1.5">
          <ChevronDown size={18} style={{ color: "#5B7CFA" }} />
        </div>
      )}
    </div>
  );
}

function Item({ it, accent, accentSoft, compact }) {
  return (
    <div
      className={`rounded-2xl ${compact ? "p-2.5" : "p-3"} flex items-start gap-2.5 border`}
      style={{ background: accentSoft, borderColor: accent + "22" }}
    >
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: accent + "1A" }}>
        <it.icon size={16} style={{ color: accent }} />
      </div>
      <div className="min-w-0">
        <div className="font-display font-semibold text-[13.5px] leading-tight" style={{ color: "#0F1836" }}>{it.title}</div>
        <div className="text-[11.5px] leading-snug mt-0.5" style={{ color: "#6B7595" }}>{it.sub}</div>
      </div>
    </div>
  );
}

function FlowPill({ color, label }) {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full text-[12.5px] font-semibold" style={{ background: color + "15", color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {label}
    </div>
  );
}

function Arrow() {
  return <span className="hidden md:inline" style={{ color: "#7C4DFF" }}>→</span>;
}

function StackCard({ title, color, items }) {
  return (
    <div className="glass-card flex flex-col gap-3" data-testid={`arch-stack-${title.toLowerCase()}`}>
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-2xl flex items-center justify-center" style={{ background: color + "1A" }}>
          <Server size={16} style={{ color }} />
        </div>
        <div className="font-display font-bold text-[16px]" style={{ color: "#0F1836" }}>{title}</div>
      </div>
      <ul className="flex flex-col gap-2 text-[13px]" style={{ color: "#2A3558" }}>
        {items.map((i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ background: color }} />
            <span>{i}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

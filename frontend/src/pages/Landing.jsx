import { Link } from "react-router-dom";
import { Sparkles, Stethoscope, MessageCircle, ShieldAlert, Pill, ArrowRight, CheckCircle2, Heart, Activity, Globe, FileText } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(180deg,#F4F6FF 0%,#EDF1FF 50%,#F8F4FF 100%)" }}>
      {/* Top nav */}
      <nav className="px-6 sm:px-12 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}>
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <div className="font-display font-bold text-[16px]" style={{ color: "#0F1836" }}>Project Care</div>
            <div className="text-[10px]" style={{ color: "#6B7595" }}>AI-Powered Continuous Patient Care</div>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <a href="#how-it-works" className="hidden md:inline text-[13px]" style={{ color: "#2A3558" }}>How it works</a>
          <a href="#features" className="hidden md:inline text-[13px]" style={{ color: "#2A3558" }}>Features</a>
          <Link to="/architecture" className="hidden md:inline text-[13px]" style={{ color: "#2A3558" }} data-testid="nav-architecture-link">Architecture</Link>
          <Link to="/login" className="btn-ghost text-[13px]" data-testid="nav-login-btn">Sign in</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 sm:px-12 pt-8 sm:pt-16 pb-16 max-w-[1180px] mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7 flex flex-col gap-6">
            <div className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-full text-[11.5px] font-semibold" style={{ background: "rgba(91,124,250,0.10)", color: "#5B7CFA" }}>
              <Heart size={11} fill="#5B7CFA" /> Built by a practicing MBBS doctor
            </div>
            <h1 className="font-display font-bold leading-[1.05] text-4xl sm:text-5xl lg:text-6xl" style={{ color: "#0F1836" }}>
              AI-Powered<br />
              <span style={{ background: "linear-gradient(90deg,#5B7CFA,#7C4DFF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Post-Consultation</span><br />
              Care System
            </h1>
            <p className="text-base sm:text-lg max-w-[560px]" style={{ color: "#2A3558" }}>
              Improve patient adherence, reduce missed risks, and deliver continuous care beyond the consultation room — through structured AI follow-up, vision-based file analysis, and real-time clinical alerts.
            </p>
            <div className="flex flex-col items-start gap-2">
              <Link to="/demo" className="btn-primary inline-flex items-center gap-2 text-[14px] px-5 py-3" data-testid="cta-try-demo">
                <Sparkles size={16} /> Experience Live Demo <ArrowRight size={16} />
              </Link>
              <div className="text-[12px]" style={{ color: "#6B7595" }} data-testid="cta-support-text">
                No login required · 2-minute guided experience
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2 text-[12px]" style={{ color: "#6B7595" }}>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={13} className="text-[#3CC97C]" /> Built by a practicing MBBS doctor</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={13} className="text-[#3CC97C]" /> 24/7 multilingual follow-up</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={13} className="text-[#3CC97C]" /> WhatsApp + Web</span>
            </div>
          </div>

          {/* Visual */}
          <div className="lg:col-span-5">
            <div className="glass-card p-5 flex flex-col gap-3 relative" style={{ boxShadow: "0 30px 60px rgba(91,124,250,0.18)" }}>
              <div className="flex items-center gap-2.5 pb-3 border-b border-[#5B7CFA]/12">
                <div className="w-9 h-9 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}>
                  <Sparkles size={16} className="text-white" />
                </div>
                <div className="flex-1">
                  <div className="font-display font-semibold text-[14px]" style={{ color: "#0F1836" }}>Care AI · Live triage</div>
                  <div className="text-[11px]" style={{ color: "#6B7595" }}>Patryk · post-diabetes follow-up</div>
                </div>
                <span className="badge badge-success text-[10px]">Online</span>
              </div>
              <div className="flex flex-col gap-2 text-[13px]">
                <div className="rounded-2xl px-3 py-2.5 self-end max-w-[80%] text-white" style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}>
                  I'm dizzy and weak, also sweating.
                </div>
                <div className="rounded-2xl px-3 py-2.5 bg-white border border-white max-w-[88%]" style={{ color: "#0F1836" }}>
                  Patryk, that combination after insulin is concerning. What's your blood sugar right now?
                </div>
                <div className="rounded-2xl px-3 py-2.5 self-end max-w-[80%] text-white" style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}>
                  68 mg/dL.
                </div>
                <div className="rounded-2xl px-3 py-2.5 bg-[#FFE9E9] border border-[#E85A5A]/30 max-w-[88%]" style={{ color: "#7B1F1F" }}>
                  <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider mb-1 px-2 py-0.5 rounded-full text-white" style={{ background: "#E85A5A" }}>
                    <ShieldAlert size={10} /> Emergency
                  </div>
                  Possible hypoglycemia. Please take 15g of fast-acting glucose now and recheck in 15 minutes. Dr. Lahari has been alerted.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="px-6 sm:px-12 py-16 max-w-[1180px] mx-auto">
        <div className="text-center max-w-[640px] mx-auto mb-10">
          <div className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "#5B7CFA" }}>How it works</div>
          <h2 className="font-display font-bold text-3xl sm:text-4xl mb-3" style={{ color: "#0F1836" }}>Care that doesn't end at the door</h2>
          <p className="text-base" style={{ color: "#6B7595" }}>Every consultation kicks off a continuous, AI-monitored care loop — so risks aren't missed and patients aren't left alone with their prescriptions.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { icon: Stethoscope, t: "1 · Smart consultation", d: "Care AI collects a structured history (name, age, sex, symptoms, severity, timeline) using selectable chips. Doctor sees a clean clinical handoff.", c: "#5B7CFA" },
            { icon: Pill, t: "2 · AI-drafted prescription", d: "Doctor reviews an AI-suggested Rx that respects allergies and current meds — modify, add, delete, approve.", c: "#7C4DFF" },
            { icon: MessageCircle, t: "3 · 24/7 continuous follow-up", d: "Patient chats with Care AI on web or WhatsApp — voice notes, photos, lab reports — with auto-escalation to the doctor on red flags.", c: "#3CC97C" },
          ].map((f) => (
            <div key={f.t} className="glass-card flex flex-col gap-2.5">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: `${f.c}1A` }}>
                <f.icon size={20} style={{ color: f.c }} />
              </div>
              <h3 className="font-display font-semibold text-[16px]" style={{ color: "#0F1836" }}>{f.t}</h3>
              <p className="text-[13px] leading-relaxed" style={{ color: "#6B7595" }}>{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features grid */}
      <section id="features" className="px-6 sm:px-12 py-16 max-w-[1180px] mx-auto">
        <div className="text-center max-w-[640px] mx-auto mb-10">
          <div className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "#7C4DFF" }}>Why clinicians pick Project Care</div>
          <h2 className="font-display font-bold text-3xl sm:text-4xl mb-3" style={{ color: "#0F1836" }}>Designed for real clinical workflows</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: ShieldAlert, t: "Real-time red-flag alerts", d: "Hypoglycemia, chest pain, sepsis-like symptoms — escalated to the doctor the moment Care AI hears them.", c: "#E85A5A" },
            { icon: FileText, t: "Vision-based image triage", d: "Patient uploads a prescription, lab report, or symptom photo — GPT-4o vision extracts data + summarises for the doctor.", c: "#F2994A" },
            { icon: Globe, t: "Multilingual care", d: "English, Hindi, Telugu, Tamil — voice + text. Every reply localised to the patient's preferred language.", c: "#5B7CFA" },
            { icon: MessageCircle, t: "WhatsApp continuity", d: "OTP-linked WhatsApp chat — same Care AI brain, same triage, same alerts. Voice notes auto-transcribed.", c: "#3CC97C" },
            { icon: Activity, t: "False-alert correction", d: "When the patient clarifies, prior alerts auto-clear. The doctor sees a clean update — no noise.", c: "#7C4DFF" },
            { icon: Pill, t: "Adherence by default", d: "Prescriptions parsed into auto-reminders — patients are nudged, doctors get an audit trail.", c: "#5B7CFA" },
          ].map((f) => (
            <div key={f.t} className="glass-soft p-4 flex flex-col gap-2">
              <div className="w-9 h-9 rounded-2xl flex items-center justify-center" style={{ background: `${f.c}1A` }}>
                <f.icon size={17} style={{ color: f.c }} />
              </div>
              <div className="font-display font-semibold text-[14px]" style={{ color: "#0F1836" }}>{f.t}</div>
              <div className="text-[12.5px] leading-relaxed" style={{ color: "#6B7595" }}>{f.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 sm:px-12 pb-20 max-w-[980px] mx-auto">
        <div className="glass-card text-center p-8 sm:p-12" style={{ background: "linear-gradient(135deg,#5B7CFA0d,#7C4DFF0d)" }}>
          <h2 className="font-display font-bold text-3xl sm:text-4xl mb-3" style={{ color: "#0F1836" }}>See it for yourself</h2>
          <p className="text-base mb-6 max-w-[480px] mx-auto" style={{ color: "#6B7595" }}>A 2-minute, fully scripted demo. No signup. No empty states. Just the experience.</p>
          <Link to="/demo" className="btn-primary inline-flex items-center gap-2 text-[14px] px-5 py-3" data-testid="cta-bottom-demo">
            <Sparkles size={16} /> Experience Live Demo <ArrowRight size={16} />
          </Link>
          <div className="text-[12px] mt-3" style={{ color: "#6B7595" }}>No login required · 2-minute guided experience</div>
        </div>
      </section>

      <footer className="px-6 sm:px-12 py-6 text-[11px] text-center" style={{ color: "#6B7595" }}>
        © 2026 Project Care · Built by a practicing MBBS doctor. Demo data for evaluation only.
      </footer>
    </div>
  );
}

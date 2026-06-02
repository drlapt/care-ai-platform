import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Mic, Pill, FlaskConical, AlertTriangle, ShieldAlert, Stethoscope, ChevronRight, Bot, Loader2, Eye } from "lucide-react";
import { rxAiGuidance } from "@/lib/api";

function Pill_({ children, color = "#5B7CFA" }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11.5px] font-medium"
      style={{ background: `${color}14`, color }}
    >
      {children}
    </span>
  );
}

function urgencyColor(u) {
  return u === "stat" ? "#E85A5A" : u === "urgent" ? "#F2994A" : "#5B7CFA";
}

export default function ActiveConsultPanel({ session }) {
  const [guidance, setGuidance] = useState(null);
  const [guidanceLoading, setGuidanceLoading] = useState(false);
  const [guidanceError, setGuidanceError] = useState(false);

  // Phase 12 — Auto-fetch AI gap suggestions for the live patient.
  useEffect(() => {
    if (!session?.patient_id) {
      setGuidance(null);
      return;
    }
    let alive = true;
    setGuidanceLoading(true);
    setGuidanceError(false);
    const intake = session.intake_summary || {};
    const meds = (intake.current_medications || []).map((m) => (typeof m === "string" ? m : (m.name || m.medication))).filter(Boolean);
    rxAiGuidance({
      patient_id: session.patient_id,
      chief_complaint: intake.chief_complaint || session.reason || "",
      current_diagnosis: intake.assessment || "",
      current_medications: meds,
      current_investigations: [],
    })
      .then((d) => { if (alive) setGuidance(d); })
      .catch(() => { if (alive) { setGuidance(null); setGuidanceError(true); } })
      .finally(() => { if (alive) setGuidanceLoading(false); });
    return () => { alive = false; };
  }, [session?.id, session?.patient_id]);

  if (!session) {
    return (
      <section className="glass-card p-6 flex flex-col gap-4 min-h-[280px]" data-testid="active-consult-empty">
        <header className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}>
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <div className="font-display font-bold text-[20px]" style={{ color: "#0F1836" }}>Active consultation</div>
            <div className="text-[12px]" style={{ color: "#6B7595" }}>Live preview · AI co-pilot ready</div>
          </div>
        </header>
        <div className="flex-1 glass-soft rounded-2xl flex flex-col items-center justify-center text-center py-10 gap-3">
          <Stethoscope size={28} className="text-[#5B7CFA]" />
          <div>
            <div className="font-semibold text-[16px]" style={{ color: "#0F1836" }}>No live consultation</div>
            <div className="text-[12.5px] mt-1" style={{ color: "#6B7595" }}>Start the next patient from the queue or schedule.</div>
          </div>
          <Link to="/appointments" className="btn-primary inline-flex items-center gap-1.5 text-[12.5px] py-2 px-3" data-testid="active-consult-start-cta">
            <Stethoscope size={13} /> Start a consultation
          </Link>
        </div>
      </section>
    );
  }

  const intake = session.intake_summary || {};
  const symptoms = intake.symptoms || intake.key_symptoms || [];
  const meds = intake.current_medications || [];
  const allergies = intake.allergies || [];
  const redFlags = intake.red_flags || [];
  const assessment = intake.assessment || intake.chief_complaint || session.reason || "Consultation in progress";
  const patientName = session.patient_name || "Patient";

  const investigations = guidance?.investigations || [];
  const missed = guidance?.missed_symptoms || [];
  const followUpHint = guidance?.follow_up || "";
  const hasSuggestions = investigations.length > 0 || missed.length > 0 || !!followUpHint;

  return (
    <section className="glass-card p-6 flex flex-col gap-4 min-h-[280px]" data-testid="active-consult-panel">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-[15px] shrink-0" style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}>
            {(patientName || "?").split(" ").map((n) => n[0]).slice(0, 2).join("")}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-display font-bold text-[20px] truncate" style={{ color: "#0F1836" }}>{patientName}</h3>
              <span className="badge inline-flex items-center gap-1 !py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5B7CFA] animate-pulse" /> Live
              </span>
            </div>
            <div className="text-[12px] mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: "#6B7595" }}>
              <span className="inline-flex items-center gap-1"><Bot size={11} className="text-[#7C4DFF]" /> AI co-pilot active</span>
              <span>·</span>
              <span className="truncate">{assessment}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/consult/${session.id}`} className="btn-ghost inline-flex items-center gap-1 text-[12.5px] py-2 px-3" data-testid="active-consult-open">
            Open <ChevronRight size={12} />
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="active-consult-summary">
        <div className="glass-soft p-3 rounded-2xl">
          <div className="text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#6B7595" }}>AI-extracted symptoms</div>
          <div className="flex flex-wrap gap-1.5">
            {(symptoms.length ? symptoms : ["—"]).slice(0, 5).map((s, i) => <Pill_ key={i} color="#5B7CFA">{typeof s === "string" ? s : (s.name || s.symptom || JSON.stringify(s))}</Pill_>)}
          </div>
        </div>
        <div className="glass-soft p-3 rounded-2xl">
          <div className="text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#6B7595" }}>Current meds</div>
          <div className="flex flex-wrap gap-1.5">
            {(meds.length ? meds : ["None"]).slice(0, 4).map((m, i) => <Pill_ key={i} color="#7C4DFF">{typeof m === "string" ? m : (m.name || m.medication)}</Pill_>)}
          </div>
        </div>
        <div className="glass-soft p-3 rounded-2xl" style={allergies.length ? { background: "rgba(232,90,90,0.06)" } : {}}>
          <div className="text-[11px] font-bold uppercase tracking-wider mb-1.5 inline-flex items-center gap-1" style={{ color: allergies.length ? "#9C2E2E" : "#6B7595" }}>
            {allergies.length > 0 && <ShieldAlert size={11} />} Allergies
          </div>
          <div className="flex flex-wrap gap-1.5">
            {allergies.length ? allergies.slice(0, 4).map((a, i) => <Pill_ key={i} color="#E85A5A">{typeof a === "string" ? a : (a.allergen || a.name)}</Pill_>) : <span className="text-[12px]" style={{ color: "#6B7595" }}>NKDA</span>}
          </div>
        </div>
      </div>

      {redFlags.length > 0 && (
        <div className="rounded-2xl p-3 flex items-start gap-2" style={{ background: "rgba(232,90,90,0.10)", border: "1px solid rgba(232,90,90,0.25)" }} data-testid="active-consult-redflags">
          <AlertTriangle size={16} className="text-[#E85A5A] mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-[12px] font-bold" style={{ color: "#9C2E2E" }}>Red flags detected</div>
            <div className="text-[12px] mt-0.5" style={{ color: "#9C2E2E" }}>{redFlags.slice(0, 3).join(" · ")}</div>
          </div>
        </div>
      )}

      {/* AI co-pilot live suggestions (Phase 12) */}
      <div
        className="rounded-2xl p-3 flex flex-col gap-3"
        style={{ background: "linear-gradient(135deg, rgba(91,124,250,0.06), rgba(124,77,255,0.06))" }}
        data-testid="active-consult-ai"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[#7C4DFF]" />
          <div className="text-[12px] font-bold inline-flex items-center gap-1.5" style={{ color: "#3F2F7A" }}>
            AI co-pilot · suggestions
            {guidanceLoading && <Loader2 size={12} className="animate-spin text-[#7C4DFF]" />}
          </div>
        </div>

        {guidanceLoading && !guidance && (
          <div className="text-[12px]" style={{ color: "#2A3558" }}>Analyzing intake & history…</div>
        )}

        {!guidanceLoading && guidanceError && (
          <div className="text-[12px]" style={{ color: "#6B7595" }}>Suggestions temporarily unavailable.</div>
        )}

        {!guidanceLoading && !guidanceError && !hasSuggestions && (
          <div className="text-[12px]" style={{ color: "#2A3558" }}>
            No additional gaps flagged. Open the consultation to draft Rx & finalise.
          </div>
        )}

        {investigations.length > 0 && (
          <div data-testid="active-consult-ai-tests">
            <div className="text-[10.5px] font-bold uppercase tracking-wider mb-1.5 inline-flex items-center gap-1" style={{ color: "#6B7595" }}>
              <FlaskConical size={10} /> Suggested tests
            </div>
            <div className="flex flex-wrap gap-1.5">
              {investigations.slice(0, 4).map((it, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium"
                  style={{ background: `${urgencyColor(it.urgency)}14`, color: urgencyColor(it.urgency) }}
                  title={it.reason}
                  data-testid={`active-consult-ai-test-${i}`}
                >
                  <span className="font-bold uppercase tracking-wider text-[9.5px]">{it.urgency}</span>
                  {it.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {missed.length > 0 && (
          <div data-testid="active-consult-ai-missed">
            <div className="text-[10.5px] font-bold uppercase tracking-wider mb-1.5 inline-flex items-center gap-1" style={{ color: "#6B7595" }}>
              <Eye size={10} /> Did you ask about?
            </div>
            <ul className="flex flex-col gap-0.5">
              {missed.slice(0, 3).map((m, i) => (
                <li key={i} className="text-[12px]" style={{ color: "#2A3558" }} data-testid={`active-consult-ai-missed-${i}`}>· {m}</li>
              ))}
            </ul>
          </div>
        )}

        {followUpHint && (
          <div className="text-[12px] inline-flex items-start gap-1.5" style={{ color: "#3F2F7A" }} data-testid="active-consult-ai-followup">
            <Bot size={12} className="mt-0.5 shrink-0" />
            <span>{followUpHint}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap pt-1" data-testid="active-consult-actions">
        <Link to={`/consult/${session.id}`} className="btn-primary inline-flex items-center gap-1.5 text-[12.5px] py-2 px-3" data-testid="active-consult-rx">
          <Pill size={13} /> Build Rx
        </Link>
        <Link to={`/consult/${session.id}`} className="btn-ghost inline-flex items-center gap-1.5 text-[12.5px] py-2 px-3">
          <Mic size={13} /> Voice note
        </Link>
        <Link to={`/consult/${session.id}`} className="btn-ghost inline-flex items-center gap-1.5 text-[12.5px] py-2 px-3">
          <FlaskConical size={13} /> Order labs
        </Link>
      </div>
    </section>
  );
}

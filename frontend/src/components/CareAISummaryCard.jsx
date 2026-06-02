import { AlertTriangle, CheckCircle2, Clock, Sparkles, FileText, Stethoscope, ListChecks, Activity } from "lucide-react";

const URGENCY_CONFIG = {
  emergency: { label: "EMERGENCY", bg: "linear-gradient(135deg,#E85A5A,#C94747)", color: "#fff", chip: "#E85A5A", icon: AlertTriangle, text: "Call emergency services or go to the ER now." },
  high: { label: "HIGH PRIORITY", bg: "linear-gradient(135deg,#F5A623,#E8860B)", color: "#fff", chip: "#C77800", icon: AlertTriangle, text: "Needs same-day physician attention." },
  medium: { label: "ROUTINE", bg: "linear-gradient(135deg,#5B7CFA,#7C4DFF)", color: "#fff", chip: "#5B7CFA", icon: Clock, text: "Schedule evaluation within a few days." },
  low: { label: "LOW PRIORITY", bg: "rgba(60,201,124,0.15)", color: "#1E7E45", chip: "#28A55B", icon: CheckCircle2, text: "Stable — routine follow-up." },
};

/**
 * CareAISummaryCard
 *   - Renders the clinical handoff from Care AI as an at-a-glance summary.
 *   - Props: urgency ("emergency"|"high"|"medium"|"low"), handoff (object), redFlags (array), summary (string), size ("compact"|"full")
 */
export default function CareAISummaryCard({ urgency, handoff, redFlags = [], summary, size = "full" }) {
  const cfg = URGENCY_CONFIG[urgency] || URGENCY_CONFIG.medium;
  const Icon = cfg.icon;

  return (
    <div className="glass-card overflow-hidden p-0" data-testid="care-ai-summary-card">
      {/* Urgency banner */}
      <div className="px-5 py-3 flex items-center gap-3" style={{ background: cfg.bg, color: cfg.color }}>
        <Icon size={18} />
        <div className="flex-1">
          <div className="font-display font-bold text-[15px] tracking-wide">{cfg.label}</div>
          <div className="text-[12px] opacity-90">{cfg.text}</div>
        </div>
        <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold bg-white/20 rounded-full px-2.5 py-1">
          <Sparkles size={11} /> Care AI Intake
        </div>
      </div>

      <div className="p-5 flex flex-col gap-4">
        {/* Chief complaint */}
        {handoff?.chief_complaint && (
          <div>
            <Label icon={FileText}>Chief complaint</Label>
            <div className="text-[14px]" style={{ color: "#0F1836" }}>{handoff.chief_complaint}</div>
          </div>
        )}

        {/* HPI */}
        {(handoff?.hpi || summary) && (
          <div>
            <Label icon={Stethoscope}>History of Present Illness</Label>
            <div className="text-[13.5px] leading-relaxed" style={{ color: "#2A3558" }}>{handoff?.hpi || summary}</div>
          </div>
        )}

        {/* Red flags */}
        {redFlags?.length > 0 && (
          <div>
            <Label icon={AlertTriangle} danger>Red flags identified</Label>
            <ul className="flex flex-col gap-1.5">
              {redFlags.map((rf, i) => {
                const isObj = rf && typeof rf === "object";
                const finding = isObj ? (rf.finding || rf.symptom || rf.description || JSON.stringify(rf)) : String(rf);
                const sev = (isObj ? rf.severity : "") || "";
                return (
                  <li key={i} className="glass-soft px-3 py-2 text-[13px] flex items-start justify-between gap-3" style={{ background: "rgba(232,90,90,0.08)", borderColor: "rgba(232,90,90,0.3)" }}>
                    <span className="flex-1" style={{ color: "#2A3558" }}>⚠ {finding}</span>
                    {sev && <span className={`badge text-[10px] ${sev.toLowerCase() === "high" ? "badge-danger" : sev.toLowerCase() === "medium" ? "badge-warning" : ""}`}>{sev}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {size === "full" && (
          <>
            {/* Review of systems */}
            {handoff?.ros?.length > 0 && (
              <div>
                <Label icon={ListChecks}>Review of systems</Label>
                <div className="flex flex-wrap gap-1.5">
                  {handoff.ros.map((r, i) => <span key={i} className="badge text-[11px]" style={{ color: "#2A3558" }}>{r}</span>)}
                </div>
              </div>
            )}

            {/* Assessment */}
            {handoff?.assessment && (
              <div>
                <Label icon={Activity}>Care AI Assessment</Label>
                <div className="text-[13.5px] leading-relaxed" style={{ color: "#2A3558" }}>{handoff.assessment}</div>
              </div>
            )}

            {/* Recommendations */}
            {handoff?.recommendations?.length > 0 && (
              <div>
                <Label icon={ListChecks}>Recommended next steps</Label>
                <ul className="flex flex-col gap-1.5">
                  {handoff.recommendations.map((r, i) => (
                    <li key={i} className="glass-soft px-3 py-2 text-[13px]" style={{ color: "#2A3558" }}>{i + 1}. {r}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {/* Footer meta */}
        <div className="flex items-center justify-between pt-2 border-t border-white/60 text-[11px]" style={{ color: "#6B7595" }}>
          <span className="inline-flex items-center gap-1"><Sparkles size={10} /> Care AI</span>
          {handoff?.confidence && <span>Confidence: <strong className="capitalize" style={{ color: "#0F1836" }}>{handoff.confidence}</strong></span>}
        </div>
      </div>
    </div>
  );
}

function Label({ icon: Icon, children, danger }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <Icon size={12} className={danger ? "text-[#E85A5A]" : "text-[#5B7CFA]"} />
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: danger ? "#E85A5A" : "#6B7595" }}>{children}</span>
    </div>
  );
}

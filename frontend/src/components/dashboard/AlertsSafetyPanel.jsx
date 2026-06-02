import { Link } from "react-router-dom";
import { ShieldCheck, ShieldAlert, ChevronRight, BellRing } from "lucide-react";

const URGENCY_DOT = {
  emergency: "#E85A5A",
  high: "#E85A5A",
  medium: "#F2994A",
  low: "#5B7CFA",
  info: "#7C4DFF",
};

export default function AlertsSafetyPanel({ alerts = [] }) {
  const open = alerts.filter((a) => a.status === "open" || !a.status);
  const top = open.slice(0, 4);

  return (
    <section
      className="glass-card flex flex-col gap-3"
      style={{ borderTop: open.length > 0 ? "3px solid #E85A5A" : "3px solid #3CC97C" }}
      data-testid="alerts-safety-panel"
      aria-live="polite"
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: open.length > 0 ? "rgba(232,90,90,0.12)" : "rgba(60,201,124,0.12)" }}
          >
            {open.length > 0
              ? <ShieldAlert size={16} className="text-[#E85A5A]" />
              : <ShieldCheck size={16} className="text-[#3CC97C]" />}
          </div>
          <div>
            <h3 className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>Safety alerts</h3>
            <div className="text-[11.5px]" style={{ color: "#6B7595" }}>
              {open.length > 0 ? `${open.length} need attention` : "All systems nominal"}
            </div>
          </div>
        </div>
        {open.length > 0 && (
          <Link to="/alerts" className="text-[12px] font-semibold inline-flex items-center gap-0.5" style={{ color: "#E85A5A" }} data-testid="alerts-view-all">
            Resolve <ChevronRight size={12} />
          </Link>
        )}
      </header>

      {top.length === 0 ? (
        <div className="glass-soft p-5 flex flex-col items-center text-center gap-1.5">
          <ShieldCheck size={20} className="text-[#3CC97C]" />
          <div className="font-semibold text-[14px]" style={{ color: "#0F1836" }}>No critical alerts</div>
          <div className="text-[12px]" style={{ color: "#6B7595" }}>Care AI hasn't flagged anything.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {top.map((a) => {
            const dot = URGENCY_DOT[a.urgency] || "#5B7CFA";
            return (
              <Link
                key={a.id}
                to={a.patient_id ? `/patients/${a.patient_id}/alerts` : "/alerts"}
                className="flex items-start gap-3 p-3 rounded-2xl transition hover:shadow-md"
                style={{ background: `${dot}10`, borderLeft: `3px solid ${dot}` }}
                data-testid={`alert-item-${a.id}`}
              >
                <div className="w-2 h-2 rounded-full mt-2 shrink-0 animate-pulse" style={{ background: dot }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold text-[13px] truncate" style={{ color: "#0F1836" }}>
                      {a.patient_name || "Patient"}
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: dot }}>{a.urgency || "alert"}</span>
                  </div>
                  <div className="text-[12px] mt-0.5 line-clamp-2" style={{ color: "#2A3558" }}>
                    {a.topic || a.summary || "Care AI flagged a concern."}
                  </div>
                </div>
                <BellRing size={14} className="shrink-0" style={{ color: dot }} />
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

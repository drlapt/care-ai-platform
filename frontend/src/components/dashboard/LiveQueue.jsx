import { Link } from "react-router-dom";
import { Coffee, Bot, ChevronRight, AlertTriangle } from "lucide-react";

function initials(name) {
  return (name || "?").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

function urgencyTone(urgent) {
  return urgent
    ? { bg: "rgba(232,90,90,0.10)", border: "#E85A5A", color: "#9C2E2E", label: "Urgent" }
    : { bg: "rgba(91,124,250,0.10)", border: "#5B7CFA", color: "#3F4F8A", label: "Normal" };
}

export default function LiveQueue({ items = [] }) {
  return (
    <section
      className="glass-card flex flex-col gap-3"
      data-testid="live-queue"
      aria-live="polite"
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="relative w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(124,77,255,0.12)" }}>
            <Bot size={16} className="text-[#7C4DFF]" />
            {items.length > 0 && (
              <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full flex items-center justify-center" style={{ background: "#7C4DFF" }}>
                <span className="absolute inline-flex h-full w-full rounded-full animate-ping opacity-60" style={{ background: "#7C4DFF" }} />
              </span>
            )}
          </div>
          <div>
            <h3 className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>Live queue</h3>
            <div className="text-[11.5px]" style={{ color: "#6B7595" }}>{items.length} waiting · AI intake auto-runs</div>
          </div>
        </div>
        <Link to="/appointments" className="text-[12px] font-semibold inline-flex items-center gap-0.5" style={{ color: "#5B7CFA" }} data-testid="queue-view-all">
          Manage <ChevronRight size={12} />
        </Link>
      </header>

      {items.length === 0 ? (
        <div className="glass-soft p-5 flex flex-col items-center text-center gap-1.5">
          <Coffee size={20} className="text-[#6B7595]" />
          <div className="font-semibold text-[14px]" style={{ color: "#0F1836" }}>Queue is clear</div>
          <div className="text-[12px]" style={{ color: "#6B7595" }}>No patients waiting right now.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.slice(0, 5).map((q) => {
            const t = urgencyTone(q.urgent);
            return (
              <Link
                key={q.id}
                to={`/consult/new?appointment_id=${q.id}`}
                className="flex items-center gap-3 p-3 rounded-2xl transition hover:shadow-md"
                style={{ background: t.bg, borderLeft: `3px solid ${t.border}` }}
                data-testid={`queue-item-${q.id}`}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-[13px]"
                  style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}
                >
                  {initials(q.patient_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold text-[13.5px] truncate" style={{ color: "#0F1836" }}>{q.patient_name || "Patient"}</div>
                    {q.intake_complete && (
                      <span className="badge badge-success inline-flex items-center gap-1 !py-0.5">
                        <Bot size={10} /> Intake
                      </span>
                    )}
                  </div>
                  <div className="text-[11.5px] truncate" style={{ color: t.color }}>
                    {q.urgent && <AlertTriangle size={10} className="inline mr-1" />}
                    {q.reason || "General consultation"} · {q.waited_min}m wait
                  </div>
                </div>
                <span className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: t.border }}>{t.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

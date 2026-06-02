import { Link } from "react-router-dom";
import { CalendarX, Clock, Stethoscope, ChevronRight } from "lucide-react";

const STATUS_STYLE = {
  in_progress: { dot: "#5B7CFA", label: "In progress", pulse: true },
  scheduled:   { dot: "#7C4DFF", label: "Upcoming",    pulse: false },
  requested:   { dot: "#F2994A", label: "Requested",   pulse: true  },
  completed:   { dot: "#3CC97C", label: "Completed",   pulse: false },
  ended:       { dot: "#3CC97C", label: "Completed",   pulse: false },
  cancelled:   { dot: "#9AA3BD", label: "Cancelled",   pulse: false },
};

export default function ScheduleTimeline({ items = [] }) {
  return (
    <section className="glass-card flex flex-col gap-3" data-testid="schedule-timeline">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(91,124,250,0.12)" }}>
            <Clock size={16} className="text-[#5B7CFA]" />
          </div>
          <h3 className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>Today's schedule</h3>
        </div>
        <Link to="/appointments" className="text-[12px] font-semibold inline-flex items-center gap-0.5" style={{ color: "#5B7CFA" }} data-testid="schedule-view-all">
          View all <ChevronRight size={12} />
        </Link>
      </header>

      {items.length === 0 ? (
        <div className="glass-soft p-6 flex flex-col items-center text-center gap-2">
          <CalendarX size={20} className="text-[#6B7595]" />
          <div className="font-semibold text-[14px]" style={{ color: "#0F1836" }}>Open schedule</div>
          <div className="text-[12.5px]" style={{ color: "#6B7595" }}>No appointments left for the rest of the day.</div>
        </div>
      ) : (
        <div className="flex flex-col">
          {items.slice(0, 6).map((a, idx) => {
            const s = STATUS_STYLE[a.status] || STATUS_STYLE.scheduled;
            return (
              <Link
                key={a.id}
                to={`/consult/new?appointment_id=${a.id}`}
                className="flex items-start gap-3 py-3 border-b border-white/40 last:border-0 hover:bg-white/40 transition rounded-lg px-1 -mx-1"
                data-testid={`schedule-item-${a.id}`}
              >
                <div className="flex flex-col items-center pt-1 min-w-[44px]">
                  <div className="text-[12px] font-bold tabular-nums" style={{ color: "#0F1836" }}>{a.time}</div>
                  <div className="relative mt-1.5">
                    <span className="block w-2 h-2 rounded-full" style={{ background: s.dot }} />
                    {s.pulse && (
                      <span className="absolute inset-0 w-2 h-2 rounded-full animate-ping" style={{ background: s.dot, opacity: 0.5 }} />
                    )}
                  </div>
                  {idx < items.length - 1 && idx < 5 && (
                    <div className="w-[2px] flex-1 mt-1" style={{ background: "rgba(91,124,250,0.15)" }} />
                  )}
                </div>
                <div className="flex-1 min-w-0 pb-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-[14px] truncate" style={{ color: "#0F1836" }}>{a.patient_name || "Patient"}</div>
                    <span className="text-[10.5px] font-bold uppercase tracking-wider shrink-0" style={{ color: s.dot }}>{s.label}</span>
                  </div>
                  <div className="text-[12px] truncate flex items-center gap-1.5 mt-0.5" style={{ color: "#6B7595" }}>
                    <Stethoscope size={11} /> {a.reason || a.type || "Consultation"}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

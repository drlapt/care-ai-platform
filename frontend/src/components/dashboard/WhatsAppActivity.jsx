import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, Mic, ChevronRight, Coffee, ShieldOff, ShieldAlert, Brain, HelpCircle, Zap, Pause } from "lucide-react";
import { whatsappActivity } from "@/lib/api";

const MODE_META = {
  safety:     { color: "#E85A5A", label: "SAFETY",     icon: ShieldOff,    rank: 0 },
  escalation: { color: "#F2994A", label: "ESCALATION", icon: ShieldAlert,  rank: 1 },
  inquiry:    { color: "#5B7CFA", label: "INQUIRY",    icon: HelpCircle,   rank: 2 },
  reasoning:  { color: "#7C4DFF", label: "REASONING",  icon: Brain,        rank: 3 },
  action:     { color: "#28A55B", label: "ACTION",     icon: Zap,          rank: 4 },
  delay:      { color: "#9AA3BD", label: "DELAY",      icon: Pause,        rank: 5 },
};

function fmtTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const diffM = Math.round((Date.now() - d.getTime()) / 60000);
    if (diffM < 1) return "now";
    if (diffM < 60) return `${diffM}m`;
    if (diffM < 24 * 60) return `${Math.round(diffM / 60)}h`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function initials(name) {
  return (name || "?").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

export default function WhatsAppActivity() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    whatsappActivity()
      .then(setData)
      .catch(() => setData({ threads: [], total_messages: 0 }))
      .finally(() => setLoading(false));
  }, []);

  const threads = data?.threads || [];
  const total = data?.total_messages || 0;
  const triageCount = threads.filter((t) => t.mode === "safety" || t.mode === "escalation").length;

  return (
    <section className="glass-card flex flex-col gap-3" data-testid="whatsapp-activity">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: triageCount > 0 ? "rgba(232,90,90,0.12)" : "rgba(60,201,124,0.14)" }}
          >
            <MessageCircle size={16} className={triageCount > 0 ? "text-[#E85A5A]" : "text-[#28A55B]"} />
          </div>
          <div>
            <h3 className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>WhatsApp · 24h</h3>
            <div className="text-[11.5px]" style={{ color: "#6B7595" }}>
              {loading ? "Loading…" : (
                <>
                  {total} message{total === 1 ? "" : "s"} · {threads.length} thread{threads.length === 1 ? "" : "s"}
                  {triageCount > 0 && (
                    <span className="ml-1.5 font-bold" style={{ color: "#E85A5A" }}>
                      · {triageCount} need{triageCount === 1 ? "s" : ""} triage
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        {threads.length > 0 && (
          <Link
            to={`/followup/${threads[0].patient_id}`}
            className="text-[12px] font-semibold inline-flex items-center gap-0.5"
            style={{ color: triageCount > 0 ? "#E85A5A" : "#28A55B" }}
            data-testid="wa-activity-jump"
          >
            Open <ChevronRight size={12} />
          </Link>
        )}
      </header>

      {threads.length === 0 ? (
        <div className="glass-soft p-5 flex flex-col items-center text-center gap-1.5">
          <Coffee size={20} className="text-[#6B7595]" />
          <div className="font-semibold text-[14px]" style={{ color: "#0F1836" }}>No WhatsApp activity</div>
          <div className="text-[12px]" style={{ color: "#6B7595" }}>Patients haven't messaged Care AI in the last 24 hours.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2" data-testid="wa-threads-list">
          {threads.slice(0, 6).map((t) => {
            const mode = t.mode ? MODE_META[t.mode] : null;
            const isTriage = mode && mode.rank <= 1;
            return (
              <Link
                key={t.patient_id}
                to={`/followup/${t.patient_id}`}
                className="flex items-center gap-3 p-3 rounded-2xl transition hover:shadow-md"
                style={{
                  background: isTriage ? `${mode.color}10` : "rgba(60,201,124,0.06)",
                  borderLeft: `3px solid ${isTriage ? mode.color : "#25D366"}`,
                }}
                data-testid={`wa-thread-${t.patient_id}`}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-[12px] shrink-0"
                  style={{ background: isTriage
                    ? `linear-gradient(135deg, ${mode.color}, ${mode.color}cc)`
                    : "linear-gradient(135deg,#25D366,#128C7E)" }}
                >
                  {initials(t.patient_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="font-semibold text-[13.5px] truncate" style={{ color: "#0F1836" }}>{t.patient_name}</div>
                    {mode && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
                        style={{ background: `${mode.color}18`, color: mode.color }}
                        data-testid={`wa-thread-mode-${t.patient_id}`}
                        title={`Care AI mode: ${mode.label.toLowerCase()}`}
                      >
                        <mode.icon size={9} /> {mode.label}
                      </span>
                    )}
                    {t.has_voice && (
                      <span className="inline-flex items-center gap-0.5 text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md" style={{ background: "rgba(124,77,255,0.14)", color: "#7C4DFF" }}>
                        <Mic size={9} /> Voice
                      </span>
                    )}
                    <span className="text-[11px] ml-auto" style={{ color: "#6B7595" }}>{fmtTime(t.last_at)}</span>
                  </div>
                  <div className="text-[11.5px] truncate mt-0.5" style={{ color: "#2A3558" }}>
                    {t.last_role === "user" ? "" : "AI · "}{t.last_message || "—"}
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

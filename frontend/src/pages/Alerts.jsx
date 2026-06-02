import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ShieldAlert, Heart, Check, MessageCircle, ChevronRight, Pill, Clock, ArrowDown, HelpCircle, X } from "lucide-react";
import { listDoctorAlerts, ackDoctorAlert } from "@/lib/api";
import QuickPrescribeModal from "@/components/QuickPrescribeModal";
import AlertCopilotCard from "@/components/AlertCopilotCard";

const URG_STYLES = {
  emergency: { bg: "#E85A5A", label: "EMERGENCY", icon: AlertTriangle },
  high: { bg: "#F2994A", label: "HIGH", icon: ShieldAlert },
  medium: { bg: "#5B7CFA", label: "MEDIUM", icon: Heart },
  low: { bg: "#3CC97C", label: "ROUTINE", icon: Heart },
  info: { bg: "#7C4DFF", label: "INFO", icon: HelpCircle },
};

const STATUS_BADGE = {
  open: { label: "Active", color: "#E85A5A" },
  pending_confirmation: { label: "Awaiting confirmation", color: "#F2994A" },
  downgraded: { label: "Downgraded", color: "#5B7CFA" },
};

const EVENT_LABEL = {
  created: { txt: "Alert created", icon: AlertTriangle, color: "#E85A5A" },
  updated: { txt: "Alert updated", icon: ShieldAlert, color: "#F2994A" },
  downgrade_proposed: { txt: "Downgrade proposed (awaiting patient confirmation)", icon: ArrowDown, color: "#F2994A" },
  downgraded: { txt: "Severity downgraded", icon: ArrowDown, color: "#5B7CFA" },
  cleared_by_correction: { txt: "Cleared after patient correction", icon: Check, color: "#3CC97C" },
  correction_rejected: { txt: "Patient rejected correction — alert reopened", icon: X, color: "#E85A5A" },
  doctor_resolved: { txt: "Resolved by doctor", icon: Check, color: "#3CC97C" },
  doctor_set_dismissed: { txt: "Dismissed by doctor", icon: X, color: "#6B7595" },
  doctor_set_auto_dismissed: { txt: "Auto-dismissed", icon: Clock, color: "#6B7595" },
};

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [quickRx, setQuickRx] = useState(null); // {patient_id, patient_name, alert_id}

  const load = () => {
    setLoading(true);
    listDoctorAlerts().then(setAlerts).catch(() => setAlerts([])).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const resolve = async (id) => {
    try {
      await ackDoctorAlert(id, "resolved");
      toast.success("Alert resolved");
      setAlerts((a) => a.filter((x) => x.id !== id));
    } catch {
      toast.error("Could not resolve");
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-up" data-testid="alerts-page">
      <header>
        <h1 className="font-display font-extrabold text-[44px] leading-none" style={{ color: "#0F1836" }}>
          Patient <span className="text-gradient">Alerts</span>
        </h1>
        <p className="text-sm mt-2" style={{ color: "#6B7595" }}>Red-flag concerns surfaced by the 24/7 Care AI follow-up. Triage, review the chat, and resolve.</p>
      </header>

      {loading ? (
        <div className="glass-card animate-pulse-soft">Loading alerts…</div>
      ) : alerts.length === 0 ? (
        <div className="glass-card text-center p-10" data-testid="alerts-empty">
          <Check size={28} className="mx-auto mb-3 text-[#3CC97C]" />
          <div className="font-semibold" style={{ color: "#0F1836" }}>All clear</div>
          <div className="text-[13px] mt-1" style={{ color: "#6B7595" }}>No open patient alerts right now.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="alerts-list">
          {alerts.map((a) => {
            const urg = URG_STYLES[a.urgency] || URG_STYLES.medium;
            const statusBadge = STATUS_BADGE[a.status] || STATUS_BADGE.open;
            const isPending = a.status === "pending_confirmation";
            const isDowngraded = a.status === "downgraded";
            const events = Array.isArray(a.events) ? a.events : [];
            return (
              <article key={a.id} className="glass-card flex flex-col gap-3" data-testid={`alert-${a.id}`} style={{ borderLeft: `4px solid ${urg.bg}` }}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full text-white" style={{ background: urg.bg }}>
                      <urg.icon size={10} /> {urg.label}
                    </span>
                    {(isPending || isDowngraded) && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full" style={{ background: `${statusBadge.color}1A`, color: statusBadge.color, border: `1px solid ${statusBadge.color}55` }} data-testid={`alert-status-${a.status}`}>
                        {isPending ? <HelpCircle size={10} /> : <ArrowDown size={10} />} {statusBadge.label}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px]" style={{ color: "#6B7595" }}>
                    {new Date(a.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <div>
                  <div className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>{a.patient_name || "Unknown patient"}</div>
                  <div className="text-[13px] font-medium" style={{ color: "#5B7CFA" }}>{a.topic}</div>
                </div>
                <div className="glass-soft p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "#6B7595" }}>Patient said</div>
                  <div className="text-[13.5px]" style={{ color: "#0F1836" }}>{a.patient_message}</div>
                </div>
                {a.summary && (
                  <div className="text-[13px]" style={{ color: "#2A3558" }}>
                    <span className="font-semibold">AI triage: </span>{a.summary}
                  </div>
                )}
                {isPending && (
                  <div className="rounded-xl p-3 text-[12.5px] flex items-start gap-2" style={{ background: "rgba(242,153,74,0.10)", color: "#7A4A00" }}>
                    <HelpCircle size={14} className="shrink-0 mt-0.5" />
                    <div>
                      Care AI detected a possible correction and is asking the patient to confirm. The alert will auto-clear if the patient says yes — or come back to <b>Active</b> if they say no.
                    </div>
                  </div>
                )}
                {events.length > 0 && (
                  <details className="rounded-xl bg-white/60 px-3 py-2 text-[12px]" data-testid={`alert-timeline-${a.id}`}>
                    <summary className="cursor-pointer font-semibold inline-flex items-center gap-1.5" style={{ color: "#2A3558" }}>
                      <Clock size={12} /> Timeline · {events.length} event{events.length === 1 ? "" : "s"}
                    </summary>
                    <ol className="mt-2 flex flex-col gap-1.5 pl-1">
                      {events.map((ev, i) => {
                        const meta = EVENT_LABEL[ev.event] || { txt: ev.event, icon: ChevronRight, color: "#6B7595" };
                        const Icon = meta.icon;
                        return (
                          <li key={i} className="flex items-start gap-2" data-testid={`alert-event-${ev.event}`}>
                            <Icon size={11} className="mt-0.5 shrink-0" style={{ color: meta.color }} />
                            <div className="flex-1 min-w-0">
                              <div className="text-[11.5px] font-semibold" style={{ color: meta.color }}>{meta.txt}</div>
                              <div className="text-[10.5px]" style={{ color: "#6B7595" }}>
                                {new Date(ev.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                {ev.urgency_before && ev.urgency_after && (
                                  <span> · {ev.urgency_before} → {ev.urgency_after}</span>
                                )}
                                {ev.by && <span> · {ev.by.startsWith("doctor:") ? "by doctor" : `by ${ev.by}`}</span>}
                              </div>
                              {ev.note && <div className="text-[11px] mt-0.5 italic" style={{ color: "#2A3558" }}>"{ev.note}"</div>}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </details>
                )}
                {/* Phase 13 — Autonomous Co-Pilot suggestions */}
                {a.status === "open" && (
                  <AlertCopilotCard
                    alert={a}
                    onPrescribe={(al) => setQuickRx({ patient_id: al.patient_id, patient_name: al.patient_name, alert_id: al.id })}
                  />
                )}
                <div className="flex items-center justify-between mt-1 pt-3 border-t border-white/60 gap-2 flex-wrap">
                  <Link to={`/followup/${a.patient_id}`} className="btn-ghost inline-flex items-center gap-1.5 py-2 px-3 text-[12px]" data-testid={`alert-open-chat-${a.id}`}>
                    <MessageCircle size={13} /> Open chat <ChevronRight size={12} />
                  </Link>
                  <div className="flex gap-1.5">
                    <button onClick={() => setQuickRx({ patient_id: a.patient_id, patient_name: a.patient_name, alert_id: a.id })} className="btn-ghost inline-flex items-center gap-1.5 py-2 px-3 text-[12px]" data-testid={`alert-prescribe-${a.id}`}>
                      <Pill size={13} /> Prescribe
                    </button>
                    <button onClick={() => resolve(a.id)} className="btn-primary inline-flex items-center gap-1.5 py-2 px-3 text-[12px]" data-testid={`alert-resolve-${a.id}`}>
                      <Check size={13} /> Resolve
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {quickRx && (
        <QuickPrescribeModal
          patientId={quickRx.patient_id}
          patientName={quickRx.patient_name}
          alertId={quickRx.alert_id}
          onClose={() => setQuickRx(null)}
          onIssued={() => load()}
        />
      )}
    </div>
  );
}

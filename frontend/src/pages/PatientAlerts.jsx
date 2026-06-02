import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  AlertTriangle, ShieldAlert, Heart, Check, ArrowDown, HelpCircle, X, Clock,
  ChevronRight, ChevronLeft, MessageCircle, FileText, Filter,
} from "lucide-react";
import { getPatientAlertHistory } from "@/lib/api";

const URG = {
  emergency: { bg: "#E85A5A", label: "EMERGENCY", Icon: AlertTriangle },
  high: { bg: "#F2994A", label: "HIGH", Icon: ShieldAlert },
  medium: { bg: "#5B7CFA", label: "MEDIUM", Icon: Heart },
  low: { bg: "#3CC97C", label: "ROUTINE", Icon: Heart },
  info: { bg: "#7C4DFF", label: "INFO", Icon: HelpCircle },
};

const STATUS = {
  open: { label: "Active", color: "#E85A5A" },
  pending_confirmation: { label: "Awaiting confirmation", color: "#F2994A" },
  downgraded: { label: "Downgraded", color: "#5B7CFA" },
  cleared_by_correction: { label: "Cleared (correction)", color: "#3CC97C" },
  resolved: { label: "Resolved", color: "#3CC97C" },
  auto_dismissed: { label: "Auto-dismissed", color: "#6B7595" },
  dismissed: { label: "Dismissed", color: "#6B7595" },
};

const EVENT = {
  created: { txt: "Alert created", Icon: AlertTriangle, color: "#E85A5A" },
  updated: { txt: "Alert updated", Icon: ShieldAlert, color: "#F2994A" },
  downgrade_proposed: { txt: "Downgrade proposed (awaiting patient confirmation)", Icon: ArrowDown, color: "#F2994A" },
  downgraded: { txt: "Severity downgraded", Icon: ArrowDown, color: "#5B7CFA" },
  cleared_by_correction: { txt: "Cleared after patient correction", Icon: Check, color: "#3CC97C" },
  correction_rejected: { txt: "Patient rejected correction — alert reopened", Icon: X, color: "#E85A5A" },
  doctor_resolved: { txt: "Resolved by doctor", Icon: Check, color: "#3CC97C" },
  doctor_set_dismissed: { txt: "Dismissed by doctor", Icon: X, color: "#6B7595" },
  doctor_set_auto_dismissed: { txt: "Auto-dismissed", Icon: Clock, color: "#6B7595" },
};

const ACTIVE_STATUSES = ["open", "pending_confirmation", "downgraded"];
const RESOLVED_STATUSES = ["cleared_by_correction", "resolved", "auto_dismissed", "dismissed"];

const FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "resolved", label: "Resolved" },
  { id: "high", label: "High severity" },
];

export default function PatientAlerts() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    setLoading(true);
    getPatientAlertHistory(id)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [id]);

  const filtered = useMemo(() => {
    if (!data?.alerts) return [];
    if (filter === "active") return data.alerts.filter((a) => ACTIVE_STATUSES.includes(a.status));
    if (filter === "resolved") return data.alerts.filter((a) => RESOLVED_STATUSES.includes(a.status));
    if (filter === "high") return data.alerts.filter((a) => ["emergency", "high"].includes((a.urgency || "").toLowerCase()));
    return data.alerts;
  }, [data, filter]);

  if (loading) {
    return <div className="text-[13px]" style={{ color: "#6B7595" }}>Loading alert history…</div>;
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-up" data-testid="patient-alerts-page">
      <header className="flex flex-col gap-2">
        <Link to={`/patients/${id}`} className="inline-flex items-center gap-1.5 text-[12px] font-semibold w-fit transition hover:opacity-70" style={{ color: "#5B7CFA" }} data-testid="patient-alerts-back-link">
          <ChevronLeft size={13} /> Back to patient
        </Link>
        <h1 className="font-display font-extrabold text-[40px] leading-none" style={{ color: "#0F1836" }}>
          Alert <span className="text-gradient">history</span>
        </h1>
        <p className="text-[14px]" style={{ color: "#6B7595" }}>
          {data?.patient_name || "Patient"} · Full audit trail of every Care AI / doctor alert
        </p>
      </header>

      {/* Counts strip */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="patient-alerts-counts">
        <CountCard label="Total" value={data?.counts?.total ?? 0} color="#0F1836" testid="count-total" />
        <CountCard label="Active" value={data?.counts?.active ?? 0} color="#E85A5A" testid="count-active" />
        <CountCard label="Resolved" value={data?.counts?.resolved ?? 0} color="#3CC97C" testid="count-resolved" />
        <CountCard label="High severity" value={data?.counts?.high_severity ?? 0} color="#F2994A" testid="count-high" />
      </section>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap" data-testid="patient-alerts-filters">
        <Filter size={14} className="opacity-60" style={{ color: "#5B7CFA" }} />
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`pill ${filter === f.id ? "pill-on" : ""}`}
            data-testid={`filter-${f.id}`}
          >
            {f.label}
          </button>
        ))}
        <span className="text-[12px] ml-auto" style={{ color: "#6B7595" }}>
          {filtered.length} of {data?.alerts?.length || 0}
        </span>
      </div>

      {/* Alert list */}
      {filtered.length === 0 ? (
        <div className="glass-card text-center py-10" data-testid="patient-alerts-empty">
          <FileText size={28} className="mx-auto mb-2 opacity-50" style={{ color: "#6B7595" }} />
          <div className="text-[14px]" style={{ color: "#6B7595" }}>No alerts match this filter.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((a) => (
            <AlertCard key={a.id} alert={a} patientId={id} />
          ))}
        </div>
      )}
    </div>
  );
}

function CountCard({ label, value, color, testid }) {
  return (
    <div className="glass-card flex flex-col gap-1 py-3 px-4" data-testid={testid}>
      <div className="text-[10.5px] font-bold uppercase tracking-widest" style={{ color: "#6B7595" }}>{label}</div>
      <div className="font-display font-extrabold text-[28px] leading-none" style={{ color }}>{value}</div>
    </div>
  );
}

function AlertCard({ alert, patientId }) {
  const urg = URG[(alert.urgency || "medium").toLowerCase()] || URG.medium;
  const status = STATUS[alert.status] || STATUS.open;
  const events = Array.isArray(alert.events) ? alert.events : [];
  const initialEvent = events.find((e) => e.event === "created");
  const initialUrg = initialEvent?.urgency_after || alert.urgency;
  const reasonLabel = alert.resolution_reason
    ? alert.resolution_reason.replace(/_/g, " ")
    : null;

  return (
    <article
      className="glass-card flex flex-col gap-3"
      style={{ borderLeft: `4px solid ${urg.bg}` }}
      data-testid={`patient-alert-${alert.id}`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full text-white"
            style={{ background: urg.bg }}
          >
            <urg.Icon size={10} /> {urg.label}
          </span>
          <span
            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full"
            style={{ background: `${status.color}1A`, color: status.color, border: `1px solid ${status.color}55` }}
            data-testid={`patient-alert-status-${alert.status}`}
          >
            {status.label}
          </span>
        </div>
        <div className="text-[11px]" style={{ color: "#6B7595" }}>
          {new Date(alert.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>

      <div>
        <div className="font-display font-bold text-[17px]" style={{ color: "#0F1836" }}>{alert.topic || "Concern"}</div>
        {initialUrg && initialUrg !== alert.urgency && (
          <div className="text-[11.5px] mt-0.5" style={{ color: "#6B7595" }}>
            initial severity <span className="font-semibold" style={{ color: URG[initialUrg.toLowerCase()]?.bg || "#0F1836" }}>{initialUrg.toUpperCase()}</span> → now {urg.label}
          </div>
        )}
      </div>

      {alert.patient_message && (
        <div className="glass-soft p-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider mb-1" style={{ color: "#6B7595" }}>Patient said</div>
          <div className="text-[13px]" style={{ color: "#0F1836" }}>"{alert.patient_message}"</div>
        </div>
      )}

      {alert.summary && (
        <div className="text-[12.5px]" style={{ color: "#2A3558" }}>
          <span className="font-semibold">AI triage: </span>{alert.summary}
        </div>
      )}

      {reasonLabel && (
        <div className="rounded-xl px-3 py-2 text-[12px] inline-flex items-center gap-1.5 self-start"
             style={{ background: `${status.color}10`, color: status.color, border: `1px solid ${status.color}33` }}
             data-testid={`patient-alert-reason-${alert.id}`}>
          <Check size={12} /> Resolution: <span className="capitalize font-semibold">{reasonLabel}</span>
        </div>
      )}

      {events.length > 0 && (
        <details className="rounded-xl bg-white/60 px-3 py-2 text-[12px]" data-testid={`patient-alert-timeline-${alert.id}`}>
          <summary className="cursor-pointer font-semibold inline-flex items-center gap-1.5" style={{ color: "#2A3558" }}>
            <Clock size={12} /> Timeline · {events.length} event{events.length === 1 ? "" : "s"}
          </summary>
          <ol className="mt-2 flex flex-col gap-1.5 pl-1">
            {events.map((ev, i) => {
              const meta = EVENT[ev.event] || { txt: ev.event, Icon: ChevronRight, color: "#6B7595" };
              const Icon = meta.Icon;
              const actor = (ev.by || "").startsWith("doctor:")
                ? "doctor"
                : ev.by || "system";
              return (
                <li key={i} className="flex items-start gap-2" data-testid={`patient-alert-event-${ev.event}`}>
                  <Icon size={11} className="mt-0.5 shrink-0" style={{ color: meta.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11.5px] font-semibold" style={{ color: meta.color }}>{meta.txt}</div>
                    <div className="text-[10.5px]" style={{ color: "#6B7595" }}>
                      {new Date(ev.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      {ev.urgency_before && ev.urgency_after && (
                        <span> · {ev.urgency_before} → {ev.urgency_after}</span>
                      )}
                      <span> · by <span className="font-semibold capitalize">{actor}</span></span>
                    </div>
                    {ev.note && <div className="text-[11px] mt-0.5 italic" style={{ color: "#2A3558" }}>"{ev.note}"</div>}
                  </div>
                </li>
              );
            })}
          </ol>
        </details>
      )}

      <Link
        to={`/followup/${patientId}`}
        className="btn-ghost inline-flex items-center gap-1.5 py-2 px-3 text-[12px] self-start"
        data-testid={`patient-alert-open-chat-${alert.id}`}
      >
        <MessageCircle size={13} /> Open chat
      </Link>
    </article>
  );
}

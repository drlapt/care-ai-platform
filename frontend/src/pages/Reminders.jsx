import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Pill, Plus, Clock, CheckCircle2, Trash2, User, Calendar, FlaskConical, BellRing, ChevronRight, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  listReminders, createReminder, logTaken, deleteReminder, listPatients,
  listAppointments, listLabResults, listDoctorAlerts,
} from "@/lib/api";

const TABS = [
  { id: "medications", label: "Medications", icon: Pill,         color: "#28A55B" },
  { id: "followups",   label: "Follow-ups",  icon: Calendar,      color: "#5B7CFA" },
  { id: "tests",       label: "Tests",       icon: FlaskConical,  color: "#F2994A" },
  { id: "alerts",      label: "Alerts",      icon: BellRing,      color: "#E85A5A" },
];

export default function Reminders() {
  const { user } = useAuth();
  const isDoctor = user?.role !== "patient";
  const [tab, setTab] = useState("medications");

  const [items, setItems] = useState([]);
  const [appts, setAppts] = useState([]);
  const [labs, setLabs] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [patients, setPatients] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ patient_id: "", medication: "", dose: "", times_per_day: 2, time_of_day: "08:00, 20:00", notes: "" });
  const [loading, setLoading] = useState(false);

  const load = () => {
    Promise.all([
      listReminders().catch(() => []),
      listAppointments().catch(() => []),
      listLabResults().catch(() => []),
      isDoctor ? listDoctorAlerts().catch(() => []) : Promise.resolve([]),
    ]).then(([r, a, l, al]) => { setItems(r); setAppts(a); setLabs(l); setAlerts(al); });
  };

  useEffect(() => {
    load();
    if (isDoctor) {
      listPatients().then((ps) => {
        setPatients(ps);
        setForm((f) => ({ ...f, patient_id: ps[0]?.id || "" }));
      }).catch(() => {});
    } else if (user?.linked_patient_id) {
      setForm((f) => ({ ...f, patient_id: user.linked_patient_id }));
    }
  }, [user]);

  // Categorize
  const followupAppts = useMemo(() => appts.filter((a) => {
    const t = (a.type || "").toLowerCase();
    const r = (a.reason || "").toLowerCase();
    return ["scheduled", "requested"].includes(a.status) && (t.includes("follow") || r.includes("follow") || a.is_followup);
  }), [appts]);

  const pendingTests = useMemo(() => labs.filter((l) => l.status === "ordered" || l.status === "pending"), [labs]);

  const openAlerts = useMemo(() => alerts.filter((a) => a.status === "open" || !a.status), [alerts]);

  const counts = {
    medications: items.length,
    followups: followupAppts.length,
    tests: pendingTests.length,
    alerts: openAlerts.length,
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.patient_id || !form.medication.trim()) { toast.error("Patient and medication are required"); return; }
    setLoading(true);
    try {
      await createReminder({ ...form, times_per_day: Number(form.times_per_day) || 1 });
      toast.success("Reminder added");
      setShowForm(false);
      setForm((f) => ({ ...f, medication: "", dose: "", notes: "" }));
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not add reminder");
    } finally {
      setLoading(false);
    }
  };

  const markTaken = async (id) => {
    try { await logTaken(id); toast.success("Marked as taken"); load(); } catch { toast.error("Failed"); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this reminder?")) return;
    try { await deleteReminder(id); load(); } catch { toast.error("Failed"); }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-up" data-testid="reminders-page">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display font-extrabold text-[44px] leading-none" style={{ color: "#0F1836" }}>
            Care <span className="text-gradient">Reminders</span>
          </h1>
          <p className="text-sm mt-2" style={{ color: "#6B7595" }}>
            {isDoctor ? "Manage medication schedules for your patients." : "Everything Care AI is keeping an eye on for you."}
          </p>
        </div>
        {tab === "medications" && (
          <button onClick={() => setShowForm((s) => !s)} className="btn-primary inline-flex items-center gap-2" data-testid="add-reminder-btn">
            <Plus size={16} /> {showForm ? "Cancel" : "Add reminder"}
          </button>
        )}
      </header>

      {/* Tabs */}
      <div className="flex items-center gap-2 flex-wrap" data-testid="reminders-tabs">
        {TABS.map(({ id, label, icon: Icon, color }) => {
          const active = tab === id;
          const n = counts[id];
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="px-3.5 py-2 rounded-full inline-flex items-center gap-2 text-[13px] font-semibold transition"
              style={active
                ? { background: `${color}15`, color, boxShadow: `0 0 0 1px ${color}33` }
                : { background: "rgba(255,255,255,0.6)", color: "#6B7595" }}
              data-testid={`tab-${id}`}
            >
              <Icon size={14} />
              {label}
              {n > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: active ? color : "rgba(91,124,250,0.14)", color: active ? "white" : "#5B7CFA" }}>
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* === Medications tab === */}
      {tab === "medications" && (
        <>
          {showForm && (
            <form onSubmit={submit} className="glass-card grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="reminder-form">
              {isDoctor && (
                <label className="flex flex-col gap-1 md:col-span-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>Patient</span>
                  <select value={form.patient_id} onChange={(e) => setForm({ ...form, patient_id: e.target.value })} className="input" data-testid="reminder-patient-select">
                    {patients.map((p) => (<option key={p.id} value={p.id}>{p.personal_info?.name}</option>))}
                  </select>
                </label>
              )}
              <Field label="Medication" val={form.medication} onChange={(v) => setForm({ ...form, medication: v })} placeholder="e.g. Metformin" testid="reminder-med-input" />
              <Field label="Dose" val={form.dose} onChange={(v) => setForm({ ...form, dose: v })} placeholder="e.g. 500mg" testid="reminder-dose-input" />
              <Field label="Times per day" val={form.times_per_day} onChange={(v) => setForm({ ...form, times_per_day: v })} placeholder="2" type="number" testid="reminder-freq-input" />
              <Field label="Time of day" val={form.time_of_day} onChange={(v) => setForm({ ...form, time_of_day: v })} placeholder="08:00, 20:00" testid="reminder-time-input" />
              <label className="flex flex-col gap-1 md:col-span-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>Notes</span>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Take with food" className="input" data-testid="reminder-notes-input" />
              </label>
              <div className="md:col-span-2 flex justify-end">
                <button disabled={loading} type="submit" className="btn-primary inline-flex items-center gap-2" data-testid="reminder-submit-btn">
                  <Plus size={15} /> {loading ? "Saving…" : "Save reminder"}
                </button>
              </div>
            </form>
          )}

          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="reminders-list">
            {items.length === 0 ? (
              <Empty icon={Pill} title="No medication reminders" subtitle="Add one above to stay on track." testid="reminders-empty" />
            ) : items.map((r) => (
              <article key={r.id} className="glass-card flex flex-col gap-3" data-testid={`reminder-${r.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="w-11 h-11 rounded-2xl bg-[#3CC97C]/12 flex items-center justify-center"><Pill size={18} className="text-[#28A55B]" /></div>
                  <button onClick={() => remove(r.id)} className="w-8 h-8 rounded-full bg-white/70 hover:bg-white transition flex items-center justify-center" data-testid={`reminder-delete-${r.id}`} title="Delete">
                    <Trash2 size={14} className="text-[#E85A5A]" />
                  </button>
                </div>
                <div>
                  <div className="font-display font-bold text-[20px]" style={{ color: "#0F1836" }}>{r.medication}</div>
                  {r.dose && <div className="text-[13px] font-medium" style={{ color: "#5B7CFA" }}>{r.dose}</div>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="glass-pill px-3 py-1.5 inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "#0F1836" }}>
                    <Clock size={12} /> {r.times_per_day}× / day
                  </span>
                  {r.time_of_day && (
                    <span className="glass-pill px-3 py-1.5 text-[12px] font-semibold" style={{ color: "#0F1836" }}>{r.time_of_day}</span>
                  )}
                </div>
                {isDoctor && r.patient_name && (
                  <div className="text-[12px] inline-flex items-center gap-1.5" style={{ color: "#6B7595" }}>
                    <User size={12} /> {r.patient_name}
                  </div>
                )}
                {r.notes && <div className="text-[13px]" style={{ color: "#2A3558" }}>{r.notes}</div>}
                {r.source_consultation_id && (
                  <Link to={`/consultations/${r.source_consultation_id}`} className="text-[11px] font-semibold inline-flex items-center gap-0.5" style={{ color: "#7C4DFF" }}>
                    From consultation <ChevronRight size={11} />
                  </Link>
                )}
                <div className="flex items-center justify-between mt-1 pt-3 border-t border-white/60">
                  <div className="text-[12px]" style={{ color: "#6B7595" }}>
                    {(r.taken_log?.length || 0)} dose{(r.taken_log?.length || 0) === 1 ? "" : "s"} logged
                  </div>
                  <button onClick={() => markTaken(r.id)} className="btn-ghost inline-flex items-center gap-1.5 py-1.5 px-3 text-[12px]" data-testid={`reminder-taken-${r.id}`}>
                    <CheckCircle2 size={13} /> Mark taken
                  </button>
                </div>
              </article>
            ))}
          </section>
        </>
      )}

      {/* === Follow-ups tab === */}
      {tab === "followups" && (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="followups-list">
          {followupAppts.length === 0 ? (
            <Empty icon={Calendar} title="No follow-ups scheduled" subtitle="Care AI will create one automatically after your next visit." testid="followups-empty" />
          ) : followupAppts.map((a) => (
            <article key={a.id} className="glass-card flex flex-col gap-3" data-testid={`followup-${a.id}`}>
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] text-white font-display font-bold flex items-center justify-center text-center leading-tight">
                  <div>
                    <div className="text-[10px]">{new Date(a.date).toLocaleDateString(undefined, { month: "short" })}</div>
                    <div className="text-[18px]">{new Date(a.date).getDate()}</div>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[15px] truncate" style={{ color: "#0F1836" }}>{a.reason || "Follow-up"}</div>
                  <div className="text-[12px]" style={{ color: "#6B7595" }}>{a.time} · {a.doctor_name || a.patient_name}</div>
                </div>
              </div>
              <Link to={`/consult/new?appointment_id=${a.id}`} className="btn-primary text-[12px] py-2 inline-flex items-center justify-center gap-1.5" data-testid={`followup-start-${a.id}`}>
                <Calendar size={12} /> Start follow-up
              </Link>
            </article>
          ))}
        </section>
      )}

      {/* === Tests tab === */}
      {tab === "tests" && (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="tests-list">
          {pendingTests.length === 0 ? (
            <Empty icon={FlaskConical} title="No pending tests" subtitle="If your doctor orders any labs, you'll see them here." testid="tests-empty" />
          ) : pendingTests.map((l) => (
            <article key={l.id} className="glass-card flex flex-col gap-3" data-testid={`test-${l.id}`}>
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "rgba(242,153,74,0.14)" }}>
                  <FlaskConical size={18} className="text-[#F2994A]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[15px]" style={{ color: "#0F1836" }}>{l.test_name}</div>
                  <div className="text-[11.5px]" style={{ color: "#6B7595" }}>
                    Ordered {l.ordered_at ? new Date(l.ordered_at).toLocaleDateString() : "recently"}
                  </div>
                </div>
                <span className="badge badge-warning !py-0">{l.status}</span>
              </div>
              <Link to="/laboratory" className="btn-ghost text-[12px] py-2 inline-flex items-center justify-center gap-1.5">
                <FlaskConical size={12} /> View details
              </Link>
            </article>
          ))}
        </section>
      )}

      {/* === Alerts tab === */}
      {tab === "alerts" && (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="alerts-list-tab">
          {!isDoctor && (
            <Empty
              icon={BellRing}
              title="Alerts are managed by your doctor"
              subtitle="Care AI surfaces urgent issues to your doctor automatically. You'll be contacted if action is needed."
              testid="alerts-empty-patient"
            />
          )}
          {isDoctor && (openAlerts.length === 0 ? (
            <Empty icon={BellRing} title="No open alerts" subtitle="Care AI hasn't flagged anything urgent." testid="alerts-empty-doctor" />
          ) : openAlerts.map((a) => (
            <Link to={`/alerts`} key={a.id} className="glass-card flex flex-col gap-2" data-testid={`alert-tab-${a.id}`}>
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-[#E85A5A]" />
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "#E85A5A" }}>{a.urgency || "alert"}</span>
              </div>
              <div className="font-semibold text-[14px]" style={{ color: "#0F1836" }}>{a.patient_name}</div>
              <div className="text-[12.5px]" style={{ color: "#5B7CFA" }}>{a.topic}</div>
              <div className="text-[11.5px] line-clamp-2" style={{ color: "#2A3558" }}>{a.summary}</div>
            </Link>
          )))}
        </section>
      )}
    </div>
  );
}

function Field({ label, val, onChange, placeholder, type = "text", testid }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>{label}</span>
      <input type={type} value={val} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="input" data-testid={testid} />
    </label>
  );
}

function Empty({ icon: Icon, title, subtitle, testid }) {
  return (
    <div className="col-span-full glass-card text-center p-10" data-testid={testid}>
      <Icon size={28} className="mx-auto mb-3 text-[#5B7CFA]" />
      <div className="font-semibold" style={{ color: "#0F1836" }}>{title}</div>
      <div className="text-[13px] mt-1 max-w-[420px] mx-auto" style={{ color: "#6B7595" }}>{subtitle}</div>
    </div>
  );
}

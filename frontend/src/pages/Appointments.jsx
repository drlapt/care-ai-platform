import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Calendar as CalendarIcon, Plus, Clock, ChevronLeft, ChevronRight, CheckCircle2, XCircle, Stethoscope, CalendarClock } from "lucide-react";
import { listAppointments, listPatients, createAppointment, updateAppointment } from "@/lib/api";

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

export default function Appointments() {
  const [appts, setAppts] = useState([]);
  const [patients, setPatients] = useState([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [proposeFor, setProposeFor] = useState(null); // appointment object

  useEffect(() => {
    Promise.all([listAppointments(), listPatients()]).then(([a, p]) => {
      setAppts(a); setPatients(p);
    }).catch(() => toast.error("Failed to load appointments"));
  }, []);

  // Build current week grid starting Monday
  const monday = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weekOffset * 7);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [weekOffset]);

  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  const byDate = {};
  for (const a of appts) {
    byDate[a.date] = byDate[a.date] || [];
    byDate[a.date].push(a);
  }
  Object.values(byDate).forEach((arr) => arr.sort((x, y) => x.time.localeCompare(y.time)));

  const reload = async () => setAppts(await listAppointments());

  const setStatus = async (id, status) => {
    await updateAppointment(id, { status });
    toast.success(`Appointment ${status}`);
    reload();
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-up" data-testid="appointments-page">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-sm font-medium mb-2" style={{ color: "#6B7595" }}>Clinic calendar</div>
          <h1 className="font-display font-extrabold text-[44px] leading-none" style={{ color: "#0F1836" }}>Appointments</h1>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="btn-primary inline-flex items-center gap-2" data-testid="new-appt-btn">
          <Plus size={16} /> New Appointment
        </button>
      </header>

      {showForm && <AppointmentForm patients={patients} onCreated={() => { setShowForm(false); reload(); }} onClose={() => setShowForm(false)} />}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Total" value={appts.length} />
        <Stat label="This week" value={days.reduce((n, d) => n + (byDate[d.toISOString().slice(0,10)]?.length || 0), 0)} />
        <Stat label="Scheduled" value={appts.filter((a) => a.status === "scheduled").length} />
        <Stat label="Completed" value={appts.filter((a) => a.status === "completed").length} />
      </div>

      {/* Week navigator */}
      <div className="glass-card">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <CalendarIcon size={18} className="text-[#5B7CFA]" />
            <div className="font-display font-bold text-[20px]" style={{ color: "#0F1836" }}>
              {monday.toLocaleDateString(undefined, { month: "long", day: "numeric" })} — {days[6].toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setWeekOffset((w) => w - 1)} className="w-9 h-9 rounded-full bg-white/70 hover:bg-white transition flex items-center justify-center" data-testid="week-prev"><ChevronLeft size={16} /></button>
            <button onClick={() => setWeekOffset(0)} className="btn-ghost text-xs" data-testid="week-today">Today</button>
            <button onClick={() => setWeekOffset((w) => w + 1)} className="w-9 h-9 rounded-full bg-white/70 hover:bg-white transition flex items-center justify-center" data-testid="week-next"><ChevronRight size={16} /></button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {days.map((d) => {
            const iso = d.toISOString().slice(0, 10);
            const items = byDate[iso] || [];
            const isToday = iso === new Date().toISOString().slice(0, 10);
            return (
              <div key={iso} className={`glass-soft p-3 min-h-[180px] ${isToday ? "ring-2 ring-[#5B7CFA]" : ""}`} data-testid={`day-${iso}`}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>{d.toLocaleDateString(undefined, { weekday: "short" })}</div>
                    <div className="font-display font-bold text-[20px]" style={{ color: isToday ? "#5B7CFA" : "#0F1836" }}>{d.getDate()}</div>
                  </div>
                  {isToday && <span className="badge text-[10px]">Today</span>}
                </div>
                <div className="flex flex-col gap-1.5">
                  {items.map((a) => (
                    <div key={a.id} className="rounded-xl p-2 text-[11.5px]" style={{ background: "rgba(91,124,250,0.08)", border: "1px solid rgba(91,124,250,0.18)" }} data-testid={`appt-${a.id}`}>
                      <div className="font-semibold" style={{ color: "#0F1836" }}>{a.time}</div>
                      <div className="truncate" style={{ color: "#2A3558" }}>{a.patient_name}</div>
                      <div className="truncate text-[10px]" style={{ color: "#6B7595" }}>{a.reason}</div>
                    </div>
                  ))}
                  {items.length === 0 && <div className="text-[11px] text-center py-6" style={{ color: "#B4BCD8" }}>No visits</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pending approval */}
      <div className="glass-card" data-testid="pending-section">
        <div className="flex items-center gap-2 mb-3">
          <span className="badge badge-warning">Pending approval</span>
          <span className="text-[12px]" style={{ color: "#6B7595" }}>{appts.filter((a) => a.status === "requested").length} request{appts.filter((a) => a.status === "requested").length === 1 ? "" : "s"}</span>
        </div>
        <div className="flex flex-col gap-2">
          {appts.filter((a) => a.status === "requested").length === 0 && (
            <div className="text-sm" style={{ color: "#6B7595" }}>No pending requests.</div>
          )}
          {appts.filter((a) => a.status === "requested").map((a) => (
            <div key={a.id} className="glass-soft p-4 flex items-center gap-4 flex-wrap" data-testid={`pending-row-${a.id}`}>
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] text-white font-semibold flex items-center justify-center shrink-0">
                {(a.patient_name || "?").split(" ").map(n => n[0]).slice(0,2).join("")}
              </div>
              <div className="flex-1 min-w-[180px]">
                <div className="font-semibold text-[15px]" style={{ color: "#0F1836" }}>{a.patient_name}</div>
                <div className="text-[12px]" style={{ color: "#6B7595" }}>{a.reason || a.type}</div>
              </div>
              <div className="text-[13px] flex items-center gap-1.5" style={{ color: "#2A3558" }}>
                <CalendarIcon size={13} /> {a.date} · <Clock size={13} /> {a.time}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                <button onClick={() => setStatus(a.id, "scheduled")} className="btn-primary text-[11px] py-1.5 px-3" data-testid={`confirm-${a.id}`}>Confirm</button>
                <button onClick={() => setProposeFor(a)} className="btn-ghost text-[11px] py-1.5 px-3 inline-flex items-center gap-1" data-testid={`propose-${a.id}`}>
                  <CalendarClock size={11} /> Suggest alternate
                </button>
                <button onClick={() => setStatus(a.id, "cancelled")} className="w-8 h-8 rounded-full bg-white hover:bg-[#E85A5A]/10 flex items-center justify-center" title="Decline" data-testid={`decline-${a.id}`}><XCircle size={14} className="text-[#E85A5A]" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Patient pending — doctor proposed reschedule, awaiting patient */}
      {appts.some((a) => a.status === "rescheduled") && (
        <div className="glass-card" data-testid="rescheduled-section">
          <div className="flex items-center gap-2 mb-3">
            <span className="badge" style={{ background: "#5B7CFA20", color: "#5B7CFA" }}>Awaiting patient</span>
            <span className="text-[12px]" style={{ color: "#6B7595" }}>You proposed alternate slots — patient is reviewing</span>
          </div>
          <div className="flex flex-col gap-2">
            {appts.filter((a) => a.status === "rescheduled").map((a) => (
              <div key={a.id} className="glass-soft p-4 flex items-center gap-4 flex-wrap" data-testid={`rescheduled-row-${a.id}`}>
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] text-white font-semibold flex items-center justify-center shrink-0">
                  {(a.patient_name || "?").split(" ").map(n => n[0]).slice(0,2).join("")}
                </div>
                <div className="flex-1 min-w-[200px]">
                  <div className="font-semibold text-[15px]" style={{ color: "#0F1836" }}>{a.patient_name}</div>
                  <div className="text-[12px]" style={{ color: "#6B7595" }}>
                    Original: {a.date} {a.time} → Proposed: <span className="font-semibold text-[#5B7CFA]">{a.proposed_date} {a.proposed_time}</span>
                  </div>
                  {a.proposed_reason && <div className="text-[12px] italic mt-1" style={{ color: "#6B7595" }}>"{a.proposed_reason}"</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirmed */}
      <div className="glass-card" data-testid="confirmed-section">
        <div className="flex items-center gap-2 mb-3">
          <span className="badge" style={{ background: "#3CC97C20", color: "#28A55B" }}>Confirmed</span>
          <span className="text-[12px]" style={{ color: "#6B7595" }}>{appts.filter((a) => a.status === "scheduled").length} ready to consult</span>
        </div>
        <div className="flex flex-col gap-2">
          {appts.filter((a) => a.status === "scheduled").length === 0 && (
            <div className="text-sm" style={{ color: "#6B7595" }}>No confirmed appointments yet.</div>
          )}
          {appts.filter((a) => a.status === "scheduled").map((a) => (
            <div key={a.id} className="glass-soft p-4 flex items-center gap-4 flex-wrap" data-testid={`confirmed-row-${a.id}`}>
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] text-white font-semibold flex items-center justify-center shrink-0">
                {(a.patient_name || "?").split(" ").map(n => n[0]).slice(0,2).join("")}
              </div>
              <div className="flex-1 min-w-[180px]">
                <div className="font-semibold text-[15px]" style={{ color: "#0F1836" }}>{a.patient_name}</div>
                <div className="text-[12px]" style={{ color: "#6B7595" }}>{a.reason || a.type}</div>
              </div>
              <div className="text-[13px] flex items-center gap-1.5" style={{ color: "#2A3558" }}>
                <CalendarIcon size={13} /> {a.date} · <Clock size={13} /> {a.time}
              </div>
              <div className="flex gap-1.5">
                <Link to={`/consult/new?appointment_id=${a.id}`} className="btn-primary text-[11px] py-1.5 px-3 inline-flex items-center gap-1" data-testid={`start-consult-${a.id}`}>
                  <Stethoscope size={11} /> Start consultation
                </Link>
                <button onClick={() => setStatus(a.id, "completed")} className="w-8 h-8 rounded-full bg-white hover:bg-[#3CC97C]/10 flex items-center justify-center" title="Mark complete" data-testid={`complete-${a.id}`}><CheckCircle2 size={14} className="text-[#28A55B]" /></button>
                <button onClick={() => setStatus(a.id, "cancelled")} className="w-8 h-8 rounded-full bg-white hover:bg-[#E85A5A]/10 flex items-center justify-center" title="Cancel" data-testid={`cancel-${a.id}`}><XCircle size={14} className="text-[#E85A5A]" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Other (completed / cancelled) */}
      {appts.some((a) => ["completed", "cancelled"].includes(a.status)) && (
        <div className="glass-card" data-testid="archived-section">
          <h3 className="font-display font-bold text-[18px] mb-3" style={{ color: "#0F1836" }}>Past & cancelled</h3>
          <div className="flex flex-col gap-2 max-h-[260px] overflow-y-auto">
            {appts.filter((a) => ["completed", "cancelled"].includes(a.status)).map((a) => (
              <div key={a.id} className="glass-soft p-3 flex items-center gap-3 flex-wrap text-[13px]" data-testid={`archived-row-${a.id}`}>
                <span className={`badge ${a.status === "completed" ? "badge-success" : "badge-danger"}`}>{a.status}</span>
                <span style={{ color: "#0F1836" }}>{a.patient_name}</span>
                <span style={{ color: "#6B7595" }}>{a.date} {a.time}</span>
                <span style={{ color: "#6B7595" }}>{a.reason || a.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {proposeFor && (
        <ProposeAlternateModal
          appt={proposeFor}
          onClose={() => setProposeFor(null)}
          onProposed={() => { setProposeFor(null); reload(); }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="glass-card text-center">
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>{label}</div>
      <div className="font-display font-bold text-[32px] mt-1" style={{ color: "#0F1836" }}>{value}</div>
    </div>
  );
}

function AppointmentForm({ patients, onCreated, onClose }) {
  const [form, setForm] = useState({ patient_id: "", date: new Date().toISOString().slice(0, 10), time: "09:00", duration_min: 30, type: "consultation", reason: "" });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target?.value ?? e }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.patient_id) { toast.error("Select a patient"); return; }
    setSaving(true);
    try {
      await createAppointment({ ...form, duration_min: Number(form.duration_min) });
      toast.success("Appointment created");
      onCreated();
    } catch (err) { toast.error("Failed to create"); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="glass-card" data-testid="appt-form">
      <h3 className="font-display font-bold text-[18px] mb-4" style={{ color: "#0F1836" }}>New appointment</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold" style={{ color: "#2A3558" }}>Patient *</span>
          <select className="form-select" value={form.patient_id} onChange={set("patient_id")} data-testid="appt-patient">
            <option value="">Select…</option>
            {patients.map((p) => <option key={p.id} value={p.id}>{p.personal_info?.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold" style={{ color: "#2A3558" }}>Type</span>
          <select className="form-select" value={form.type} onChange={set("type")}>
            <option value="consultation">Consultation</option>
            <option value="follow_up">Follow-up</option>
            <option value="procedure">Procedure</option>
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold" style={{ color: "#2A3558" }}>Date</span>
          <input type="date" className="form-input" value={form.date} onChange={set("date")} data-testid="appt-date" />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold" style={{ color: "#2A3558" }}>Time</span>
          <input type="time" className="form-input" value={form.time} onChange={set("time")} data-testid="appt-time" />
        </label>
        <label className="flex flex-col gap-2 md:col-span-2">
          <span className="text-[13px] font-semibold" style={{ color: "#2A3558" }}>Reason</span>
          <input className="form-input" value={form.reason} onChange={set("reason")} placeholder="e.g., Follow-up for chest pain" data-testid="appt-reason" />
        </label>
      </div>
      <div className="flex justify-end gap-3 mt-5">
        <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
        <button type="submit" disabled={saving} className="btn-primary" data-testid="appt-submit">{saving ? "Saving…" : "Schedule"}</button>
      </div>
    </form>
  );
}

function ProposeAlternateModal({ appt, onClose, onProposed }) {
  const [date, setDate] = useState(appt.date || todayISO());
  const [time, setTime] = useState(appt.time || "10:00");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateAppointment(appt.id, { proposed_date: date, proposed_time: time, proposed_reason: reason });
      toast.success("Alternate slot suggested — patient will be notified.");
      onProposed?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not propose");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 animate-fade-up"
      style={{ background: "rgba(15,24,54,0.40)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
      data-testid="propose-backdrop"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="glass-card w-full max-w-[480px] flex flex-col gap-4"
        data-testid="propose-modal"
      >
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#5B7CFA]/15 flex items-center justify-center">
            <CalendarClock size={20} className="text-[#5B7CFA]" />
          </div>
          <div>
            <div className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>Suggest an alternate slot</div>
            <div className="text-[12.5px]" style={{ color: "#6B7595" }}>For {appt.patient_name} · originally {appt.date} {appt.time}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>New date</span>
            <input type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} className="bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3 text-[14px] outline-none" data-testid="propose-date" required />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>New time</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3 text-[14px] outline-none" data-testid="propose-time" required />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>Note to patient (optional)</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. I'm in surgery during your slot — can we move to 3pm?"
            className="bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3 text-[14px] outline-none"
            data-testid="propose-reason"
          />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost text-[13px]" data-testid="propose-cancel">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary text-[13px]" data-testid="propose-submit">{saving ? "Sending…" : "Send proposal"}</button>
        </div>
      </form>
    </div>
  );
}


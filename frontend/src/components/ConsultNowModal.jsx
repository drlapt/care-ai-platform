import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X, Calendar, Stethoscope, Send, ChevronRight, ChevronLeft, Award, Star, Loader2, CheckCircle2 } from "lucide-react";
import { createAppointment, listDoctors, doctorAvailability } from "@/lib/api";

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

function nextBusinessSlot() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1); // Sun → Mon
  if (d.getDay() === 6) d.setDate(d.getDate() + 2); // Sat → Mon
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

const STEPS = ["department", "doctor", "slot", "reason"];

export default function ConsultNowModal({ patientId, onClose, onBooked }) {
  const [step, setStep] = useState(0);
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [department, setDepartment] = useState("general");
  const [loadingDoctors, setLoadingDoctors] = useState(true);
  const [doctor, setDoctor] = useState(null);
  const [date, setDate] = useState(nextBusinessSlot());
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [time, setTime] = useState("");
  const [type, setType] = useState("consultation");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  // Load doctors when modal opens / department changes
  useEffect(() => {
    let alive = true;
    setLoadingDoctors(true);
    listDoctors(department)
      .then((data) => {
        if (!alive) return;
        setDepartments(data.departments || []);
        setDoctors(data.doctors || []);
      })
      .catch(() => alive && setDoctors([]))
      .finally(() => alive && setLoadingDoctors(false));
    return () => { alive = false; };
  }, [department]);

  // Load availability when we have a doctor + date
  useEffect(() => {
    if (!doctor || !date) return;
    let alive = true;
    setLoadingSlots(true);
    setTime("");
    doctorAvailability(doctor.id, date)
      .then((d) => alive && setSlots(d.slots || []))
      .catch(() => alive && setSlots([]))
      .finally(() => alive && setLoadingSlots(false));
    return () => { alive = false; };
  }, [doctor, date]);

  const submit = async () => {
    if (!doctor) { toast.error("Pick a doctor"); return; }
    if (!time) { toast.error("Pick a time slot"); return; }
    if (!reason.trim()) { toast.error("Briefly describe your concern"); return; }
    setSaving(true);
    try {
      const appt = await createAppointment({
        patient_id: patientId,
        date, time,
        type, reason,
        duration_min: 30,
        doctor_id: doctor.id,
        department,
      });
      toast.success(`Slot booked with ${doctor.name} — starting your intake now…`);
      onBooked?.(appt);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not request consultation");
    } finally {
      setSaving(false);
    }
  };

  const next = () => {
    if (step === 0) { setStep(1); return; }
    if (step === 1) {
      if (!doctor) { toast.error("Pick a doctor first"); return; }
      setStep(2); return;
    }
    if (step === 2) {
      if (!time) { toast.error("Pick a time slot"); return; }
      setStep(3); return;
    }
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 animate-fade-up"
      style={{ background: "rgba(15, 24, 54, 0.35)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
      data-testid="consult-modal-backdrop"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-card w-full max-w-[560px] flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        data-testid="consult-modal"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}>
              <Stethoscope size={20} className="text-white" />
            </div>
            <div>
              <div className="font-display font-bold text-[20px]" style={{ color: "#0F1836" }}>Consult a Doctor</div>
              <div className="text-[12.5px]" style={{ color: "#6B7595" }}>Step {step + 1} of {STEPS.length} · {STEPS[step]}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full bg-white/70 hover:bg-white transition flex items-center justify-center" data-testid="consult-modal-close">
            <X size={14} />
          </button>
        </div>

        {/* Stepper bar */}
        <div className="flex items-center gap-1.5">
          {STEPS.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-gradient-to-r from-[#5B7CFA] to-[#7C4DFF]" : "bg-[#5B7CFA]/15"}`} />
          ))}
        </div>

        {/* STEP 1: Department */}
        {step === 0 && (
          <div className="flex flex-col gap-3" data-testid="step-department">
            <div className="text-[13.5px]" style={{ color: "#2A3558" }}>Which department do you need?</div>
            <div className="grid grid-cols-1 gap-2">
              {(departments.length ? departments : [{ id: "general", label: "General Physician" }]).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDepartment(d.id)}
                  className={`text-left px-4 py-3.5 rounded-2xl border transition flex items-center justify-between ${department === d.id ? "bg-gradient-to-r from-[#5B7CFA]/10 to-[#7C4DFF]/10 border-[#5B7CFA]" : "bg-white border-[#5B7CFA]/15 hover:border-[#5B7CFA]/40"}`}
                  data-testid={`dept-${d.id}`}
                >
                  <span className="font-semibold text-[14.5px]" style={{ color: "#0F1836" }}>{d.label}</span>
                  {department === d.id && <CheckCircle2 size={16} className="text-[#5B7CFA]" />}
                </button>
              ))}
            </div>
            <p className="text-[11.5px]" style={{ color: "#6B7595" }}>More departments coming soon.</p>
          </div>
        )}

        {/* STEP 2: Doctor cards */}
        {step === 1 && (
          <div className="flex flex-col gap-3" data-testid="step-doctor">
            <div className="text-[13.5px]" style={{ color: "#2A3558" }}>Choose your doctor</div>
            {loadingDoctors ? (
              <div className="flex items-center gap-2 text-[13px]" style={{ color: "#6B7595" }}>
                <Loader2 size={14} className="animate-spin" /> Loading available doctors…
              </div>
            ) : doctors.length === 0 ? (
              <div className="text-[13px] text-center py-6" style={{ color: "#6B7595" }}>No doctors available in this department right now.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {doctors.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDoctor(d)}
                    className={`text-left p-4 rounded-2xl border transition ${doctor?.id === d.id ? "bg-gradient-to-r from-[#5B7CFA]/10 to-[#7C4DFF]/10 border-[#5B7CFA]" : "bg-white border-[#5B7CFA]/15 hover:border-[#5B7CFA]/40"}`}
                    data-testid={`doctor-card-${d.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] text-white font-bold flex items-center justify-center shrink-0">
                        {(d.name || "?").split(" ").map((n) => n[0]).slice(0, 2).join("")}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-[15px] flex items-center gap-2" style={{ color: "#0F1836" }}>
                          {d.name}
                          {doctor?.id === d.id && <CheckCircle2 size={14} className="text-[#5B7CFA]" />}
                        </div>
                        <div className="text-[12.5px]" style={{ color: "#6B7595" }}>{d.specialization}</div>
                        <div className="flex items-center gap-3 mt-1.5 text-[11.5px]" style={{ color: "#2A3558" }}>
                          <span className="inline-flex items-center gap-1"><Award size={11} className="text-[#7C4DFF]" /> {d.experience_years}+ yrs</span>
                          {d.rating && <span className="inline-flex items-center gap-1"><Star size={11} className="text-[#F2994A]" fill="#F2994A" /> {d.rating}</span>}
                        </div>
                        {d.bio && <div className="text-[11.5px] mt-1.5 line-clamp-2" style={{ color: "#6B7595" }}>{d.bio}</div>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* STEP 3: Date + slots */}
        {step === 2 && doctor && (
          <div className="flex flex-col gap-3" data-testid="step-slot">
            <div className="text-[13.5px]" style={{ color: "#2A3558" }}>Pick a time with <span className="font-semibold">{doctor.name}</span></div>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>Date</span>
              <div className="flex items-center gap-2 bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3">
                <Calendar size={14} className="text-[#5B7CFA]" />
                <input type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} className="flex-1 outline-none bg-transparent text-[14px]" data-testid="consult-date-input" required />
              </div>
            </label>
            {loadingSlots ? (
              <div className="flex items-center gap-2 text-[13px]" style={{ color: "#6B7595" }}>
                <Loader2 size={14} className="animate-spin" /> Loading slots…
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" data-testid="consult-slots">
                {slots.length === 0 && <div className="col-span-full text-center text-[12.5px] py-3" style={{ color: "#6B7595" }}>No slots returned</div>}
                {slots.map((s) => (
                  <button
                    key={s.time}
                    type="button"
                    disabled={!s.available}
                    onClick={() => setTime(s.time)}
                    className={`py-2.5 rounded-2xl border text-[13.5px] font-semibold transition ${
                      time === s.time
                        ? "bg-gradient-to-r from-[#5B7CFA] to-[#7C4DFF] text-white border-transparent"
                        : s.available
                        ? "bg-white border-[#5B7CFA]/15 text-[#2A3558] hover:border-[#5B7CFA]/40"
                        : "bg-[#5B7CFA]/5 border-[#5B7CFA]/10 text-[#B4BCD8] cursor-not-allowed"
                    }`}
                    data-testid={`slot-${s.time}`}
                  >
                    {s.time}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* STEP 4: Reason */}
        {step === 3 && (
          <div className="flex flex-col gap-3" data-testid="step-reason">
            <div className="glass-soft p-3 text-[12.5px]" style={{ color: "#2A3558" }}>
              <span className="font-semibold">{doctor?.name}</span> · {date} · {time}
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>Visit type</span>
              <div className="flex gap-2" data-testid="consult-type-toggle">
                {[
                  { k: "consultation", l: "New concern" },
                  { k: "follow_up", l: "Follow-up" },
                ].map((t) => (
                  <button key={t.k} type="button" onClick={() => setType(t.k)} className={`flex-1 py-2 rounded-2xl border text-[13px] font-semibold transition ${type === t.k ? "bg-gradient-to-r from-[#5B7CFA] to-[#7C4DFF] text-white border-transparent" : "bg-white border-[#5B7CFA]/15 text-[#2A3558]"}`} data-testid={`consult-type-${t.k}`}>
                    {t.l}
                  </button>
                ))}
              </div>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>What's your concern?</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                required
                placeholder="Briefly describe what you'd like to discuss…"
                className="bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3 text-[14px] outline-none resize-none"
                data-testid="consult-reason-input"
              />
            </label>
          </div>
        )}

        {/* Footer nav */}
        <div className="flex items-center gap-2 pt-2">
          {step > 0 && (
            <button onClick={back} className="btn-ghost inline-flex items-center gap-1.5" data-testid="consult-back-btn">
              <ChevronLeft size={14} /> Back
            </button>
          )}
          <div className="flex-1" />
          {step < 3 ? (
            <button onClick={next} className="btn-primary inline-flex items-center gap-1.5" data-testid="consult-next-btn">
              Next <ChevronRight size={14} />
            </button>
          ) : (
            <button onClick={submit} disabled={saving || !reason.trim()} className="btn-primary inline-flex items-center gap-1.5" data-testid="consult-submit-btn">
              <Send size={14} /> {saving ? "Sending…" : "Request consultation"}
            </button>
          )}
        </div>

        {step === 3 && (
          <p className="text-[11px] text-center" style={{ color: "#6B7595" }}>
            {doctor?.name} will confirm your slot shortly. For emergencies, call 911 or use the red-flag Care AI chat.
          </p>
        )}
      </div>
    </div>
  );
}

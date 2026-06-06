import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import {
  Stethoscope, Calendar, Pill, Heart, ShieldAlert, Sparkles, Clock, ChevronRight,
  CalendarClock, CheckCircle2, X, MessageSquare, Activity, FileText, Plus, Users, AlertTriangle, Pencil, Check,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  getPatient, listAppointments, listPrescriptions, listLabResults,
  listProfiles, listReminders, updateAppointment,
} from "@/lib/api";
import ConsultNowModal from "@/components/ConsultNowModal";
import ConnectWhatsApp from "@/components/ConnectWhatsApp";
import WhatsAppSettingsCard from "@/components/WhatsAppSettingsCard";
import ProfileSwitcher from "@/components/ProfileSwitcher";
import SafetyCheckBanner from "@/components/SafetyCheckBanner";
import ProfileEditModal from "@/components/ProfileEditModal";

export default function PatientPortal() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [patient, setPatient] = useState(null);
  const [appts, setAppts] = useState([]);
  const [rx, setRx] = useState([]);
  const [labs, setLabs] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [showConsult, setShowConsult] = useState(location.state?.openConsult === true);
  const [waAutoOpen, setWaAutoOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState(null);

  const reloadAppts = () => listAppointments().then(setAppts).catch(() => {});

  const handleBooked = (appt) => {
    reloadAppts();
    if (appt?.id) navigate(`/consult/new?appointment_id=${appt.id}`);
  };

  useEffect(() => {
    if (!user?.linked_patient_id) return;
    Promise.all([
      getPatient(user.linked_patient_id),
      listAppointments(),
      listPrescriptions(),
      listLabResults(),
      listProfiles().catch(() => ({ profiles: [] })),
      listReminders().catch(() => []),
    ]).then(([p, a, r, l, prof, rem]) => {
      setPatient(p); setAppts(a); setRx(r); setLabs(l);
      setProfiles(prof.profiles || []); setReminders(rem || []);
    }).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user || user.role !== "patient") return;
    if (user.whatsapp_number) return;
    if (sessionStorage.getItem("pc_wa_prompted")) return;
    sessionStorage.setItem("pc_wa_prompted", "1");
    const t = setTimeout(() => setWaAutoOpen(true), 800);
    return () => clearTimeout(t);
  }, [user]);

  if (!patient) return <div className="glass-card">Loading your health record…</div>;

  const pi = patient.personal_info || {};
  const mh = patient.medical_history || {};
  const upcoming = appts.filter((a) => ["scheduled", "requested"].includes(a.status)).slice(0, 3);
  const reschedules = appts.filter((a) => a.status === "rescheduled" && a.proposed_date && a.proposed_time);
  const consultations = (patient.consultations || []).slice().reverse();
  const allergies = (mh.allergies || []).filter(Boolean);

  // Phase 16 — pending safety check on the most recent consult that has one
  const pendingSafetyRxId = consultations.find((c) => {
    const sc = c.safety_check;
    return sc && (sc.status === "pending" || sc.status === "partial" || sc.status === "hold");
  })?.id;
  const conditions = (mh.current_conditions || []).map((c) => typeof c === "string" ? c : c.condition).filter(Boolean);
  const lastVisit = consultations[0]?.date ? new Date(consultations[0].date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
  const activeRx = rx.slice(0, 4);
  const otherProfiles = (profiles || []).filter((p) => p.id !== user?.linked_patient_id);
  const showAddProfileSlot = (profiles?.length || 0) < 5;

  return (
    <div className="flex flex-col gap-5 animate-fade-up" data-testid="patient-portal-page">
      {/* === HERO === */}
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-sm font-medium mb-2" style={{ color: "#6B7595" }}>
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </div>
          <h1 className="font-display font-extrabold text-[40px] sm:text-[48px] lg:text-[56px] leading-none" style={{ color: "#0F1836" }}>
            Hi, <span className="text-gradient">{pi.name?.split(" ")[0] || "there"}</span>
          </h1>
          <p className="text-sm mt-2 max-w-[560px]" style={{ color: "#6B7595" }}>
            Your continuous care, organised. Care AI is watching out for you 24/7.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap" data-testid="portal-hero-actions">
          <ProfileSwitcher />
          <button
            onClick={() => setShowConsult(true)}
            className="btn-primary inline-flex items-center gap-2 shadow-lg"
            data-testid="consult-now-btn"
          >
            <Stethoscope size={16} /> Consult a Doctor
          </button>
        </div>
      </header>

      {/* Phase 16 — Pre-treatment safety check */}
      {pendingSafetyRxId && (
        <SafetyCheckBanner
          pendingRxId={pendingSafetyRxId}
          onResolved={() => {
            // refresh patient to update consultations.safety_check.status locally
            getPatient(user.linked_patient_id).then(setPatient).catch(() => {});
          }}
        />
      )}

      {/* WhatsApp nudge (when not linked) */}
      {!user?.whatsapp_number && (
        <section
          className="glass-card p-4 flex items-center gap-3 flex-wrap"
          style={{ borderLeft: "4px solid #25D366", background: "rgba(37,211,102,0.06)" }}
          data-testid="wa-nudge-banner"
        >
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "#25D366" }}>
            <MessageSquare size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-[180px]">
            <div className="font-semibold text-[14px]" style={{ color: "#0F1836" }}>Connect WhatsApp for 24/7 Care AI</div>
            <div className="text-[12px]" style={{ color: "#2A3558" }}>
              {user?.whatsapp_pending_number
                ? `You added ${user.whatsapp_pending_number} at signup — verify it now.`
                : "Chat with Care AI on WhatsApp in your language. Free with your account."}
            </div>
          </div>
          <button onClick={() => setWaAutoOpen(true)} className="btn-primary text-[12px] py-2 px-4" data-testid="wa-nudge-cta">
            {user?.whatsapp_pending_number ? "Verify number" : "Connect now"}
          </button>
        </section>
      )}

      {/* Doctor reschedule proposals */}
      {reschedules.map((a) => (
        <section
          key={a.id}
          className="glass-card p-4 flex items-center gap-3 flex-wrap"
          style={{ borderLeft: "4px solid #F2994A", background: "rgba(242,153,74,0.06)" }}
          data-testid={`reschedule-banner-${a.id}`}
        >
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "#F2994A" }}>
            <CalendarClock size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-[240px]">
            <div className="font-semibold text-[14px]" style={{ color: "#0F1836" }}>Dr. {a.doctor_name?.split(" ").pop() || "Lahari"} suggested a new time</div>
            <div className="text-[12.5px]" style={{ color: "#2A3558" }}>
              Originally {a.date} {a.time} → New: <span className="font-semibold">{a.proposed_date} {a.proposed_time}</span>
            </div>
            {a.proposed_reason && <div className="text-[12px] italic mt-1" style={{ color: "#6B7595" }}>"{a.proposed_reason}"</div>}
          </div>
          <button
            onClick={async () => {
              try { await updateAppointment(a.id, { patient_action: "accept_reschedule" }); toast.success("New slot accepted!"); reloadAppts(); }
              catch (e) { toast.error(e?.response?.data?.detail || "Could not accept"); }
            }}
            className="btn-primary text-[12px] py-2 px-3 inline-flex items-center gap-1"
            data-testid={`reschedule-accept-${a.id}`}
          >
            <CheckCircle2 size={12} /> Accept
          </button>
          <button
            onClick={async () => {
              try { await updateAppointment(a.id, { patient_action: "reject_reschedule" }); toast.success("Cancelled — rebook anytime."); reloadAppts(); }
              catch (e) { toast.error(e?.response?.data?.detail || "Could not cancel"); }
            }}
            className="btn-ghost text-[12px] py-2 px-3 inline-flex items-center gap-1"
            data-testid={`reschedule-reject-${a.id}`}
          >
            <X size={12} /> Decline
          </button>
        </section>
      ))}

      {/* === Family Profiles (above health snapshot per spec) === */}
      <section className="glass-card flex flex-col gap-3" data-testid="family-profiles">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "rgba(91,124,250,0.14)" }}>
              <Users size={18} className="text-[#5B7CFA]" />
            </div>
            <div>
              <h3 className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>Family profiles</h3>
              <div className="text-[11.5px]" style={{ color: "#6B7595" }}>Manage care for up to 5 family members</div>
            </div>
          </div>
          <span className="text-[11.5px]" style={{ color: "#6B7595" }}>{profiles.length}/5</span>
        </header>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {profiles.map((p) => {
            const sel = p.id === user?.linked_patient_id;
            const idOk = !!(p.name && (p.dob || p.age != null) && p.gender);
            const vitalsOk = !!(p.height_cm && p.weight_kg);
            const hrOk = !!p.has_health_record;
            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => setEditingProfile(p)}
                onKeyDown={(e) => e.key === "Enter" && setEditingProfile(p)}
                className="glass-soft p-3 flex flex-col items-center text-center gap-1.5 cursor-pointer hover:shadow-md transition active:scale-[0.98]"
                style={sel ? { borderTop: "2px solid #5B7CFA" } : {}}
                data-testid={`family-profile-${p.id}`}
              >
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-[14px]"
                  style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}
                >
                  {(p.name || "?").charAt(0).toUpperCase()}
                </div>
                <div className="font-semibold text-[12.5px] truncate w-full" style={{ color: "#0F1836" }}>{p.name}</div>
                <div className="text-[10.5px] uppercase tracking-wider font-bold" style={{ color: "#7C4DFF" }}>
                  {p.relationship === "self" ? "You" : p.relationship}
                </div>
                {p.bmi && (
                  <div className="text-[10px] font-semibold" style={{ color: "#6B7595" }}>BMI {p.bmi}</div>
                )}
                {/* Completeness categories */}
                <div className="flex items-center gap-1 flex-wrap justify-center mt-0.5">
                  <CategoryDot label="Identity" done={idOk} />
                  <CategoryDot label="Vitals" done={vitalsOk} />
                  <Link
                    to={`/profiles/${p.id}/health-record`}
                    title="Manage health record"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <CategoryDot label="Health" done={hrOk} />
                  </Link>
                </div>
                {sel && <span className="badge badge-success !py-0 text-[9.5px]">Active</span>}
                {/* Always-visible edit affordance — works on touch */}
                <div
                  className="mt-auto inline-flex items-center gap-0.5 text-[9.5px] font-semibold"
                  style={{ color: "#9AA3BD" }}
                  data-testid={`edit-profile-btn-${p.id}`}
                >
                  <Pencil size={8} /> Edit
                </div>
              </div>
            );
          })}
          {showAddProfileSlot && (
            <button
              type="button"
              onClick={() => navigate("/profiles/new")}
              className="glass-soft p-3 flex flex-col items-center text-center gap-1.5 border-2 border-dashed transition hover:bg-white/60"
              style={{ borderColor: "rgba(91,124,250,0.4)" }}
              data-testid="family-add-profile"
            >
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "rgba(91,124,250,0.10)" }}>
                <Plus size={18} className="text-[#5B7CFA]" />
              </div>
              <div className="font-semibold text-[12.5px]" style={{ color: "#5B7CFA" }}>Add member</div>
              <div className="text-[10.5px]" style={{ color: "#6B7595" }}>Up to 5 total</div>
            </button>
          )}
        </div>
      </section>

      {/* === ROW 1 — Health Snapshot · Active meds · Upcoming === */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Health Snapshot */}
        <section className="glass-card flex flex-col gap-3" data-testid="health-snapshot">
          <header className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "rgba(232,90,90,0.14)" }}>
              <Heart size={18} className="text-[#E85A5A]" />
            </div>
            <div>
              <h3 className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>Health snapshot</h3>
              <div className="text-[11.5px]" style={{ color: "#6B7595" }}>Care AI is keeping these on file</div>
            </div>
          </header>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Conditions" count={conditions.length} accent="#5B7CFA" />
            <Stat label="Allergies" count={allergies.length} accent={allergies.length ? "#E85A5A" : "#6B7595"} danger={allergies.length > 0} />
          </div>
          {allergies.length > 0 && (
            <div className="rounded-xl px-3 py-2" style={{ background: "rgba(232,90,90,0.10)" }} data-testid="snapshot-allergies">
              <div className="text-[10.5px] font-bold uppercase tracking-wider mb-1 inline-flex items-center gap-1" style={{ color: "#9C2E2E" }}>
                <ShieldAlert size={10} /> Allergic to
              </div>
              <div className="flex flex-wrap gap-1.5">
                {allergies.slice(0, 4).map((a, i) => (
                  <span key={i} className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full bg-white/70" style={{ color: "#9C2E2E" }}>{a}</span>
                ))}
              </div>
            </div>
          )}
          {conditions.length > 0 && (
            <div className="rounded-xl px-3 py-2" style={{ background: "rgba(91,124,250,0.08)" }} data-testid="snapshot-conditions">
              <div className="text-[10.5px] font-bold uppercase tracking-wider mb-1" style={{ color: "#3F4F8A" }}>Conditions</div>
              <div className="flex flex-wrap gap-1.5">
                {conditions.slice(0, 4).map((c, i) => (
                  <span key={i} className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full bg-white/70" style={{ color: "#3F4F8A" }}>{c}</span>
                ))}
              </div>
            </div>
          )}
          {conditions.length === 0 && allergies.length === 0 && user?.linked_patient_id && (
            <Link
              to={`/profiles/${user.linked_patient_id}/health-record`}
              className="text-[12.5px] font-semibold inline-flex items-center gap-1"
              style={{ color: "#5B7CFA" }}
              data-testid="snapshot-add-conditions-link"
            >
              + Add your health conditions →
            </Link>
          )}
          <div className="flex items-center justify-between text-[12px] pt-1" style={{ color: "#6B7595" }}>
            <span>Last visit</span>
            <span className="font-semibold" style={{ color: "#0F1836" }}>{lastVisit || "—"}</span>
          </div>
        </section>

        {/* Active medications */}
        <section className="glass-card flex flex-col gap-3" data-testid="active-meds">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "rgba(60,201,124,0.14)" }}>
                <Pill size={18} className="text-[#28A55B]" />
              </div>
              <div>
                <h3 className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>Active medications</h3>
                <div className="text-[11.5px]" style={{ color: "#6B7595" }}>{activeRx.length || "No"} prescription{activeRx.length === 1 ? "" : "s"} active</div>
              </div>
            </div>
            <Link to="/reminders" className="text-[12px] font-semibold inline-flex items-center gap-0.5" style={{ color: "#28A55B" }} data-testid="active-meds-reminders">
              <Clock size={12} /> Reminders
            </Link>
          </header>
          {activeRx.length === 0 ? (
            <div className="glass-soft p-4 text-center text-[12.5px]" style={{ color: "#6B7595" }}>
              You're not on any medications right now.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {activeRx.map((r, i) => (
                <div key={i} className="glass-soft p-3 flex items-center gap-2" data-testid={`active-rx-${i}`}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(60,201,124,0.14)" }}>
                    <Pill size={14} className="text-[#28A55B]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[13px] truncate" style={{ color: "#0F1836" }}>{r.medication}</div>
                    <div className="text-[11px] truncate" style={{ color: "#6B7595" }}>
                      {[r.dose, r.when_to_take || r.frequency || r.how_often].filter(Boolean).join(" · ") || "Schedule TBD"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Upcoming appointments */}
        <section className="glass-card flex flex-col gap-3" data-testid="upcoming">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "rgba(91,124,250,0.14)" }}>
                <Calendar size={18} className="text-[#5B7CFA]" />
              </div>
              <div>
                <h3 className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>Upcoming visits</h3>
                <div className="text-[11.5px]" style={{ color: "#6B7595" }}>{upcoming.length || "No"} scheduled</div>
              </div>
            </div>
            {upcoming.length > 0 && (
              <button onClick={() => setShowConsult(true)} className="text-[12px] font-semibold" style={{ color: "#5B7CFA" }} data-testid="upcoming-add">
                + Book
              </button>
            )}
          </header>
          {upcoming.length === 0 ? (
            <div className="glass-soft p-4 flex flex-col gap-2 text-center">
              <div className="text-[13px] font-semibold" style={{ color: "#0F1836" }}>No upcoming visits</div>
              <button onClick={() => setShowConsult(true)} className="btn-primary text-[12px] py-2 inline-flex items-center justify-center gap-1.5" data-testid="portal-empty-consult-btn">
                <Stethoscope size={12} /> Consult a Doctor
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {upcoming.map((a) => (
                <Link
                  to={`/consult/new?appointment_id=${a.id}`}
                  key={a.id}
                  className="glass-soft p-3 flex items-center gap-3 hover:shadow-md transition"
                  data-testid={`portal-appt-${a.id}`}
                >
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] text-white font-display font-bold flex items-center justify-center text-center leading-tight shrink-0">
                    <div>
                      <div className="text-[10px]">{new Date(a.date).toLocaleDateString(undefined, { month: "short" })}</div>
                      <div className="text-[18px]">{new Date(a.date).getDate()}</div>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[13px] truncate" style={{ color: "#0F1836" }}>{a.reason || a.type}</div>
                    <div className="text-[11.5px]" style={{ color: "#6B7595" }}>
                      {a.time} · {a.doctor_name}
                    </div>
                    <span className={`badge ${a.status === "requested" ? "badge-warning" : ""} !py-0 mt-1 text-[9.5px]`}>
                      {a.status === "requested" ? "Pending" : a.status}
                    </span>
                  </div>
                  <ChevronRight size={14} className="text-[#5B7CFA]" />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* === ROW 2 — Recent consultations (full width, lots of detail) === */}
      <section className="glass-card flex flex-col gap-3" data-testid="my-consultations">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "rgba(124,77,255,0.14)" }}>
              <FileText size={18} className="text-[#7C4DFF]" />
            </div>
            <div>
              <h3 className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>Recent consultations</h3>
              <div className="text-[11.5px]" style={{ color: "#6B7595" }}>Open one to see notes, Rx, and chat with Care AI</div>
            </div>
          </div>
          <Link to="/messages" className="text-[12px] font-semibold inline-flex items-center gap-1" style={{ color: "#7C4DFF" }}>
            <MessageSquare size={12} /> Message doctor
          </Link>
        </header>
        {consultations.length === 0 ? (
          <div className="glass-soft p-6 flex flex-col items-center text-center gap-2">
            <Activity size={20} className="text-[#7C4DFF]" />
            <div className="font-semibold text-[14px]" style={{ color: "#0F1836" }}>No consultations yet</div>
            <div className="text-[12px]" style={{ color: "#6B7595" }}>Book your first visit and Care AI will keep a record automatically.</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {consultations.slice(0, 6).map((c) => (
              <Link
                to={`/consultations/${c.id}`}
                key={c.id}
                className="glass-soft p-3 flex flex-col gap-2 hover:shadow-md hover:-translate-y-0.5 transition"
                data-testid={`consultation-card-${c.id}`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#7C4DFF" }}>
                    {new Date(c.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </div>
                  {c.prescriptions?.length > 0 && (
                    <span className="badge badge-success !py-0 text-[9.5px] inline-flex items-center gap-0.5">
                      <Pill size={9} /> {c.prescriptions.length} Rx
                    </span>
                  )}
                </div>
                <div className="font-semibold text-[14px] line-clamp-2" style={{ color: "#0F1836" }}>
                  {c.extracted_data?.assessment || c.chief_complaint || "Consultation"}
                </div>
                <div className="text-[11.5px] line-clamp-2" style={{ color: "#2A3558" }}>
                  {c.patient_summary || c.doctor_summary || "Tap to see notes & Rx"}
                </div>
                <div className="flex items-center justify-between text-[11px] pt-1 mt-auto" style={{ color: "#5B7CFA" }}>
                  <span className="font-semibold">Open · ask AI</span>
                  <ChevronRight size={12} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* === Care AI + Reminders shortcuts === */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="portal-companion-row">
        <Link
          to="/followup"
          className="glass-card p-5 flex items-center gap-4 hover:shadow-xl transition"
          data-testid="portal-followup-cta"
          style={{ background: "linear-gradient(135deg, rgba(91,124,250,0.12), rgba(124,77,255,0.12))" }}
        >
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}>
            <Sparkles size={22} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>Chat with Care AI · 24/7</div>
            <div className="text-[12.5px]" style={{ color: "#2A3558" }}>Ask about symptoms, meds, side effects.</div>
          </div>
          <ChevronRight size={18} className="text-[#5B7CFA]" />
        </Link>
        <Link
          to="/reminders"
          className="glass-card p-5 flex items-center gap-4 hover:shadow-xl transition"
          data-testid="portal-reminders-cta"
        >
          <div className="w-14 h-14 rounded-2xl bg-[#3CC97C]/18 flex items-center justify-center">
            <Clock size={22} className="text-[#28A55B]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>My reminders</div>
            <div className="text-[12.5px]" style={{ color: "#2A3558" }}>
              {reminders.length} med{reminders.length === 1 ? "" : "s"} tracked · follow-ups & tests too
            </div>
          </div>
          <ChevronRight size={18} className="text-[#5B7CFA]" />
        </Link>
      </section>

      {/* WhatsApp settings (existing) */}
      <section data-testid="portal-whatsapp-section" className="flex flex-col gap-4">
        <ConnectWhatsApp user={user} onChange={refresh} prefilledNumber={user?.whatsapp_pending_number} autoOpen={waAutoOpen} />
        <WhatsAppSettingsCard onChange={refresh} />
      </section>

      {showConsult && (
        <ConsultNowModal
          onClose={() => setShowConsult(false)}
          onBooked={handleBooked}
        />
      )}

      {editingProfile && (
        <ProfileEditModal
          profile={editingProfile}
          isOnlyProfile={profiles.length <= 1}
          onClose={() => setEditingProfile(null)}
          onSaved={(updated) => {
            setProfiles((prev) => prev.map((p) => p.id === updated.id ? { ...p, ...updated } : p));
            setEditingProfile(null);
          }}
          onDeleted={(deletedId) => {
            setProfiles((prev) => prev.filter((p) => p.id !== deletedId));
            setEditingProfile(null);
          }}
        />
      )}
    </div>
  );
}

function CategoryDot({ label, done }) {
  return (
    <div className="flex items-center gap-0.5" title={`${label}: ${done ? "complete" : "incomplete"}`}>
      <div
        className="w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0"
        style={{ background: done ? "#3CC97C22" : "rgba(91,124,250,0.1)" }}
      >
        {done
          ? <Check size={8} style={{ color: "#3CC97C" }} />
          : <div className="w-1.5 h-1.5 rounded-full" style={{ background: "rgba(91,124,250,0.3)" }} />
        }
      </div>
      <span className="text-[8.5px] font-semibold" style={{ color: done ? "#3CC97C" : "#9AA3BD" }}>{label}</span>
    </div>
  );
}

function Stat({ label, count, accent, danger }) {
  return (
    <div
      className="glass-soft px-3 py-2.5 flex items-center gap-2"
      style={danger ? { background: "rgba(232,90,90,0.06)" } : {}}
    >
      {danger && <AlertTriangle size={14} className="text-[#E85A5A]" />}
      <div>
        <div className="font-display font-extrabold text-[20px] leading-none" style={{ color: accent }}>{count}</div>
        <div className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: "#6B7595" }}>{label}</div>
      </div>
    </div>
  );
}

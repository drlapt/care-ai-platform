import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { X, Save, Loader2, User, Ruler, Weight, Droplets, Calendar, Check, ClipboardList } from "lucide-react";
import { updateProfile } from "@/lib/api";

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];
const REL_OPTIONS = [
  { value: "self", label: "Self" },
  { value: "mother", label: "Mother" },
  { value: "father", label: "Father" },
  { value: "spouse", label: "Spouse" },
  { value: "child", label: "Child" },
  { value: "sibling", label: "Sibling" },
  { value: "family", label: "Other family" },
  { value: "guest", label: "Guest" },
];

function calcBmi(h, w) {
  const hm = parseFloat(h);
  const wkg = parseFloat(w);
  if (!hm || !wkg || hm <= 0) return null;
  return (wkg / ((hm / 100) ** 2)).toFixed(1);
}

function bmiCategory(bmi) {
  if (!bmi) return null;
  const b = parseFloat(bmi);
  if (b < 18.5) return { label: "Underweight", color: "#5B7CFA" };
  if (b < 25) return { label: "Healthy", color: "#3CC97C" };
  if (b < 30) return { label: "Overweight", color: "#F2994A" };
  return { label: "Obese", color: "#E85A5A" };
}

function CompletenessStatus({ form, profile }) {
  const idOk = !!(form.name.trim() && (form.dob || profile?.age != null) && form.gender);
  const vitalsOk = !!(form.height_cm && form.weight_kg);
  const mh = profile?.medical_history || {};
  const healthOk = !!(
    mh.current_conditions?.length || mh.current_medications?.length ||
    mh.medications?.length || mh.allergies?.length || profile?.has_health_record
  );
  const StatusLine = ({ done, label, note }) => (
    <div className="flex items-center gap-2 text-[13px]">
      <div
        className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
        style={{ background: done ? "rgba(60,201,124,0.15)" : "rgba(91,124,250,0.1)" }}
      >
        {done
          ? <Check size={10} style={{ color: "#3CC97C" }} />
          : <div className="w-2 h-2 rounded-full" style={{ background: "rgba(91,124,250,0.3)" }} />
        }
      </div>
      <span style={{ color: done ? "#28A55B" : "#6B7595" }}>
        {done ? `✓ ${label} complete` : `○ ${note || label + " incomplete"}`}
      </span>
    </div>
  );
  return (
    <div className="glass-soft px-4 py-3 flex flex-col gap-2 rounded-2xl" data-testid="completeness-status">
      <div className="text-[10.5px] font-bold uppercase tracking-wider mb-0.5" style={{ color: "#9AA3BD" }}>Profile status</div>
      <StatusLine done={idOk} label="Identity" note="Name, age, and gender needed" />
      <StatusLine done={vitalsOk} label="Vitals" note="Height and weight needed" />
      <StatusLine done={healthOk} label="Health record" note="Health record can be expanded later" />
    </div>
  );
}

export default function ProfileEditModal({ profile, onClose, onSaved }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: profile?.name || "",
    dob: profile?.dob || "",
    gender: profile?.gender || "",
    relationship: profile?.relationship || "family",
    height_cm: profile?.height_cm ? String(profile.height_cm) : "",
    weight_kg: profile?.weight_kg ? String(profile.weight_kg) : "",
    blood_group: profile?.blood_group || "",
  });
  const [saving, setSaving] = useState(false);

  const bmi = calcBmi(form.height_cm, form.weight_kg);
  const bmiCat = bmiCategory(bmi);

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target?.value ?? e }));

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        gender: form.gender || null,
        relationship: form.relationship || null,
        dob: form.dob || null,
        height_cm: form.height_cm ? parseFloat(form.height_cm) : null,
        weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null,
        blood_group: form.blood_group || null,
      };
      const result = await updateProfile(profile.id, payload);
      toast.success("Profile updated");
      onSaved?.({ ...profile, ...payload, bmi: bmi ? parseFloat(bmi) : profile?.bmi, profile_completeness: result?.profile_completeness ?? profile?.profile_completeness });
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not save profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-up"
      style={{ background: "rgba(15, 24, 54, 0.35)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
      data-testid="profile-edit-backdrop"
    >
      <form
        onSubmit={handleSave}
        onClick={(e) => e.stopPropagation()}
        className="glass-card w-full max-w-[520px] flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        data-testid="profile-edit-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}>
              <User size={18} className="text-white" />
            </div>
            <div>
              <div className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>Edit Profile</div>
              <div className="text-[12px]" style={{ color: "#6B7595" }}>{profile?.name}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full bg-white/70 hover:bg-white transition flex items-center justify-center">
            <X size={14} />
          </button>
        </div>

        {/* Completeness status */}
        <CompletenessStatus form={form} profile={profile} />

        {/* Identity */}
        <fieldset className="flex flex-col gap-3">
          <legend className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: "#6B7595" }}>
            <User size={11} className="inline mr-1" />Identity
          </legend>
          <div className="grid grid-cols-1 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold" style={{ color: "#2A3558" }}>Full name *</span>
              <input className="input" value={form.name} onChange={set("name")} placeholder="Full name" required data-testid="edit-name" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold inline-flex items-center gap-1" style={{ color: "#2A3558" }}>
                  <Calendar size={11} /> Date of birth
                </span>
                <input className="input" type="date" value={form.dob} onChange={set("dob")} data-testid="edit-dob"
                  max={new Date().toISOString().slice(0, 10)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold" style={{ color: "#2A3558" }}>Gender</span>
                <select className="input" value={form.gender} onChange={set("gender")} data-testid="edit-gender">
                  <option value="">Select…</option>
                  {GENDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold" style={{ color: "#2A3558" }}>Relationship</span>
              <select className="input" value={form.relationship} onChange={set("relationship")} data-testid="edit-relationship">
                {REL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
        </fieldset>

        {/* Vitals */}
        <fieldset className="flex flex-col gap-3">
          <legend className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: "#6B7595" }}>
            <Ruler size={11} className="inline mr-1" />Vitals
          </legend>
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold inline-flex items-center gap-1" style={{ color: "#2A3558" }}>
                <Ruler size={11} /> Height (cm)
              </span>
              <input className="input" type="number" min="50" max="250" step="0.1" value={form.height_cm} onChange={set("height_cm")} placeholder="170" data-testid="edit-height" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold inline-flex items-center gap-1" style={{ color: "#2A3558" }}>
                <Weight size={11} /> Weight (kg)
              </span>
              <input className="input" type="number" min="1" max="300" step="0.1" value={form.weight_kg} onChange={set("weight_kg")} placeholder="70" data-testid="edit-weight" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold inline-flex items-center gap-1" style={{ color: "#2A3558" }}>
                <Droplets size={11} /> Blood group
              </span>
              <select className="input" value={form.blood_group} onChange={set("blood_group")} data-testid="edit-blood">
                <option value="">Unknown</option>
                {BLOOD_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
          </div>

          {/* BMI preview */}
          {bmi && (
            <div className="glass-soft px-4 py-3 flex items-center justify-between" data-testid="bmi-preview">
              <div>
                <div className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: "#6B7595" }}>BMI (calculated)</div>
                <div className="font-display font-extrabold text-[26px] leading-none" style={{ color: bmiCat?.color || "#0F1836" }}>{bmi}</div>
              </div>
              {bmiCat && (
                <span className="text-[12px] font-bold px-3 py-1 rounded-full text-white" style={{ background: bmiCat.color }}>
                  {bmiCat.label}
                </span>
              )}
            </div>
          )}
        </fieldset>

        {/* Health record link */}
        {profile?.id && (
          <button
            type="button"
            onClick={() => { onClose(); navigate(`/profiles/${profile.id}/health-record`); }}
            className="w-full text-[13px] font-semibold py-2.5 rounded-2xl border transition hover:opacity-80 inline-flex items-center justify-center gap-2"
            style={{ borderColor: "rgba(91,124,250,0.3)", color: "#5B7CFA", background: "rgba(91,124,250,0.06)" }}
            data-testid="edit-manage-health-record"
          >
            <ClipboardList size={14} /> Manage conditions, medications &amp; allergies
          </button>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost flex-1" data-testid="edit-cancel">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary flex-1 inline-flex items-center justify-center gap-2" data-testid="edit-save">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

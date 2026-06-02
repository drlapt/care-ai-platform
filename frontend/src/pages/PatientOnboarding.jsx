import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Sparkles, Check } from "lucide-react";
import { createPatient } from "@/lib/api";
import CareAIChat from "@/components/CareAIChat";

const STEPS = { REG: "registration", CHAT: "chat", DONE: "done" };

export default function PatientOnboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(STEPS.REG);
  const [form, setForm] = useState({
    name: "", age: "", gender: "", phone: "", email: "",
    emergency_contact_name: "", emergency_contact_phone: "",
    chief_complaint: "",
  });
  const [patient, setPatient] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target?.value ?? e }));

  const submitRegistration = async (e) => {
    e.preventDefault();
    if (!form.name || !form.age || !form.gender || !form.phone || !form.chief_complaint) {
      toast.error("Please complete all required fields"); return;
    }
    setSubmitting(true);
    try {
      const created = await createPatient({
        personal_info: {
          name: form.name, age: Number(form.age), gender: form.gender,
          phone: form.phone, email: form.email,
          emergency_contact_name: form.emergency_contact_name,
          emergency_contact_phone: form.emergency_contact_phone,
        },
        chief_complaint: form.chief_complaint,
      });
      setPatient(created);
      setStep(STEPS.CHAT);
    } catch (err) { toast.error("Failed to register patient"); console.error(err); }
    finally { setSubmitting(false); }
  };

  const onChatComplete = () => {
    setStep(STEPS.DONE);
    toast.success("Care AI onboarding complete");
  };

  return (
    <div className="max-w-3xl mx-auto w-full animate-fade-up" data-testid="onboarding-page">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 mb-6 text-sm font-medium" style={{ color: "#6B7595" }} data-testid="back-btn">
        <ArrowLeft size={16} /> Back
      </button>

      {step === STEPS.REG && (
        <form onSubmit={submitRegistration} className="glass-card" data-testid="registration-form">
          <div className="mb-6">
            <div className="badge mb-3"><Sparkles size={12} /> Care AI Onboarding</div>
            <h1 className="font-display font-bold text-[32px] leading-tight mb-2" style={{ color: "#0F1836" }}>New Patient Registration</h1>
            <p className="text-sm" style={{ color: "#6B7595" }}>Care AI will conversationally gather the patient's medical history after registration.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Full Name *"><input className="form-input" value={form.name} onChange={set("name")} placeholder="Sarah Johnson" data-testid="reg-name" /></Field>
            <Field label="Age *"><input className="form-input" type="number" min="0" max="130" value={form.age} onChange={set("age")} placeholder="34" data-testid="reg-age" /></Field>
            <Field label="Gender *">
              <select className="form-select" value={form.gender} onChange={set("gender")} data-testid="reg-gender">
                <option value="">Select…</option><option>Male</option><option>Female</option><option>Other</option>
              </select>
            </Field>
            <Field label="Phone Number *"><input className="form-input" value={form.phone} onChange={set("phone")} placeholder="+1-555-0100" data-testid="reg-phone" /></Field>
            <Field label="Email"><input className="form-input" type="email" value={form.email} onChange={set("email")} placeholder="patient@email.com" data-testid="reg-email" /></Field>
            <Field label="Emergency Contact Name"><input className="form-input" value={form.emergency_contact_name} onChange={set("emergency_contact_name")} placeholder="Full name" data-testid="reg-ec-name" /></Field>
            <div className="md:col-span-2">
              <Field label="Emergency Contact Phone"><input className="form-input" value={form.emergency_contact_phone} onChange={set("emergency_contact_phone")} placeholder="+1-555-0101" data-testid="reg-ec-phone" /></Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Chief Complaint *">
                <textarea className="form-textarea" rows={4} value={form.chief_complaint} onChange={set("chief_complaint")} placeholder="Describe your main health concern (e.g., chest pain, fever, headache)" data-testid="reg-complaint" />
              </Field>
            </div>
          </div>

          <div className="flex justify-end mt-6">
            <button type="submit" disabled={submitting} className="btn-primary inline-flex items-center gap-2" data-testid="reg-submit">
              {submitting ? "Registering…" : "Start Care AI Chat"} <ArrowRight size={16} />
            </button>
          </div>
        </form>
      )}

      {step === STEPS.CHAT && patient && (
        <CareAIChat patient={patient} onComplete={onChatComplete} />
      )}

      {step === STEPS.DONE && patient && (
        <div className="glass-card text-center py-12" data-testid="onboarding-done">
          <div className="w-20 h-20 mx-auto mb-5 rounded-3xl bg-gradient-to-br from-[#3CC97C] to-[#28A55B] flex items-center justify-center shadow-lg">
            <Check className="text-white" size={36} />
          </div>
          <h2 className="font-display font-bold text-[30px] mb-2" style={{ color: "#0F1836" }}>Profile Created</h2>
          <p className="text-sm mb-8" style={{ color: "#6B7595" }}>{patient.personal_info?.name}'s intake is complete — Care AI has prepared a summary for the doctor.</p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <button onClick={() => navigate(`/patients/${patient.id}`)} className="btn-ghost" data-testid="goto-profile">View Profile</button>
            <button onClick={() => navigate(`/patients/${patient.id}/consultation`)} className="btn-primary inline-flex items-center gap-2" data-testid="goto-consultation">
              Proceed to Consultation <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold" style={{ color: "#2A3558" }}>{label}</span>
      {children}
    </label>
  );
}

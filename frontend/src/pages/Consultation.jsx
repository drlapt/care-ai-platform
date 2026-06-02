import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Sparkles, Loader2, ShieldAlert, Pill, Activity, User, Check, ClipboardList, HeartPulse, Mic, Wand2, Lightbulb, AlertTriangle,
} from "lucide-react";
import { getPatient, processConsultation, careAICopilot, careAISummary } from "@/lib/api";
import VoiceRecorder from "@/components/VoiceRecorder";
import CareAISummaryCard from "@/components/CareAISummaryCard";

const SAMPLES = {
  chest: `Patient: I have been having chest pain for 2 days.
Doctor: Can you describe the pain?
Patient: It's a sharp pain, about 7 out of 10, comes and goes.
Doctor: Any shortness of breath?
Patient: Yes, especially when walking upstairs.
Doctor: Any family history of heart problems?
Patient: My father had a heart attack at 55.
Doctor: I'm prescribing Aspirin 75mg daily and want you to see a cardiologist within a week.
Patient: I'm allergic to penicillin, is that okay?
Doctor: Yes, aspirin is fine. Take it after meals to avoid stomach upset.`,
  fever: `Patient: I have fever since 3 days, around 101 degrees.
Doctor: Any other symptoms?
Patient: Mild cough and body ache, feeling very tired.
Doctor: Any difficulty breathing?
Patient: No, just the cough, mostly dry.
Doctor: Any recent travel or contact with sick people?
Patient: No recent travel, but my colleague was sick last week.
Doctor: Take Paracetamol 650mg three times daily after meals, drink plenty of fluids, rest.
Patient: Should I take cough syrup?
Doctor: Honey with warm water is better. Come back if fever persists beyond 5 days or if you develop breathing difficulty.`,
};

export default function Consultation() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [patient, setPatient] = useState(null);
  const [conversation, setConversation] = useState("");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [showVoice, setShowVoice] = useState(false);
  const [copilot, setCopilot] = useState(null);
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [careSummary, setCareSummary] = useState(null);

  useEffect(() => {
    getPatient(id).then(setPatient).catch(() => toast.error("Patient not found"));
    careAISummary(id).then((s) => s.has_summary && setCareSummary(s)).catch(() => {});
  }, [id]);

  const submit = async () => {
    if (conversation.trim().length < 30) { toast.error("Please enter the full consultation conversation"); return; }
    setProcessing(true); setResult(null);
    try {
      const res = await processConsultation(id, conversation);
      setResult(res); toast.success("Consultation processed");
    } catch (err) { toast.error("AI processing failed. Try again."); console.error(err); }
    finally { setProcessing(false); }
  };

  if (!patient) return <div className="glass-card" data-testid="loading">Loading patient…</div>;

  const pi = patient.personal_info || {};
  const mh = patient.medical_history || {};

  const onVoiceTranscript = ({ text }) => {
    setConversation((prev) => (prev ? prev + "\n" + text : text));
    toast.success("Transcript added to conversation");
  };

  const runCopilot = async () => {
    if (conversation.trim().length < 20) {
      toast.error("Add some conversation first (at least 20 characters)");
      return;
    }
    setCopilotLoading(true);
    try {
      const data = await careAICopilot(id, conversation);
      setCopilot(data);
      toast.success("Copilot suggestions ready");
    } catch {
      toast.error("Copilot failed");
    } finally {
      setCopilotLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-up" data-testid="consultation-page">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm font-medium w-fit" style={{ color: "#6B7595" }} data-testid="back-btn">
        <ArrowLeft size={16} /> Back
      </button>

      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="badge mb-2"><Sparkles size={12} /> Live Consultation Processor</div>
          <h1 className="font-display font-bold text-[34px] leading-tight" style={{ color: "#0F1836" }}>{pi.name}</h1>
          <div className="text-sm mt-1" style={{ color: "#6B7595" }}>{pi.age}y · {pi.gender} · {pi.phone}</div>
        </div>
        <button onClick={() => setShowVoice((v) => !v)} className={showVoice ? "btn-ghost inline-flex items-center gap-2" : "btn-primary inline-flex items-center gap-2"} data-testid="toggle-voice">
          <Mic size={15} /> {showVoice ? "Hide Voice Recorder" : "Enable Voice Capture"}
        </button>
      </header>

      {showVoice && <VoiceRecorder onTranscript={onVoiceTranscript} />}

      {careSummary && (
        <CareAISummaryCard
          urgency={careSummary.urgency || "medium"}
          handoff={careSummary.handoff_doctor}
          redFlags={careSummary.red_flags}
          summary={careSummary.summary}
          size="full"
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr_320px] gap-6">
        <aside className="glass-card self-start flex flex-col gap-4" data-testid="consultation-patient-panel">
          <MiniSection title="Identity" icon={User}>
            <Kv k="Name" v={pi.name} />
            <Kv k="Age / Sex" v={`${pi.age}y · ${pi.gender}`} />
            <Kv k="Phone" v={pi.phone} />
          </MiniSection>
          <MiniSection title="Chief Complaint" icon={Activity}>
            <div className="text-[13px]" style={{ color: "#2A3558" }}>{mh.chief_complaint || "—"}</div>
          </MiniSection>
          <MiniSection title="Allergies" icon={ShieldAlert} danger>
            <Pills items={mh.allergies} render={(a) => String(a)} empty="NKDA" danger />
          </MiniSection>
          <MiniSection title="Medications" icon={Pill}>
            <Pills items={mh.medications} render={(m) => m?.name ? m.name : String(m)} empty="None" />
          </MiniSection>
          <MiniSection title="Conditions" icon={HeartPulse}>
            <Pills items={mh.current_conditions} render={(c) => typeof c === "string" ? c : (c?.condition || JSON.stringify(c))} empty="None" />
          </MiniSection>
        </aside>

        <section className="glass-card flex flex-col" data-testid="consultation-input-panel">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-bold text-[20px]" style={{ color: "#0F1836" }}>Doctor ↔ Patient Conversation</h3>
            <div className="flex gap-2">
              <button className="btn-ghost text-xs" onClick={() => setConversation(SAMPLES.chest)} data-testid="sample-chest">Sample: Chest Pain</button>
              <button className="btn-ghost text-xs" onClick={() => setConversation(SAMPLES.fever)} data-testid="sample-fever">Sample: Fever</button>
            </div>
          </div>

          <textarea
            className="form-textarea flex-1"
            rows={14}
            placeholder="Use the Voice Capture button, paste a transcript, or type the conversation here…"
            value={conversation}
            onChange={(e) => setConversation(e.target.value)}
            data-testid="conversation-input"
          />

          <div className="flex items-center justify-between mt-4">
            <div className="text-xs" style={{ color: "#6B7595" }} data-testid="char-count">{conversation.length} characters</div>
            <button onClick={submit} disabled={processing || conversation.length < 30} className="btn-primary inline-flex items-center gap-2" data-testid="process-btn">
              {processing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {processing ? "Processing with GPT-4o…" : "Process Consultation"}
            </button>
          </div>
        </section>

        <aside className="glass-card self-start flex flex-col gap-4" data-testid="consultation-insights-panel">
          <MiniSection title="AI Copilot" icon={Wand2}>
            <button onClick={runCopilot} disabled={copilotLoading} className="btn-ghost w-full inline-flex items-center justify-center gap-2 text-sm mb-3" data-testid="copilot-btn">
              {copilotLoading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {copilotLoading ? "Analyzing…" : "Get live suggestions"}
            </button>
            {copilot && <CopilotContent data={copilot} />}
            {!copilot && !copilotLoading && (
              <div className="text-[12px]" style={{ color: "#6B7595" }}>Get instant questions to ask, red flags, differential diagnoses, and safe Rx suggestions — cross-checked with allergies.</div>
            )}
          </MiniSection>

          <MiniSection title="AI Insights" icon={Sparkles}>
            {!result && !processing && (
              <div className="text-[13px]" style={{ color: "#6B7595" }}>Results will appear here after processing.</div>
            )}
            {processing && (
              <div className="flex flex-col gap-3 text-[13px]" style={{ color: "#2A3558" }}>
                <Step label="Extracting clinical entities" />
                <Step label="Detecting contradictions" />
                <Step label="Generating dual summaries" />
                <Step label="Explaining prescriptions" />
              </div>
            )}
            {result && <Insights result={result} />}
          </MiniSection>
        </aside>
      </div>

      {result && (
        <ResultsPanel result={result} onViewProfile={() => navigate(`/patients/${id}`)} onViewDetail={() => navigate(`/consultations/${result.consultation.id}`)} />
      )}
    </div>
  );
}

function MiniSection({ title, icon: Icon, children, danger }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className={danger ? "text-[#E85A5A]" : "text-[#5B7CFA]"} />
        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>{title}</div>
      </div>
      {children}
    </div>
  );
}
function Kv({ k, v }) { return <div className="text-[13px] flex justify-between gap-3"><span style={{ color: "#6B7595" }}>{k}</span><span className="font-semibold text-right" style={{ color: "#0F1836" }}>{v}</span></div>; }
function Pills({ items, render, empty, danger }) {
  if (!items || items.length === 0) return <div className="text-[13px]" style={{ color: "#6B7595" }}>{empty}</div>;
  return <div className="flex flex-wrap gap-1.5">{items.map((it, i) => <span key={i} className={danger ? "badge badge-danger" : "badge"}>{render(it)}</span>)}</div>;
}
function Step({ label }) { return <div className="flex items-center gap-2"><Loader2 size={13} className="animate-spin text-[#5B7CFA]" /><span>{label}</span></div>; }

function CopilotContent({ data }) {
  return (
    <div className="flex flex-col gap-4 text-[13px]" data-testid="copilot-content">
      {data.red_flags?.length > 0 && (
        <div className="glass-soft p-3" style={{ background: "rgba(232,90,90,0.08)", border: "1px solid rgba(232,90,90,0.25)" }}>
          <div className="flex items-center gap-1.5 font-semibold mb-1.5 text-[12px]" style={{ color: "#E85A5A" }}>
            <AlertTriangle size={12} /> Red flags
          </div>
          <ul className="flex flex-col gap-1.5 text-[12px]">
            {data.red_flags.map((r, i) => {
              const isObj = r && typeof r === "object";
              const text = isObj ? (r.symptom || r.finding || r.description || JSON.stringify(r)) : String(r);
              const sev = isObj ? (r.severity || "").toLowerCase() : "";
              return (
                <li key={i} className="flex items-start justify-between gap-2" style={{ color: "#2A3558" }}>
                  <span className="flex-1">• {text}</span>
                  {sev && <span className={`badge text-[10px] ${sev === "high" ? "badge-danger" : sev === "medium" ? "badge-warning" : ""}`}>{sev}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {data.next_questions?.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1" style={{ color: "#5B7CFA" }}>
            <Lightbulb size={11} /> Ask next
          </div>
          <ul className="flex flex-col gap-1.5">
            {data.next_questions.map((q, i) => (
              <li key={i} className="glass-soft px-3 py-2 text-[12.5px]" style={{ color: "#0F1836" }}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      {data.differential_dx?.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#7C4DFF" }}>Differential Dx</div>
          <ul className="flex flex-col gap-1.5">
            {data.differential_dx.map((d, i) => (
              <li key={i} className="glass-soft px-3 py-2 text-[12px]" style={{ color: "#2A3558" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold" style={{ color: "#0F1836" }}>{d.condition}</span>
                  <span className={`badge text-[10px] ${d.likelihood === "high" ? "badge-danger" : d.likelihood === "medium" ? "badge-warning" : ""}`}>{d.likelihood}</span>
                </div>
                {d.reason && <div className="mt-0.5 text-[11.5px]" style={{ color: "#6B7595" }}>{d.reason}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.rx_suggestions?.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#28A55B" }}>Rx suggestions</div>
          <ul className="flex flex-col gap-1.5">
            {data.rx_suggestions.map((r, i) => (
              <li key={i} className="glass-soft px-3 py-2 text-[12px]" style={{ color: "#2A3558" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold" style={{ color: "#0F1836" }}>{r.medication}</span>
                  {r.safe_with_allergies === false
                    ? <span className="badge badge-danger text-[10px] inline-flex items-center gap-1"><AlertTriangle size={10} /> Allergy</span>
                    : <span className="badge badge-success text-[10px] inline-flex items-center gap-1"><Check size={10} /> Safe</span>}
                </div>
                {r.rationale && <div className="mt-0.5 text-[11.5px]" style={{ color: "#6B7595" }}>{r.rationale}</div>}
                {r.interaction_warning && <div className="mt-1 text-[11.5px] font-medium" style={{ color: "#C77800" }}>⚠ {r.interaction_warning}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.education_points?.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#6B7595" }}>Patient education</div>
          <ul className="flex flex-col gap-1 text-[12px]" style={{ color: "#2A3558" }}>
            {data.education_points.map((e, i) => <li key={i}>• {e}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Insights({ result }) {
  const { consultation } = result;
  const e = consultation.extracted_data || {};
  return (
    <div className="flex flex-col gap-4 text-[13px]">
      {consultation.contradictions_found?.length > 0 && (
        <div className="glass-soft p-3 border border-[#E85A5A]/30" style={{ background: "rgba(232,90,90,0.06)" }}>
          <div className="flex items-center gap-1.5 font-semibold mb-1.5" style={{ color: "#E85A5A" }}>
            <ShieldAlert size={13} /> {consultation.contradictions_found.length} contradiction(s)
          </div>
          <ul className="flex flex-col gap-1.5">
            {consultation.contradictions_found.map((c, i) => (
              <li key={i} className="text-[12px]" style={{ color: "#2A3558" }}><span className="font-semibold">{c.type}:</span> {c.description}</li>
            ))}
          </ul>
        </div>
      )}
      {e.red_flags?.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#C77800" }}>Red Flags</div>
          <div className="flex flex-wrap gap-1.5">{e.red_flags.map((r, i) => <span key={i} className="badge badge-warning">{r}</span>)}</div>
        </div>
      )}
      {e.symptoms?.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#6B7595" }}>Symptoms</div>
          <div className="flex flex-col gap-1">
            {e.symptoms.map((s, i) => (<div key={i} className="text-[12px]" style={{ color: "#2A3558" }}>• {s.name}{s.severity ? ` · ${s.severity}` : ""}{s.duration ? ` · ${s.duration}` : ""}</div>))}
          </div>
        </div>
      )}
      {e.assessment && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#6B7595" }}>Assessment</div>
          <div className="text-[13px]" style={{ color: "#0F1836" }}>{e.assessment}</div>
        </div>
      )}
    </div>
  );
}

function ResultsPanel({ result, onViewProfile, onViewDetail }) {
  const { consultation } = result;
  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="results-panel">
      <div className="glass-card" data-testid="doctor-summary-card">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-xl bg-[#5B7CFA]/12 flex items-center justify-center"><ClipboardList size={16} className="text-[#5B7CFA]" /></div>
          <h3 className="font-display font-bold text-[19px]" style={{ color: "#0F1836" }}>Doctor Summary (Clinical)</h3>
        </div>
        <pre className="whitespace-pre-wrap text-[13.5px] leading-relaxed" style={{ color: "#2A3558", fontFamily: "Inter" }}>{consultation.doctor_summary || "—"}</pre>
      </div>
      <div className="glass-card" data-testid="patient-summary-card">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-xl bg-[#7C4DFF]/12 flex items-center justify-center"><User size={16} className="text-[#7C4DFF]" /></div>
          <h3 className="font-display font-bold text-[19px]" style={{ color: "#0F1836" }}>Patient Summary (Simple)</h3>
        </div>
        <pre className="whitespace-pre-wrap text-[13.5px] leading-relaxed" style={{ color: "#2A3558", fontFamily: "Inter" }}>{consultation.patient_summary || "—"}</pre>
      </div>
      {consultation.prescriptions?.length > 0 && (
        <div className="glass-card lg:col-span-2" data-testid="prescriptions-card">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-xl bg-[#3CC97C]/12 flex items-center justify-center"><Pill size={16} className="text-[#28A55B]" /></div>
            <h3 className="font-display font-bold text-[19px]" style={{ color: "#0F1836" }}>Prescription Guide</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {consultation.prescriptions.map((rx, i) => (
              <div key={i} className="glass-soft p-4" data-testid={`rx-${i}`}>
                <div className="font-semibold text-[16px] mb-1" style={{ color: "#0F1836" }}>{rx.name}</div>
                {rx.purpose && <div className="text-[12px] mb-3" style={{ color: "#6B7595" }}>{rx.purpose}</div>}
                <div className="flex flex-col gap-1.5 text-[13px]" style={{ color: "#2A3558" }}>
                  {rx.when_to_take && <div><span className="font-semibold">When:</span> {rx.when_to_take}</div>}
                  {rx.how_often && <div><span className="font-semibold">How often:</span> {rx.how_often}</div>}
                  {rx.duration && <div><span className="font-semibold">Duration:</span> {rx.duration}</div>}
                  {rx.food_interactions && <div><span className="font-semibold">Food:</span> {rx.food_interactions}</div>}
                  {rx.side_effects && <div><span className="font-semibold">Watch for:</span> {rx.side_effects}</div>}
                  {rx.warnings && <div><span className="font-semibold text-[#E85A5A]">Warning:</span> {rx.warnings}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="lg:col-span-2 flex flex-wrap gap-3 justify-end">
        <button onClick={onViewProfile} className="btn-ghost inline-flex items-center gap-2" data-testid="view-profile-btn">
          <User size={15} /> View Updated Profile
        </button>
        <button onClick={onViewDetail} className="btn-primary inline-flex items-center gap-2" data-testid="view-detail-btn">
          <Check size={15} /> View Full Consultation
        </button>
      </div>
    </section>
  );
}

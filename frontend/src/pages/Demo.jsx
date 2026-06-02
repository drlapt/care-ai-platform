import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Sparkles, ArrowLeft, ArrowRight, ChevronRight, Stethoscope, Award, Star,
  Calendar, Clock, User as UserIcon, Send, ShieldAlert, AlertTriangle, Heart,
  Pill, Activity, MessageCircle, CheckCircle2, FileText, Phone, Loader2, Mic,
} from "lucide-react";

/* =====================================================================
   PROJECT CARE — DEMO MODE
   Single-file, fully scripted, ZERO API calls.
   Designed to be bulletproof for live demos.
   ===================================================================== */

const STEPS = [
  { id: "intro", label: "Intro" },
  { id: "doctor", label: "Doctor" },
  { id: "details", label: "Basics" },
  { id: "symptoms", label: "Symptoms" },
  { id: "vitals", label: "Vitals" },
  { id: "alert", label: "AI Alert" },
  { id: "doctor_view", label: "Doctor view" },
  { id: "consult", label: "Consultation" },
  { id: "rx", label: "Prescription" },
  { id: "patient_output", label: "Patient" },
  { id: "continuity", label: "Continuity" },
  { id: "done", label: "Done" },
];

const PATIENT = { name: "Patryk S", age: 34, sex: "Male", patientId: "P-2026-0427" };
const DOCTOR = { name: "Dr. Lahari", specialization: "General Physician · Diabetes follow-up", years: 12, rating: 4.9 };

export default function Demo() {
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx].id;
  const next = () => setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
  const back = () => setStepIdx((i) => Math.max(0, i - 1));

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(180deg,#F4F6FF 0%,#EDF1FF 60%,#F8F4FF 100%)" }}>
      {/* Top bar */}
      <header className="px-5 sm:px-10 py-4 flex items-center justify-between border-b border-[#5B7CFA]/10 bg-white/40 backdrop-blur">
        <Link to="/" className="flex items-center gap-2.5" data-testid="demo-home-link">
          <div className="w-9 h-9 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}>
            <Sparkles size={17} className="text-white" />
          </div>
          <div>
            <div className="font-display font-bold text-[15px]" style={{ color: "#0F1836" }}>Project Care</div>
            <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#7C4DFF" }}>Live Demo</div>
          </div>
        </Link>
        <div className="hidden md:flex items-center gap-1.5 text-[11px]">
          {STEPS.slice(0, -1).map((s, i) => (
            <div key={s.id} className={`h-1.5 rounded-full transition-all ${i <= stepIdx ? "bg-gradient-to-r from-[#5B7CFA] to-[#7C4DFF]" : "bg-[#5B7CFA]/15"}`} style={{ width: i === stepIdx ? 32 : 16 }} />
          ))}
        </div>
        <Link to="/" className="text-[12px] font-semibold" style={{ color: "#6B7595" }} data-testid="demo-exit-link">Exit demo →</Link>
      </header>

      {/* Body */}
      <main className="flex-1 px-4 sm:px-8 py-6 sm:py-10 max-w-[980px] w-full mx-auto" data-testid={`demo-step-${step}`}>
        {step === "intro" && <Intro onNext={next} />}
        {step === "doctor" && <DoctorPick onNext={next} />}
        {step === "details" && <BasicDetails onNext={next} />}
        {step === "symptoms" && <Symptoms onNext={next} />}
        {step === "vitals" && <Vitals onNext={next} />}
        {step === "alert" && <AIAlert onNext={next} />}
        {step === "doctor_view" && <DoctorView onNext={next} />}
        {step === "consult" && <Consult onNext={next} />}
        {step === "rx" && <RxBuilder onNext={next} />}
        {step === "patient_output" && <PatientOutput onNext={next} />}
        {step === "continuity" && <Continuity onNext={next} />}
        {step === "done" && <Done />}
      </main>

      {/* Footer nav */}
      {step !== "intro" && step !== "done" && (
        <footer className="px-5 sm:px-10 py-4 border-t border-[#5B7CFA]/10 bg-white/40 backdrop-blur flex items-center justify-between">
          <button onClick={back} className="btn-ghost inline-flex items-center gap-1.5 text-[13px]" data-testid="demo-back-btn">
            <ArrowLeft size={14} /> Back
          </button>
          <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#6B7595" }}>{STEPS[stepIdx].label}</div>
          <div className="w-[80px]" />
        </footer>
      )}
    </div>
  );
}

/* ----- Step 1: Intro ----- */
function Intro({ onNext }) {
  return (
    <div className="glass-card p-8 sm:p-12 text-center flex flex-col items-center gap-5" data-testid="demo-intro-card">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}>
        <Stethoscope size={28} className="text-white" />
      </div>
      <h1 className="font-display font-bold text-3xl sm:text-4xl" style={{ color: "#0F1836" }}>Live Clinical Demo</h1>
      <p className="text-[15px] max-w-[560px] leading-relaxed" style={{ color: "#2A3558" }}>
        We'll walk you through a real-world post-consultation scenario — from patient intake, to AI-driven hypoglycemia detection, doctor handoff, and continuous WhatsApp follow-up.
      </p>
      <div className="glass-soft p-3 max-w-[400px] text-left text-[12.5px]" style={{ color: "#2A3558" }}>
        <div className="text-[10.5px] font-bold uppercase tracking-wider mb-1" style={{ color: "#5B7CFA" }}>Today's case</div>
        <div><span className="font-semibold">{PATIENT.name}</span> · {PATIENT.age}y · {PATIENT.sex}</div>
        <div style={{ color: "#6B7595" }}>Post-diabetes consultation · presenting with dizziness, weakness, sweating</div>
      </div>
      <button onClick={onNext} className="btn-primary inline-flex items-center gap-2 px-5 py-3 text-[14px]" data-testid="demo-start-btn">
        Start Consultation <ArrowRight size={15} />
      </button>
      <div className="text-[11px]" style={{ color: "#6B7595" }}>~2 minute walkthrough · no login required</div>
    </div>
  );
}

/* ----- Step 2: Doctor pick ----- */
function DoctorPick({ onNext }) {
  return (
    <DemoCard title="Choose your doctor" subtitle="One doctor available for this case · General Physician">
      <button onClick={onNext} className="text-left p-4 rounded-2xl border bg-white hover:border-[#5B7CFA] border-[#5B7CFA]/40 transition" data-testid="demo-doctor-card">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] text-white font-bold flex items-center justify-center shrink-0">DL</div>
          <div className="flex-1">
            <div className="font-semibold text-[15px] flex items-center gap-2" style={{ color: "#0F1836" }}>
              {DOCTOR.name} <CheckCircle2 size={14} className="text-[#5B7CFA]" />
            </div>
            <div className="text-[12.5px]" style={{ color: "#6B7595" }}>{DOCTOR.specialization}</div>
            <div className="flex items-center gap-3 mt-1.5 text-[11.5px]" style={{ color: "#2A3558" }}>
              <span className="inline-flex items-center gap-1"><Award size={11} className="text-[#7C4DFF]" /> {DOCTOR.years}+ yrs</span>
              <span className="inline-flex items-center gap-1"><Star size={11} className="text-[#F2994A]" fill="#F2994A" /> {DOCTOR.rating}</span>
              <span className="badge badge-success text-[10px]">Available now</span>
            </div>
            <div className="text-[11.5px] mt-1.5" style={{ color: "#6B7595" }}>Specialises in diabetes management & continuous AI-led follow-up.</div>
          </div>
        </div>
      </button>
      <NextBtn onClick={onNext} label="Continue" />
    </DemoCard>
  );
}

/* ----- Step 3: Basic details ----- */
function BasicDetails({ onNext }) {
  const [name, setName] = useState(PATIENT.name);
  const [age, setAge] = useState(String(PATIENT.age));
  const [sex, setSex] = useState(PATIENT.sex);
  return (
    <DemoCard title="Confirm your basics" subtitle="Care AI starts every intake by verifying who's at the other end. Pre-filled — review and continue.">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Full name"><input value={name} onChange={(e) => setName(e.target.value)} className="demo-input" data-testid="demo-name" /></Field>
        <Field label="Age">
          <div className="flex flex-wrap gap-1.5">
            {["Under 18", "18–30", "31–45", "46–60", "61–75"].map((b) => (
              <button key={b} onClick={() => setAge(b)} className={`pill ${age === b || (b === "31–45" && age === "34") ? "pill-on" : ""}`} data-testid={`demo-age-${b}`}>{b}</button>
            ))}
          </div>
        </Field>
        <Field label="Biological sex">
          <div className="flex flex-wrap gap-1.5">
            {["Female", "Male", "Intersex", "Prefer not to say"].map((s) => (
              <button key={s} onClick={() => setSex(s)} className={`pill ${sex === s ? "pill-on" : ""}`} data-testid={`demo-sex-${s}`}>{s}</button>
            ))}
          </div>
        </Field>
        <Field label="Preferred language">
          <div className="flex flex-wrap gap-1.5">
            {["English", "हिंदी", "తెలుగు", "தமிழ்"].map((l, i) => (
              <button key={l} className={`pill ${i === 0 ? "pill-on" : ""}`}>{l}</button>
            ))}
          </div>
        </Field>
      </div>
      <NextBtn onClick={onNext} label="Continue to symptoms" />
    </DemoCard>
  );
}

/* ----- Step 4: Symptoms ----- */
function Symptoms({ onNext }) {
  const [picked, setPicked] = useState([]);
  const [transcript, setTranscript] = useState("");
  const [recState, setRecState] = useState("idle"); // idle | recording | done
  const ALL = ["Dizziness", "Weakness", "Sweating", "Headache", "Nausea", "Blurred vision", "Tremor", "Confusion", "Palpitations"];
  const toggle = (s) => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));

  const startSimRecord = () => {
    if (recState === "recording") return;
    setRecState("recording");
    setTranscript("");
    setTimeout(() => {
      setTranscript("I'm feeling dizzy, weak, and sweating");
      setPicked(["Dizziness", "Weakness", "Sweating"]);
      setRecState("done");
    }, 2000);
  };

  return (
    <DemoCard title="What are you feeling right now?" subtitle="Select all that apply — or just speak. Care AI handles voice-first intake.">
      {/* Simulated voice input */}
      <div className="rounded-2xl p-3 sm:p-4 flex flex-col gap-2.5 border border-[#5B7CFA]/15" style={{ background: "linear-gradient(135deg,rgba(91,124,250,0.06),rgba(124,77,255,0.06))" }} data-testid="demo-voice-block">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={startSimRecord}
            disabled={recState === "recording"}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-full font-semibold text-[13px] transition ${recState === "recording" ? "text-white" : "text-white"}`}
            style={{
              background: recState === "recording"
                ? "linear-gradient(135deg,#E85A5A,#7C4DFF)"
                : "linear-gradient(135deg,#5B7CFA,#7C4DFF)",
              boxShadow: "0 8px 18px rgba(91,124,250,0.30)",
            }}
            data-testid="demo-voice-record-btn"
          >
            {recState === "recording" ? (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
                </span>
                Recording…
              </>
            ) : (
              <>
                <Mic size={14} /> {recState === "done" ? "Re-record" : "Record symptoms"}
              </>
            )}
          </button>
          <span className="text-[11.5px] inline-flex items-center gap-1.5" style={{ color: "#6B7595" }} data-testid="demo-voice-note">
            <Sparkles size={11} className="text-[#7C4DFF]" /> Voice-first (simulated for demo)
          </span>
        </div>
        {(recState === "recording" || recState === "done") && (
          <div className="rounded-xl bg-white/80 px-3 py-2 text-[13px] flex items-start gap-2 animate-fade-up" style={{ color: "#0F1836" }} data-testid="demo-voice-transcript">
            <Mic size={13} className="text-[#5B7CFA] mt-0.5 shrink-0" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: "#5B7CFA" }}>Transcript</div>
              {recState === "recording" ? (
                <span className="inline-flex items-center gap-1.5" style={{ color: "#6B7595" }}>
                  <Loader2 size={12} className="animate-spin" /> listening…
                </span>
              ) : (
                <span>"{transcript}"</span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {ALL.map((s) => (
          <button key={s} onClick={() => toggle(s)} className={`pill ${picked.includes(s) ? "pill-on" : ""}`} data-testid={`demo-sym-${s}`}>{s}</button>
        ))}
      </div>
      <Field label="Onset">
        <div className="flex flex-wrap gap-2">
          {["A few minutes ago", "Within last hour", "Today", "Yesterday"].map((d, i) => (
            <button key={d} className={`pill ${i === 1 ? "pill-on" : ""}`}>{d}</button>
          ))}
        </div>
      </Field>
      <Field label="Severity (0–10)">
        <div className="flex items-center gap-2">
          <input type="range" min="0" max="10" defaultValue="7" className="flex-1 accent-[#5B7CFA]" />
          <div className="font-bold text-lg" style={{ color: "#5B7CFA" }}>7</div>
        </div>
      </Field>
      <NextBtn onClick={onNext} label="Continue" disabled={picked.length === 0} />
    </DemoCard>
  );
}

/* ----- Step 5: Vitals (the trigger) ----- */
function Vitals({ onNext }) {
  const [bg, setBg] = useState("68");
  const [hr, setHr] = useState("104");
  const [bp, setBp] = useState("110/72");
  return (
    <DemoCard title="Quick vitals check" subtitle="A few minutes ago we asked about insulin. Now share your latest blood sugar.">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Blood sugar (mg/dL)">
          <input value={bg} onChange={(e) => setBg(e.target.value)} className="demo-input text-2xl font-bold text-center" data-testid="demo-bg" style={{ color: parseFloat(bg) < 70 ? "#E85A5A" : "#0F1836" }} />
        </Field>
        <Field label="Heart rate (bpm)"><input value={hr} onChange={(e) => setHr(e.target.value)} className="demo-input text-center" /></Field>
        <Field label="Blood pressure"><input value={bp} onChange={(e) => setBp(e.target.value)} className="demo-input text-center" /></Field>
      </div>
      <div className="glass-soft p-3 text-[12.5px]" style={{ color: "#2A3558" }}>
        <span className="font-semibold">Heads up:</span> blood sugar below 70 mg/dL is considered low. Care AI will flag this automatically on submit.
      </div>
      <NextBtn onClick={onNext} label="Submit to Care AI" />
    </DemoCard>
  );
}

/* ----- Step 6: AI Alert (THE moment) ----- */
function AIAlert({ onNext }) {
  const [stage, setStage] = useState(0); // 0 analyzing, 1 alert
  useEffect(() => {
    const t = setTimeout(() => setStage(1), 1300);
    return () => clearTimeout(t);
  }, []);

  return (
    <DemoCard title="Care AI is reviewing your input…" subtitle="Real-time triage on every patient turn. No human in the loop yet — Care AI catches the red flag first.">
      {stage === 0 && (
        <div className="glass-soft p-6 flex items-center gap-3" data-testid="demo-analyzing">
          <Loader2 size={18} className="animate-spin text-[#5B7CFA]" />
          <div className="text-[14px]" style={{ color: "#2A3558" }}>Analyzing symptoms · checking against your last visit · cross-referencing your meds…</div>
        </div>
      )}
      {stage === 1 && (
        <div className="rounded-2xl p-5 sm:p-6 flex flex-col gap-3 animate-fade-up" style={{ background: "linear-gradient(135deg,#FFE9E9,#FFD6D6)", border: "2px solid #E85A5A" }} data-testid="demo-alert-card">
          <div className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider text-white" style={{ background: "#E85A5A" }}>
            <ShieldAlert size={11} /> Emergency · Possible hypoglycemia
          </div>
          <div className="font-display font-bold text-2xl" style={{ color: "#7B1F1F" }}>⚠️ Possible hypoglycemia detected</div>
          <div className="text-[14px] leading-relaxed" style={{ color: "#7B1F1F" }}>
            Low blood glucose (<span className="font-bold">68 mg/dL</span>) with symptoms of dizziness, weakness, and sweating strongly suggests a hypoglycemic episode — likely after the morning insulin dose without adequate food intake.
          </div>
          <div className="bg-white/70 rounded-xl p-3 text-[12.5px] flex flex-col gap-1" style={{ color: "#5B1F1F" }}>
            <div className="font-semibold">Care AI reasoning</div>
            <div>• BG 68 mg/dL is below the safe threshold of 70 mg/dL.</div>
            <div>• Sweating + tremor + weakness = classic neuroglycopenic profile.</div>
            <div>• Patient on insulin (per last consultation) — high pre-test probability.</div>
            <div>• Triage = <span className="font-bold">EMERGENCY</span>; Dr. Lahari has been notified.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11.5px]" style={{ color: "#7B1F1F" }}>
            <span className="inline-flex items-center gap-1"><Phone size={11} /> Dr. Lahari paged</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1"><MessageCircle size={11} /> WhatsApp alert sent</span>
          </div>
        </div>
      )}
      <NextBtn onClick={onNext} label="See doctor's view" disabled={stage === 0} />
    </DemoCard>
  );
}

/* ----- Step 7: Doctor view ----- */
function DoctorView({ onNext }) {
  return (
    <DemoCard title="Dr. Lahari · 3 seconds later" subtitle="The structured patient summary — exactly what the doctor sees the moment Care AI escalates.">
      <div className="rounded-2xl bg-white border-2 border-[#E85A5A]/30 p-4 flex flex-col gap-3" data-testid="demo-doctor-summary">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: "#E85A5A" }}>New emergency alert · 0:00 ago</div>
            <div className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>{PATIENT.name} · {PATIENT.age}y {PATIENT.sex}</div>
            <div className="text-[12px]" style={{ color: "#6B7595" }}>{PATIENT.patientId} · last visit: 26 Apr (post-diabetes f/u)</div>
          </div>
          <span className="badge badge-danger">EMERGENCY</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Tile label="Chief complaint" value="Dizziness, weakness, sweating × 1 hr" />
          <Tile label="Vitals" value="BG 68 mg/dL · HR 104 · BP 110/72" highlight />
          <Tile label="Allergies" value="NKDA" />
          <Tile label="Current Rx" value="Insulin glargine 18u qHS, Metformin 1g BID" />
        </div>

        <div className="rounded-xl bg-[#FFE9E9] border border-[#E85A5A]/30 p-3 text-[12.5px] flex gap-2" style={{ color: "#7B1F1F" }}>
          <ShieldAlert size={14} className="shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Care AI assessment:</span> Acute hypoglycemia, symptomatic. Recommend immediate oral glucose, recheck in 15 min, hold next insulin dose pending review.
          </div>
        </div>
      </div>

      <NextBtn onClick={onNext} label="Open consultation" />
    </DemoCard>
  );
}

/* ----- Step 8: Live consult conversation ----- */
function Consult({ onNext }) {
  return (
    <DemoCard title="Live consultation" subtitle={`${DOCTOR.name} · ${PATIENT.name} · started just now`}>
      <div className="flex flex-col gap-2.5">
        <Bubble who="doc" name="Dr. Lahari">Hi Patryk — I see your sugar is 68 with dizziness and sweating. Did you take insulin this morning?</Bubble>
        <Bubble who="pt" name="Patryk">Yes, I took my usual dose but I skipped a proper breakfast — only had black coffee.</Bubble>
        <Bubble who="doc" name="Dr. Lahari">That's the cause. Drink the juice or take 4 glucose tabs right now. Then we'll recheck in 15 minutes and hold tonight's insulin until I review your numbers.</Bubble>
        <Bubble who="pt" name="Patryk">Doing it now. Thank you doctor 🙏</Bubble>
        <Bubble who="ai">Care AI here — I'll auto-remind Patryk to recheck BG at <span className="font-semibold">14:23</span> and notify you with the result.</Bubble>
      </div>
      <NextBtn onClick={onNext} label="Doctor writes prescription" />
    </DemoCard>
  );
}

/* ----- Step 9: Rx builder (doctor-only until submitted) ----- */
function RxBuilder({ onNext }) {
  const [submitted, setSubmitted] = useState(false);
  const items = [
    { medication: "Oral glucose (15g)", dose: "1 sachet / 4 tabs", frequency: "STAT", duration: "Once now", instructions: "Take immediately. Recheck BG in 15 min. Repeat if BG still <70." },
    { medication: "Insulin glargine", dose: "Hold tonight's dose", frequency: "—", duration: "Tonight only", instructions: "Restart at reduced dose tomorrow morning per Dr. Lahari." },
    { medication: "Reminder protocol", dose: "—", frequency: "Every 4 hr × 24 hr", duration: "Next 24 hours", instructions: "Care AI will check on Patryk every 4 hours via WhatsApp." },
  ];
  return (
    <DemoCard title="Prescription · doctor draft" subtitle="Care AI suggests a draft. Doctor reviews, edits, and signs off. Only then does the patient see it.">
      <div className="flex flex-col gap-2">
        {items.map((it, i) => (
          <div key={i} className="rounded-2xl bg-white border border-[#5B7CFA]/15 p-3 flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Pill size={14} className="text-[#28A55B]" />
              <div className="font-semibold text-[14px]" style={{ color: "#0F1836" }}>{it.medication}</div>
              <div className="text-[12px]" style={{ color: "#6B7595" }}>{it.dose}</div>
            </div>
            <div className="text-[12px]" style={{ color: "#2A3558" }}>{it.frequency} · {it.duration}</div>
            <div className="text-[11.5px]" style={{ color: "#6B7595" }}>{it.instructions}</div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl p-3 flex items-center gap-2 text-[12.5px]" style={{ background: submitted ? "#E8F8EE" : "#FFF6E5", color: submitted ? "#1F6E3D" : "#7A4A00" }} data-testid={`demo-rx-status-${submitted ? "signed" : "draft"}`}>
        {submitted ? <CheckCircle2 size={14} /> : <Clock size={14} />}
        {submitted ? "Signed by Dr. Lahari · sent to patient via app + WhatsApp" : "Draft · not visible to patient yet"}
      </div>
      {!submitted ? (
        <button onClick={() => setSubmitted(true)} className="btn-primary inline-flex items-center gap-2 self-end" data-testid="demo-rx-sign-btn">
          <Send size={14} /> Sign & send to patient
        </button>
      ) : (
        <NextBtn onClick={onNext} label="See patient's view" />
      )}
    </DemoCard>
  );
}

/* ----- Step 10: Patient output ----- */
function PatientOutput({ onNext }) {
  return (
    <DemoCard title="Patient view · 30 seconds after submit" subtitle="Patryk's phone — both inside the app and on WhatsApp.">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* In-app */}
        <div className="rounded-2xl bg-white border border-[#5B7CFA]/15 p-4 flex flex-col gap-3" data-testid="demo-patient-app">
          <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#5B7CFA" }}>In the app</div>
          <div className="font-display font-bold text-[16px]" style={{ color: "#0F1836" }}>📋 Your prescription</div>
          <div className="flex flex-col gap-1.5 text-[12.5px]" style={{ color: "#2A3558" }}>
            <div>• <b>Oral glucose 15g</b> — STAT, recheck in 15 min</div>
            <div>• <b>Hold tonight's insulin</b> — Dr. Lahari will reset tomorrow</div>
            <div>• <b>Care AI check-ins</b> — every 4 hours for 24 h</div>
          </div>
          <div className="rounded-xl p-3 text-[12.5px] flex gap-2" style={{ background: "#5B7CFA10", color: "#1F2A56" }}>
            <Sparkles size={14} className="shrink-0 mt-0.5 text-[#7C4DFF]" />
            <div>
              <div className="font-semibold mb-0.5">Care AI explains:</div>
              Your sugar is low. Please take glucose immediately and recheck in 15 minutes — I'll remind you. We're holding tonight's insulin so it doesn't drop again. Stay nearby someone for the next hour.
            </div>
          </div>
        </div>

        {/* WhatsApp */}
        <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: "#0B141A" }} data-testid="demo-patient-whatsapp">
          <div className="flex items-center gap-2 pb-2 border-b border-white/10">
            <div className="w-8 h-8 rounded-full bg-[#25D366] flex items-center justify-center font-bold text-white text-[12px]">PC</div>
            <div className="flex-1">
              <div className="font-semibold text-[13px] text-white">Project Care · Care AI</div>
              <div className="text-[10px] text-white/60">online</div>
            </div>
            <Phone size={13} className="text-white/60" />
          </div>
          <div className="flex flex-col gap-2 text-[12.5px]">
            <div className="self-start max-w-[88%] rounded-xl rounded-tl-sm bg-white px-3 py-2" style={{ color: "#0B141A" }}>
              📋 Your prescription from Dr. Lahari is ready. Tap to view.
            </div>
            <div className="self-start max-w-[88%] rounded-xl rounded-tl-sm bg-white px-3 py-2" style={{ color: "#0B141A" }}>
              💊 1. <b>Oral glucose 15g</b> — STAT<br />
              💊 2. Hold tonight's insulin<br />
              💊 3. Recheck BG in 15 min
            </div>
            <div className="self-start max-w-[88%] rounded-xl rounded-tl-sm bg-[#DCF8C6] px-3 py-2" style={{ color: "#0B141A" }}>
              <span className="font-semibold">Your sugar is low.</span> Please take glucose immediately and recheck in 15 minutes. I'll ping you then. 💪
            </div>
            <div className="text-[10px] text-white/40 text-center pt-1">Reply by text or 🎙️ voice — Care AI is on 24/7.</div>
          </div>
        </div>
      </div>
      <NextBtn onClick={onNext} label="What happens next?" />
    </DemoCard>
  );
}

/* ----- Step 11: Continuity ----- */
function Continuity({ onNext }) {
  return (
    <DemoCard title="The consultation didn't end. It just transformed." subtitle="Project Care turns every visit into a continuous, AI-monitored care loop.">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { icon: Clock, t: "+15 min", d: "Care AI auto-reminds Patryk to recheck BG. Doctor gets the result." },
          { icon: MessageCircle, t: "+4 hr", d: "Care AI checks in via WhatsApp. Voice notes auto-transcribed and triaged." },
          { icon: Activity, t: "+24 hr", d: "If BG stays normal, the alert is auto-resolved. If anything trends down, Dr. Lahari is paged again." },
        ].map((s) => (
          <div key={s.t} className="glass-soft p-3 flex flex-col gap-1.5">
            <div className="w-9 h-9 rounded-2xl bg-[#5B7CFA]/15 flex items-center justify-center"><s.icon size={16} className="text-[#5B7CFA]" /></div>
            <div className="font-display font-semibold text-[14px]" style={{ color: "#0F1836" }}>{s.t}</div>
            <div className="text-[12px] leading-relaxed" style={{ color: "#6B7595" }}>{s.d}</div>
          </div>
        ))}
      </div>
      <div className="glass-soft p-4 flex items-center gap-3 text-[13px]" style={{ color: "#2A3558" }} data-testid="demo-continuity-pill">
        <div className="w-9 h-9 rounded-full bg-[#3CC97C]/15 flex items-center justify-center"><Heart size={16} className="text-[#28A55B]" fill="#3CC97C" /></div>
        <div className="flex-1">
          <div className="font-semibold">Follow-up monitoring enabled</div>
          <div className="text-[11.5px]" style={{ color: "#6B7595" }}>For the next 24 hours, Care AI will keep Patryk safe and Dr. Lahari informed — automatically.</div>
        </div>
        <span className="badge badge-success">Active</span>
      </div>
      <NextBtn onClick={onNext} label="Finish demo" />
    </DemoCard>
  );
}

/* ----- Step 12: Done ----- */
function Done() {
  return (
    <div className="glass-card p-8 sm:p-10 text-center flex flex-col items-center gap-5" data-testid="demo-done-card">
      <div className="w-14 h-14 rounded-2xl bg-[#3CC97C]/18 flex items-center justify-center"><CheckCircle2 size={26} className="text-[#28A55B]" /></div>
      <h2 className="font-display font-bold text-3xl" style={{ color: "#0F1836" }}>That's Project Care.</h2>
      <p className="text-[14px] max-w-[520px]" style={{ color: "#2A3558" }}>
        From a structured AI intake, through a real-time clinical alert, into a same-thread doctor handoff, to a WhatsApp follow-up — all in under 3 minutes, all built around how doctors actually think.
      </p>
      <div className="flex flex-wrap gap-2 justify-center pt-1">
        <Link to="/demo" reloadDocument className="btn-ghost inline-flex items-center gap-2 text-[13px]" data-testid="demo-restart-btn"><ArrowRight size={14} className="rotate-180" /> Run again</Link>
        <Link to="/" className="btn-primary inline-flex items-center gap-2 text-[13px]" data-testid="demo-home-btn"><Sparkles size={14} /> Back to home</Link>
      </div>
      <div className="text-[11px] mt-4" style={{ color: "#6B7595" }}>Built by a practicing MBBS doctor · Demo data only — no patient information collected.</div>
    </div>
  );
}

/* ===== Reusable bits ===== */
function DemoCard({ title, subtitle, children }) {
  return (
    <div className="glass-card flex flex-col gap-4 animate-fade-up">
      <div>
        <div className="font-display font-bold text-2xl" style={{ color: "#0F1836" }}>{title}</div>
        {subtitle && <div className="text-[13px] mt-1" style={{ color: "#6B7595" }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10.5px] font-bold uppercase tracking-widest" style={{ color: "#6B7595" }}>{label}</span>
      {children}
    </label>
  );
}
function NextBtn({ onClick, label, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} className="btn-primary self-end inline-flex items-center gap-2 text-[13px]" data-testid="demo-next-btn">
      {label} <ArrowRight size={14} />
    </button>
  );
}
function Tile({ label, value, highlight }) {
  return (
    <div className={`rounded-xl p-3 ${highlight ? "bg-[#FFE9E9] border border-[#E85A5A]/30" : "bg-[#5B7CFA]/05 border border-[#5B7CFA]/15"}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: highlight ? "#7B1F1F" : "#5B7CFA" }}>{label}</div>
      <div className="text-[13.5px]" style={{ color: highlight ? "#7B1F1F" : "#0F1836" }}>{value}</div>
    </div>
  );
}
function Bubble({ who, name, children }) {
  if (who === "ai") {
    return (
      <div className="self-stretch glass-soft p-3 text-[12.5px] flex gap-2" style={{ color: "#2A3558" }}>
        <Sparkles size={14} className="shrink-0 mt-0.5 text-[#7C4DFF]" />
        <div><span className="font-semibold">Care AI · </span>{children}</div>
      </div>
    );
  }
  const isDoc = who === "doc";
  return (
    <div className={`flex ${isDoc ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13.5px] ${isDoc ? "bg-white border border-white" : "text-white"}`} style={{ background: isDoc ? undefined : "linear-gradient(135deg,#5B7CFA,#7C4DFF)", color: isDoc ? "#0F1836" : "#fff" }}>
        <div className={`text-[10px] mb-0.5 font-semibold uppercase tracking-wider ${isDoc ? "" : "text-white/70"}`} style={{ color: isDoc ? "#5B7CFA" : undefined }}>{name}</div>
        {children}
      </div>
    </div>
  );
}

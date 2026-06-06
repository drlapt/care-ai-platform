import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Mic, MicOff, Sparkles, Check, ChevronRight, ArrowLeft, Keyboard,
  User, Heart, Stethoscope, Upload, Loader2, AlertTriangle, Edit3,
} from "lucide-react";
import { createProfile, extractProfileFromText } from "@/lib/api";
import { startSpeechRecognition, isSpeechSupported, speechSupportNote } from "@/lib/speech";

// ─── Constants ───────────────────────────────────────────────────────────────

const RELATIONSHIP_OPTIONS = [
  { value: "self",    label: "Myself",   emoji: "👤", desc: "Your own health profile" },
  { value: "mother",  label: "Mother",   emoji: "👩", desc: "For your mother" },
  { value: "father",  label: "Father",   emoji: "👨", desc: "For your father" },
  { value: "child",   label: "Child",    emoji: "👧", desc: "For your child" },
  { value: "spouse",  label: "Spouse",   emoji: "💑", desc: "For your spouse or partner" },
  { value: "other",   label: "Other",    emoji: "👥", desc: "Sibling, friend, or other" },
];

const RELATIONSHIP_LABEL = {
  self: "myself", mother: "my mother", father: "my father",
  child: "my child", spouse: "my spouse", other: "this person",
};

const SILENCE_TIMEOUT_MS = 2500;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcBmi(h, w) {
  const hm = parseFloat(h), wkg = parseFloat(w);
  if (!hm || !wkg || hm <= 0) return null;
  return +(wkg / ((hm / 100) ** 2)).toFixed(1);
}

function bmiLabel(bmi) {
  if (!bmi) return null;
  const b = parseFloat(bmi);
  if (b < 18.5) return { text: "Underweight", color: "#5B7CFA" };
  if (b < 25)   return { text: "Healthy weight", color: "#3CC97C" };
  if (b < 30)   return { text: "Overweight", color: "#F2994A" };
  return { text: "Obese range", color: "#E85A5A" };
}

// ─── Progress indicator ───────────────────────────────────────────────────────

const SCREEN_LABELS = ["Who", "Speak", "Confirm", "Done"];

function ProgressBar({ screen }) {
  return (
    <div className="flex items-center gap-1 mb-6" data-testid="profile-create-progress">
      {SCREEN_LABELS.map((label, i) => {
        const done = i < screen;
        const active = i === screen;
        return (
          <div key={i} className="flex items-center gap-1 flex-1">
            <div className={`flex flex-col items-center gap-0.5 ${i > 0 ? "flex-1" : ""}`}>
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition
                  ${done ? "bg-[#3CC97C] text-white" : active ? "bg-[#5B7CFA] text-white" : "bg-[#5B7CFA]/15 text-[#6B7595]"}`}
              >
                {done ? <Check size={12} /> : i + 1}
              </div>
              <div className={`text-[9px] font-semibold uppercase tracking-wider ${active ? "" : "opacity-50"}`} style={{ color: active ? "#5B7CFA" : "#6B7595" }}>
                {label}
              </div>
            </div>
            {i < SCREEN_LABELS.length - 1 && (
              <div className={`flex-1 h-0.5 rounded-full mb-4 ${done ? "bg-[#3CC97C]" : "bg-[#5B7CFA]/15"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Screen 1 — Relationship picker ──────────────────────────────────────────

function Screen1Relationship({ onSelect }) {
  return (
    <div className="flex flex-col gap-5 animate-fade-up" data-testid="screen-relationship">
      <div>
        <h1 className="font-display font-bold text-[28px] leading-tight mb-1" style={{ color: "#0F1836" }}>
          Let's get to know this person
        </h1>
        <p className="text-[15px]" style={{ color: "#6B7595" }}>Who is this profile for?</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {RELATIONSHIP_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            className="flex flex-col items-center gap-2 p-5 rounded-3xl border-2 border-[#5B7CFA]/15 bg-white hover:border-[#5B7CFA] hover:bg-[#5B7CFA]/5 transition active:scale-95"
            data-testid={`rel-option-${opt.value}`}
          >
            <span className="text-[32px]">{opt.emoji}</span>
            <span className="font-display font-bold text-[15px]" style={{ color: "#0F1836" }}>{opt.label}</span>
            <span className="text-[11px] text-center" style={{ color: "#6B7595" }}>{opt.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Screen 2 — CARE AI Voice / Text input ───────────────────────────────────

function Screen2CareAI({ relationship, onExtracted, onSkip }) {
  const [mode, setMode] = useState("voice"); // "voice" | "type"
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [typedText, setTypedText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const recRef = useRef(null);
  const silenceTimer = useRef(null);
  const srSupported = isSpeechSupported();
  const srNote = speechSupportNote("en-US");

  const relLabel = RELATIONSHIP_LABEL[relationship] || "this person";
  const exampleText = `"This is my ${relationship === "self" ? "own profile" : relationship}. He is 67 years old. He has diabetes and thyroid. His height is 170 cm and weight is 78 kg."`;

  const clearSilence = () => { if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null; } };

  const stopListening = useCallback(() => {
    clearSilence();
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }, []);

  const doExtract = useCallback(async (text) => {
    if (!text.trim()) return;
    setExtracting(true);
    try {
      const result = await extractProfileFromText(text.trim(), relationship);
      onExtracted(result, text.trim());
    } catch {
      toast.error("CARE AI couldn't understand. Let's enter the details manually.");
      onExtracted({ extracted: {}, confidence: {}, missing_required: ["name", "age"], missing_optional: [], fallback: true }, text.trim());
    } finally {
      setExtracting(false);
    }
  }, [relationship, onExtracted]);

  const startListening = () => {
    if (!srSupported) { setMode("type"); return; }
    setTranscript("");
    setListening(true);
    const handle = startSpeechRecognition({
      locale: "en-US",
      baseValue: "",
      onUpdate: (val) => {
        setTranscript(val);
        clearSilence();
        silenceTimer.current = setTimeout(() => {
          stopListening();
          doExtract(val);
        }, SILENCE_TIMEOUT_MS);
      },
      onError: (err) => {
        setListening(false);
        if (err !== "no-speech") toast.error(`Voice error: ${err}. Try typing instead.`);
      },
      onEnd: () => setListening(false),
    });
    recRef.current = handle;
  };

  const handleStopAndExtract = () => {
    const text = transcript || typedText;
    stopListening();
    if (text.trim()) doExtract(text);
  };

  useEffect(() => () => { clearSilence(); recRef.current?.stop(); }, []);

  if (extracting) {
    return (
      <div className="flex flex-col items-center gap-6 py-12 animate-fade-up" data-testid="screen-extracting">
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}>
          <Sparkles size={32} className="text-white" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="font-display font-bold text-[22px]" style={{ color: "#0F1836" }}>CARE AI is understanding…</div>
          <Loader2 size={20} className="animate-spin" style={{ color: "#5B7CFA" }} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 animate-fade-up" data-testid="screen-voice">
      {/* CARE AI hero icon */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <div className="w-16 h-16 rounded-3xl flex items-center justify-center shadow-lg" style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}>
          <Sparkles size={28} className="text-white" />
        </div>
        <div className="text-center">
          <h2 className="font-display font-bold text-[24px]" style={{ color: "#0F1836" }}>Hi, I'm CARE AI</h2>
          <p className="text-[14px] mt-1 max-w-[360px]" style={{ color: "#6B7595" }}>
            Tell me about {relLabel}. Speak naturally — I'll understand.
          </p>
        </div>
      </div>

      {mode === "voice" ? (
        <>
          {/* Microphone — HERO */}
          <div className="flex flex-col items-center gap-4 py-4">
            <button
              type="button"
              onClick={listening ? handleStopAndExtract : startListening}
              disabled={extracting}
              className={`w-28 h-28 rounded-full flex items-center justify-center shadow-xl transition active:scale-95
                ${listening
                  ? "bg-[#E85A5A] text-white animate-pulse"
                  : "text-white hover:scale-105"
                }`}
              style={!listening ? { background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" } : {}}
              data-testid="mic-button"
            >
              {listening ? <MicOff size={40} /> : <Mic size={40} />}
            </button>

            <div className="text-[14px] font-semibold" style={{ color: listening ? "#E85A5A" : "#5B7CFA" }}>
              {listening ? "Listening… tap to stop" : "Tap to start speaking"}
            </div>

            {!srSupported && srNote && (
              <div className="text-[12px] text-center px-4" style={{ color: "#6B7595" }}>{srNote}</div>
            )}
          </div>

          {/* Live transcript */}
          {transcript && (
            <div className="glass-soft px-4 py-3 rounded-2xl text-[14px] leading-relaxed" style={{ color: "#2A3558" }} data-testid="live-transcript">
              {transcript}
            </div>
          )}

          {/* Manual submit if they stopped without trigger */}
          {transcript && !listening && (
            <button
              type="button"
              onClick={() => doExtract(transcript)}
              className="btn-primary inline-flex items-center justify-center gap-2"
              data-testid="submit-transcript"
            >
              <ChevronRight size={16} /> Continue with this
            </button>
          )}

          {/* Example */}
          {!transcript && (
            <div className="glass-soft rounded-2xl px-4 py-3 text-[13px] leading-relaxed" style={{ color: "#6B7595" }}>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#9AA3BD" }}>Example</div>
              {exampleText}
            </div>
          )}

          {/* Type instead */}
          <button
            type="button"
            onClick={() => setMode("type")}
            className="text-[13px] font-semibold underline text-center"
            style={{ color: "#6B7595" }}
            data-testid="switch-to-type"
          >
            <Keyboard size={13} className="inline mr-1" /> Type instead
          </button>
        </>
      ) : (
        <>
          {/* Textarea fallback */}
          <textarea
            className="bg-white border border-[#5B7CFA]/20 rounded-2xl px-4 py-3 text-[14px] leading-relaxed outline-none resize-none min-h-[120px]"
            placeholder={`Tell me about ${relLabel}. E.g. "This is my father Ramesh, 67 years old, has diabetes and thyroid, 170cm, 78kg."`}
            value={typedText}
            onChange={(e) => setTypedText(e.target.value)}
            data-testid="type-textarea"
            autoFocus
          />
          <button
            type="button"
            onClick={() => doExtract(typedText)}
            disabled={!typedText.trim() || extracting}
            className="btn-primary inline-flex items-center justify-center gap-2"
            data-testid="submit-typed"
          >
            {extracting ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
            {extracting ? "Understanding…" : "Continue"}
          </button>
          {srSupported && (
            <button
              type="button"
              onClick={() => { setMode("voice"); setTypedText(""); }}
              className="text-[13px] font-semibold underline text-center"
              style={{ color: "#6B7595" }}
              data-testid="switch-to-voice"
            >
              <Mic size={13} className="inline mr-1" /> Use voice instead
            </button>
          )}
        </>
      )}

      {/* Skip entirely */}
      <button
        type="button"
        onClick={onSkip}
        className="text-[12px] text-center"
        style={{ color: "#9AA3BD" }}
        data-testid="skip-ai"
      >
        Skip — I'll enter details manually
      </button>
    </div>
  );
}

// ─── Screen 3 — Confirm ───────────────────────────────────────────────────────

function ConfirmedRow({ label, value, accent }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: "#3CC97C22" }}>
        <Check size={10} style={{ color: "#3CC97C" }} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[11.5px] font-bold uppercase tracking-wider" style={{ color: "#9AA3BD" }}>{label} </span>
        <span className="text-[14px] font-semibold" style={{ color: accent || "#0F1836" }}>{String(value)}</span>
      </div>
    </div>
  );
}

function InlineField({ label, type = "text", value, onChange, placeholder, options, required }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold" style={{ color: "#2A3558" }}>
        {label}{required && <span style={{ color: "#E85A5A" }}> *</span>}
      </span>
      {options ? (
        <select
          className="input"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          required={required}
        >
          <option value="">Select…</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input
          className="input"
          type={type}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
        />
      )}
    </label>
  );
}

function Screen3Confirm({ relationship, extraction, rawTranscript, onCreated, onRetry }) {
  const ext = extraction?.extracted || {};
  const fallback = extraction?.fallback === true;

  const [fields, setFields] = useState({
    name: ext.name || "",
    age: ext.age_estimate ? String(ext.age_estimate) : "",
    dob: ext.dob || "",
    gender: ext.gender || "",
    height_cm: ext.height_cm ? String(ext.height_cm) : "",
    weight_kg: ext.weight_kg ? String(ext.weight_kg) : "",
    blood_group: ext.blood_group || "",
  });
  const [saving, setSaving] = useState(false);

  const set = (k) => (v) => setFields((s) => ({ ...s, [k]: v }));

  const bmi = calcBmi(fields.height_cm, fields.weight_kg);
  const bmiInfo = bmiLabel(bmi);

  const hasName = fields.name.trim().length > 0;
  const hasAge = fields.dob.trim().length > 0 || fields.age.trim().length > 0;
  const canCreate = hasName && hasAge;

  const missingRequired = extraction?.missing_required || [];
  const showNameInput = !ext.name || missingRequired.includes("name");
  const showAgeInput = (!ext.age_estimate && !ext.dob) || missingRequired.includes("age");

  const handleCreate = async () => {
    if (!hasName) { toast.error("Name is required"); return; }
    if (!hasAge)  { toast.error("Age or date of birth is required"); return; }
    setSaving(true);
    try {
      const payload = {
        name: fields.name.trim(),
        relationship,
        dob: fields.dob || null,
        age: fields.age ? parseInt(fields.age, 10) : null,
        age_estimate_source: fields.dob ? "derived_from_dob" : "patient_reported",
        gender: fields.gender || null,
        height_cm: fields.height_cm ? parseFloat(fields.height_cm) : null,
        weight_kg: fields.weight_kg ? parseFloat(fields.weight_kg) : null,
        blood_group: fields.blood_group || null,
        conditions: ext.conditions || [],
        medications: ext.medications || [],
        allergies: ext.allergies || [],
      };
      const created = await createProfile(payload);
      onCreated(created, bmi);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not create profile");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAnyway = async () => {
    if (!hasName || !hasAge) { toast.error("Name and age are still required"); return; }
    await handleCreate();
  };

  return (
    <div className="flex flex-col gap-5 animate-fade-up" data-testid="screen-confirm">
      <div>
        <h2 className="font-display font-bold text-[24px]" style={{ color: "#0F1836" }}>
          {fallback ? "Let's enter a few details manually" : "Here's what I understood"}
        </h2>
        {!fallback && (
          <p className="text-[13px] mt-1" style={{ color: "#6B7595" }}>
            Review and confirm before creating the profile.
          </p>
        )}
        {fallback && (
          <div className="flex items-start gap-2 mt-2 px-3 py-2 rounded-xl text-[12px]" style={{ background: "rgba(242,153,74,0.10)", color: "#7A4200" }}>
            <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: "#F2994A" }} />
            <span>CARE AI couldn't fully understand your input. Please enter the details below.</span>
          </div>
        )}
      </div>

      {/* UNDERSTOOD section */}
      {!fallback && (ext.name || ext.age_estimate || ext.gender || ext.height_cm || ext.weight_kg || ext.blood_group || ext.conditions?.length || ext.medications?.length || ext.allergies?.length) && (
        <div className="glass-soft rounded-2xl px-4 py-3 flex flex-col" data-testid="understood-section">
          <div className="text-[10.5px] font-bold uppercase tracking-wider mb-2" style={{ color: "#3CC97C" }}>CARE AI understood</div>
          <ConfirmedRow label="Name" value={ext.name} />
          <ConfirmedRow label="Age" value={ext.age_estimate ? `${ext.age_estimate} years` : null} />
          <ConfirmedRow label="Date of Birth" value={ext.dob} />
          <ConfirmedRow label="Gender" value={ext.gender} />
          <ConfirmedRow label="Height" value={ext.height_cm ? `${ext.height_cm} cm` : null} />
          <ConfirmedRow label="Weight" value={ext.weight_kg ? `${ext.weight_kg} kg` : null} />
          {bmi && <ConfirmedRow label="BMI" value={`${bmi} — ${bmiInfo?.text || ""}`} accent={bmiInfo?.color} />}
          <ConfirmedRow label="Blood Group" value={ext.blood_group} />
          {ext.conditions?.length > 0 && <ConfirmedRow label="Conditions" value={ext.conditions.join(", ")} />}
          {ext.medications?.length > 0 && <ConfirmedRow label="Medications" value={ext.medications.join(", ")} />}
          {ext.allergies?.length > 0 && <ConfirmedRow label="Allergies" value={ext.allergies.join(", ")} accent="#E85A5A" />}
        </div>
      )}

      {/* MISSING REQUIRED */}
      {(showNameInput || showAgeInput) && (
        <div className="flex flex-col gap-3">
          <div className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: "#E85A5A" }}>Required — please fill in</div>
          {showNameInput && (
            <InlineField label="Full name" value={fields.name} onChange={set("name")} placeholder="Full name" required />
          )}
          {showAgeInput && (
            <div className="grid grid-cols-2 gap-3">
              <InlineField label="Date of birth" type="date" value={fields.dob} onChange={set("dob")}
                placeholder="YYYY-MM-DD" />
              <InlineField label="Age (if no DOB)" type="number" value={fields.age} onChange={set("age")}
                placeholder="e.g. 67" />
            </div>
          )}
        </div>
      )}

      {/* MISSING OPTIONAL */}
      <div className="flex flex-col gap-3">
        <div className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: "#6B7595" }}>
          Optional — add now or later
        </div>
        {!ext.gender && (
          <InlineField
            label="Gender"
            value={fields.gender}
            onChange={set("gender")}
            options={[
              { value: "male", label: "Male" },
              { value: "female", label: "Female" },
              { value: "other", label: "Other" },
            ]}
          />
        )}
        {(!ext.height_cm || !ext.weight_kg) && (
          <div className="grid grid-cols-2 gap-3">
            {!ext.height_cm && (
              <InlineField label="Height (cm)" type="number" value={fields.height_cm} onChange={set("height_cm")} placeholder="170" />
            )}
            {!ext.weight_kg && (
              <InlineField label="Weight (kg)" type="number" value={fields.weight_kg} onChange={set("weight_kg")} placeholder="70" />
            )}
          </div>
        )}
        {!ext.blood_group && (
          <InlineField
            label="Blood group"
            value={fields.blood_group}
            onChange={set("blood_group")}
            options={["A+","A-","B+","B-","AB+","AB-","O+","O-"].map((g) => ({ value: g, label: g }))}
          />
        )}

        {/* BMI preview */}
        {bmi && (
          <div className="glass-soft px-4 py-3 flex items-center justify-between rounded-2xl" data-testid="bmi-preview">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#6B7595" }}>BMI (calculated)</div>
              <div className="font-display font-extrabold text-[24px]" style={{ color: bmiInfo?.color || "#0F1836" }}>{bmi}</div>
            </div>
            {bmiInfo && <span className="text-[12px] font-bold px-3 py-1 rounded-full text-white" style={{ background: bmiInfo.color }}>{bmiInfo.text}</span>}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 pt-1">
        <button
          type="button"
          onClick={handleCreate}
          disabled={!canCreate || saving}
          className="btn-primary inline-flex items-center justify-center gap-2"
          data-testid="create-profile-btn"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {saving ? "Creating profile…" : "Create Profile"}
        </button>
        <button
          type="button"
          onClick={handleCreateAnyway}
          disabled={!canCreate || saving}
          className="btn-ghost text-[13px]"
          data-testid="create-later-btn"
        >
          I'll add more later
        </button>
        <button
          type="button"
          onClick={onRetry}
          className="text-[12px] text-center"
          style={{ color: "#9AA3BD" }}
          data-testid="retry-voice-btn"
        >
          <Edit3 size={11} className="inline mr-1" /> Try again with different description
        </button>
      </div>
    </div>
  );
}

// ─── Screen 4 — Success ───────────────────────────────────────────────────────

function Screen4Done({ profile, bmi, fromBooking, onConsult, onDashboard }) {
  const bmiInfo = bmiLabel(bmi);
  const relLabel = RELATIONSHIP_OPTIONS.find((r) => r.value === profile?.relationship)?.label || profile?.relationship;

  return (
    <div className="flex flex-col items-center text-center gap-6 py-6 animate-fade-up" data-testid="screen-done">
      {/* Success icon */}
      <div className="w-20 h-20 rounded-3xl flex items-center justify-center shadow-xl" style={{ background: "linear-gradient(135deg,#3CC97C,#28A55B)" }}>
        <Check size={36} className="text-white" />
      </div>

      <div>
        <div className="font-display font-bold text-[28px]" style={{ color: "#0F1836" }}>Profile Created</div>
        <div className="text-[15px] mt-1" style={{ color: "#6B7595" }}>
          {profile?.name}'s profile is ready.
        </div>
        {relLabel && (
          <div className="text-[13px] mt-1 font-semibold" style={{ color: "#5B7CFA" }}>{relLabel}</div>
        )}
        {bmi && bmiInfo && (
          <div className="inline-block mt-2 px-4 py-1 rounded-full text-[13px] font-bold text-white" style={{ background: bmiInfo.color }}>
            BMI {bmi} · {bmiInfo.text}
          </div>
        )}
      </div>

      {/* Primary actions */}
      <div className="flex flex-col gap-3 w-full max-w-[300px]">
        <button
          type="button"
          onClick={onConsult}
          className="btn-primary inline-flex items-center justify-center gap-2"
          data-testid="done-book-consult"
        >
          <Stethoscope size={15} /> Book a Consultation
        </button>
        <button
          type="button"
          onClick={onDashboard}
          className="btn-ghost"
          data-testid="done-go-dashboard"
        >
          Go to Dashboard
        </button>
      </div>

      {/* Upload reports — placeholder for Sprint 2.4 */}
      <div className="glass-soft rounded-2xl px-5 py-4 w-full max-w-[360px]" data-testid="upload-reports-teaser">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(91,124,250,0.12)" }}>
            <Upload size={18} className="text-[#5B7CFA]" />
          </div>
          <div className="text-left">
            <div className="font-semibold text-[14px]" style={{ color: "#0F1836" }}>
              Would CARE AI like to learn more?
            </div>
            <div className="text-[11.5px]" style={{ color: "#6B7595" }}>Upload reports · Coming soon</div>
          </div>
          <span className="badge text-[9px] shrink-0">Soon</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main ProfileCreate page ──────────────────────────────────────────────────

export default function ProfileCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromBooking = searchParams.get("from") === "booking";

  const [screen, setScreen] = useState(0);
  const [relationship, setRelationship] = useState(null);
  const [extraction, setExtraction] = useState(null);
  const [rawTranscript, setRawTranscript] = useState("");
  const [createdProfile, setCreatedProfile] = useState(null);
  const [createdBmi, setCreatedBmi] = useState(null);

  const handleSelectRelationship = (rel) => {
    setRelationship(rel);
    setScreen(1);
  };

  const handleExtracted = (result, transcript) => {
    setExtraction(result);
    setRawTranscript(transcript);
    setScreen(2);
  };

  const handleSkipAI = () => {
    setExtraction({ extracted: {}, confidence: {}, missing_required: ["name", "age"], missing_optional: [], fallback: true });
    setScreen(2);
  };

  const handleProfileCreated = (profile, bmi) => {
    setCreatedProfile(profile);
    setCreatedBmi(bmi);
    setScreen(3);
    toast.success(`${profile.name}'s profile created`);
  };

  const handleRetryVoice = () => {
    setExtraction(null);
    setRawTranscript("");
    setScreen(1);
  };

  const handleConsult = () => {
    navigate("/portal", { state: { openConsult: true } });
  };

  const handleDashboard = () => {
    navigate("/portal");
  };

  return (
    <div className="max-w-lg mx-auto w-full animate-fade-up" data-testid="profile-create-page">
      {/* Back navigation */}
      {screen < 3 && (
        <button
          type="button"
          onClick={() => {
            if (screen === 0) navigate(-1);
            else setScreen((s) => s - 1);
          }}
          className="inline-flex items-center gap-2 mb-4 text-[13px] font-medium"
          style={{ color: "#6B7595" }}
          data-testid="profile-create-back"
        >
          <ArrowLeft size={15} /> Back
        </button>
      )}

      <ProgressBar screen={screen} />

      {screen === 0 && (
        <Screen1Relationship onSelect={handleSelectRelationship} />
      )}
      {screen === 1 && relationship && (
        <Screen2CareAI
          relationship={relationship}
          onExtracted={handleExtracted}
          onSkip={handleSkipAI}
        />
      )}
      {screen === 2 && (
        <Screen3Confirm
          relationship={relationship}
          extraction={extraction}
          rawTranscript={rawTranscript}
          onCreated={handleProfileCreated}
          onRetry={handleRetryVoice}
        />
      )}
      {screen === 3 && (
        <Screen4Done
          profile={createdProfile}
          bmi={createdBmi}
          fromBooking={fromBooking}
          onConsult={handleConsult}
          onDashboard={handleDashboard}
        />
      )}
    </div>
  );
}

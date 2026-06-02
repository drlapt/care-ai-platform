import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  X, Pill, Plus, Trash2, Send, Sparkles, Loader2, FlaskConical, AlertTriangle,
  ClipboardList, Stethoscope, FileText, ChevronRight, CalendarClock, ShieldAlert, HelpCircle,
  Mic, ShieldCheck, AlertOctagon, Lightbulb,
} from "lucide-react";
import { quickPrescribe, quickPrescribeDraft, rxAiGuidance, getPatient, copilotCheck, copilotVoice, listTemplates, applyTemplate } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const BLANK_MED = { medication: "", dose: "", frequency: "twice daily", duration: "5 days", instructions: "", reason: "" };
const BLANK_TEST = { name: "", urgency: "routine", reason: "" };

export default function QuickPrescribeModal({ patientId, patientName, alertId, onClose, onIssued }) {
  const { user } = useAuth();
  const [patient, setPatient] = useState(null);
  // Structured clinical sections
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [clinicalSummary, setClinicalSummary] = useState("");
  const [provisionalDx, setProvisionalDx] = useState("");
  const [doctorNotes, setDoctorNotes] = useState("");
  const [items, setItems] = useState([{ ...BLANK_MED }]);
  const [investigations, setInvestigations] = useState([]);
  const [advice, setAdvice] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [redFlags, setRedFlags] = useState("");
  const [reason, setReason] = useState("");
  // Async + AI state
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [guidance, setGuidance] = useState(null); // {investigations, follow_up, missed_symptoms}
  const [guidanceLoading, setGuidanceLoading] = useState(false);
  // Phase 22 — Clinical Co-Pilot state
  const [copilot, setCopilot] = useState(null);     // {status, allergy_warnings, dose_warnings, ...}
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [overrideAllergy, setOverrideAllergy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  // Phase 12 — Templates
  const [templates, setTemplates] = useState([]);
  const [tplOpen, setTplOpen] = useState(false);

  // Load doctor's templates once
  useEffect(() => {
    let alive = true;
    listTemplates().then((d) => alive && setTemplates(d || [])).catch(() => {});
    return () => { alive = false; };
  }, []);

  const onApplyTemplate = async (t) => {
    setTplOpen(false);
    try {
      const fresh = await applyTemplate(t.id);
      const tpl = fresh || t;
      // Merge meds: replace blank starter row, otherwise append
      setItems((prev) => {
        const blanks = prev.every((i) => !((i.medication || "").trim()));
        const tplMeds = (tpl.medications || []).map((m) => ({ ...BLANK_MED, ...m }));
        if (tplMeds.length === 0) return prev;
        return blanks ? tplMeds : [...prev.filter((i) => (i.medication || "").trim()), ...tplMeds];
      });
      // Merge tests
      const tplTests = (tpl.tests || []).map((x) => ({
        name: x.name || "",
        urgency: x.urgency || "routine",
        reason: x.reason || "",
      }));
      if (tplTests.length) setInvestigations((prev) => [...(prev || []), ...tplTests]);
      // Advice + follow-up — only fill if empty so we never clobber doctor's typing
      if (tpl.advice && !advice) setAdvice(tpl.advice);
      if (tpl.follow_up && !followUp) setFollowUp(tpl.follow_up);
      toast.success(`Applied "${tpl.name}"`);
      // Refresh local sort by usage_count
      setTemplates((prev) => prev.map((p) => (p.id === tpl.id ? { ...p, usage_count: tpl.usage_count } : p))
        .sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0)));
    } catch {
      toast.error("Could not apply template");
    }
  };

  // Load patient context
  useEffect(() => {
    if (!patientId) return;
    let alive = true;
    getPatient(patientId)
      .then((p) => alive && setPatient(p))
      .catch(() => {});
    return () => { alive = false; };
  }, [patientId]);

  // Auto-fetch AI Rx draft once
  useEffect(() => {
    if (!patientId || draftLoaded) return;
    let alive = true;
    setDrafting(true);
    quickPrescribeDraft({ patient_id: patientId, alert_id: alertId })
      .then((data) => {
        if (!alive) return;
        if ((data.items || []).length > 0) {
          setItems(data.items.map((it) => ({ ...BLANK_MED, ...it })));
          if (data.reason) setReason(data.reason);
          toast.success("Care AI drafted a starting Rx — review or edit below.");
        } else if (data.reason) {
          toast.warning(`Care AI: ${data.reason}`);
        }
      })
      .catch(() => {})
      .finally(() => { if (alive) { setDrafting(false); setDraftLoaded(true); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, alertId]);

  const pi = patient?.personal_info || {};
  const mh = patient?.medical_history || {};
  const allergies = (mh.allergies || []).join(", ") || "NKDA";
  const conditions = (mh.current_conditions || []).join(", ") || "—";
  const todayLabel = useMemo(
    () => new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" }),
    [],
  );

  const updateItem = (i, k, v) => setItems((a) => a.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const removeItem = (i) => setItems((a) => a.filter((_, idx) => idx !== i));
  const addItem = () => setItems((a) => [...a, { ...BLANK_MED }]);

  const updateInv = (i, k, v) => setInvestigations((a) => a.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const removeInv = (i) => setInvestigations((a) => a.filter((_, idx) => idx !== i));
  const addInv = (preset = null) => setInvestigations((a) => [...a, preset ? { ...BLANK_TEST, ...preset } : { ...BLANK_TEST }]);

  const regenerateDraft = async () => {
    setDrafting(true);
    try {
      const data = await quickPrescribeDraft({ patient_id: patientId, alert_id: alertId });
      if ((data.items || []).length > 0) {
        setItems(data.items.map((it) => ({ ...BLANK_MED, ...it })));
        if (data.reason) setReason(data.reason);
        toast.success("Refreshed AI draft.");
      } else {
        toast.warning(`Care AI: ${data.reason || "No medication recommended."}`);
      }
    } catch {
      toast.error("Could not refresh draft");
    } finally {
      setDrafting(false);
    }
  };

  const fetchGuidance = async () => {
    setGuidanceLoading(true);
    try {
      const data = await rxAiGuidance({
        patient_id: patientId,
        alert_id: alertId,
        chief_complaint: chiefComplaint,
        current_diagnosis: provisionalDx,
        current_medications: items.filter((i) => i.medication).map((i) => i.medication),
        current_investigations: investigations.map((i) => i.name).filter(Boolean),
      });
      setGuidance(data);
    } catch {
      toast.error("Care AI guidance unavailable");
      setGuidance({ investigations: [], follow_up: "", missed_symptoms: [] });
    } finally {
      setGuidanceLoading(false);
    }
  };

  // ===== Phase 22: Clinical Co-Pilot =====
  const runSafetyCheck = async () => {
    const cleanedMeds = items.filter((i) => (i.medication || "").trim());
    setCopilotLoading(true);
    try {
      const data = await copilotCheck({
        patient_id: patientId,
        items: cleanedMeds,
        chief_complaint: chiefComplaint,
        clinical_summary: clinicalSummary,
        provisional_diagnosis: provisionalDx,
        alert_id: alertId,
      });
      setCopilot(data);
      setOverrideAllergy(false);
      if (data.status === "ok") toast.success("Co-Pilot: no safety issues detected.");
      else if (data.blocking) toast.error("Co-Pilot found a blocking issue — review below.");
      else toast.message("Co-Pilot has suggestions — review below.");
    } catch {
      toast.error("Co-Pilot unavailable");
    } finally {
      setCopilotLoading(false);
    }
  };

  const acceptSuggestion = (s) => {
    setItems((prev) => {
      const blanks = prev.every((i) => !((i.medication || "").trim()));
      const newRow = {
        medication: s.medication || "",
        dose: s.dose || "",
        frequency: s.frequency || "",
        duration: s.duration || "5 days",
        instructions: "",
        reason: s.reason || s.for_symptom || "",
      };
      return blanks ? [newRow] : [...prev, newRow];
    });
    toast.success(`Added ${s.medication}`);
    setCopilot(null);
  };

  const startVoice = async () => {
    if (recording || voiceLoading) return;
    if (!navigator.mediaDevices?.getUserMedia) { toast.error("Microphone not supported in this browser"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      recorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (ev) => { if (ev.data?.size) chunksRef.current.push(ev.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (!blob.size) { setRecording(false); return; }
        setVoiceLoading(true);
        try {
          const file = new File([blob], "rx-voice.webm", { type: "audio/webm" });
          const data = await copilotVoice(file, patientId);
          if (data.transcript) toast.success(`Heard: "${data.transcript.slice(0, 60)}${data.transcript.length > 60 ? "…" : ""}"`);
          if ((data.items || []).length > 0) {
            const blanks = items.every((i) => !((i.medication || "").trim()));
            const next = blanks ? data.items : [...items.filter((i) => (i.medication || "").trim()), ...data.items];
            setItems(next.map((it) => ({ ...BLANK_MED, ...it })));
            if (data.reason && !reason) setReason(data.reason);
          } else {
            toast.warning("Voice draft was empty — try again.");
          }
        } catch {
          toast.error("Voice prescription failed");
        } finally {
          setVoiceLoading(false);
          setRecording(false);
        }
      };
      mr.start();
      setRecording(true);
    } catch {
      toast.error("Microphone permission denied");
      setRecording(false);
    }
  };
  const stopVoice = () => {
    if (recorderRef.current && recording) recorderRef.current.stop();
  };

  const submit = async (e) => {
    e.preventDefault();
    const cleanedMeds = items.filter((i) => (i.medication || "").trim());
    if (cleanedMeds.length === 0) { toast.error("Add at least one medication"); return; }
    setSaving(true);
    try {
      const res = await quickPrescribe({
        patient_id: patientId,
        items: cleanedMeds,
        reason: reason || provisionalDx,
        alert_id: alertId,
        chief_complaint: chiefComplaint,
        clinical_summary: clinicalSummary,
        provisional_diagnosis: provisionalDx,
        doctor_notes: doctorNotes,
        investigations: investigations.filter((i) => (i.name || "").trim()),
        advice,
        follow_up: followUp,
        red_flags: redFlags.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean),
        override_allergy_warning: overrideAllergy,
      });
      toast.success(`Prescription issued (${res.reminders_created} reminder${res.reminders_created === 1 ? "" : "s"} auto-created)`);
      onIssued?.(res);
      onClose();
    } catch (err) {
      // Allergy collision (HTTP 409) — surface inline so the doctor can override.
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409 && detail?.error === "allergy_collision") {
        setCopilot({
          status: "blocking", blocking: true,
          allergy_warnings: detail.collisions || [],
          dose_warnings: [], interaction_warnings: [], gap_warnings: [], suggestions: [],
        });
        toast.error("Allergy conflict — review the safety panel before signing.");
      } else {
        toast.error(detail || "Could not issue prescription");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 animate-fade-up"
      style={{ background: "rgba(15, 24, 54, 0.42)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
      data-testid="quick-rx-backdrop"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="glass-card w-full max-w-[820px] flex flex-col gap-4 max-h-[92vh] overflow-y-auto"
        data-testid="quick-rx-modal"
      >
        {/* Letterhead */}
        <header className="flex items-start justify-between gap-3 pb-3 border-b border-[#5B7CFA]/15">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] text-white flex items-center justify-center shrink-0">
              <FileText size={20} />
            </div>
            <div className="min-w-0">
              <div className="font-display font-bold text-[20px] truncate" style={{ color: "#0F1836" }}>Clinical Prescription</div>
              <div className="text-[11.5px]" style={{ color: "#6B7595" }}>
                Issued by <span className="font-semibold">{user?.name || "Doctor"}</span> · {todayLabel}
              </div>
              {drafting && (
                <div className="text-[11.5px] mt-1 inline-flex items-center gap-1.5" style={{ color: "#7C4DFF" }} data-testid="quick-rx-drafting">
                  <Loader2 size={11} className="animate-spin" /> Care AI is drafting a starting Rx…
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Phase 12 — Apply template */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setTplOpen((o) => !o)}
                disabled={saving}
                title={templates.length ? "Apply a saved template" : "No templates yet — create one in Templates"}
                className="px-3 h-9 rounded-full bg-[#7C4DFF]/10 hover:bg-[#7C4DFF]/22 inline-flex items-center gap-1.5 text-[12px] font-semibold transition disabled:opacity-50"
                style={{ color: "#7C4DFF" }}
                data-testid="quick-rx-apply-template-btn"
              >
                <FileText size={12} /> Template{templates.length > 0 ? ` · ${templates.length}` : ""}
              </button>
              {tplOpen && (
                <div
                  className="absolute right-0 top-[calc(100%+6px)] z-50 w-[280px] glass-card !p-2 flex flex-col gap-1 max-h-[280px] overflow-y-auto"
                  onClick={(e) => e.stopPropagation()}
                  data-testid="quick-rx-template-menu"
                >
                  {templates.length === 0 ? (
                    <div className="px-3 py-3 text-[12px]" style={{ color: "#6B7595" }}>
                      No templates yet. Create one in <span className="font-semibold text-[#7C4DFF]">Templates</span>.
                    </div>
                  ) : (
                    templates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => onApplyTemplate(t)}
                        className="text-left px-2.5 py-2 rounded-xl hover:bg-white/80 transition flex items-center gap-2"
                        data-testid={`quick-rx-template-${t.id}`}
                      >
                        <span className="text-lg shrink-0">{t.icon || "📋"}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-[13px] truncate" style={{ color: "#0F1836" }}>{t.name}</div>
                          <div className="text-[11px]" style={{ color: "#6B7595" }}>
                            {(t.medications || []).length} med{(t.medications || []).length === 1 ? "" : "s"} · used {t.usage_count || 0}×
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <button type="button" onClick={recording ? stopVoice : startVoice} disabled={voiceLoading || saving}
              title={recording ? "Stop recording" : "Voice-dictate prescription"}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition disabled:opacity-50 ${recording ? "bg-[#E85A5A] text-white" : "bg-[#5B7CFA]/12 hover:bg-[#5B7CFA]/22 text-[#5B7CFA]"}`}
              data-testid="quick-rx-voice">
              {voiceLoading
                ? <Loader2 size={13} className="animate-spin" />
                : recording
                  ? <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span></span>
                  : <Mic size={14} />}
            </button>
            <button type="button" onClick={runSafetyCheck} disabled={copilotLoading || saving}
              title="Run Clinical Co-Pilot safety check"
              className="w-9 h-9 rounded-full bg-[#3CC97C]/14 hover:bg-[#3CC97C]/26 flex items-center justify-center transition disabled:opacity-50"
              data-testid="quick-rx-copilot-btn">
              {copilotLoading ? <Loader2 size={13} className="animate-spin text-[#3CC97C]" /> : <ShieldCheck size={14} className="text-[#3CC97C]" />}
            </button>
            <button type="button" onClick={regenerateDraft} disabled={drafting || saving} title="Ask Care AI to redraft meds"
              className="w-9 h-9 rounded-full bg-[#7C4DFF]/12 hover:bg-[#7C4DFF]/22 flex items-center justify-center transition disabled:opacity-50"
              data-testid="quick-rx-redraft">
              {drafting ? <Loader2 size={13} className="animate-spin text-[#7C4DFF]" /> : <Sparkles size={14} className="text-[#7C4DFF]" />}
            </button>
            <button type="button" onClick={onClose} className="w-8 h-8 rounded-full bg-white/70 hover:bg-white flex items-center justify-center" data-testid="quick-rx-close"><X size={14} /></button>
          </div>
        </header>

        {/* Patient details */}
        <Section title="Patient details" icon={Stethoscope} testid="rx-section-patient">
          <div className="glass-soft p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12.5px]">
            <Field label="Name" value={pi.name || patientName || "—"} />
            <Field label="Age / Sex" value={`${pi.age ?? "—"} · ${pi.gender || "—"}`} />
            <Field label="Allergies" value={allergies} accent={(mh.allergies || []).length ? "#E85A5A" : "#0F1836"} />
            <Field label="Conditions" value={conditions} />
          </div>
        </Section>

        {/* Chief complaint + Clinical summary + Provisional diagnosis */}
        <Section title="Chief complaint" icon={ClipboardList} testid="rx-section-chief">
          <input value={chiefComplaint} onChange={(e) => setChiefComplaint(e.target.value)}
            placeholder="e.g. Persistent dry cough x5 days with low-grade fever"
            className="bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3 text-[14px] outline-none w-full"
            data-testid="rx-chief-complaint" />
        </Section>

        <Section title="Clinical summary" icon={FileText} testid="rx-section-summary">
          <textarea value={clinicalSummary} onChange={(e) => setClinicalSummary(e.target.value)} rows={2}
            placeholder="History, examination findings, vitals if any, relevant negatives."
            className="bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3 text-[14px] outline-none w-full resize-y"
            data-testid="rx-clinical-summary" />
        </Section>

        <Section title="Provisional diagnosis" icon={Stethoscope} testid="rx-section-dx">
          <input value={provisionalDx} onChange={(e) => setProvisionalDx(e.target.value)}
            placeholder="e.g. Acute viral URTI"
            className="bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3 text-[14px] outline-none w-full"
            data-testid="rx-provisional-dx" />
        </Section>

        {/* Medications */}
        <Section title="Medications" icon={Pill} testid="rx-section-meds">
          <div className="flex flex-col gap-2" data-testid="quick-rx-items">
            {items.map((it, i) => (
              <div key={i} className="glass-soft p-3 grid grid-cols-1 md:grid-cols-5 gap-2" data-testid={`quick-rx-item-${i}`}>
                <input placeholder="Medication" value={it.medication} onChange={(e) => updateItem(i, "medication", e.target.value)} className="bg-white border border-[#5B7CFA]/15 rounded-xl px-3 py-2 text-[13px] outline-none" data-testid={`qrx-med-${i}`} />
                <input placeholder="Dose" value={it.dose} onChange={(e) => updateItem(i, "dose", e.target.value)} className="bg-white border border-[#5B7CFA]/15 rounded-xl px-3 py-2 text-[13px] outline-none" />
                <input placeholder="Frequency" value={it.frequency} onChange={(e) => updateItem(i, "frequency", e.target.value)} className="bg-white border border-[#5B7CFA]/15 rounded-xl px-3 py-2 text-[13px] outline-none" />
                <input placeholder="Duration" value={it.duration} onChange={(e) => updateItem(i, "duration", e.target.value)} className="bg-white border border-[#5B7CFA]/15 rounded-xl px-3 py-2 text-[13px] outline-none" />
                <div className="flex gap-2">
                  <input placeholder="Instructions" value={it.instructions} onChange={(e) => updateItem(i, "instructions", e.target.value)} className="flex-1 bg-white border border-[#5B7CFA]/15 rounded-xl px-3 py-2 text-[13px] outline-none" />
                  <button type="button" onClick={() => removeItem(i)} className="w-9 h-9 rounded-xl bg-white hover:bg-[#E85A5A]/10 flex items-center justify-center" data-testid={`qrx-remove-${i}`}><Trash2 size={13} className="text-[#E85A5A]" /></button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={addItem} className="btn-ghost inline-flex items-center gap-1.5 text-[13px] mt-2 self-start" data-testid="quick-rx-add">
            <Plus size={13} /> Add medication
          </button>
        </Section>

        {/* Phase 22 — Clinical Co-Pilot panel */}
        {copilot && (
          <Section
            title={copilot.status === "ok" ? "Clinical Co-Pilot · all clear" : copilot.blocking ? "Clinical Co-Pilot · review needed" : "Clinical Co-Pilot · suggestions"}
            icon={copilot.blocking ? AlertOctagon : ShieldCheck}
            testid="rx-section-copilot"
            accent={copilot.blocking ? "#E85A5A" : copilot.status === "warn" ? "#F2994A" : "#3CC97C"}
          >
            <div className="rounded-2xl p-3 flex flex-col gap-3 border" style={{ background: copilot.blocking ? "rgba(232,90,90,0.06)" : copilot.status === "warn" ? "rgba(242,153,74,0.06)" : "rgba(60,201,124,0.06)", borderColor: copilot.blocking ? "rgba(232,90,90,0.30)" : copilot.status === "warn" ? "rgba(242,153,74,0.30)" : "rgba(60,201,124,0.30)" }} data-testid="rx-copilot-panel">
              {copilot.allergy_warnings?.length > 0 && (
                <CopilotBlock icon={ShieldAlert} color="#E85A5A" title="Allergy conflict" testid="copilot-allergy">
                  {copilot.allergy_warnings.map((w, i) => (
                    <div key={i} className="bg-white/70 rounded-xl px-3 py-2 text-[12.5px]" data-testid={`copilot-allergy-${i}`}>
                      <b>{w.medication}</b> conflicts with recorded allergy <b>{w.allergy}</b> · <span className="opacity-70">{w.match}</span>
                    </div>
                  ))}
                  <label className="inline-flex items-center gap-2 text-[12px] mt-1" style={{ color: "#7B1F1F" }}>
                    <input type="checkbox" checked={overrideAllergy} onChange={(e) => setOverrideAllergy(e.target.checked)} data-testid="copilot-override-toggle" />
                    Override and issue anyway (audited)
                  </label>
                </CopilotBlock>
              )}
              {copilot.interaction_warnings?.length > 0 && (
                <CopilotBlock icon={AlertTriangle} color="#F2994A" title="Drug interactions" testid="copilot-interactions">
                  {copilot.interaction_warnings.map((w, i) => (
                    <div key={i} className="bg-white/70 rounded-xl px-3 py-2 text-[12.5px]" data-testid={`copilot-interaction-${i}`}>
                      <span className="font-semibold capitalize">{w.drug_a}</span> ↔ <span className="font-semibold capitalize">{w.drug_b}</span>
                      <span className="ml-1 text-[10px] uppercase tracking-wider" style={{ color: w.severity === "major" ? "#E85A5A" : "#F2994A" }}> · {w.severity}</span>
                      <div className="text-[11.5px] mt-0.5" style={{ color: "#6B7595" }}>{w.note}</div>
                    </div>
                  ))}
                </CopilotBlock>
              )}
              {copilot.dose_warnings?.length > 0 && (
                <CopilotBlock icon={AlertTriangle} color="#F2994A" title="Dose check" testid="copilot-dose">
                  {copilot.dose_warnings.map((w, i) => (
                    <div key={i} className="bg-white/70 rounded-xl px-3 py-2 text-[12.5px]" data-testid={`copilot-dose-${i}`}>
                      <b>{w.medication}</b> · {w.kind === "dose_high" ? "above" : "below"} typical range
                      <div className="text-[11.5px] mt-0.5" style={{ color: "#6B7595" }}>~{w.computed_daily} / day · expected {w.expected}{w.note ? ` · ${w.note}` : ""}</div>
                    </div>
                  ))}
                </CopilotBlock>
              )}
              {copilot.gap_warnings?.length > 0 && (
                <CopilotBlock icon={HelpCircle} color="#5B7CFA" title="Untreated symptoms" testid="copilot-gaps">
                  {copilot.gap_warnings.map((w, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 bg-white/70 rounded-xl px-3 py-2 text-[12.5px]" data-testid={`copilot-gap-${i}`}>
                      <div>
                        <div><span className="font-semibold capitalize">{w.symptom}</span> · no treatment in current Rx</div>
                        <div className="text-[11.5px]" style={{ color: "#6B7595" }}>Suggest: {w.suggestion.medication} {w.suggestion.dose} {w.suggestion.frequency}</div>
                      </div>
                      <button type="button" className="btn-ghost text-[11px] py-1.5 px-2.5" onClick={() => acceptSuggestion(w.suggestion)} data-testid={`copilot-gap-accept-${i}`}>
                        <Plus size={11} /> Add
                      </button>
                    </div>
                  ))}
                </CopilotBlock>
              )}
              {copilot.suggestions?.length > 0 && (
                <CopilotBlock icon={Lightbulb} color="#7C4DFF" title="Suggested medications" testid="copilot-suggestions">
                  {copilot.suggestions.map((s, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 bg-white/70 rounded-xl px-3 py-2 text-[12.5px]" data-testid={`copilot-suggestion-${i}`}>
                      <div>
                        <div><span className="font-semibold">{s.medication}</span> {s.dose} · {s.frequency}</div>
                        <div className="text-[11.5px]" style={{ color: "#6B7595" }}>{s.reason || s.for_symptom}</div>
                      </div>
                      <button type="button" className="btn-ghost text-[11px] py-1.5 px-2.5" onClick={() => acceptSuggestion(s)} data-testid={`copilot-sugg-accept-${i}`}>
                        <Plus size={11} /> Add
                      </button>
                    </div>
                  ))}
                </CopilotBlock>
              )}
              {copilot.status === "ok" && (
                <div className="text-[12.5px] inline-flex items-center gap-1.5" style={{ color: "#1F7A4A" }}>
                  <ShieldCheck size={12} /> No allergy conflicts, no major interactions, doses within range, no untreated symptoms.
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Investigations */}
        <Section title="Investigations / tests" icon={FlaskConical} testid="rx-section-investigations">
          <div className="flex flex-col gap-2" data-testid="rx-investigations-list">
            {investigations.length === 0 && (
              <div className="text-[12.5px]" style={{ color: "#6B7595" }}>No tests yet — add one or use Care AI guidance below.</div>
            )}
            {investigations.map((it, i) => (
              <div key={i} className="glass-soft p-3 grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1.6fr_auto] gap-2" data-testid={`rx-inv-${i}`}>
                <input placeholder="Test name (e.g. CBC, ECG)" value={it.name} onChange={(e) => updateInv(i, "name", e.target.value)} className="bg-white border border-[#5B7CFA]/15 rounded-xl px-3 py-2 text-[13px] outline-none" />
                <select value={it.urgency} onChange={(e) => updateInv(i, "urgency", e.target.value)} className="bg-white border border-[#5B7CFA]/15 rounded-xl px-3 py-2 text-[13px] outline-none" data-testid={`rx-inv-urgency-${i}`}>
                  <option value="routine">Routine</option>
                  <option value="urgent">Urgent</option>
                  <option value="stat">STAT</option>
                </select>
                <input placeholder="Reason / clinical context" value={it.reason} onChange={(e) => updateInv(i, "reason", e.target.value)} className="bg-white border border-[#5B7CFA]/15 rounded-xl px-3 py-2 text-[13px] outline-none" />
                <button type="button" onClick={() => removeInv(i)} className="w-9 h-9 rounded-xl bg-white hover:bg-[#E85A5A]/10 flex items-center justify-center" data-testid={`rx-inv-remove-${i}`}><Trash2 size={13} className="text-[#E85A5A]" /></button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => addInv()} className="btn-ghost inline-flex items-center gap-1.5 text-[13px] mt-2 self-start" data-testid="rx-add-investigation">
            <Plus size={13} /> Add test
          </button>
        </Section>

        {/* Doctor notes */}
        <Section title="Doctor notes" icon={ClipboardList} testid="rx-section-notes">
          <textarea value={doctorNotes} onChange={(e) => setDoctorNotes(e.target.value)} rows={2}
            placeholder="Free-text notes for the patient's chart."
            className="bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3 text-[14px] outline-none w-full resize-y"
            data-testid="rx-doctor-notes" />
        </Section>

        {/* Advice + Follow-up */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Section title="Advice" icon={ChevronRight} testid="rx-section-advice">
            <textarea value={advice} onChange={(e) => setAdvice(e.target.value)} rows={2}
              placeholder="Hydration, rest, diet, activity guidance…"
              className="bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3 text-[13.5px] outline-none w-full resize-y"
              data-testid="rx-advice" />
          </Section>
          <Section title="Follow-up" icon={CalendarClock} testid="rx-section-followup">
            <input value={followUp} onChange={(e) => setFollowUp(e.target.value)}
              placeholder="e.g. Return in 7 days, sooner if worse."
              className="bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3 text-[14px] outline-none w-full"
              data-testid="rx-followup" />
          </Section>
        </div>

        {/* Red flags */}
        <Section title="Red flags · seek immediate care if" icon={ShieldAlert} testid="rx-section-redflags" accent="#E85A5A">
          <textarea value={redFlags} onChange={(e) => setRedFlags(e.target.value)} rows={2}
            placeholder="Comma- or line-separated. e.g. Chest pain, breathlessness at rest, fever > 39°C for 3+ days"
            className="bg-white border border-[#E85A5A]/30 rounded-2xl px-3.5 py-3 text-[13.5px] outline-none w-full resize-y"
            data-testid="rx-red-flags" />
        </Section>

        {/* AI Guidance */}
        <Section title="Care AI guidance" icon={Sparkles} testid="rx-section-ai-guidance" accent="#7C4DFF">
          <div className="rounded-2xl p-3 flex flex-col gap-3" style={{ background: "linear-gradient(135deg,rgba(124,77,255,0.08),rgba(91,124,250,0.06))", border: "1px solid rgba(124,77,255,0.18)" }}>
            <div className="text-[12.5px]" style={{ color: "#2A3558" }}>
              Ask Care AI three safety-net questions: <b>Any tests to add?</b> · <b>Follow-up needed?</b> · <b>Any missed symptoms?</b>
            </div>
            <button type="button" onClick={fetchGuidance} disabled={guidanceLoading}
              className="btn-ghost inline-flex items-center gap-2 text-[13px] self-start"
              data-testid="rx-ai-guidance-btn">
              {guidanceLoading
                ? (<><Loader2 size={13} className="animate-spin" /> Asking Care AI…</>)
                : (<><Sparkles size={13} /> Get Care AI suggestions</>)}
            </button>

            {guidance && (
              <div className="flex flex-col gap-2.5 mt-1" data-testid="rx-ai-guidance-result">
                <GuidanceBlock
                  icon={FlaskConical} color="#5B7CFA"
                  title="Tests to add"
                  empty="Care AI didn't recommend additional tests."
                  testid="guidance-tests"
                >
                  {guidance.investigations.map((t, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 bg-white/80 rounded-xl px-3 py-2 text-[12.5px]" data-testid={`guidance-test-${i}`}>
                      <div>
                        <div className="font-semibold" style={{ color: "#0F1836" }}>{t.name} <span className="ml-1 text-[10px] uppercase tracking-wider" style={{ color: t.urgency === "stat" ? "#E85A5A" : t.urgency === "urgent" ? "#F2994A" : "#5B7CFA" }}>{t.urgency}</span></div>
                        {t.reason && <div className="text-[11.5px]" style={{ color: "#6B7595" }}>{t.reason}</div>}
                      </div>
                      <button type="button" className="btn-ghost text-[11px] py-1.5 px-2.5" onClick={() => addInv(t)} data-testid={`guidance-add-test-${i}`}>
                        <Plus size={11} /> Add
                      </button>
                    </div>
                  )) || []}
                  {(!guidance.investigations || guidance.investigations.length === 0) && null}
                </GuidanceBlock>

                <GuidanceBlock
                  icon={CalendarClock} color="#7C4DFF"
                  title="Follow-up plan"
                  empty="Care AI didn't propose a follow-up."
                  testid="guidance-followup"
                >
                  {guidance.follow_up ? (
                    <div className="flex items-center justify-between gap-2 bg-white/80 rounded-xl px-3 py-2 text-[12.5px]" data-testid="guidance-followup-row">
                      <div style={{ color: "#0F1836" }}>{guidance.follow_up}</div>
                      <button type="button" className="btn-ghost text-[11px] py-1.5 px-2.5" onClick={() => setFollowUp(guidance.follow_up)} data-testid="guidance-apply-followup">
                        Use
                      </button>
                    </div>
                  ) : null}
                </GuidanceBlock>

                <GuidanceBlock
                  icon={HelpCircle} color="#F2994A"
                  title="Missed symptoms / red flags"
                  empty="No additional symptoms flagged."
                  testid="guidance-missed"
                >
                  {(guidance.missed_symptoms || []).map((m, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 bg-white/80 rounded-xl px-3 py-2 text-[12.5px]" data-testid={`guidance-missed-${i}`}>
                      <div style={{ color: "#0F1836" }}>{m}</div>
                      <button
                        type="button" className="btn-ghost text-[11px] py-1.5 px-2.5"
                        onClick={() => setRedFlags((rf) => (rf ? `${rf}\n${m}` : m))}
                        data-testid={`guidance-add-missed-${i}`}
                      >
                        Add to red flags
                      </button>
                    </div>
                  ))}
                </GuidanceBlock>
              </div>
            )}
          </div>
        </Section>

        {/* Sign + send */}
        <footer className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-3 border-t border-[#5B7CFA]/15">
          <div className="text-[11px]" style={{ color: "#6B7595" }}>
            Signed by <span className="font-semibold">{user?.name || "Doctor"}</span> · Reminders auto-created · Care AI will explain to the patient via their 24/7 thread.
          </div>
          <button type="submit" disabled={saving} className="btn-primary inline-flex items-center gap-2" data-testid="quick-rx-submit">
            <Send size={14} /> {saving ? "Issuing…" : "Sign & send Rx"}
          </button>
        </footer>
      </form>
    </div>
  );
}

/* ---------- Reusable bits ---------- */

function Section({ title, icon: Icon, children, testid, accent = "#5B7CFA" }) {
  return (
    <section className="flex flex-col gap-2" data-testid={testid}>
      <div className="inline-flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-widest" style={{ color: accent }}>
        <Icon size={11} /> {title}
      </div>
      {children}
    </section>
  );
}

function Field({ label, value, accent }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#6B7595" }}>{label}</span>
      <span className="text-[13px] font-semibold truncate" style={{ color: accent || "#0F1836" }} title={value}>{value}</span>
    </div>
  );
}

function GuidanceBlock({ icon: Icon, color, title, empty, testid, children }) {
  const hasContent = Array.isArray(children) ? children.some(Boolean) : !!children;
  return (
    <div className="flex flex-col gap-1.5" data-testid={testid}>
      <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color }}>
        <Icon size={11} /> {title}
      </div>
      {hasContent ? children : <div className="text-[11.5px] italic" style={{ color: "#6B7595" }}>{empty}</div>}
    </div>
  );
}

function CopilotBlock({ icon: Icon, color, title, testid, children }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid={testid}>
      <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest" style={{ color }}>
        <Icon size={11} /> {title}
      </div>
      {children}
    </div>
  );
}

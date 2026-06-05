import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { MessageCircle, Send, ShieldAlert, Sparkles, ArrowLeft, Heart, AlertTriangle, Mic, MicOff, Volume2, VolumeX, Square, Globe, Loader2, MessageSquare, Paperclip, Image as ImageIcon, FileText, Brain, HelpCircle, Zap, ShieldOff, ShieldCheck, Pause } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { followupHistory, followupMessage, getPatient, listPatients, ttsSpeak, uploadFollowupFile, followupAttachmentUrl } from "@/lib/api";
import { startSpeechRecognition, isSpeechSupported, speechSupportNote } from "@/lib/speech";

const URG_STYLES = {
  emergency: { bg: "#E85A5A", label: "EMERGENCY", icon: AlertTriangle },
  high: { bg: "#F2994A", label: "HIGH", icon: ShieldAlert },
  medium: { bg: "#5B7CFA", label: "MEDIUM", icon: Heart },
  low: { bg: "#3CC97C", label: "ROUTINE", icon: Heart },
};

// Phase 18 — Clinical reasoning MODE pill (shown only to doctors)
const MODE_STYLES = {
  inquiry:    { bg: "#5B7CFA", label: "INQUIRY",    icon: HelpCircle },
  reasoning:  { bg: "#7C4DFF", label: "REASONING",  icon: Brain },
  action:     { bg: "#28A55B", label: "ACTION",     icon: Zap },
  safety:     { bg: "#E85A5A", label: "SAFETY",     icon: ShieldOff },
  escalation: { bg: "#F2994A", label: "ESCALATION", icon: ShieldAlert },
  delay:      { bg: "#9AA3BD", label: "DELAY",      icon: Pause },
};

const RISK_STYLES = {
  safe:    { color: "#28A55B", label: "safe",    icon: ShieldCheck },
  caution: { color: "#F2994A", label: "caution", icon: ShieldAlert },
  unsafe:  { color: "#E85A5A", label: "unsafe",  icon: ShieldOff },
};

const LANGUAGES = [
  { code: "en", label: "English", sttLocale: "en-US", greeting: "Hello! I'm your Care AI companion. How can I help you today?" },
  { code: "hi", label: "हिंदी", sttLocale: "hi-IN", greeting: "नमस्ते! मैं आपका Care AI साथी हूँ। आज मैं आपकी कैसे मदद कर सकता हूँ?" },
  { code: "te", label: "తెలుగు", sttLocale: "te-IN", greeting: "నమస్కారం! నేను మీ Care AI సహచరుడిని. ఈరోజు నేను మీకు ఎలా సహాయం చేయగలను?" },
  { code: "ta", label: "தமிழ்", sttLocale: "ta-IN", greeting: "வணக்கம்! நான் உங்கள் Care AI துணை. இன்று நான் உங்களுக்கு எப்படி உதவ முடியும்?" },
];

const SR_OK = isSpeechSupported();

export default function FollowupChat() {
  const { user } = useAuth();
  const { patientId: paramId } = useParams();
  const navigate = useNavigate();
  const patientId = paramId || user?.linked_patient_id;

  const [patient, setPatient] = useState(null);
  const [patients, setPatients] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [language, setLanguage] = useState("en");
  const [listening, setListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [uploading, setUploading] = useState(false);

  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const fileInputRef = useRef(null);

  const lang = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];

  useEffect(() => {
    if (user?.role !== "patient") {
      listPatients().then(setPatients).catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    if (!patientId) return;
    Promise.all([
      getPatient(patientId).catch(() => null),
      followupHistory(patientId).catch(() => []),
    ]).then(([p, h]) => {
      setPatient(p);
      setMessages(h || []);
    });
  }, [patientId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Stop audio / recognition on unmount
  useEffect(() => () => {
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
    try { audioRef.current?.pause(); } catch { /* noop */ }
  }, []);

  const stopSpeaking = useCallback(() => {
    try { audioRef.current?.pause(); audioRef.current = null; } catch { /* noop */ }
    setSpeaking(false);
  }, []);

  const speak = useCallback(async (text) => {
    if (!ttsEnabled || !text) return;
    stopSpeaking();
    try {
      setSpeaking(true);
      const blob = await ttsSpeak(text, "nova", 1.0);
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      audioRef.current = a;
      a.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
      a.onerror = () => { setSpeaking(false); URL.revokeObjectURL(url); };
      await a.play();
    } catch (e) {
      setSpeaking(false);
      // Silent fail — chat still works without voice
      console.warn("TTS failed", e);
    }
  }, [ttsEnabled, stopSpeaking]);

  const send = async (textOverride) => {
    const text = (textOverride ?? input).trim();
    if (!text || sending || !patientId) return;
    setInput("");
    const senderRole = user?.role === "patient" ? "user" : "doctor";
    const optimistic = { id: `temp-${Date.now()}`, patient_id: patientId, role: senderRole, sender_name: senderRole === "doctor" ? user?.name : undefined, text, created_at: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    setSending(true);
    try {
      const res = await followupMessage(patientId, text, language);
      const newMsgs = res.message ? [optimistic, res.message] : [optimistic];
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), ...newMsgs]);
      if (res.alert) {
        const urgency = res.alert.urgency;
        if (urgency === "emergency") toast.error("⚠️ EMERGENCY — your doctor has been alerted. If symptoms worsen, call 911.");
        else if (urgency === "high") toast.warning("Your doctor has been notified of this concern.");
      }
      if (user?.role === "patient") speak(res.message?.text);
    } catch (e) {
      toast.error("Could not send message. Please try again.");
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = async (file) => {
    if (!file || !patient) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("File too large (max 10MB)"); return; }
    setUploading(true);
    // Optimistic patient row
    const optimistic = {
      id: `opt-${Date.now()}`,
      role: "user",
      text: `📎 Uploading ${file.name}…`,
      kind: "attachment",
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    try {
      const res = await uploadFollowupFile(patient.id, file, language);
      setMessages((m) => [
        ...m.filter((x) => x.id !== optimistic.id),
        res.user_message,
        res.ai_message,
      ]);
      if (res.alert) toast.error(`⚠️ Dr. Lahari has been alerted (${res.alert.urgency}).`);
      else toast.success("Care AI has reviewed your file.");
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      toast.error(e?.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const startListening = () => {
    const note = speechSupportNote(lang.sttLocale);
    if (note) { toast.error(note); return; }
    stopSpeaking();
    const handle = startSpeechRecognition({
      locale: lang.sttLocale,
      baseValue: input, // preserve whatever the user already typed
      onUpdate: (next) => setInput(next),
      onError: (err) => {
        setListening(false);
        if (err === "language-not-supported-on-this-device") {
          toast.error("Voice input for this language isn't supported on this device — please type your message.");
        } else if (err && err !== "no-speech" && err !== "aborted") {
          toast.error(`Voice error: ${err}`);
        }
      },
      onEnd: () => setListening(false),
    });
    if (handle) {
      recognitionRef.current = handle;
      setListening(true);
    }
  };

  const stopListening = () => {
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
    setListening(false);
  };

  if (!patientId) {
    return (
      <div className="flex flex-col gap-6 animate-fade-up" data-testid="followup-chooser-page">
        <header>
          <h1 className="font-display font-extrabold text-[44px] leading-none" style={{ color: "#0F1836" }}>24/7 Follow-up</h1>
          <p className="text-sm mt-2" style={{ color: "#6B7595" }}>Pick a patient to review their AI follow-up chat.</p>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {patients.map((p) => (
            <button key={p.id} onClick={() => navigate(`/followup/${p.id}`)} className="glass-soft p-4 text-left hover:shadow-lg transition" data-testid={`followup-patient-${p.id}`}>
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] text-white font-semibold flex items-center justify-center">
                  {(p.personal_info?.name || "?").split(" ").map(n => n[0]).slice(0,2).join("")}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[15px] truncate" style={{ color: "#0F1836" }}>{p.personal_info?.name}</div>
                  <div className="text-[12px]" style={{ color: "#6B7595" }}>{p.personal_info?.age}y · {p.personal_info?.gender}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const pname = patient?.personal_info?.name || "Patient";

  return (
    <div className="flex flex-col gap-4 animate-fade-up h-full" data-testid="followup-chat-page">
      <header className="flex items-center gap-3 flex-wrap">
        {user?.role !== "patient" && (
          <button onClick={() => navigate("/followup")} className="w-9 h-9 rounded-full bg-white/70 hover:bg-white transition flex items-center justify-center" data-testid="followup-back-btn">
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B7CFA 0%, #7C4DFF 100%)" }}>
          <Sparkles className="text-white" size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-[24px] leading-tight" style={{ color: "#0F1836" }}>Talk to Care AI · 24/7</h1>
          <div className="text-[13px]" style={{ color: "#6B7595" }}>
            {user?.role === "patient" ? "Chat or speak in your language — about symptoms, meds, recovery, or anything else." : `Viewing ${pname}'s AI follow-up thread.`}
          </div>
        </div>

        {/* Language selector */}
        <div className="flex items-center gap-2 glass-pill px-3 py-1.5" data-testid="language-selector">
          <Globe size={14} className="text-[#5B7CFA]" />
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="bg-transparent outline-none text-[13px] font-semibold cursor-pointer"
            style={{ color: "#0F1836" }}
            data-testid="language-select"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>

        {/* Speaker toggle */}
        <button
          onClick={() => { if (speaking) stopSpeaking(); setTtsEnabled((v) => !v); }}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition ${ttsEnabled ? "bg-[#5B7CFA] text-white" : "bg-white/70 text-[#6B7595] hover:bg-white"}`}
          title={ttsEnabled ? "Voice replies ON" : "Voice replies OFF"}
          data-testid="tts-toggle-btn"
        >
          {ttsEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
      </header>

      <section className="glass-card flex flex-col" style={{ minHeight: "60vh" }} data-testid="followup-chat-window">
        <div ref={scrollRef} className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3 mb-4" style={{ maxHeight: "60vh" }} data-testid="followup-messages">
          {messages.length === 0 && (
            <div className="glass-soft p-5 text-center" data-testid="followup-empty">
              <MessageCircle size={24} className="mx-auto mb-2 text-[#5B7CFA]" />
              <div className="font-semibold" style={{ color: "#0F1836" }}>{lang.greeting}</div>
              <div className="text-[13px] mt-1" style={{ color: "#6B7595" }}>
                Tip: tap the mic to speak. Switch language above anytime — I'll adapt.
              </div>
            </div>
          )}
          {messages.map((m) => {
            const isPatientMsg = m.role === "user";
            const isDoctorMsg  = m.role === "doctor";
            const isUser = isPatientMsg || isDoctorMsg;
            const isMine = (user?.role === "patient" && isPatientMsg) || (user?.role !== "patient" && isDoctorMsg);
            const urg = m.urgency && URG_STYLES[m.urgency];
            const isVoice = m.media_type === "voice";
            const isWa = m.source === "whatsapp";
            const modeMeta = !isUser && m.mode ? MODE_STYLES[m.mode] : null;
            const riskMeta = !isUser && m.risk ? RISK_STYLES[m.risk] : null;
            const isViewerDoctor = user?.role !== "patient";
            const bubbleBg = isDoctorMsg
              ? "bg-gradient-to-br from-[#3CC97C] to-[#22a06b] text-white"
              : isPatientMsg
                ? "bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] text-white"
                : "bg-white/80 border border-white";
            return (
              <div key={m.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`} data-testid={`msg-${m.role}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${bubbleBg}`}>
                  <div className="flex items-center flex-wrap gap-1.5 mb-1.5">
                    {isDoctorMsg && (
                      <div className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/25 text-white">
                        {m.sender_name || "Doctor"}
                      </div>
                    )}
                    {urg && !isUser && (
                      <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-white" style={{ background: urg.bg }}>
                        <urg.icon size={10} /> {urg.label}
                      </div>
                    )}
                    {isViewerDoctor && modeMeta && (
                      <div
                        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                        style={{ background: `${modeMeta.bg}18`, color: modeMeta.bg }}
                        data-testid={`msg-mode-${m.mode}`}
                        title={`Care AI decision pathway: ${modeMeta.label.toLowerCase()}`}
                      >
                        <modeMeta.icon size={9} /> {modeMeta.label}
                      </div>
                    )}
                    {isViewerDoctor && riskMeta && m.risk !== "safe" && (
                      <div
                        className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={{ background: `${riskMeta.color}14`, color: riskMeta.color }}
                        data-testid={`msg-risk-${m.risk}`}
                      >
                        <riskMeta.icon size={9} /> {riskMeta.label}
                      </div>
                    )}
                    {(isVoice || isWa) && (
                      <div
                        className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${isUser ? "bg-white/20 text-white" : "bg-[#5B7CFA]/10 text-[#5B7CFA]"}`}
                        data-testid={`msg-source-${isVoice ? "voice" : "whatsapp"}`}
                      >
                        {isVoice ? <Mic size={10} /> : <MessageSquare size={10} />}
                        {isVoice ? "Voice note" : "WhatsApp"}
                      </div>
                    )}
                  </div>
                  <div className={`text-[14px] whitespace-pre-wrap leading-relaxed`} style={{ color: isUser ? "#fff" : "#0F1836" }}>{m.text}</div>
                  {/* Phase 18 — Gap analysis footer (doctor-only) */}
                  {isViewerDoctor && !isUser && (m.gap || []).length > 0 && (
                    <div className="mt-2 text-[11px] rounded-lg px-2 py-1.5" style={{ background: "rgba(124,77,255,0.06)", color: "#3F2F7A" }} data-testid={`msg-gap-${m.id}`}>
                      <span className="font-bold uppercase tracking-wider text-[9.5px] mr-1">Care AI next step:</span>
                      {(m.gap || []).join(" · ")}
                    </div>
                  )}
                  {/* Attachment thumbnail (patient upload) */}
                  {m.kind === "attachment" && m.attachment && (
                    <a
                      href={followupAttachmentUrl(m.attachment.id)}
                      target="_blank"
                      rel="noreferrer"
                      className={`mt-2 inline-flex items-center gap-2 px-2 py-1.5 rounded-xl text-[11.5px] ${isUser ? "bg-white/15 text-white" : "bg-[#5B7CFA]/10 text-[#5B7CFA]"}`}
                      data-testid={`followup-attachment-${m.attachment.id}`}
                    >
                      {(m.attachment.content_type || "").startsWith("image/")
                        ? <ImageIcon size={12} />
                        : <FileText size={12} />}
                      {m.attachment.filename || "Attachment"}
                    </a>
                  )}
                  {/* AI image analysis card */}
                  {m.kind === "image_analysis" && m.analysis && (
                    <div className="mt-2 glass-soft p-2.5 text-[12px]" style={{ color: "#2A3558" }} data-testid="followup-analysis">
                      <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#7C4DFF" }}>
                        AI read · {(m.analysis.image_type || "").replace(/_/g, " ")}
                      </div>
                      {m.analysis.extracted_data?.medications?.length > 0 && (
                        <div className="mb-1">
                          <span className="font-semibold">Medications:</span>{" "}
                          {m.analysis.extracted_data.medications.map((mm, i) => (
                            <span key={i}>{mm.name} {mm.dose} {mm.frequency}{i < m.analysis.extracted_data.medications.length - 1 ? "; " : ""}</span>
                          ))}
                        </div>
                      )}
                      {m.analysis.extracted_data?.lab_values?.length > 0 && (
                        <div className="mb-1">
                          <span className="font-semibold">Lab values:</span>{" "}
                          {m.analysis.extracted_data.lab_values.map((lv, i) => (
                            <span key={i}>{lv.name}={lv.value} {lv.reference ? `(ref ${lv.reference})` : ""}{i < m.analysis.extracted_data.lab_values.length - 1 ? "; " : ""}</span>
                          ))}
                        </div>
                      )}
                      {m.analysis.extracted_data?.key_findings?.length > 0 && (
                        <div className="mb-1">
                          <span className="font-semibold">Findings:</span> {m.analysis.extracted_data.key_findings.join("; ")}
                        </div>
                      )}
                    </div>
                  )}
                  {isVoice && m.media_url && user?.role !== "patient" && (
                    <a
                      href={m.media_url}
                      target="_blank"
                      rel="noreferrer"
                      className={`mt-1.5 inline-flex items-center gap-1 text-[11px] underline ${isUser ? "text-white/80" : "text-[#5B7CFA]"}`}
                      data-testid="voice-original-link"
                    >
                      <Volume2 size={11} /> Original audio
                    </a>
                  )}
                  <div className={`text-[10px] mt-1.5`} style={{ color: isUser ? "rgba(255,255,255,0.75)" : "#6B7595" }}>
                    {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            );
          })}
          {sending && (
            <div className="flex justify-start" data-testid="followup-thinking">
              <div className="bg-white/80 border border-white rounded-2xl px-4 py-3 text-[13px] animate-pulse-soft inline-flex items-center gap-2" style={{ color: "#6B7595" }}>
                <Loader2 size={13} className="animate-spin" /> Care AI is thinking…
              </div>
            </div>
          )}
          {speaking && !sending && (
            <div className="flex justify-start" data-testid="followup-speaking">
              <button onClick={stopSpeaking} className="bg-[#7C4DFF]/15 text-[#7C4DFF] border border-[#7C4DFF]/30 rounded-2xl px-3 py-1.5 text-[11.5px] font-semibold inline-flex items-center gap-1.5" data-testid="stop-speaking-btn">
                <Square size={10} fill="currentColor" /> AI is speaking — tap to stop
              </button>
            </div>
          )}
        </div>

        <div className="flex items-end gap-2" data-testid="followup-composer">
          {/* File / image upload */}
          {user?.role === "patient" && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf,.doc,.docx,.heic,.heif"
                onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                className="hidden"
                data-testid="followup-file-input"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || sending}
                title="Upload image, prescription, lab report, or document"
                className="h-[56px] w-[56px] rounded-2xl inline-flex items-center justify-center shrink-0 transition bg-white border border-[#5B7CFA]/15 text-[#5B7CFA] hover:bg-[#5B7CFA]/10 disabled:opacity-50"
                data-testid="followup-upload-btn"
              >
                {uploading ? <Loader2 size={20} className="animate-spin" /> : <Paperclip size={20} />}
              </button>
            </>
          )}

          {/* Mic */}
          {SR_OK && user?.role === "patient" && (
            <button
              onClick={listening ? stopListening : startListening}
              disabled={sending}
              className={`h-[56px] w-[56px] rounded-2xl inline-flex items-center justify-center shrink-0 transition ${listening ? "bg-[#E85A5A] text-white animate-pulse-soft" : "bg-white border border-[#5B7CFA]/15 text-[#5B7CFA] hover:bg-[#5B7CFA]/10"}`}
              data-testid="mic-btn"
              title={listening ? "Tap to stop" : `Speak in ${lang.label}`}
            >
              {listening ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
          )}

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={listening ? "Listening…" : user?.role === "patient" ? "Type or speak how you're feeling…" : "Type a message…"}
            className="flex-1 resize-none bg-white border border-[#5B7CFA]/15 rounded-2xl px-4 py-3 text-[14px] outline-none focus:border-[#5B7CFA]/40 transition"
            rows={2}
            data-testid="followup-input"
          />
          <button onClick={() => send()} disabled={sending || !input.trim()} className="btn-primary h-[56px] px-5 inline-flex items-center gap-2 shrink-0" data-testid="followup-send-btn">
            <Send size={16} /> Send
          </button>
        </div>
        <div className="text-[11px] mt-2" style={{ color: "#6B7595" }}>
          Care AI is not a substitute for emergency services. If you have chest pain, difficulty breathing, or severe symptoms — call 911 immediately.
        </div>
      </section>
    </div>
  );
}

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import {
  Sparkles, Send, Stethoscope, UserCircle2, CheckCircle2, Clock, Loader2,
  Pill, Edit3, Trash2, Plus, AlertTriangle, ShieldAlert, Heart, MessageCircle,
  Mic, MicOff, Volume2, VolumeX, Square, Play, Paperclip, Download, Globe, FileText, Image as ImageIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  startIntake, sendIntake, getConsultationSession, doctorJoinConsultation,
  sendLiveMessage, endConsultation, updatePrescription, finalizeConsultation,
  getConsultationByAppt, ttsSpeak, setConsultationLanguage, uploadConsultationFile, attachmentUrl,
  shareIntake,
} from "@/lib/api";
import { startSpeechRecognition, isSpeechSupported, speechSupportNote } from "@/lib/speech";

const LANGS = [
  { code: "en", label: "English", stt: "en-US" },
  { code: "hi", label: "हिंदी", stt: "hi-IN" },
  { code: "te", label: "తెలుగు", stt: "te-IN" },
  { code: "ta", label: "தமிழ்", stt: "ta-IN" },
];

const SR_OK = isSpeechSupported();

const URG_STYLES = {
  emergency: { bg: "#E85A5A", label: "EMERGENCY", icon: AlertTriangle },
  high: { bg: "#F2994A", label: "HIGH", icon: ShieldAlert },
  medium: { bg: "#5B7CFA", label: "MEDIUM", icon: Heart },
  low: { bg: "#3CC97C", label: "ROUTINE", icon: Heart },
};

function StatusPill({ status }) {
  const map = {
    intake: { label: "Care AI intake", bg: "#7C4DFF" },
    intake_complete: { label: "Awaiting your consent", bg: "#F2994A" },
    awaiting_doctor: { label: "Awaiting Dr. Lahari", bg: "#F2994A" },
    live: { label: "Live consultation", bg: "#3CC97C" },
    pending_rx: { label: "Doctor finalising Rx", bg: "#5B7CFA" },
    ended: { label: "Consultation complete", bg: "#6B7595" },
  };
  const s = map[status] || map.intake;
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider text-white" style={{ background: s.bg }}>
      <Clock size={10} /> {s.label}
    </span>
  );
}

function AttachmentCard({ a, isMine }) {
  const isImg = (a.content_type || "").startsWith("image/");
  const url = attachmentUrl(a.id);
  const sizeKB = a.size ? `${(a.size / 1024).toFixed(0)} KB` : "";
  return (
    <div className={`mt-1 rounded-xl overflow-hidden border ${isMine ? "border-white/30" : "border-[#5B7CFA]/20"}`} data-testid={`attachment-${a.id}`}>
      {isImg ? (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          <img src={url} alt={a.filename} className="max-w-[280px] max-h-[220px] object-contain bg-white" />
        </a>
      ) : null}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={`flex items-center gap-2 px-3 py-2 text-[13px] ${isMine ? "bg-white/10 text-white" : "bg-white text-[#0F1836]"} hover:opacity-90`}
      >
        {isImg ? <ImageIcon size={14} /> : <FileText size={14} />}
        <div className="flex-1 min-w-0 truncate">{a.filename}</div>
        <span className="text-[10.5px] opacity-70">{sizeKB}</span>
        <Download size={13} />
      </a>
    </div>
  );
}

function ListenButton({ text, size = 14 }) {
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef(null);
  const safeText = (text || "").trim();
  const stop = () => { try { audioRef.current?.pause(); } catch { /* noop */ } audioRef.current = null; setSpeaking(false); };
  const go = async () => {
    if (!safeText) return;
    if (speaking) { stop(); return; }
    try {
      setSpeaking(true);
      const blob = await ttsSpeak(safeText, "nova", 1.0);
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      audioRef.current = a;
      a.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
      a.onerror = () => { setSpeaking(false); URL.revokeObjectURL(url); };
      await a.play();
    } catch {
      setSpeaking(false);
    }
  };
  if (!safeText) return null;
  return (
    <button onClick={go} title={speaking ? "Stop" : "Listen"} className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border transition ${speaking ? "bg-[#7C4DFF] text-white border-transparent" : "bg-white/70 text-[#5B7CFA] border-[#5B7CFA]/20 hover:bg-[#5B7CFA]/10"}`} data-testid="listen-btn">
      {speaking ? <Square size={size-4} fill="currentColor" /> : <Play size={size-4} fill="currentColor" />} Listen
    </button>
  );
}

function MessageBubble({ m, currentRole, ttsEnabled }) {
  if (m.role === "system") {
    return <div className="text-center text-[11.5px] my-1" style={{ color: "#6B7595" }}>— {m.text} —</div>;
  }
  // Skip empty Care AI bubbles (e.g. AI emitted only an <INTAKE_READY> tag) —
  // pre-fix legacy data could still render an empty bubble; we just hide it.
  const hasText = (m.text || "").trim().length > 0;
  const hasAttachment = m.kind === "attachment" && m.attachment;
  if (!hasText && !hasAttachment) return null;
  const isMine = m.role === currentRole;
  const roleLabel = m.role === "care_ai" ? "Care AI" : m.role === "doctor" ? (m.sender_name || "Dr. Lahari") : "Patient";
  const bg = isMine
    ? "linear-gradient(135deg,#5B7CFA,#7C4DFF)"
    : m.role === "care_ai"
    ? "rgba(124,77,255,0.10)"
    : m.role === "doctor"
    ? "rgba(60,201,124,0.12)"
    : "rgba(255,255,255,0.8)";
  const color = isMine ? "#fff" : "#0F1836";
  const border = isMine ? "transparent" : m.role === "care_ai" ? "rgba(124,77,255,0.25)" : m.role === "doctor" ? "rgba(60,201,124,0.30)" : "rgba(255,255,255,1)";
  const Icon = m.role === "care_ai" ? Sparkles : m.role === "doctor" ? Stethoscope : UserCircle2;
  return (
    <div className={`flex ${isMine ? "justify-end" : "justify-start"} gap-2`} data-testid={`msg-${m.role}`}>
      {!isMine && (
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: m.role === "care_ai" ? "linear-gradient(135deg,#5B7CFA,#7C4DFF)" : m.role === "doctor" ? "#3CC97C" : "#B4BCD8" }}>
          <Icon size={14} className="text-white" />
        </div>
      )}
      <div className="max-w-[78%] rounded-2xl px-3.5 py-2.5" style={{ background: bg, color, border: `1px solid ${border}` }}>
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: isMine ? "rgba(255,255,255,0.75)" : "#6B7595" }}>{roleLabel}</div>
          {!isMine && m.role === "care_ai" && ttsEnabled && <ListenButton text={m.text} />}
        </div>
        {m.kind === "attachment" && m.attachment ? (
          <AttachmentCard a={m.attachment} isMine={isMine} />
        ) : (
          <div className="text-[14px] whitespace-pre-wrap leading-relaxed">{m.text}</div>
        )}
        <div className="text-[10px] mt-1" style={{ color: isMine ? "rgba(255,255,255,0.6)" : "#B4BCD8" }}>
          {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </div>
  );
}

export default function ConsultationSession() {
  const { user } = useAuth();
  const { sessionId: routeId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [session, setSession] = useState(null);
  const [sessionId, setSessionId] = useState(routeId);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef(null);
  const pollRef = useRef(null);
  const [joining, setJoining] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  // Multi-select chip choices for the most recent options message
  const [pickedOptions, setPickedOptions] = useState([]);
  const [otherText, setOtherText] = useState("");

  // Voice
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [listening, setListening] = useState(false);
  const [language, setLanguage] = useState("en");
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const spokenIdsRef = useRef(new Set());
  const speakingRef = useRef(false);

  const appointmentId = new URLSearchParams(location.search).get("appointment_id");

  // Bootstrap: if no sessionId, start intake from appointment_id
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (routeId) {
          const s = await getConsultationSession(routeId);
          if (mounted) { setSession(s); setSessionId(routeId); }
        } else if (appointmentId) {
          const existing = await getConsultationByAppt(appointmentId);
          if (existing && existing.id && existing.exists !== false) {
            if (mounted) { setSession(existing); setSessionId(existing.id); navigate(`/consult/${existing.id}`, { replace: true }); }
          } else {
            const s = await startIntake(appointmentId, language || "en");
            if (mounted) { setSession(s); setSessionId(s.id); navigate(`/consult/${s.id}`, { replace: true }); }
          }
        }
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Could not load consultation");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, appointmentId]);

  // Poll for new messages
  useEffect(() => {
    if (!sessionId) return;
    const id = setInterval(async () => {
      try {
        const s = await getConsultationSession(sessionId);
        setSession((prev) => {
          if (!prev) return s;
          // only update if changed (length or status)
          if (prev.messages?.length !== s.messages?.length || prev.status !== s.status) return s;
          return prev;
        });
      } catch { /* swallow */ }
    }, 3000);
    pollRef.current = id;
    return () => clearInterval(id);
  }, [sessionId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [session?.messages?.length]);

  // Auto-play latest Care AI message for patients (TTS)
  useEffect(() => {
    if (!session?.messages?.length || !ttsEnabled) return;
    if (user?.role !== "patient") return;
    const last = session.messages[session.messages.length - 1];
    if (!last || last.role !== "care_ai") return;
    const text = (last.text || "").trim();
    if (!text) return; // skip empty bubbles
    if (spokenIdsRef.current.has(last.id)) return;
    spokenIdsRef.current.add(last.id);
    (async () => {
      if (speakingRef.current) return;
      try {
        speakingRef.current = true;
        const blob = await ttsSpeak(text, "nova", 1.0);
        const url = URL.createObjectURL(blob);
        const a = new Audio(url);
        audioRef.current = a;
        a.onended = () => { speakingRef.current = false; URL.revokeObjectURL(url); };
        a.onerror = () => { speakingRef.current = false; URL.revokeObjectURL(url); };
        await a.play();
      } catch {
        speakingRef.current = false;
      }
    })();
  }, [session?.messages, ttsEnabled, user?.role]);

  // Cleanup on unmount
  useEffect(() => () => {
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
    try { audioRef.current?.pause(); } catch { /* noop */ }
  }, []);

  const stopSpeaking = () => {
    try { audioRef.current?.pause(); } catch { /* noop */ }
    audioRef.current = null;
    speakingRef.current = false;
  };

  const toggleTts = () => { if (ttsEnabled) stopSpeaking(); setTtsEnabled((v) => !v); };

  // Sync language from session when loaded
  useEffect(() => {
    if (session?.language && session.language !== language) setLanguage(session.language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.language]);

  const changeLanguage = async (code) => {
    setLanguage(code);
    if (sessionId) {
      try { await setConsultationLanguage(sessionId, code); } catch { /* noop */ }
    }
  };

  const startListening = () => {
    const lang = LANGS.find((l) => l.code === language) || LANGS[0];
    const note = speechSupportNote(lang.stt);
    if (note) { toast.error(note); return; }
    stopSpeaking();
    const handle = startSpeechRecognition({
      locale: lang.stt,
      baseValue: input,
      onUpdate: (next) => setInput(next),
      onError: (err) => {
        setListening(false);
        if (err === "language-not-supported-on-this-device") {
          toast.error("Voice input for this language isn't supported on this device — please type your message.");
        }
      },
      onEnd: () => setListening(false),
    });
    if (handle) {
      recognitionRef.current = handle;
      setListening(true);
    }
  };

  const stopListening = () => { try { recognitionRef.current?.stop(); } catch { /* noop */ } setListening(false); };

  const onPickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !sessionId) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("File too large (max 10MB)"); return; }
    setUploading(true);
    try {
      const res = await uploadConsultationFile(sessionId, file);
      setSession(res.session);
      toast.success(`Shared "${file.name}"`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const send = async (textOverride) => {
    // Guard: when this is wired to onClick={send}, React passes a SyntheticEvent
    // as the first arg. Only treat textOverride as content if it's actually a string.
    const overrideText = typeof textOverride === "string" ? textOverride : null;
    const text = ((overrideText ?? input) || "").trim();
    if (!text || sending || !session) return;
    if (overrideText === null) { setInput(""); stopListening(); }
    setPickedOptions([]); setOtherText("");
    setSending(true);
    try {
      if (session.status === "intake" && user.role === "patient") {
        const res = await sendIntake(session.id, text);
        setSession(res.session);
        if (res.alert?.urgency === "emergency") toast.error("⚠️ EMERGENCY — Dr. Lahari has been alerted.");
        else if (res.session.status === "intake_complete") {
          toast.success("Intake complete — we just need your consent to share with the doctor.");
          setConsentOpen(true);
        } else if (res.session.status === "awaiting_doctor") {
          toast.success("Intake complete — summary sent to Dr. Lahari.");
        }
      } else if (session.status === "live") {
        const res = await sendLiveMessage(session.id, text);
        setSession(res.session);
      } else {
        toast.error(
          session.status === "awaiting_doctor"
            ? "Consultation hasn't started yet. Waiting for the doctor to start it."
            : session.status === "intake_complete"
            ? "Please share the summary with the doctor below to start the consultation."
            : "Chat is closed for this consultation."
        );
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not send");
      if (overrideText === null) setInput(text);
    } finally {
      setSending(false);
    }
  };

  const submitChipSelection = () => {
    const parts = [];
    if (pickedOptions.length) parts.push(pickedOptions.join(", "));
    if (otherText.trim()) parts.push(`Other: ${otherText.trim()}`);
    if (parts.length === 0) { toast.error("Pick an option or add a custom answer"); return; }
    send(parts.join(". "));
  };

  const doShareIntake = async () => {
    setSharing(true);
    try {
      const res = await shareIntake(session.id);
      setSession(res.session);
      setConsentOpen(false);
      toast.success("Shared with Dr. Lahari — they'll start the consultation soon.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not share");
    } finally {
      setSharing(false);
    }
  };

  const doctorJoin = async () => {
    setJoining(true);
    try {
      const s = await doctorJoinConsultation(session.id);
      setSession(s);
      toast.success("Joined live consultation");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not join");
    } finally {
      setJoining(false);
    }
  };

  const doctorEnd = async () => {
    if (!window.confirm("End the consultation? Care AI will draft the summary and prescription.")) return;
    try {
      const s = await endConsultation(session.id);
      setSession(s);
      toast.success("Consultation ended — review prescription below.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not end");
    }
  };

  const doctorFinalize = async () => {
    try {
      const s = await finalizeConsultation(session.id);
      setSession(s);
      toast.success("Prescription finalised — sent to patient.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not finalise");
    }
  };

  if (loading) return <div className="glass-card animate-pulse-soft" data-testid="consult-loading">Loading consultation…</div>;
  if (!session) return <div className="glass-card" data-testid="consult-missing">Consultation not found. <button className="text-[#5B7CFA] underline" onClick={() => navigate(-1)}>Back</button></div>;

  const role = user.role === "patient" ? "patient" : "doctor";
  const urg = session.intake_summary?.urgency && URG_STYLES[session.intake_summary.urgency];
  // Chat policy:
  // - intake → only patient may type (Care AI intake)
  // - intake_complete → CHAT LOCKED (waiting for patient to consent to share)
  // - awaiting_doctor → CHAT LOCKED (intake summary only). Doctor must click "Start consultation" first.
  // - live → both can type (real-time consultation)
  // - pending_rx / ended → CHAT LOCKED (read-only summary + Rx)
  const canType = (session.status === "intake" && role === "patient") || session.status === "live";
  const lastAi = (session.messages || []).slice().reverse().find((m) => m.role === "care_ai");
  const showOptionChips = canType && session.status === "intake" && role === "patient" && lastAi?.options?.length > 0;

  return (
    <div className="flex flex-col gap-4 animate-fade-up" data-testid="consult-session-page">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}>
            <Stethoscope size={20} className="text-white" />
          </div>
          <div>
            <h1 className="font-display font-bold text-[22px] leading-tight" style={{ color: "#0F1836" }}>
              Consultation · {session.patient_name || "Patient"}
            </h1>
            <div className="text-[12.5px] mt-0.5 flex items-center gap-2 flex-wrap">
              <StatusPill status={session.status} />
              {urg && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full text-white" style={{ background: urg.bg }}>
                  <urg.icon size={10} /> {urg.label}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Language selector */}
          <div className="flex items-center gap-1.5 glass-pill px-3 py-1.5" data-testid="consult-lang">
            <Globe size={14} className="text-[#5B7CFA]" />
            <select
              value={language}
              onChange={(e) => changeLanguage(e.target.value)}
              className="bg-transparent outline-none text-[13px] font-semibold cursor-pointer"
              style={{ color: "#0F1836" }}
              data-testid="consult-lang-select"
            >
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </div>
          {/* Voice toggle — visible to everyone */}
          <button
            onClick={toggleTts}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition ${ttsEnabled ? "bg-[#5B7CFA] text-white" : "bg-white/70 text-[#6B7595] hover:bg-white"}`}
            title={ttsEnabled ? "Voice replies ON" : "Voice replies OFF"}
            data-testid="consult-tts-toggle"
          >
            {ttsEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
          {role === "doctor" && ["intake", "awaiting_doctor"].includes(session.status) && (
            <button onClick={doctorJoin} disabled={joining || session.status === "intake"} className="btn-primary inline-flex items-center gap-2" data-testid="doctor-join-btn" title={session.status === "intake" ? "Wait for patient to finish intake" : "Start the live consultation"}>
              <Sparkles size={14} /> {joining ? "Starting…" : "Start consultation"}
            </button>
          )}
          {role === "doctor" && session.status === "live" && (
            <button onClick={doctorEnd} className="btn-ghost inline-flex items-center gap-2" data-testid="doctor-end-btn">
              <CheckCircle2 size={14} /> End consultation
            </button>
          )}
        </div>
      </header>

      {/* Intake summary card (visible to doctor once intake is done, or to patient once doctor joined) */}
      {session.intake_summary && role === "doctor" && (
        <section className="glass-card" data-testid="intake-summary-card">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={16} className="text-[#7C4DFF]" />
            <div className="font-display font-bold text-[16px]" style={{ color: "#0F1836" }}>Care AI intake summary</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <KV k="Chief complaint" v={session.intake_summary.chief_complaint} />
            <KV k="Urgency" v={session.intake_summary.urgency} />
            <div className="md:col-span-2">
              <KV k="HPI" v={session.intake_summary.hpi} />
            </div>
            {session.intake_summary.red_flags?.length > 0 && (
              <div className="md:col-span-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "#E85A5A" }}>Red flags</div>
                <div className="flex flex-wrap gap-1.5">
                  {session.intake_summary.red_flags.map((rf, i) => (
                    <span key={i} className="text-[11.5px] px-2 py-1 rounded-full bg-[#E85A5A]/10 text-[#E85A5A] font-medium">{rf}</span>
                  ))}
                </div>
              </div>
            )}
            {session.intake_summary.summary_for_doctor && (
              <div className="md:col-span-2 text-[13px]" style={{ color: "#2A3558" }}>
                <span className="font-semibold">Handoff:</span> {session.intake_summary.summary_for_doctor}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Chat window */}
      <section className="glass-card flex flex-col" style={{ minHeight: "45vh" }} data-testid="consult-chat">
        <div ref={scrollRef} className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2.5 mb-3" style={{ maxHeight: "50vh" }} data-testid="consult-messages">
          {(session.messages || []).map((m) => (
            <MessageBubble key={m.id} m={m} currentRole={role} ttsEnabled={ttsEnabled} />
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-white/80 border border-white rounded-2xl px-3 py-2 text-[12.5px] inline-flex items-center gap-2" style={{ color: "#6B7595" }}>
                <Loader2 size={12} className="animate-spin" /> Sending…
              </div>
            </div>
          )}
        </div>

        {showOptionChips && (
          <div className="mb-2 flex flex-col gap-2" data-testid="intake-options">
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>
              {lastAi.multi ? "Pick all that apply" : "Pick one"}
            </div>
            <div className="flex flex-wrap gap-2">
              {lastAi.options.map((opt) => {
                const picked = pickedOptions.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      if (lastAi.multi) {
                        setPickedOptions((p) => p.includes(opt) ? p.filter((x) => x !== opt) : [...p, opt]);
                      } else {
                        // Single-select → submit immediately
                        send(opt);
                      }
                    }}
                    className={`px-3 py-2 rounded-full text-[13px] font-semibold border transition ${picked ? "bg-gradient-to-r from-[#5B7CFA] to-[#7C4DFF] text-white border-transparent" : "bg-white border-[#5B7CFA]/20 text-[#2A3558] hover:border-[#5B7CFA]/50"}`}
                    data-testid={`intake-option-${opt.replace(/\s+/g, '-').toLowerCase()}`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <input
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                placeholder="Other (custom answer) — optional"
                className="flex-1 bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-2.5 text-[13px] outline-none"
                data-testid="intake-option-other"
              />
              {lastAi.multi && (
                <button
                  type="button"
                  onClick={submitChipSelection}
                  disabled={sending || (pickedOptions.length === 0 && !otherText.trim())}
                  className="btn-primary text-[13px] px-4"
                  data-testid="intake-options-submit"
                >
                  Send selection
                </button>
              )}
            </div>
          </div>
        )}

        {canType ? (
          <div className="flex items-end gap-2" data-testid="consult-composer">
            <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" className="hidden" onChange={onPickFile} data-testid="consult-file-input" />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading || sending}
              title="Attach file"
              className="h-[56px] w-[56px] rounded-2xl inline-flex items-center justify-center shrink-0 bg-white border border-[#5B7CFA]/15 text-[#5B7CFA] hover:bg-[#5B7CFA]/10 transition"
              data-testid="consult-attach-btn"
            >
              {uploading ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} />}
            </button>
            {SR_OK && (
              <button
                onClick={listening ? stopListening : startListening}
                disabled={sending}
                className={`h-[56px] w-[56px] rounded-2xl inline-flex items-center justify-center shrink-0 transition ${listening ? "bg-[#E85A5A] text-white animate-pulse-soft" : "bg-white border border-[#5B7CFA]/15 text-[#5B7CFA] hover:bg-[#5B7CFA]/10"}`}
                data-testid="consult-mic-btn"
                title={listening ? "Stop" : `Speak (${LANGS.find((l) => l.code === language)?.label || "English"})`}
              >
                {listening ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
            )}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={
                session.status === "intake"
                  ? "Tell Care AI what's going on…"
                  : role === "doctor"
                  ? "Speak to the patient… tip: type @CareAI for clinical help"
                  : "Type a message to Dr. Lahari…"
              }
              className="flex-1 resize-none bg-white border border-[#5B7CFA]/15 rounded-2xl px-4 py-3 text-[14px] outline-none focus:border-[#5B7CFA]/40"
              rows={2}
              data-testid="consult-input"
            />
            <button onClick={send} disabled={sending || !input.trim()} className="btn-primary h-[56px] px-5 inline-flex items-center gap-2 shrink-0" data-testid="consult-send-btn">
              <Send size={16} /> Send
            </button>
          </div>
        ) : (
          <div className="text-[12.5px] p-3 rounded-2xl text-center" style={{ background: "#5B7CFA10", color: "#2A3558" }} data-testid="consult-readonly-notice">
            {session.status === "intake_complete" && role === "patient" ? (
              <div className="flex flex-col items-center gap-2">
                <span>Care AI has prepared your summary. Review the snapshot above, then share it with the doctor.</span>
                <button
                  onClick={() => setConsentOpen(true)}
                  className="btn-primary inline-flex items-center gap-2 text-[12.5px]"
                  data-testid="share-with-doctor-btn"
                >
                  <Sparkles size={14} /> Share with Dr. Lahari
                </button>
              </div>
            ) : session.status === "intake_complete" ? (
              "Patient is reviewing the intake summary before sharing it with you."
            ) : session.status === "awaiting_doctor"
              ? (role === "patient" ? "Your intake is done. Dr. Lahari has been notified — chat will open the moment the doctor starts the consultation." : "Patient intake ready. Click 'Start consultation' above to open the chat.")
              : session.status === "pending_rx"
              ? "Consultation chat has ended. Doctor is finalising the prescription below."
              : "Consultation complete. See the summary & prescription below."}
          </div>
        )}
      </section>

      {/* Post-consultation: prescription editor (doctor) / readout (patient).
          A1: Patient sees Rx ONLY after doctor finalizes (status=ended).
              Doctor sees the editor in pending_rx + ended. */}
      {((role === "doctor" && ["pending_rx", "ended"].includes(session.status)) ||
        (role === "patient" && session.status === "ended")) && (
        <PrescriptionPanel session={session} role={role} onChange={setSession} onFinalize={doctorFinalize} />
      )}

      {/* Post-consultation: summaries — patient also gated until finalized */}
      {session.summary && !(role === "patient" && session.status !== "ended") && (
        <section className="glass-card" data-testid="consult-summary">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <div className="flex items-center gap-2">
              <MessageCircle size={16} className="text-[#5B7CFA]" />
              <div className="font-display font-bold text-[16px]" style={{ color: "#0F1836" }}>
                {role === "patient" ? "Your visit summary" : "Clinical note"}
              </div>
            </div>
            <ListenButton text={role === "patient" ? (session.summary.patient_summary || "") : (session.summary.doctor_summary || "")} />
          </div>
          <div className="text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{ color: "#2A3558" }}>
            {role === "patient" ? session.summary.patient_summary : session.summary.doctor_summary}
          </div>
          {session.summary.follow_up && (
            <div className="mt-3 glass-soft p-3 text-[13px]" style={{ color: "#0F1836" }}>
              <span className="font-semibold">Follow-up:</span> {session.summary.follow_up}
            </div>
          )}
          {session.summary.red_flags_to_watch?.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "#E85A5A" }}>Watch for</div>
              <ul className="list-disc list-inside text-[13px]" style={{ color: "#2A3558" }}>
                {session.summary.red_flags_to_watch.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
          {session.status === "ended" && role === "patient" && (
            <div className="mt-4 flex justify-end">
              <button onClick={() => navigate("/followup")} className="btn-ghost inline-flex items-center gap-2 text-[13px]" data-testid="after-followup-btn">
                <Sparkles size={13} /> Ask Care AI a follow-up question
              </button>
            </div>
          )}
        </section>
      )}

      {/* Consent dialog — patient signs off on sharing intake with the doctor */}
      {consentOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 animate-fade-up"
          style={{ background: "rgba(15,24,54,0.45)", backdropFilter: "blur(8px)" }}
          onClick={() => !sharing && setConsentOpen(false)}
          data-testid="consent-backdrop"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-card w-full max-w-[480px] flex flex-col gap-4"
            data-testid="consent-modal"
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-[#5B7CFA]/15 flex items-center justify-center">
                <ShieldAlert size={20} className="text-[#5B7CFA]" />
              </div>
              <div>
                <div className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>Share with your doctor?</div>
                <div className="text-[12.5px]" style={{ color: "#6B7595" }}>One-time consent before handoff</div>
              </div>
            </div>
            <div className="text-[13.5px] leading-relaxed" style={{ color: "#2A3558" }}>
              Care AI will share the summary you and Care AI built — your symptoms, timeline,
              severity, and any context you added — with <span className="font-semibold">Dr. Lahari</span>.
              <br /><br />
              <span className="font-semibold">This information is encrypted and shared only with the doctor.</span>
              No third parties, no marketing.
            </div>
            {session.intake_summary?.summary_for_doctor && (
              <div className="glass-soft p-3 text-[12.5px]" style={{ color: "#2A3558" }} data-testid="consent-summary-preview">
                <div className="text-[10.5px] font-semibold uppercase tracking-wider mb-1" style={{ color: "#6B7595" }}>What the doctor will see</div>
                {session.intake_summary.summary_for_doctor}
              </div>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setConsentOpen(false)}
                disabled={sharing}
                className="btn-ghost text-[13px]"
                data-testid="consent-cancel-btn"
              >Not yet</button>
              <button
                onClick={doShareIntake}
                disabled={sharing}
                className="btn-primary inline-flex items-center gap-2 text-[13px]"
                data-testid="consent-confirm-btn"
              >
                {sharing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {sharing ? "Sharing…" : "Share with Dr. Lahari"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>{k}</div>
      <div className="text-[13.5px] font-medium" style={{ color: "#0F1836" }}>{v || "—"}</div>
    </div>
  );
}

function PrescriptionPanel({ session, role, onChange, onFinalize }) {
  const [items, setItems] = useState(session.prescription_final || session.prescription_ai || []);
  const [notes, setNotes] = useState(session.doctor_notes || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setItems(session.prescription_final || session.prescription_ai || []);
    setNotes(session.doctor_notes || "");
  }, [session.id, session.prescription_final, session.prescription_ai]);

  const editable = role === "doctor" && session.status === "pending_rx";

  const update = (i, k, v) => setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const remove = (i) => setItems((arr) => arr.filter((_, idx) => idx !== i));
  const addBlank = () => setItems((arr) => [...arr, { medication: "", dose: "", frequency: "", duration: "", instructions: "", reason: "" }]);
  const restoreAI = () => setItems(session.prescription_ai || []);
  const clearAll = () => setItems([]);

  const save = async () => {
    setSaving(true);
    try {
      const s = await updatePrescription(session.id, items, notes);
      onChange(s);
      toast.success("Prescription saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const ended = session.status === "ended";
  const display = ended ? (session.prescription_final || []) : items;

  return (
    <section className="glass-card" data-testid="rx-panel">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <Pill size={16} className="text-[#28A55B]" />
          <div className="font-display font-bold text-[16px]" style={{ color: "#0F1836" }}>
            {ended ? "Final prescription" : role === "doctor" ? "Care AI prescription draft — review & finalise" : "Prescription (awaiting doctor)"}
          </div>
        </div>
        {editable && (
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={restoreAI} className="btn-ghost text-[11.5px] py-1.5 px-3" data-testid="rx-restore-ai">Restore AI draft</button>
            <button onClick={clearAll} className="btn-ghost text-[11.5px] py-1.5 px-3" data-testid="rx-clear">Clear all</button>
            <button onClick={addBlank} className="btn-ghost text-[11.5px] py-1.5 px-3 inline-flex items-center gap-1" data-testid="rx-add"><Plus size={11} /> Add</button>
          </div>
        )}
      </div>

      {display.length === 0 && (
        <div className="glass-soft p-4 text-center text-[13px]" style={{ color: "#6B7595" }} data-testid="rx-empty">
          {editable ? "No medications. Add one, or finalise with zero meds." : "No medications prescribed."}
        </div>
      )}

      <div className="flex flex-col gap-2.5" data-testid="rx-items">
        {display.map((it, i) => (
          <div key={i} className="glass-soft p-3 grid grid-cols-1 md:grid-cols-5 gap-2" data-testid={`rx-item-${i}`}>
            {editable ? (
              <>
                <input placeholder="Medication" value={it.medication} onChange={(e) => update(i, "medication", e.target.value)} className="col-span-1 bg-white border border-[#5B7CFA]/15 rounded-xl px-3 py-2 text-[13px] outline-none" data-testid={`rx-med-${i}`} />
                <input placeholder="Dose" value={it.dose} onChange={(e) => update(i, "dose", e.target.value)} className="bg-white border border-[#5B7CFA]/15 rounded-xl px-3 py-2 text-[13px] outline-none" />
                <input placeholder="Frequency" value={it.frequency} onChange={(e) => update(i, "frequency", e.target.value)} className="bg-white border border-[#5B7CFA]/15 rounded-xl px-3 py-2 text-[13px] outline-none" />
                <input placeholder="Duration" value={it.duration} onChange={(e) => update(i, "duration", e.target.value)} className="bg-white border border-[#5B7CFA]/15 rounded-xl px-3 py-2 text-[13px] outline-none" />
                <div className="flex gap-2">
                  <input placeholder="Instructions" value={it.instructions} onChange={(e) => update(i, "instructions", e.target.value)} className="flex-1 bg-white border border-[#5B7CFA]/15 rounded-xl px-3 py-2 text-[13px] outline-none" />
                  <button onClick={() => remove(i)} className="w-9 h-9 rounded-xl bg-white hover:bg-[#E85A5A]/10 flex items-center justify-center" data-testid={`rx-remove-${i}`}><Trash2 size={13} className="text-[#E85A5A]" /></button>
                </div>
              </>
            ) : (
              <div className="col-span-5">
                <div className="font-semibold text-[14px]" style={{ color: "#0F1836" }}>{it.medication || "—"} <span className="font-normal text-[12.5px]" style={{ color: "#5B7CFA" }}>{it.dose}</span></div>
                <div className="text-[12.5px]" style={{ color: "#6B7595" }}>{[it.frequency, it.duration].filter(Boolean).join(" · ")}</div>
                {it.instructions && <div className="text-[12.5px]" style={{ color: "#2A3558" }}>{it.instructions}</div>}
                {it.reason && <div className="text-[11.5px] mt-0.5" style={{ color: "#6B7595" }}>Why: {it.reason}</div>}
              </div>
            )}
          </div>
        ))}
      </div>

      {editable && (
        <>
          <label className="flex flex-col gap-1 mt-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>Doctor notes (optional)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="bg-white border border-[#5B7CFA]/15 rounded-2xl px-3 py-2 text-[13px] outline-none" data-testid="rx-doctor-notes" />
          </label>
          <div className="flex items-center justify-end gap-2 mt-3">
            <button onClick={save} disabled={saving} className="btn-ghost inline-flex items-center gap-2" data-testid="rx-save">
              <Edit3 size={13} /> {saving ? "Saving…" : "Save draft"}
            </button>
            <button onClick={async () => { await save(); await onFinalize(); }} className="btn-primary inline-flex items-center gap-2" data-testid="rx-finalize">
              <CheckCircle2 size={14} /> Finalise & send to patient
            </button>
          </div>
        </>
      )}
    </section>
  );
}

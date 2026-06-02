import { useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, Sparkles, AlertTriangle, Upload, X, Info, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { transcribeAudio, classifySpeaker } from "@/lib/api";

/**
 * VoiceRecorder
 * - Live preview via Web Speech API (best-effort, browser-only)
 * - MediaRecorder captures audio → uploaded to OpenAI Whisper for final transcript
 * - Robust permission handling + upload-audio-file fallback
 */
export default function VoiceRecorder({ onTranscript }) {
  const [isRecording, setIsRecording] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [permState, setPermState] = useState("unknown"); // unknown | prompt | granted | denied | unsupported
  const [showHelp, setShowHelp] = useState(false);
  const [lastSpeaker, setLastSpeaker] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const recognitionRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const timerRef = useRef(null);
  const segmentsRef = useRef([]);
  const recordingRef = useRef(false);
  const uploadInputRef = useRef(null);

  // Initial capability probe
  useEffect(() => {
    const check = async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setPermState("unsupported");
        return;
      }
      try {
        if (navigator.permissions && navigator.permissions.query) {
          const res = await navigator.permissions.query({ name: "microphone" });
          setPermState(res.state);
          res.onchange = () => setPermState(res.state);
        } else {
          setPermState("prompt");
        }
      } catch {
        setPermState("prompt");
      }
    };
    check();
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cleanup = () => {
    recordingRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const start = async () => {
    if (permState === "unsupported") {
      setShowHelp(true);
      toast.error("Browser does not support microphone recording");
      return;
    }
    if (permState === "denied") {
      setShowHelp(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      streamRef.current = stream;
      setPermState("granted");

      // Analyser for waveform
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        setLevel(Math.min(100, (sum / data.length) * 1.2));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      // MediaRecorder
      const mime = pickSupportedMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data && e.data.size > 0 && chunksRef.current.push(e.data);
      mr.onstop = handleStop;
      mr.start(500);
      mediaRecorderRef.current = mr;

      // Live transcription via Web Speech API (best-effort; not available in Safari)
      segmentsRef.current = [];
      setLiveText("");
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        const rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = "en-US";
        rec.onresult = async (ev) => {
          let interim = "";
          let finalText = "";
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const r = ev.results[i];
            if (r.isFinal) finalText += r[0].transcript + " ";
            else interim += r[0].transcript;
          }
          if (finalText.trim()) {
            // Auto-detect speaker from content
            let spk = "Dr";
            try {
              const cls = await classifySpeaker(finalText.trim());
              spk = cls.speaker || "Dr";
              setLastSpeaker({ speaker: spk, confidence: cls.confidence });
            } catch { /* fallback keeps Dr */ }
            segmentsRef.current.push({ speaker: spk, text: finalText.trim() });
          }
          const combined = segmentsRef.current.map((s) => `${s.speaker}: ${s.text}`).join("\n");
          const interimSpeaker = lastSpeaker?.speaker || "Dr";
          setLiveText(combined + (interim ? `\n${interimSpeaker}: ${interim}` : ""));
        };
        rec.onerror = (e) => console.warn("Speech API error:", e.error);
        rec.onend = () => { if (recordingRef.current) { try { rec.start(); } catch {} } };
        try { rec.start(); recognitionRef.current = rec; } catch (err) {
          console.warn("SpeechRecognition start failed:", err);
        }
      } else {
        setLiveText("(Live preview not supported in this browser — Whisper will produce the final transcript.)");
      }

      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);

      recordingRef.current = true;
      setIsRecording(true);
    } catch (err) {
      console.error("getUserMedia error:", err);
      handleMicError(err);
    }
  };

  const handleMicError = (err) => {
    const name = err?.name || "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      setPermState("denied");
      setShowHelp(true);
    } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      toast.error("No microphone detected on this device");
      setPermState("unsupported");
      setShowHelp(true);
    } else if (name === "NotReadableError" || name === "TrackStartError") {
      toast.error("Microphone is in use by another app. Close other apps and try again.");
    } else if (name === "AbortError") {
      toast.info("Recording dismissed");
    } else {
      toast.error(`Microphone error: ${err?.message || name || "unknown"}`);
    }
    cleanup();
  };

  const stop = () => {
    setIsRecording(false);
    recordingRef.current = false;
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {}; recognitionRef.current = null; }
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
  };

  const handleStop = async () => {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch {} }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const mr = mediaRecorderRef.current;
    const mime = mr?.mimeType || "audio/webm";
    const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm";
    const blob = new Blob(chunksRef.current, { type: mime });
    if (blob.size < 2000) {
      toast.warning("Recording too short — please try again");
      return;
    }
    await uploadBlob(blob, `consultation_${Date.now()}.${ext}`);
  };

  const uploadBlob = async (blob, filename) => {
    setUploading(true);
    try {
      const res = await transcribeAudio(blob, filename);
      let finalText = res.text || "";
      if (segmentsRef.current.length > 0 && /^(Dr|Patient):/m.test(liveText)) {
        finalText = liveText.replace(/\n\w+:\s*$/, "").trim() + "\n\n--- Whisper transcript ---\n" + finalText;
      }
      onTranscript && onTranscript({ text: finalText, whisper: res.text, duration: res.duration, source: "whisper" });
      toast.success("Transcript ready");
    } catch (e) {
      console.error(e);
      const msg = e?.response?.data?.detail || "Transcription failed";
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  const onUploadFile = async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    const ok = ["audio/", "video/mp4", "video/webm", "video/mpeg"].some((p) => file.type.startsWith(p));
    if (!ok && !/\.(mp3|mp4|m4a|wav|webm|mpeg|mpga|ogg)$/i.test(file.name)) {
      toast.error("Please select an audio file (mp3, m4a, wav, webm, mp4)");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error("File too large (max 25 MB)");
      return;
    }
    await uploadBlob(file, file.name);
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  const denied = permState === "denied" || permState === "unsupported";

  return (
    <div className="glass-card" data-testid="voice-recorder">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] flex items-center justify-center">
            <Sparkles className="text-white" size={16} />
          </div>
          <div>
            <div className="font-display font-bold text-[17px]" style={{ color: "#0F1836" }}>AI Voice Capture</div>
            <div className="text-[11px]" style={{ color: "#6B7595" }}>Web Speech (live) + Whisper (final) · AI speaker detection</div>
          </div>
        </div>

        {lastSpeaker && (
          <div className="glass-soft px-3 py-1.5 inline-flex items-center gap-2 text-xs font-semibold" data-testid="speaker-indicator">
            <Wand2 size={12} className="text-[#5B7CFA]" />
            <span style={{ color: lastSpeaker.speaker === "Dr" ? "#5B7CFA" : "#7C4DFF" }}>
              {lastSpeaker.speaker === "Dr" ? "Doctor detected" : "Patient detected"}
            </span>
            <span className="text-[10px]" style={{ color: "#6B7595" }}>{Math.round((lastSpeaker.confidence || 0) * 100)}%</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        {!isRecording ? (
          <button onClick={start} disabled={uploading} className="btn-primary inline-flex items-center gap-2" data-testid="voice-start">
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
            {uploading ? "Transcribing with Whisper…" : "Start Recording"}
          </button>
        ) : (
          <button onClick={stop} className="btn-primary inline-flex items-center gap-2" style={{ background: "linear-gradient(135deg,#E85A5A,#C94747)" }} data-testid="voice-stop">
            <Square size={15} fill="currentColor" /> Stop Recording
          </button>
        )}

        {/* Upload fallback */}
        <button
          onClick={() => uploadInputRef.current?.click()}
          disabled={uploading || isRecording}
          className="btn-ghost inline-flex items-center gap-2"
          data-testid="voice-upload-btn"
          title="Upload an audio file for Whisper transcription"
        >
          <Upload size={15} /> Upload Audio
        </button>
        <input ref={uploadInputRef} type="file" accept="audio/*,.mp3,.m4a,.wav,.webm,.mp4,.ogg" className="hidden" onChange={onUploadFile} data-testid="voice-file-input" />

        {/* Status + waveform */}
        <div className="flex items-center gap-3 flex-1 min-w-[240px]">
          {isRecording && (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: "#E85A5A" }} data-testid="rec-indicator">
              <span className="w-2.5 h-2.5 rounded-full bg-[#E85A5A] animate-pulse" /> REC {mm}:{ss}
            </span>
          )}
          <div className="flex-1 h-10 flex items-center gap-[3px]" data-testid="waveform">
            {Array.from({ length: 48 }).map((_, i) => {
              const h = isRecording ? Math.max(6, (level / 100) * 40 * (0.5 + Math.sin((i + elapsed * 8) / 3) * 0.5 + 0.5)) : 6;
              return <span key={i} className="w-[3px] rounded-full" style={{ height: `${h}px`, background: isRecording ? "linear-gradient(180deg,#5B7CFA,#7C4DFF)" : "rgba(91,124,250,0.25)", transition: "height 0.1s" }} />;
            })}
          </div>
        </div>
      </div>

      {/* Permission info panel (shown when denied or when user toggled help) */}
      {(denied || showHelp) && (
        <div className="mt-5 glass-soft p-4 border" style={{ background: "rgba(245,166,35,0.08)", borderColor: "rgba(245,166,35,0.3)" }} data-testid="mic-help">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#F5A623]/15 flex items-center justify-center shrink-0">
              <AlertTriangle size={16} className="text-[#C77800]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                <div className="font-semibold text-[14px]" style={{ color: "#0F1836" }}>
                  {permState === "unsupported"
                    ? "Microphone not supported"
                    : permState === "denied"
                    ? "Microphone blocked for this site"
                    : "How to enable your microphone"}
                </div>
                <button onClick={() => setShowHelp(false)} className="w-7 h-7 rounded-full hover:bg-white/60 flex items-center justify-center"><X size={13} /></button>
              </div>
              <div className="text-[13px] leading-relaxed" style={{ color: "#2A3558" }}>
                {permState === "unsupported" ? (
                  <>Your browser or device doesn't expose a microphone. You can still use <strong>Upload Audio</strong> to send a file to Whisper, or paste/type the conversation in the textarea below.</>
                ) : (
                  <>
                    <div className="mb-2">Your browser is blocking the mic for this site. To enable it:</div>
                    <SafariIos />
                    <ChromeEdge />
                    <FirefoxHint />
                    <div className="mt-3">Or, simply use <strong>Upload Audio</strong> to send a pre-recorded file — Whisper will transcribe it.</div>
                  </>
                )}
              </div>
              {permState === "denied" && (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => { setShowHelp(false); setPermState("prompt"); setTimeout(start, 50); }} className="btn-ghost text-xs" data-testid="mic-retry">
                    I've enabled it — Retry
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Subtle "why do I need this?" link when granted/prompt */}
      {!denied && !showHelp && (
        <button onClick={() => setShowHelp(true)} className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: "#6B7595" }}>
          <Info size={11} /> Mic not working?
        </button>
      )}

      {(liveText || uploading) && (
        <div className="mt-5 glass-soft p-4 max-h-[220px] overflow-y-auto" data-testid="live-transcript">
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "#6B7595" }}>
            {uploading ? "Finalizing with Whisper…" : "Live transcript"}
          </div>
          <pre className="whitespace-pre-wrap text-[13.5px] leading-relaxed" style={{ color: "#2A3558", fontFamily: "Inter" }}>
            {liveText || "…"}
          </pre>
        </div>
      )}
    </div>
  );
}

function pickSupportedMime() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  if (typeof MediaRecorder === "undefined") return null;
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return null;
}

function SafariIos() {
  return (
    <div className="mb-1.5">
      <span className="font-semibold">Safari:</span> Safari menu → <em>Settings for patient-care-121.preview.emergentagent.com</em> → Microphone → <strong>Allow</strong>. Then refresh the page.
    </div>
  );
}
function ChromeEdge() {
  return (
    <div className="mb-1.5">
      <span className="font-semibold">Chrome / Edge:</span> Click the 🔒 <em>site info</em> icon in the address bar → Site settings → <strong>Microphone: Allow</strong>. Then refresh.
    </div>
  );
}
function FirefoxHint() {
  return (
    <div>
      <span className="font-semibold">Firefox:</span> 🔒 icon → Connection secure → More information → Permissions → uncheck "Use microphone: Block".
    </div>
  );
}

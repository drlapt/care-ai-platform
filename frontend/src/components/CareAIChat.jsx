import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, Loader2, UserCircle2, Check } from "lucide-react";
import { careAIStart, careAIMessage, careAIHistory } from "@/lib/api";
import CareAISummaryCard from "@/components/CareAISummaryCard";

/**
 * Conversational Care AI onboarding — gathers medical history via chat.
 * Props:
 *   - patient: patient object (id, personal_info)
 *   - onComplete({ handoff, profile_update }) — called when Care AI finalizes
 */
export default function CareAIChat({ patient, onComplete, autoStart = true }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [handoff, setHandoff] = useState(null);
  const [urgency, setUrgency] = useState(null);
  const [handoffDoctor, setHandoffDoctor] = useState(null);
  const [redFlags, setRedFlags] = useState([]);
  const scrollRef = useRef(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (!patient?.id || !autoStart || initRef.current) return;
    initRef.current = true;
    (async () => {
      setBusy(true);
      try {
        const existing = await careAIHistory(patient.id);
        if (existing.length > 0) {
          setMessages(existing);
        } else {
          const res = await careAIStart(patient.id);
          setMessages([res.message]);
        }
      } catch (e) { console.error(e); }
      finally { setBusy(false); }
    })();
  }, [patient, autoStart]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  const send = async (e) => {
    e?.preventDefault?.();
    const text = input.trim();
    if (!text || busy || done) return;
    setInput("");
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", text, created_at: new Date().toISOString() }]);
    setBusy(true);
    try {
      const res = await careAIMessage(patient.id, text);
      setMessages((m) => [...m, res.message]);
      if (res.done) {
        setDone(true);
        setHandoff(res.handoff);
        setUrgency(res.urgency || "medium");
        setHandoffDoctor(res.handoff_doctor || res.profile_update?.handoff_doctor);
        setRedFlags((res.handoff_doctor || res.profile_update?.handoff_doctor)?.red_flags || res.profile_update?.red_flags || []);
        onComplete && onComplete({ handoff: res.handoff, profile_update: res.profile_update });
      }
    } catch (err) {
      console.error(err);
      setMessages((m) => [...m, { id: `e-${Date.now()}`, role: "assistant", text: "Sorry, I had trouble with that. Could you rephrase?", created_at: new Date().toISOString() }]);
    } finally {
      setBusy(false);
    }
  };

  const first = patient?.personal_info?.name?.split(" ")[0] || "there";

  return (
    <div className="flex flex-col gap-4" data-testid="care-ai-root">
      {done && handoffDoctor && (
        <CareAISummaryCard urgency={urgency} handoff={handoffDoctor} redFlags={redFlags} summary={handoff} size="full" />
      )}

      <div className="glass-card flex flex-col" style={{ minHeight: done ? 320 : 560, maxHeight: 720 }} data-testid="care-ai-chat">
      <div className="flex items-center gap-3 pb-4 border-b border-white/60">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 relative" style={{ background: "linear-gradient(135deg,#5B7CFA 0%, #7C4DFF 100%)", boxShadow: "0 6px 18px rgba(91,124,250,0.32)" }}>
          <Sparkles className="text-white" size={20} />
          <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#3CC97C] border-2 border-white" />
        </div>
        <div className="flex-1">
          <div className="font-display font-bold text-[17px]" style={{ color: "#0F1836" }}>Care AI</div>
          <div className="text-[12px]" style={{ color: "#6B7595" }}>
            {done ? "Handoff complete — summary prepared for your doctor." : `Preparing your visit with ${first}`}
          </div>
        </div>
        {done && <span className="badge badge-success inline-flex items-center gap-1"><Check size={12} /> Ready</span>}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-5 flex flex-col gap-3" data-testid="care-ai-messages">
        {messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
        {busy && <Bubble message={{ role: "assistant", text: "…", typing: true }} />}
      </div>

      {done && handoff && !handoffDoctor && (
        <div className="glass-soft p-4 mb-3 flex items-start gap-3" style={{ background: "rgba(91,124,250,0.08)", borderColor: "rgba(91,124,250,0.25)" }} data-testid="handoff-card">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] flex items-center justify-center shrink-0">
            <Check className="text-white" size={16} />
          </div>
          <div className="flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "#5B7CFA" }}>Handoff to doctor</div>
            <div className="text-[13.5px]" style={{ color: "#0F1836" }}>{handoff}</div>
          </div>
        </div>
      )}

      <form onSubmit={send} className="flex items-center gap-2 pt-3 border-t border-white/60">
        <input
          className="form-input flex-1"
          placeholder={done ? "Care AI has completed your intake" : `Message Care AI…`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy || done}
          data-testid="care-ai-input"
        />
        <button type="submit" disabled={busy || done || !input.trim()} className="btn-primary p-3 !rounded-2xl disabled:opacity-50" data-testid="care-ai-send">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </form>
    </div>
    </div>
  );
}

function Bubble({ message }) {
  const isAi = message.role === "assistant";
  return (
    <div className={`flex ${isAi ? "justify-start" : "justify-end"}`}>
      {isAi && (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] flex items-center justify-center shrink-0 mr-2 mt-1">
          <Sparkles className="text-white" size={14} />
        </div>
      )}
      <div
        className={`max-w-[75%] px-4 py-2.5 text-[14px] leading-relaxed ${isAi ? "rounded-[18px] rounded-bl-md" : "rounded-[18px] rounded-br-md text-white"}`}
        style={isAi ? { background: "rgba(255,255,255,0.85)", color: "#0F1836", border: "1px solid rgba(91,124,250,0.12)" } : { background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}
      >
        {message.typing ? (
          <span className="inline-flex gap-1 items-center" data-testid="typing">
            <span className="w-1.5 h-1.5 rounded-full bg-[#5B7CFA] animate-pulse" style={{ animationDelay: "0ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-[#5B7CFA] animate-pulse" style={{ animationDelay: "150ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-[#5B7CFA] animate-pulse" style={{ animationDelay: "300ms" }} />
          </span>
        ) : (
          <div className="whitespace-pre-wrap">{message.text}</div>
        )}
      </div>
      {!isAi && (
        <div className="w-8 h-8 rounded-full bg-white/70 border border-white flex items-center justify-center shrink-0 ml-2 mt-1">
          <UserCircle2 className="text-[#5B7CFA]" size={16} />
        </div>
      )}
    </div>
  );
}

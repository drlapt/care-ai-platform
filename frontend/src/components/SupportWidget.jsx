import { useState, useEffect, useRef } from "react";
import { LifeBuoy, Send, X, Loader2 } from "lucide-react";
import { supportChat } from "@/lib/api";
import { toast } from "sonner";

/**
 * Floating support assistant — answers app/navigation questions only.
 * Never gives medical advice (server-side prompt enforces that).
 */
export default function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState([
    { role: "assistant", text: "Hi! I'm Project Care's app assistant. Ask me anything about how the app works — booking, prescriptions, WhatsApp, voice, etc. (For health questions, head to Follow-up AI.)" },
  ]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setHistory((h) => [...h, { role: "user", text }]);
    setBusy(true);
    try {
      const data = await supportChat({ message: text, history: history.slice(-12) });
      setHistory((h) => [...h, { role: "assistant", text: data.reply || "(no reply)" }]);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Support is unavailable right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full text-white shadow-xl flex items-center justify-center hover:scale-105 transition"
        style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)", boxShadow: "0 12px 24px rgba(92,124,250,0.35)" }}
        title="App help"
        data-testid="support-toggle"
      >
        {open ? <X size={20} /> : <LifeBuoy size={20} />}
      </button>

      {open && (
        <div
          className="fixed bottom-20 right-5 z-40 w-[340px] max-w-[92vw] glass-card flex flex-col gap-2"
          style={{ height: 460 }}
          data-testid="support-panel"
        >
          <div className="flex items-center gap-2 pb-2 border-b border-[#5B7CFA]/15">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] text-white flex items-center justify-center">
              <LifeBuoy size={15} />
            </div>
            <div>
              <div className="font-display font-bold text-[14px]" style={{ color: "#0F1836" }}>App Support</div>
              <div className="text-[10.5px]" style={{ color: "#6B7595" }}>App questions only · not medical advice</div>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto flex flex-col gap-2 -mx-1 px-1" data-testid="support-messages">
            {history.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed ${
                    m.role === "user"
                      ? "bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] text-white"
                      : "bg-white/85 border border-white"
                  }`}
                  style={{ color: m.role === "user" ? "#fff" : "#0F1836" }}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-[11.5px]" style={{ color: "#6B7595" }}>
                <Loader2 size={11} className="animate-spin" /> Looking up the answer…
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 pt-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
              placeholder="Ask about the app…"
              className="flex-1 bg-white border border-[#5B7CFA]/15 rounded-2xl px-3 py-2 text-[12.5px] outline-none"
              data-testid="support-input"
            />
            <button onClick={send} disabled={busy || !input.trim()} className="btn-primary px-3 py-2 text-[12px]" data-testid="support-send">
              <Send size={12} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageCircle, ChevronRight, X, Send, Check, Phone, Globe } from "lucide-react";
import { whatsappStart, whatsappVerify, whatsappDisconnect } from "@/lib/api";

const LANGS = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिंदी" },
  { code: "te", label: "తెలుగు" },
  { code: "ta", label: "தமிழ்" },
];

export default function ConnectWhatsApp({ user, onChange, prefilledNumber, autoOpen = false }) {
  const linked = !!user?.whatsapp_number;
  const initialNumber = prefilledNumber || user?.whatsapp_pending_number || "";
  const [open, setOpen] = useState(autoOpen && !linked);
  const [step, setStep] = useState("number"); // "number" | "code"
  const [number, setNumber] = useState(initialNumber);
  const [language, setLanguage] = useState(user?.whatsapp_language || "en");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => { setStep("number"); setNumber(initialNumber); setCode(""); setBusy(false); };
  const close = () => { setOpen(false); reset(); };

  // React to parent toggling autoOpen (e.g. clicking "Connect now" banner)
  useEffect(() => {
    if (autoOpen && !linked) setOpen(true);
  }, [autoOpen, linked]);

  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await whatsappStart(number, language);
      toast.success("Code sent via WhatsApp.");
      setStep("code");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not send code");
    } finally { setBusy(false); }
  };

  const verify = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await whatsappVerify(code);
      toast.success("WhatsApp linked!");
      onChange?.({ whatsapp_number: res.whatsapp_number });
      close();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Invalid code");
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect this WhatsApp number?")) return;
    try {
      await whatsappDisconnect();
      onChange?.({ whatsapp_number: null });
      toast.success("WhatsApp disconnected");
    } catch {
      toast.error("Could not disconnect");
    }
  };

  return (
    <>
      <button
        onClick={() => (linked ? disconnect() : setOpen(true))}
        className="glass-card p-5 flex items-center gap-4 hover:shadow-xl transition w-full text-left"
        data-testid="whatsapp-cta"
        style={{ background: linked ? "rgba(60,201,124,0.12)" : "rgba(37,211,102,0.08)" }}
      >
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: linked ? "#28A55B" : "#25D366" }}>
          <MessageCircle size={22} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>
            {linked ? "WhatsApp connected" : "Connect WhatsApp · 24/7 Care AI"}
          </div>
          <div className="text-[12.5px] truncate" style={{ color: "#2A3558" }}>
            {linked ? `${user.whatsapp_number} — tap to disconnect` : "Chat with Care AI on WhatsApp in your language. Send a 🎙️ voice note — we'll transcribe and reply by voice too."}
          </div>
        </div>
        {linked ? <Check size={18} className="text-[#28A55B]" /> : <ChevronRight size={18} className="text-[#5B7CFA]" />}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,24,54,0.4)", backdropFilter: "blur(6px)" }} onClick={close} data-testid="whatsapp-modal-backdrop">
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={step === "number" ? start : verify}
            className="glass-card w-full max-w-[440px] flex flex-col gap-4"
            data-testid="whatsapp-modal"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "#25D366" }}>
                  <MessageCircle size={20} className="text-white" />
                </div>
                <div>
                  <div className="font-display font-bold text-[20px]" style={{ color: "#0F1836" }}>Connect WhatsApp</div>
                  <div className="text-[12.5px]" style={{ color: "#6B7595" }}>{step === "number" ? "Step 1 · Phone number" : "Step 2 · Verify code"}</div>
                </div>
              </div>
              <button type="button" onClick={close} className="w-8 h-8 rounded-full bg-white/70 flex items-center justify-center" data-testid="whatsapp-modal-close"><X size={14} /></button>
            </div>

            {step === "number" ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>WhatsApp number (E.164)</span>
                  <div className="flex items-center gap-2 bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3">
                    <Phone size={14} className="text-[#5B7CFA]" />
                    <input required value={number} onChange={(e) => setNumber(e.target.value)} placeholder="+919876543210" className="flex-1 outline-none bg-transparent text-[14px]" data-testid="whatsapp-number-input" />
                  </div>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>Preferred language for replies</span>
                  <div className="flex items-center gap-2 bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3">
                    <Globe size={14} className="text-[#5B7CFA]" />
                    <select value={language} onChange={(e) => setLanguage(e.target.value)} className="flex-1 outline-none bg-transparent text-[14px]" data-testid="whatsapp-lang-select">
                      {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                  </div>
                </label>
                <button type="submit" disabled={busy} className="btn-primary w-full inline-flex items-center justify-center gap-2" data-testid="whatsapp-send-code-btn">
                  <Send size={14} /> {busy ? "Sending…" : "Send verification code"}
                </button>
              </>
            ) : (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>6-digit code from WhatsApp</span>
                  <input
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                    inputMode="numeric"
                    maxLength={6}
                    className="bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3 text-[18px] tracking-[6px] text-center font-bold outline-none"
                    data-testid="whatsapp-code-input"
                  />
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setStep("number")} className="btn-ghost flex-1" data-testid="whatsapp-back">Back</button>
                  <button type="submit" disabled={busy || code.length < 6} className="btn-primary flex-1 inline-flex items-center justify-center gap-2" data-testid="whatsapp-verify-btn">
                    <Check size={14} /> {busy ? "Verifying…" : "Verify"}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      )}
    </>
  );
}

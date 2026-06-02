import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageCircle, ShieldCheck, ShieldOff, Loader2, LogOut } from "lucide-react";
import { getWhatsappPreferences, updateWhatsappPreferences, whatsappDisconnect } from "@/lib/api";

const TOGGLES = [
  { key: "send_prescriptions", label: "Prescriptions", hint: "Receive your Rx PDF and medication list on WhatsApp." },
  { key: "send_summary",       label: "Visit summaries", hint: "Get a plain-language summary after each consultation." },
  { key: "send_reminders",     label: "Medication reminders", hint: "On-time nudges so you never miss a dose." },
  { key: "send_alerts",        label: "Care alerts", hint: "Important messages from your care team." },
  { key: "send_reports",       label: "Lab reports", hint: "Lab/imaging results delivered when ready." },
  { key: "voice_replies",      label: "Voice replies 🎙️", hint: "Hear Care AI's answers as a short voice note — great for complex explanations." },
];

function maskNumber(num) {
  if (!num) return "";
  const digits = num.replace(/\D/g, "");
  if (digits.length < 4) return num;
  const last4 = digits.slice(-4);
  // Show "+<country 1-3 digits> •••• <last4>"
  const cc = digits.length > 10 ? digits.slice(0, digits.length - 10) : "";
  const middleLen = Math.max(0, digits.length - 4 - cc.length);
  return `${cc ? `+${cc} ` : "+"}${"•".repeat(middleLen)} ${last4}`.trim();
}

export default function WhatsAppSettingsCard({ onChange }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null); // key currently being toggled
  const [disconnecting, setDisconnecting] = useState(false);
  const [data, setData] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const d = await getWhatsappPreferences();
      setData(d);
    } catch (e) {
      // Non-blocking; user might not be a patient or backend hiccup
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const linked = !!data?.linked && !!data?.verified;
  const prefs = data?.prefs || {};

  const toggle = async (key) => {
    if (!linked) return;
    const next = !prefs[key];
    // Optimistic update
    setData((d) => ({ ...d, prefs: { ...d.prefs, [key]: next } }));
    setSaving(key);
    try {
      const res = await updateWhatsappPreferences({ [key]: next });
      setData((d) => ({ ...d, prefs: res.prefs || d.prefs }));
    } catch (e) {
      // Revert
      setData((d) => ({ ...d, prefs: { ...d.prefs, [key]: !next } }));
      toast.error(e?.response?.data?.detail || "Could not update preference");
    } finally {
      setSaving(null);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm("Disconnect WhatsApp? You can reconnect anytime by verifying your number again.")) return;
    setDisconnecting(true);
    try {
      await whatsappDisconnect();
      toast.success("WhatsApp disconnected.");
      onChange?.({ whatsapp_number: null });
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not disconnect");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <section className="glass-card" data-testid="wa-settings-card">
      <header className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: linked ? "#28A55B" : "#9AA3BD" }}
          >
            <MessageCircle size={20} className="text-white" />
          </div>
          <div>
            <h3 className="font-display font-bold text-[20px]" style={{ color: "#0F1836" }}>
              WhatsApp settings
            </h3>
            <div className="text-[12.5px] flex items-center gap-1.5 mt-0.5" style={{ color: "#6B7595" }}>
              {loading ? (
                <><Loader2 size={12} className="animate-spin" /> Loading…</>
              ) : linked ? (
                <>
                  <ShieldCheck size={12} className="text-[#28A55B]" />
                  <span data-testid="wa-status-text">
                    Connected · <span className="font-semibold text-[#0F1836]">{maskNumber(data.phone_number)}</span>
                  </span>
                </>
              ) : (
                <>
                  <ShieldOff size={12} className="text-[#6B7595]" />
                  <span data-testid="wa-status-text">Not connected — link your number above to manage preferences.</span>
                </>
              )}
            </div>
          </div>
        </div>
        {linked && (
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="btn-ghost text-[12px] py-2 px-3 inline-flex items-center gap-1"
            data-testid="wa-disconnect-btn"
          >
            {disconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        )}
      </header>

      <div className="flex flex-col gap-2" data-testid="wa-toggles">
        {TOGGLES.map(({ key, label, hint }) => {
          const checked = !!prefs[key];
          const disabled = !linked || saving === key;
          return (
            <div
              key={key}
              className="flex items-center justify-between gap-3 py-3 px-3 rounded-2xl transition"
              style={{
                background: checked && linked ? "rgba(40,165,91,0.06)" : "rgba(91,124,250,0.04)",
                opacity: linked ? 1 : 0.6,
              }}
              data-testid={`wa-toggle-row-${key}`}
            >
              <div className="min-w-0">
                <div className="font-semibold text-[14px]" style={{ color: "#0F1836" }}>{label}</div>
                <div className="text-[12px]" style={{ color: "#6B7595" }}>{hint}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={`Toggle ${label}`}
                disabled={disabled}
                onClick={() => toggle(key)}
                className="relative shrink-0 w-11 h-6 rounded-full transition disabled:cursor-not-allowed"
                style={{
                  background: checked ? "#28A55B" : "#C9CFE2",
                }}
                data-testid={`wa-toggle-${key}`}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
                  style={{ transform: checked ? "translateX(20px)" : "translateX(0)" }}
                />
                {saving === key && (
                  <Loader2 size={10} className="absolute inset-0 m-auto animate-spin text-white" />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {linked && prefs.consent === false && (
        <div
          className="mt-3 text-[12px] px-3 py-2 rounded-xl"
          style={{ background: "rgba(232,90,90,0.08)", color: "#9C2E2E" }}
          data-testid="wa-consent-revoked-banner"
        >
          You've revoked WhatsApp consent. No messages will be sent until you reconnect.
        </div>
      )}
    </section>
  );
}

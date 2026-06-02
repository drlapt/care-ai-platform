import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { Sparkles, ArrowRight, ArrowLeft, Mail, Lock, User, Mic, Activity, ClipboardList, ShieldCheck, MessageCircle, Globe } from "lucide-react";
import { authLogin, authRegister } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const WA_LANGS = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिंदी" },
  { code: "te", label: "తెలుగు" },
  { code: "ta", label: "தமிழ்" },
];

export default function Login() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("signin"); // "signin" | "signup"
  const [form, setForm] = useState({ email: "", password: "", name: "", whatsapp_number: "", whatsapp_language: "en" });
  const [debugInfo, setDebugInfo] = useState(null);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (loading) return;
    if (tab === "signup" && form.password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    setDebugInfo(null);
    try {
      let user;
      if (tab === "signup") {
        const payload = {
          email: form.email,
          password: form.password,
          name: form.name,
        };
        if (form.whatsapp_number?.trim()) {
          payload.whatsapp_number = form.whatsapp_number.trim();
          payload.whatsapp_language = form.whatsapp_language;
        }
        const res = await authRegister(payload);
        user = res.user;
        toast.success("Account created");
      } else {
        const res = await authLogin(form.email, form.password);
        user = res.user;
        toast.success("Welcome back");
      }
      await refresh();
      navigate(user?.role === "doctor" ? "/dashboard" : "/portal", { replace: true });
    } catch (err) {
      // Surface the REAL failure cause so we can debug prod issues.
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      const url = err?.config ? `${err.config.baseURL || ""}${err.config.url || ""}` : "(unknown)";
      const kind = !err?.response
        ? (err?.code === "ERR_NETWORK" ? "Network error (backend unreachable or CORS blocked)" : `Request failed: ${err?.message || "unknown"}`)
        : `HTTP ${status}${detail ? ` — ${detail}` : ""}`;
      // eslint-disable-next-line no-console
      console.error("[auth] submit failed", { tab, url, status, detail, error: err });
      setDebugInfo({ url, status: status || "—", message: detail || err?.message || "Unknown error", kind });
      if (status === 401) toast.error("Invalid credentials");
      else if (status === 409) toast.error(detail || "Email already registered");
      else if (!err?.response) toast.error("Can't reach the server — check your connection");
      else toast.error(detail || `${tab === "signup" ? "Sign-up" : "Sign-in"} failed (${status})`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col" data-testid="login-page">
      {/* Top nav with back-to-home */}
      <nav className="px-6 lg:px-12 pt-5 flex items-center justify-between max-w-[1400px] mx-auto w-full">
        <Link to="/" className="inline-flex items-center gap-1.5 text-[13px] font-semibold transition hover:opacity-70" style={{ color: "#2A3558" }} data-testid="login-back-home-link">
          <ArrowLeft size={14} /> Back to Home
        </Link>
        <Link to="/demo" className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: "#5B7CFA" }} data-testid="login-nav-demo-link">
          <Sparkles size={12} /> Try live demo
        </Link>
      </nav>
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-8 p-6 lg:p-12 max-w-[1400px] mx-auto w-full">
        {/* Left: Hero */}
        <section className="flex flex-col justify-center animate-fade-up">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B7CFA 0%, #7C4DFF 100%)", boxShadow: "0 6px 18px rgba(91,124,250,0.35)" }}>
              <Sparkles className="text-white" size={24} />
            </div>
            <div>
              <div className="font-display font-bold text-[22px] leading-none" style={{ color: "#0F1836" }}>Project Care</div>
              <div className="text-[12px]" style={{ color: "#6B7595" }}>AI-Powered Continuous Patient Care</div>
            </div>
          </div>

          <h1 className="font-display font-extrabold text-[44px] sm:text-[56px] lg:text-[64px] leading-[1.02]" style={{ color: "#0F1836" }}>
            Your <span className="text-gradient">voice-first</span><br />
            AI medical<br />
            companion.
          </h1>

          <p className="text-[17px] mt-6 max-w-[520px]" style={{ color: "#2A3558" }}>
            Speak or type to Care AI in English, हिंदी, తెలుగు or தமிழ். Get intelligent medical interviews, 24/7 follow-ups, and direct escalation to Dr. Lahari when it matters.
          </p>

          <div className="grid grid-cols-2 gap-4 mt-10 max-w-[520px]">
            {[
              { icon: Mic, label: "Voice + text conversation" },
              { icon: ClipboardList, label: "4-language support" },
              { icon: Activity, label: "Smart urgency triage" },
              { icon: ShieldCheck, label: "HIPAA-aware data model" },
            ].map((f) => (
              <div key={f.label} className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/70 border border-white flex items-center justify-center shrink-0"><f.icon size={16} className="text-[#5B7CFA]" /></div>
                <div className="text-[14px] font-medium" style={{ color: "#2A3558" }}>{f.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Right: Auth panel */}
        <section className="flex items-center justify-center animate-fade-up" style={{ animationDelay: "0.1s" }}>
          <div className="glass-card w-full max-w-[460px]" data-testid="auth-panel">
            <div className="text-center mb-6">
              <h2 className="font-display font-bold text-[26px]" style={{ color: "#0F1836" }}>
                {tab === "signin" ? "Welcome back" : "Create your account"}
              </h2>
              <p className="text-sm mt-1" style={{ color: "#6B7595" }}>
                {tab === "signin" ? "Sign in to continue your care" : "It takes less than 30 seconds"}
              </p>
            </div>

            <div className="flex gap-1 p-1 rounded-2xl bg-white/60 border border-white/80 mb-5" data-testid="auth-tabs">
              {[
                { k: "signin", l: "Sign in" },
                { k: "signup", l: "Sign up" },
              ].map((t) => (
                <button
                  key={t.k}
                  onClick={() => setTab(t.k)}
                  data-testid={`tab-${t.k}`}
                  className={`flex-1 py-2 text-[13px] font-semibold rounded-xl transition ${tab === t.k ? "bg-gradient-to-r from-[#5B7CFA] to-[#7C4DFF] text-white shadow" : "text-[#2A3558] hover:bg-white/80"}`}
                >
                  {t.l}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="flex flex-col gap-3" data-testid={`${tab}-form`}>
              {tab === "signup" && (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>Full name</span>
                  <div className="flex items-center gap-2 bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3">
                    <User size={15} className="text-[#6B7595]" />
                    <input required value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="Jane Doe" className="flex-1 outline-none bg-transparent text-[14px]" data-testid="signup-name-input" />
                  </div>
                </label>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>Email</span>
                <div className="flex items-center gap-2 bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3">
                  <Mail size={15} className="text-[#6B7595]" />
                  <input required type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} placeholder="you@example.com" className="flex-1 outline-none bg-transparent text-[14px]" data-testid={`${tab}-email-input`} />
                </div>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>Password</span>
                <div className="flex items-center gap-2 bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3">
                  <Lock size={15} className="text-[#6B7595]" />
                  <input required type="password" minLength={6} value={form.password} onChange={(e) => setField("password", e.target.value)} placeholder="••••••••" className="flex-1 outline-none bg-transparent text-[14px]" data-testid={`${tab}-password-input`} />
                </div>
              </label>
              {tab === "signup" && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "#6B7595" }}>
                      <MessageCircle size={11} className="text-[#25D366]" /> WhatsApp number <span className="font-normal normal-case tracking-normal text-[10px]">(optional · 24/7 Care AI on WhatsApp)</span>
                    </span>
                    <div className="flex items-center gap-2 bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3">
                      <span className="text-[13px]" style={{ color: "#6B7595" }}>📱</span>
                      <input
                        type="tel"
                        value={form.whatsapp_number}
                        onChange={(e) => setField("whatsapp_number", e.target.value)}
                        placeholder="+919876543210"
                        className="flex-1 outline-none bg-transparent text-[14px]"
                        data-testid="signup-whatsapp-input"
                      />
                    </div>
                  </label>
                  {form.whatsapp_number?.trim() && (
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>WhatsApp language</span>
                      <div className="flex items-center gap-2 bg-white border border-[#5B7CFA]/15 rounded-2xl px-3.5 py-3">
                        <Globe size={14} className="text-[#5B7CFA]" />
                        <select value={form.whatsapp_language} onChange={(e) => setField("whatsapp_language", e.target.value)} className="flex-1 outline-none bg-transparent text-[14px]" data-testid="signup-whatsapp-lang">
                          {WA_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                        </select>
                      </div>
                    </label>
                  )}
                </>
              )}
              <button type="submit" disabled={loading} className="btn-primary w-full inline-flex items-center justify-center gap-2 mt-2" data-testid={`${tab}-submit-btn`}>
                {loading ? "Please wait…" : tab === "signup" ? "Create account" : "Sign in"} <ArrowRight size={15} />
              </button>
            </form>

            {/* Debug panel — only shows after a failed auth attempt. Helps debug prod-vs-preview config issues. */}
            {debugInfo && (
              <details className="mt-3 rounded-xl border border-[#E85A5A]/25 bg-[#FFE9E9]/40 px-3 py-2 text-[11.5px]" data-testid="auth-debug-panel">
                <summary className="cursor-pointer font-semibold" style={{ color: "#7B1F1F" }}>
                  Debug info — share this with support if the issue persists
                </summary>
                <div className="mt-2 flex flex-col gap-1 font-mono break-all" style={{ color: "#5B1F1F" }}>
                  <div><span className="opacity-60">Endpoint:</span> {debugInfo.url}</div>
                  <div><span className="opacity-60">Status:</span> {String(debugInfo.status)}</div>
                  <div><span className="opacity-60">Error:</span> {debugInfo.kind}</div>
                  <div><span className="opacity-60">Message:</span> {debugInfo.message}</div>
                </div>
              </details>
            )}

            {/* Demo escape — never trap the user */}
            <div className="mt-4 pt-4 border-t border-[#5B7CFA]/10 text-center">
              <div className="text-[11.5px] mb-1.5" style={{ color: "#6B7595" }}>
                Prefer to explore first? Try the demo — no login required.
              </div>
              <Link
                to="/demo"
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold transition hover:opacity-80"
                style={{ color: "#5B7CFA" }}
                data-testid="login-demo-escape-link"
              >
                Just exploring? <span style={{ background: "linear-gradient(90deg,#5B7CFA,#7C4DFF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Try live demo</span> <ArrowRight size={13} />
              </Link>
            </div>

            <p className="text-[11px] text-center mt-5" style={{ color: "#6B7595" }}>
              By continuing you agree to our Terms & Privacy Policy.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

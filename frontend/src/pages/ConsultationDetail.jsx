import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, ClipboardList, User, Pill, ShieldAlert, Activity, Sparkles, Send, Loader2, Bot, FlaskConical, MessageCircle, FileText } from "lucide-react";
import { getConsultation, careAIMessage, careAIHistory } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function ConsultationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    getConsultation(id).then(setData).catch(() => setData(null));
  }, [id]);

  if (!data) return <div className="glass-card">Loading…</div>;
  const { consultation: c, patient } = data;
  const e = c.extracted_data || {};
  const isPatient = user?.role === "patient";

  return (
    <div className="flex flex-col gap-6 animate-fade-up" data-testid="consultation-detail-page">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm font-medium w-fit" style={{ color: "#6B7595" }} data-testid="back-btn">
        <ArrowLeft size={16} /> Back
      </button>

      <header>
        <div className="text-sm mb-1" style={{ color: "#6B7595" }}>{new Date(c.date).toLocaleString()}</div>
        <h1 className="font-display font-bold text-[32px] leading-tight" style={{ color: "#0F1836" }}>
          Consultation — <Link to={`/patients/${patient.id}`} className="text-gradient">{patient.personal_info?.name}</Link>
        </h1>
      </header>

      {c.contradictions_found?.length > 0 && (
        <div className="glass-card" style={{ background: "rgba(232,90,90,0.06)", borderColor: "rgba(232,90,90,0.3)" }} data-testid="contradictions">
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert size={16} className="text-[#E85A5A]" />
            <h3 className="font-display font-bold text-[17px]" style={{ color: "#E85A5A" }}>Contradictions Detected</h3>
          </div>
          <ul className="flex flex-col gap-2">
            {c.contradictions_found.map((x, i) => (
              <li key={i} className="glass-soft p-3 text-[14px]" style={{ color: "#2A3558" }}>
                <div className="font-semibold" style={{ color: "#E85A5A" }}>{x.type} ({x.severity})</div>
                <div>{x.description}</div>
                {x.suggested_action && <div className="mt-1 text-[12px]" style={{ color: "#6B7595" }}>→ {x.suggested_action}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title={isPatient ? "Your visit summary" : "Doctor Summary (Clinical)"} icon={isPatient ? FileText : ClipboardList} testid="doctor-summary">
          <pre className="whitespace-pre-wrap text-[13.5px] leading-relaxed" style={{ color: "#2A3558", fontFamily: "Inter" }}>
            {(isPatient ? c.patient_summary : c.doctor_summary) || "—"}
          </pre>
        </Card>
        <Card title={isPatient ? "Doctor's clinical notes" : "Patient Summary (Simple)"} icon={User} testid="patient-summary">
          <pre className="whitespace-pre-wrap text-[13.5px] leading-relaxed" style={{ color: "#2A3558", fontFamily: "Inter" }}>
            {(isPatient ? c.doctor_summary : c.patient_summary) || "—"}
          </pre>
        </Card>

        {e.assessment && (
          <Card title="Assessment & Plan" icon={Activity} testid="assessment">
            <div className="mb-2"><span className="font-semibold">Assessment:</span> {e.assessment}</div>
            {e.plan && <div><span className="font-semibold">Plan:</span> {e.plan}</div>}
          </Card>
        )}

        {(e.investigations?.length > 0 || c.investigations?.length > 0) && (
          <Card title="Investigations / tests" icon={FlaskConical} testid="investigations">
            <ul className="flex flex-col gap-1.5">
              {(e.investigations || c.investigations || []).map((it, i) => (
                <li key={i} className="text-[13px]" style={{ color: "#2A3558" }}>
                  · {typeof it === "string" ? it : (it.name || it.test || JSON.stringify(it))}
                  {it?.urgency && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: "#F2994A" }}>{it.urgency}</span>}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {c.prescriptions?.length > 0 && (
          <Card title="Prescription" icon={Pill} testid="prescriptions" className="lg:col-span-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {c.prescriptions.map((rx, i) => (
                <div key={i} className="glass-soft p-4">
                  <div className="font-semibold text-[15px] mb-1" style={{ color: "#0F1836" }}>{rx.name || rx.medication}</div>
                  {rx.purpose && <div className="text-[12px] mb-2" style={{ color: "#6B7595" }}>{rx.purpose}</div>}
                  <div className="flex flex-col gap-1 text-[13px]" style={{ color: "#2A3558" }}>
                    {(rx.dose || rx.dosage) && <div>💊 {rx.dose || rx.dosage}</div>}
                    {(rx.when_to_take || rx.frequency) && <div>🕒 {rx.when_to_take || rx.frequency}</div>}
                    {rx.how_often && <div>🔁 {rx.how_often}</div>}
                    {rx.duration && <div>📆 {rx.duration}</div>}
                    {(rx.food_interactions || rx.instructions) && <div>🍽 {rx.food_interactions || rx.instructions}</div>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {(c.advice || e.advice) && (
          <Card title="Advice" icon={MessageCircle} testid="advice" className="lg:col-span-2">
            <div className="text-[13.5px]" style={{ color: "#2A3558" }}>{c.advice || e.advice}</div>
          </Card>
        )}

        {/* Phase 14 — Continue with Care AI (patient-only inline chat) */}
        {isPatient && <ContinueWithCareAI consultation={c} patient={patient} />}

        <Card title="Full conversation" icon={User} testid="conversation" className="lg:col-span-2">
          <pre className="whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: "#2A3558", fontFamily: "Inter" }}>{c.conversation}</pre>
        </Card>
      </div>
    </div>
  );
}

function ContinueWithCareAI({ consultation, patient }) {
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  // Seed Care AI with this consultation's context as the first message
  const contextSeed = `I'm asking about my consultation on ${new Date(consultation.date).toLocaleDateString()} for "${consultation.extracted_data?.assessment || consultation.chief_complaint || "a recent visit"}".`;

  useEffect(() => {
    careAIHistory(patient.id).then((h) => {
      // Show only the last 6 messages for context — keep the inline panel compact
      setHistory((h || []).slice(-6));
    }).catch(() => {});
  }, [patient.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [history.length]);

  const send = async (text) => {
    const t = (text || "").trim();
    if (!t) return;
    setInput("");
    setHistory((h) => [...h, { role: "user", text: t, created_at: new Date().toISOString() }]);
    setSending(true);
    try {
      const res = await careAIMessage(patient.id, `${contextSeed}\n\nMy question: ${t}`);
      const reply = res?.reply || res?.message || "I'll check on that and get back to you.";
      setHistory((h) => [...h, { role: "ai", text: reply, created_at: new Date().toISOString() }]);
    } catch (e) {
      toast.error("Care AI unavailable — try again");
      setHistory((h) => h.slice(0, -1));
      setInput(t);
    } finally {
      setSending(false);
    }
  };

  const quickPrompts = [
    "Should I worry about side effects?",
    "When should I follow up?",
    "Can I exercise normally?",
  ];

  return (
    <div className="glass-card lg:col-span-2 flex flex-col gap-3" style={{ background: "linear-gradient(135deg, rgba(91,124,250,0.06), rgba(124,77,255,0.06))" }} data-testid="continue-with-ai">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}>
            <Sparkles size={20} className="text-white" />
          </div>
          <div>
            <div className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>Continue with Care AI</div>
            <div className="text-[12px]" style={{ color: "#6B7595" }}>Ask follow-up questions about this visit — 24/7.</div>
          </div>
        </div>
      </header>

      {/* Conversation */}
      {history.length > 0 && (
        <div ref={scrollRef} className="flex flex-col gap-2 max-h-[320px] overflow-y-auto pr-1" data-testid="continue-ai-history">
          {history.map((m, i) => {
            const isUser = m.role === "user" || m.role === "patient";
            return (
              <div key={i} className={`flex items-start gap-2 ${isUser ? "flex-row-reverse" : ""}`} data-testid={`continue-ai-msg-${i}`}>
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
                  style={{ background: isUser ? "linear-gradient(135deg,#5B7CFA,#7C4DFF)" : "linear-gradient(135deg,#28A55B,#3CC97C)" }}
                >
                  {isUser ? (patient.personal_info?.name || "U").charAt(0).toUpperCase() : <Bot size={12} />}
                </div>
                <div
                  className={`px-3 py-2 rounded-2xl text-[13px] max-w-[85%] ${isUser ? "" : "bg-white/80"}`}
                  style={isUser ? { background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)", color: "white" } : { color: "#2A3558" }}
                >
                  {m.text}
                </div>
              </div>
            );
          })}
          {sending && (
            <div className="flex items-start gap-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white shrink-0" style={{ background: "linear-gradient(135deg,#28A55B,#3CC97C)" }}>
                <Bot size={12} />
              </div>
              <div className="px-3 py-2 rounded-2xl bg-white/80 inline-flex items-center gap-1.5 text-[13px]" style={{ color: "#6B7595" }}>
                <Loader2 size={12} className="animate-spin" /> Care AI is thinking…
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick prompts (when empty) */}
      {history.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {quickPrompts.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => send(p)}
              className="text-[12px] px-3 py-1.5 rounded-full bg-white/70 hover:bg-white transition"
              style={{ color: "#5B7CFA" }}
              data-testid={`continue-ai-prompt-${p.slice(0, 12).replace(/\W/g, '-').toLowerCase()}`}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="flex items-center gap-2 mt-1"
        data-testid="continue-ai-form"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about this consultation…"
          className="input flex-1"
          disabled={sending}
          data-testid="continue-ai-input"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="btn-primary inline-flex items-center gap-1.5 px-4"
          data-testid="continue-ai-send"
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </form>
    </div>
  );
}

function Card({ title, icon: Icon, children, testid, className = "" }) {
  return (
    <div className={`glass-card ${className}`} data-testid={testid}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-9 h-9 rounded-xl bg-[#5B7CFA]/12 flex items-center justify-center"><Icon size={16} className="text-[#5B7CFA]" /></div>
        <h3 className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

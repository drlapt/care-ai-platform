import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Sparkles, Loader2, Send, FlaskConical, AlertTriangle, Pill, CalendarPlus, MessageCircle } from "lucide-react";
import { alertCopilot, sendMessage } from "@/lib/api";

const KIND_META = {
  draft_reply:        { icon: Send,         color: "#5B7CFA", label: "Draft reply" },
  order_lab:          { icon: FlaskConical, color: "#F2994A", label: "Order lab" },
  escalate:           { icon: AlertTriangle,color: "#E85A5A", label: "Escalate" },
  prescribe:          { icon: Pill,         color: "#3CC97C", label: "Prescribe" },
  schedule_followup:  { icon: CalendarPlus, color: "#7C4DFF", label: "Schedule follow-up" },
};

const URG_DOT = { stat: "#E85A5A", urgent: "#F2994A", routine: "#5B7CFA" };

export default function AlertCopilotCard({ alert, onPrescribe }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [sending, setSending] = useState(null);

  const fetchActions = async () => {
    setLoading(true);
    try {
      const d = await alertCopilot(alert.id);
      setData(d);
      if (!d.actions?.length) toast.message("Co-Pilot: no specific action — open the chat to handle directly.");
    } catch {
      toast.error("Co-Pilot unavailable");
    } finally {
      setLoading(false);
    }
  };

  const sendReply = async (text) => {
    if (!text || !alert.patient_id) return;
    setSending(text);
    try {
      await sendMessage(alert.patient_id, text);
      toast.success("Reply sent to patient");
    } catch {
      toast.error("Could not send reply");
    } finally {
      setSending(null);
    }
  };

  return (
    <div
      className="rounded-2xl p-3 flex flex-col gap-2.5"
      style={{ background: "linear-gradient(135deg, rgba(91,124,250,0.06), rgba(124,77,255,0.06))" }}
      data-testid={`alert-copilot-${alert.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-bold inline-flex items-center gap-1.5" style={{ color: "#3F2F7A" }}>
          <Sparkles size={12} className="text-[#7C4DFF]" /> AI Co-Pilot · suggested next action
        </div>
        {!data && (
          <button
            type="button"
            onClick={fetchActions}
            disabled={loading}
            className="btn-ghost text-[11.5px] py-1 px-2.5 inline-flex items-center gap-1"
            data-testid={`alert-copilot-fetch-${alert.id}`}
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {loading ? "Thinking…" : "Suggest"}
          </button>
        )}
      </div>

      {data?.summary && <div className="text-[12px]" style={{ color: "#2A3558" }}>{data.summary}</div>}

      {data && data.actions?.length === 0 && (
        <div className="text-[11.5px]" style={{ color: "#6B7595" }}>No clear next action — review the chat directly.</div>
      )}

      {data?.actions?.map((act, i) => {
        const meta = KIND_META[act.kind] || KIND_META.draft_reply;
        const Icon = meta.icon;
        return (
          <div
            key={i}
            className="bg-white/70 rounded-xl px-3 py-2.5 flex items-start gap-2"
            data-testid={`alert-copilot-action-${alert.id}-${i}`}
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: `${meta.color}18` }}
            >
              <Icon size={13} style={{ color: meta.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <div className="font-semibold text-[12.5px]" style={{ color: "#0F1836" }}>{act.title || meta.label}</div>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: URG_DOT[act.urgency] || "#5B7CFA" }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: URG_DOT[act.urgency] || "#5B7CFA" }}>{act.urgency}</span>
              </div>
              {act.why && <div className="text-[11.5px] mt-0.5" style={{ color: "#6B7595" }}>{act.why}</div>}
              {act.suggested_text && (
                <div className="bg-[#5B7CFA]/8 rounded-lg px-2.5 py-1.5 mt-1.5 text-[11.5px] italic" style={{ color: "#2A3558" }}>
                  "{act.suggested_text}"
                </div>
              )}
              {act.suggested_lab && (
                <div className="text-[11.5px] mt-1" style={{ color: "#F2994A" }}>
                  <span className="font-bold">Lab:</span> {act.suggested_lab}
                </div>
              )}
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {act.kind === "draft_reply" && act.suggested_text && (
                  <button
                    onClick={() => sendReply(act.suggested_text)}
                    disabled={sending === act.suggested_text}
                    className="btn-primary text-[11px] py-1 px-2 inline-flex items-center gap-1"
                    data-testid={`alert-copilot-send-${alert.id}-${i}`}
                  >
                    {sending === act.suggested_text ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
                    Send to patient
                  </button>
                )}
                {act.kind === "prescribe" && (
                  <button
                    onClick={() => onPrescribe?.(alert)}
                    className="btn-ghost text-[11px] py-1 px-2 inline-flex items-center gap-1"
                    data-testid={`alert-copilot-rx-${alert.id}-${i}`}
                  >
                    <Pill size={10} /> Open Rx
                  </button>
                )}
                {act.kind === "order_lab" && (
                  <Link to="/laboratory" className="btn-ghost text-[11px] py-1 px-2 inline-flex items-center gap-1">
                    <FlaskConical size={10} /> Open lab
                  </Link>
                )}
                <Link
                  to={`/followup/${alert.patient_id}`}
                  className="btn-ghost text-[11px] py-1 px-2 inline-flex items-center gap-1"
                >
                  <MessageCircle size={10} /> Open chat
                </Link>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

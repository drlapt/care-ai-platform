import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert, Loader2, Send, AlertTriangle } from "lucide-react";
import { getSafetyCheck, submitSafetyCheck } from "@/lib/api";

/**
 * Phase 16 — Pre-Treatment Safety Check Banner
 * Renders a single most-recent pending safety check for the patient.
 * Patient enters required vital values; UI calls /submit and reflects safe/hold result.
 */
export default function SafetyCheckBanner({ pendingRxId, onResolved }) {
  const [data, setData] = useState(null);
  const [vals, setVals] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!pendingRxId) return;
    getSafetyCheck(pendingRxId)
      .then((d) => {
        setData(d);
        // pre-populate vals so submit always sends every required key
        const v = {};
        (d.required || []).forEach((r) => { v[r.key] = ""; });
        setVals(v);
      })
      .catch(() => setData(null));
  }, [pendingRxId]);

  const status = data?.status;
  const required = useMemo(() => data?.required || [], [data]);

  if (!data || status === "not_required" || !required.length) return null;
  if (status === "cleared") return null; // hide once cleared

  const submit = async (e) => {
    e?.preventDefault?.();
    if (Object.values(vals).some((v) => String(v).trim() === "")) {
      toast.error("Please enter every value");
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitSafetyCheck(data.rx_id, vals);
      if (res.status === "cleared") {
        toast.success("All vitals safe — you can start the medication.");
        onResolved?.();
        // refresh local state
        const fresh = await getSafetyCheck(data.rx_id);
        setData(fresh);
      } else if (res.status === "hold") {
        toast.error("Hold this medication — Dr. Lahari has been alerted.");
        const fresh = await getSafetyCheck(data.rx_id);
        setData(fresh);
      } else {
        toast.message("More values needed");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not submit");
    } finally {
      setSubmitting(false);
    }
  };

  const onHold = status === "hold";
  const accent = onHold ? "#E85A5A" : "#5B7CFA";
  const bg = onHold ? "rgba(232,90,90,0.08)" : "rgba(91,124,250,0.06)";
  const Icon = onHold ? ShieldAlert : ShieldCheck;

  return (
    <section
      className="glass-card flex flex-col gap-3"
      style={{ borderLeft: `4px solid ${accent}`, background: bg }}
      data-testid="safety-check-banner"
    >
      <header className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: `${accent}18` }}>
          <Icon size={20} style={{ color: accent }} />
        </div>
        <div className="flex-1">
          <div className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>
            {onHold ? "Hold this medication" : "Pre-treatment safety check"}
          </div>
          <div className="text-[12.5px] mt-0.5" style={{ color: "#2A3558" }}>
            {onHold
              ? "We've paused the new medication and alerted Dr. Lahari. Don't take it until your doctor confirms."
              : "Care AI needs your current vitals before you start the new medication. This keeps you safe."}
          </div>
        </div>
      </header>

      {onHold && (
        <div className="rounded-xl px-3 py-2.5 bg-white/70 flex flex-col gap-1.5" data-testid="safety-check-hold-reasons">
          {Object.entries(data.result || {}).map(([k, v]) => v?.status === "hold" && (
            <div key={k} className="flex items-start gap-2 text-[12.5px]" style={{ color: "#9C2E2E" }}>
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{v.reason}</span>
            </div>
          ))}
          <div className="text-[12px] mt-1.5" style={{ color: "#6B7595" }}>
            If you feel unwell — chest pain, breathlessness, severe dizziness — go to the nearest ER or call emergency services right away.
          </div>
        </div>
      )}

      {!onHold && (
        <form onSubmit={submit} className="flex flex-col gap-2.5" data-testid="safety-check-form">
          {required.map((r) => {
            const last = data.result?.[r.key];
            const flagged = last?.status === "hold";
            return (
              <label key={r.key} className="flex flex-col gap-1" data-testid={`safety-check-row-${r.key}`}>
                <span className="text-[11.5px] font-semibold inline-flex items-center gap-1" style={{ color: flagged ? "#9C2E2E" : "#0F1836" }}>
                  {flagged && <AlertTriangle size={11} />} {r.ask}
                </span>
                <div className="flex items-center gap-2">
                  <input
                    className="input flex-1"
                    placeholder={r.unit ? `e.g. value in ${r.unit}` : "Enter value"}
                    value={vals[r.key] ?? ""}
                    onChange={(e) => setVals((v) => ({ ...v, [r.key]: e.target.value }))}
                    data-testid={`safety-check-input-${r.key}`}
                  />
                  {r.unit && r.unit !== "yes/no" && (
                    <span className="text-[11.5px] font-bold uppercase tracking-wider" style={{ color: "#6B7595" }}>{r.unit}</span>
                  )}
                </div>
                {last?.reason && (
                  <span className="text-[11px]" style={{ color: flagged ? "#9C2E2E" : "#28A55B" }}>{last.reason}</span>
                )}
              </label>
            );
          })}
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary inline-flex items-center justify-center gap-1.5"
            data-testid="safety-check-submit"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {submitting ? "Checking…" : "Submit & confirm safe"}
          </button>
        </form>
      )}
    </section>
  );
}

import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Plus, Trash2, Pencil, Loader2, ChevronDown, ChevronUp,
  Activity, Pill, AlertTriangle, Check, X,
} from "lucide-react";
import {
  getHealthRecord,
  addCondition, deleteCondition, patchCondition,
  addMedication, deleteMedication, patchMedication,
  addAllergy, deleteAllergy,
} from "@/lib/api";

const FREQ_OPTIONS = [
  "Once daily", "Twice daily", "Three times daily", "As needed", "Other",
];
const CONDITION_STATUSES = ["active", "resolved", "monitoring"];
const STATUS_COLORS = { active: "#3CC97C", resolved: "#9AA3BD", monitoring: "#F2994A" };
const SEVERITY_COLORS = { mild: "#F2994A", moderate: "#E8820A", severe: "#E85A5A" };
const QUICK_CONDITIONS = ["Diabetes", "Hypertension", "Asthma", "Thyroid Disorder", "CKD", "CAD", "Arthritis"];

function SectionHeader({ icon: Icon, title, count, open, onToggle, accentColor }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-5 py-4 rounded-2xl transition hover:opacity-90"
      style={{ background: "rgba(255,255,255,0.6)", backdropFilter: "blur(8px)" }}
    >
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${accentColor}18` }}>
        <Icon size={18} style={{ color: accentColor }} />
      </div>
      <div className="flex-1 text-left">
        <div className="font-bold text-[15px]" style={{ color: "#0F1836" }}>{title}</div>
        <div className="text-[12px]" style={{ color: "#6B7595" }}>
          {count === 0 ? "None recorded" : `${count} recorded`}
        </div>
      </div>
      {open ? <ChevronUp size={16} style={{ color: "#6B7595" }} /> : <ChevronDown size={16} style={{ color: "#6B7595" }} />}
    </button>
  );
}

function Badge({ label, color }) {
  return (
    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full capitalize"
      style={{ background: `${color}20`, color }}>
      {label}
    </span>
  );
}

// ── Conditions Section ─────────────────────────────────────────────────────

function ConditionCard({ cond, profileId, onUpdated, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(cond.status || "active");
  const [notes, setNotes] = useState(cond.notes || "");
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    setBusy(true);
    try {
      const res = await patchCondition(profileId, cond.id, { status, notes: notes || null });
      toast.success("Updated");
      onUpdated(res);
      setEditing(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Remove "${cond.name}"?`)) return;
    setBusy(true);
    try {
      const res = await deleteCondition(profileId, cond.id);
      toast.success("Removed");
      onDeleted(res);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not remove");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-soft px-4 py-3 flex flex-col gap-2 rounded-2xl">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="font-semibold text-[14px]" style={{ color: "#0F1836" }}>{cond.name}</div>
          {cond.diagnosis_date && (
            <div className="text-[11.5px] mt-0.5" style={{ color: "#9AA3BD" }}>Since {cond.diagnosis_date}</div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Badge label={cond.status || "active"} color={STATUS_COLORS[cond.status] || "#9AA3BD"} />
          <button type="button" onClick={() => setEditing((e) => !e)} className="w-7 h-7 rounded-full glass-soft flex items-center justify-center hover:opacity-80">
            <Pencil size={12} style={{ color: "#5B7CFA" }} />
          </button>
          <button type="button" onClick={handleDelete} disabled={busy} className="w-7 h-7 rounded-full glass-soft flex items-center justify-center hover:opacity-80">
            {busy ? <Loader2 size={12} className="animate-spin" style={{ color: "#E85A5A" }} /> : <Trash2 size={12} style={{ color: "#E85A5A" }} />}
          </button>
        </div>
      </div>
      {cond.notes && !editing && (
        <div className="text-[12.5px]" style={{ color: "#6B7595" }}>{cond.notes}</div>
      )}
      {editing && (
        <div className="flex flex-col gap-2 pt-1">
          <select className="input text-[13px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            {CONDITION_STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          <textarea className="input text-[13px]" rows={2} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(false)} className="btn-ghost flex-1 text-[13px] py-1.5">Cancel</button>
            <button type="button" onClick={handleSave} disabled={busy} className="btn-primary flex-1 text-[13px] py-1.5 inline-flex items-center justify-center gap-1">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddConditionForm({ profileId, onAdded, onCancel }) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState("active");
  const [diagDate, setDiagDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (condName) => {
    const n = condName ?? name;
    if (!n.trim()) { toast.error("Name required"); return; }
    setBusy(true);
    try {
      const res = await addCondition(profileId, {
        name: n.trim(), status, diagnosis_date: diagDate || null, notes: notes || null,
      });
      toast.success("Condition added");
      onAdded(res);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not add condition");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-soft px-4 py-4 rounded-2xl flex flex-col gap-3">
      <div className="text-[12px] font-bold uppercase tracking-wider" style={{ color: "#6B7595" }}>Quick add</div>
      <div className="flex flex-wrap gap-1.5">
        {QUICK_CONDITIONS.map((qc) => (
          <button key={qc} type="button" disabled={busy}
            onClick={() => submit(qc)}
            className="text-[12px] font-semibold px-3 py-1 rounded-full border transition hover:opacity-80"
            style={{ borderColor: "#5B7CFA40", color: "#5B7CFA", background: "#5B7CFA10" }}>
            {qc}
          </button>
        ))}
      </div>
      <div className="text-[12px] font-bold uppercase tracking-wider mt-1" style={{ color: "#6B7595" }}>Or enter manually</div>
      <input className="input text-[13px]" placeholder="Condition name" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <select className="input text-[13px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          {CONDITION_STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <input className="input text-[13px]" type="date" value={diagDate} onChange={(e) => setDiagDate(e.target.value)}
          max={new Date().toISOString().slice(0, 10)} placeholder="Diagnosis date" />
      </div>
      <textarea className="input text-[13px]" rows={2} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost flex-1 text-[13px] py-1.5">Cancel</button>
        <button type="button" onClick={() => submit()} disabled={busy || !name.trim()} className="btn-primary flex-1 text-[13px] py-1.5 inline-flex items-center justify-center gap-1">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
        </button>
      </div>
    </div>
  );
}

// ── Medications Section ────────────────────────────────────────────────────

function MedicationCard({ med, profileId, onUpdated, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: med.name, strength: med.strength || "", frequency: med.frequency || "", duration: med.duration || "", notes: med.notes || "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSave = async () => {
    setBusy(true);
    try {
      const res = await patchMedication(profileId, med.id, {
        name: form.name.trim(), strength: form.strength || null, frequency: form.frequency || null,
        duration: form.duration || null, notes: form.notes || null,
      });
      toast.success("Updated");
      onUpdated(res);
      setEditing(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Remove "${med.name}"?`)) return;
    setBusy(true);
    try {
      const res = await deleteMedication(profileId, med.id);
      toast.success("Removed");
      onDeleted(res);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not remove");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-soft px-4 py-3 flex flex-col gap-2 rounded-2xl">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="font-semibold text-[14px]" style={{ color: "#0F1836" }}>{med.name}</div>
          <div className="text-[12px] mt-0.5" style={{ color: "#6B7595" }}>
            {[med.strength, med.frequency].filter(Boolean).join(" · ")}
            {med.duration ? ` · ${med.duration}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setEditing((e) => !e)} className="w-7 h-7 rounded-full glass-soft flex items-center justify-center hover:opacity-80">
            <Pencil size={12} style={{ color: "#5B7CFA" }} />
          </button>
          <button type="button" onClick={handleDelete} disabled={busy} className="w-7 h-7 rounded-full glass-soft flex items-center justify-center hover:opacity-80">
            {busy ? <Loader2 size={12} className="animate-spin" style={{ color: "#E85A5A" }} /> : <Trash2 size={12} style={{ color: "#E85A5A" }} />}
          </button>
        </div>
      </div>
      {med.notes && !editing && (
        <div className="text-[12.5px]" style={{ color: "#6B7595" }}>{med.notes}</div>
      )}
      {editing && (
        <div className="flex flex-col gap-2 pt-1">
          <input className="input text-[13px]" placeholder="Medication name" value={form.name} onChange={set("name")} />
          <div className="grid grid-cols-2 gap-2">
            <input className="input text-[13px]" placeholder="Strength (e.g. 500mg)" value={form.strength} onChange={set("strength")} />
            <select className="input text-[13px]" value={form.frequency} onChange={set("frequency")}>
              <option value="">Frequency…</option>
              {FREQ_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <input className="input text-[13px]" placeholder="Duration (e.g. 3 months)" value={form.duration} onChange={set("duration")} />
          <textarea className="input text-[13px]" rows={2} placeholder="Notes (optional)" value={form.notes} onChange={set("notes")} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(false)} className="btn-ghost flex-1 text-[13px] py-1.5">Cancel</button>
            <button type="button" onClick={handleSave} disabled={busy} className="btn-primary flex-1 text-[13px] py-1.5 inline-flex items-center justify-center gap-1">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddMedicationForm({ profileId, onAdded, onCancel }) {
  const [form, setForm] = useState({ name: "", strength: "", frequency: "", duration: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    setBusy(true);
    try {
      const res = await addMedication(profileId, {
        name: form.name.trim(), strength: form.strength || null, frequency: form.frequency || null,
        duration: form.duration || null, notes: form.notes || null,
      });
      toast.success("Medication added");
      onAdded(res);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not add medication");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-soft px-4 py-4 rounded-2xl flex flex-col gap-3">
      <input className="input text-[13px]" placeholder="Medication name *" value={form.name} onChange={set("name")} />
      <div className="grid grid-cols-2 gap-2">
        <input className="input text-[13px]" placeholder="Strength (e.g. 500mg)" value={form.strength} onChange={set("strength")} />
        <select className="input text-[13px]" value={form.frequency} onChange={set("frequency")}>
          <option value="">Frequency…</option>
          {FREQ_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <input className="input text-[13px]" placeholder="Duration (e.g. 3 months)" value={form.duration} onChange={set("duration")} />
      <textarea className="input text-[13px]" rows={2} placeholder="Notes (optional)" value={form.notes} onChange={set("notes")} />
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost flex-1 text-[13px] py-1.5">Cancel</button>
        <button type="button" onClick={submit} disabled={busy || !form.name.trim()} className="btn-primary flex-1 text-[13px] py-1.5 inline-flex items-center justify-center gap-1">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
        </button>
      </div>
    </div>
  );
}

// ── Allergies Section ──────────────────────────────────────────────────────

function AllergyCard({ allergy, profileId, onDeleted }) {
  const [busy, setBusy] = useState(false);

  const handleDelete = async () => {
    if (!window.confirm(`Remove allergy to "${allergy.substance}"?`)) return;
    setBusy(true);
    try {
      const res = await deleteAllergy(profileId, allergy.id);
      toast.success("Removed");
      onDeleted(res);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not remove");
    } finally {
      setBusy(false);
    }
  };

  const sev = (allergy.severity || "").toLowerCase();
  return (
    <div className="glass-soft px-4 py-3 flex items-start gap-3 rounded-2xl">
      <div className="flex-1">
        <div className="font-semibold text-[14px]" style={{ color: "#0F1836" }}>{allergy.substance}</div>
        {allergy.reaction && (
          <div className="text-[12.5px] mt-0.5" style={{ color: "#6B7595" }}>{allergy.reaction}</div>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {sev && <Badge label={sev} color={SEVERITY_COLORS[sev] || "#9AA3BD"} />}
        <button type="button" onClick={handleDelete} disabled={busy} className="w-7 h-7 rounded-full glass-soft flex items-center justify-center hover:opacity-80">
          {busy ? <Loader2 size={12} className="animate-spin" style={{ color: "#E85A5A" }} /> : <Trash2 size={12} style={{ color: "#E85A5A" }} />}
        </button>
      </div>
    </div>
  );
}

function AddAllergyForm({ profileId, onAdded, onCancel }) {
  const [form, setForm] = useState({ substance: "", reaction: "", severity: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.substance.trim()) { toast.error("Substance required"); return; }
    setBusy(true);
    try {
      const res = await addAllergy(profileId, {
        substance: form.substance.trim(), reaction: form.reaction || null, severity: form.severity || null,
      });
      toast.success("Allergy added");
      onAdded(res);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not add allergy");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-soft px-4 py-4 rounded-2xl flex flex-col gap-3">
      <input className="input text-[13px]" placeholder="Substance / allergen *" value={form.substance} onChange={set("substance")} />
      <div className="grid grid-cols-2 gap-2">
        <input className="input text-[13px]" placeholder="Reaction (optional)" value={form.reaction} onChange={set("reaction")} />
        <select className="input text-[13px]" value={form.severity} onChange={set("severity")}>
          <option value="">Severity…</option>
          <option value="mild">Mild</option>
          <option value="moderate">Moderate</option>
          <option value="severe">Severe</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost flex-1 text-[13px] py-1.5">Cancel</button>
        <button type="button" onClick={submit} disabled={busy || !form.substance.trim()} className="btn-primary flex-1 text-[13px] py-1.5 inline-flex items-center justify-center gap-1">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
        </button>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function HealthRecord() {
  const { profileId } = useParams();
  const navigate = useNavigate();

  const [conditions, setConditions] = useState([]);
  const [medications, setMedications] = useState([]);
  const [allergies, setAllergies] = useState([]);
  const [loading, setLoading] = useState(true);

  const [openSection, setOpenSection] = useState("conditions");
  const [addingCondition, setAddingCondition] = useState(false);
  const [addingMedication, setAddingMedication] = useState(false);
  const [addingAllergy, setAddingAllergy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getHealthRecord(profileId);
      setConditions(data.conditions || []);
      setMedications((data.medications || []).filter((m) => typeof m === "object" && m?.id));
      setAllergies((data.allergies || []).filter((a) => typeof a === "object" && a?.id));
    } catch (e) {
      toast.error("Could not load health record");
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => { load(); }, [load]);

  const applyUpdate = (data) => {
    if (data?.conditions !== undefined) setConditions(data.conditions);
    if (data?.medications !== undefined) setMedications((data.medications || []).filter((m) => typeof m === "object" && m?.id));
    if (data?.allergies !== undefined) setAllergies((data.allergies || []).filter((a) => typeof a === "object" && a?.id));
  };

  const toggle = (s) => setOpenSection((cur) => (cur === s ? null : s));

  return (
    <div className="min-h-screen px-4 py-6 max-w-xl mx-auto flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full glass-soft flex items-center justify-center hover:opacity-80 shrink-0">
          <ArrowLeft size={16} style={{ color: "#0F1836" }} />
        </button>
        <div>
          <div className="font-display font-bold text-[20px]" style={{ color: "#0F1836" }}>Health Record</div>
          <div className="text-[12px]" style={{ color: "#6B7595" }}>Conditions · Medications · Allergies</div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin" style={{ color: "#5B7CFA" }} />
        </div>
      ) : (
        <>
          {/* ── Conditions ── */}
          <div className="flex flex-col gap-2">
            <SectionHeader icon={Activity} title="Conditions" count={conditions.length}
              open={openSection === "conditions"} onToggle={() => toggle("conditions")} accentColor="#3CC97C" />
            {openSection === "conditions" && (
              <div className="flex flex-col gap-2 pl-1">
                {conditions.map((c) => (
                  <ConditionCard key={c.id} cond={c} profileId={profileId}
                    onUpdated={applyUpdate} onDeleted={applyUpdate} />
                ))}
                {conditions.length === 0 && !addingCondition && (
                  <div className="text-[13px] text-center py-4" style={{ color: "#9AA3BD" }}>
                    No conditions recorded
                  </div>
                )}
                {addingCondition
                  ? <AddConditionForm profileId={profileId}
                      onAdded={(res) => { applyUpdate(res); setAddingCondition(false); }}
                      onCancel={() => setAddingCondition(false)} />
                  : <button type="button" onClick={() => setAddingCondition(true)}
                      className="w-full text-[13px] font-semibold py-2.5 rounded-2xl border-2 border-dashed transition hover:opacity-80"
                      style={{ borderColor: "#3CC97C50", color: "#3CC97C" }}>
                      <Plus size={13} className="inline mr-1" />Add condition
                    </button>
                }
              </div>
            )}
          </div>

          {/* ── Medications ── */}
          <div className="flex flex-col gap-2">
            <SectionHeader icon={Pill} title="Medications" count={medications.length}
              open={openSection === "medications"} onToggle={() => toggle("medications")} accentColor="#5B7CFA" />
            {openSection === "medications" && (
              <div className="flex flex-col gap-2 pl-1">
                {medications.map((m) => (
                  <MedicationCard key={m.id} med={m} profileId={profileId}
                    onUpdated={applyUpdate} onDeleted={applyUpdate} />
                ))}
                {medications.length === 0 && !addingMedication && (
                  <div className="text-[13px] text-center py-4" style={{ color: "#9AA3BD" }}>
                    No medications recorded
                  </div>
                )}
                {addingMedication
                  ? <AddMedicationForm profileId={profileId}
                      onAdded={(res) => { applyUpdate(res); setAddingMedication(false); }}
                      onCancel={() => setAddingMedication(false)} />
                  : <button type="button" onClick={() => setAddingMedication(true)}
                      className="w-full text-[13px] font-semibold py-2.5 rounded-2xl border-2 border-dashed transition hover:opacity-80"
                      style={{ borderColor: "#5B7CFA50", color: "#5B7CFA" }}>
                      <Plus size={13} className="inline mr-1" />Add medication
                    </button>
                }
              </div>
            )}
          </div>

          {/* ── Allergies ── */}
          <div className="flex flex-col gap-2">
            <SectionHeader icon={AlertTriangle} title="Allergies" count={allergies.length}
              open={openSection === "allergies"} onToggle={() => toggle("allergies")} accentColor="#E85A5A" />
            {openSection === "allergies" && (
              <div className="flex flex-col gap-2 pl-1">
                {allergies.map((a) => (
                  <AllergyCard key={a.id} allergy={a} profileId={profileId} onDeleted={applyUpdate} />
                ))}
                {allergies.length === 0 && !addingAllergy && (
                  <div className="text-[13px] text-center py-3" style={{ color: "#9AA3BD" }}>
                    No allergies recorded —{" "}
                    <button type="button" onClick={() => setAddingAllergy(true)}
                      className="underline" style={{ color: "#5B7CFA" }}>
                      Mark as none known
                    </button>
                  </div>
                )}
                {addingAllergy
                  ? <AddAllergyForm profileId={profileId}
                      onAdded={(res) => { applyUpdate(res); setAddingAllergy(false); }}
                      onCancel={() => setAddingAllergy(false)} />
                  : allergies.length > 0 && (
                      <button type="button" onClick={() => setAddingAllergy(true)}
                        className="w-full text-[13px] font-semibold py-2.5 rounded-2xl border-2 border-dashed transition hover:opacity-80"
                        style={{ borderColor: "#E85A5A50", color: "#E85A5A" }}>
                        <Plus size={13} className="inline mr-1" />Add allergy
                      </button>
                    )
                }
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

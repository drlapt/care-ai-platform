import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, X, Pill, FlaskConical, MessageCircle, Sparkles, Edit3, FileText, Loader2, Tag, CalendarClock } from "lucide-react";
import { listTemplates, createTemplate, updateTemplate, deleteTemplate } from "@/lib/api";

const ICON_CHOICES = ["📋", "🌡️", "🩺", "🩹", "💊", "🫁", "🫀", "🧠", "🦴", "👶", "🤰", "🧪"];

const BLANK_MED = { medication: "", dose: "", frequency: "twice daily", duration: "5 days", instructions: "", reason: "" };
const BLANK_TEST = { name: "", urgency: "routine", reason: "" };

function emptyForm() {
  return {
    name: "", icon: "📋", condition_tags: [],
    medications: [{ ...BLANK_MED }], tests: [],
    advice: "", follow_up: "",
  };
}

export default function Templates() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // form payload OR null
  const [saving, setSaving] = useState(false);

  const reload = () => {
    setLoading(true);
    return listTemplates()
      .then((d) => setItems(d || []))
      .catch(() => toast.error("Could not load templates"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, []);

  const openNew  = () => setEditing({ ...emptyForm(), _isNew: true });
  const openEdit = (t) => setEditing({ ...t, condition_tags: t.condition_tags || [], medications: t.medications?.length ? t.medications : [{ ...BLANK_MED }], tests: t.tests || [] });
  const close    = () => setEditing(null);

  const save = async () => {
    if (!editing.name?.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    const payload = {
      name: editing.name.trim(),
      icon: editing.icon || "📋",
      condition_tags: editing.condition_tags || [],
      medications: (editing.medications || []).filter((m) => (m.medication || "").trim()),
      tests: (editing.tests || []).filter((t) => (t.name || "").trim()),
      advice: editing.advice || "",
      follow_up: editing.follow_up || "",
    };
    try {
      if (editing._isNew) await createTemplate(payload);
      else await updateTemplate(editing.id, payload);
      toast.success(editing._isNew ? "Template created" : "Template updated");
      close();
      await reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (t) => {
    if (!window.confirm(`Delete "${t.name}"?`)) return;
    try {
      await deleteTemplate(t.id);
      toast.success("Template deleted");
      await reload();
    } catch {
      toast.error("Delete failed");
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-up" data-testid="templates-page">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-sm font-medium mb-2 inline-flex items-center gap-2" style={{ color: "#7C4DFF" }}>
            <Sparkles size={14} /> Phase 2 · Live
          </div>
          <h1 className="font-display font-extrabold text-[44px] leading-none" style={{ color: "#0F1836" }}>
            <span className="text-gradient">Templates</span> Studio
          </h1>
          <p className="text-sm mt-2 max-w-[640px]" style={{ color: "#6B7595" }}>
            One-click prescription + test packs. Save the way <span className="font-semibold">you</span> prescribe and apply it in any consultation.
          </p>
        </div>
        <button onClick={openNew} className="btn-primary inline-flex items-center gap-2" data-testid="templates-create-btn">
          <Plus size={14} /> New template
        </button>
      </header>

      {loading ? (
        <div className="glass-card p-10 flex items-center justify-center"><Loader2 className="animate-spin text-[#5B7CFA]" /></div>
      ) : items.length === 0 ? (
        <section className="glass-card p-10 flex flex-col items-center text-center gap-3" data-testid="templates-empty">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B7CFA,#7C4DFF)" }}>
            <FileText size={28} className="text-white" />
          </div>
          <div>
            <div className="font-display font-bold text-[20px]" style={{ color: "#0F1836" }}>No templates yet</div>
            <div className="text-[13px] mt-1 max-w-[480px]" style={{ color: "#6B7595" }}>
              Build your first template — a fever pack, a diabetes follow-up, a gastritis kit. Apply it in seconds inside any prescription.
            </div>
          </div>
          <button onClick={openNew} className="btn-primary inline-flex items-center gap-2 mt-2" data-testid="templates-empty-create-btn">
            <Plus size={14} /> Create your first template
          </button>
        </section>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="templates-grid">
          {items.map((t, idx) => (
            <article key={t.id} className="glass-card flex flex-col gap-3" data-testid={`template-card-${t.id}`}>
              <header className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0" style={{ background: "rgba(91,124,250,0.10)" }}>
                  {t.icon || "📋"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-bold text-[16px] truncate" style={{ color: "#0F1836" }}>{t.name}</div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-1">
                    {idx === 0 && t.usage_count > 0 && (
                      <span className="badge badge-success !py-0.5 inline-flex items-center gap-1"><Sparkles size={10} /> Most used</span>
                    )}
                    {(t.condition_tags || []).slice(0, 3).map((tag, i) => (
                      <span key={i} className="text-[10.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md inline-flex items-center gap-1" style={{ background: "rgba(124,77,255,0.10)", color: "#7C4DFF" }}>
                        <Tag size={9} /> {tag}
                      </span>
                    ))}
                    <span className="text-[10.5px]" style={{ color: "#6B7595" }}>· used {t.usage_count || 0}×</span>
                  </div>
                </div>
              </header>

              {t.medications?.length > 0 && (
                <div>
                  <div className="text-[10.5px] font-bold uppercase tracking-wider mb-1.5 inline-flex items-center gap-1" style={{ color: "#6B7595" }}>
                    <Pill size={10} /> Meds · {t.medications.length}
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {t.medications.slice(0, 3).map((m, i) => (
                      <li key={i} className="text-[12.5px]" style={{ color: "#2A3558" }}>
                        · {m.medication} {m.dose ? `${m.dose} ` : ""}{m.frequency ? `· ${m.frequency}` : ""}
                      </li>
                    ))}
                    {t.medications.length > 3 && <li className="text-[11.5px]" style={{ color: "#6B7595" }}>+ {t.medications.length - 3} more</li>}
                  </ul>
                </div>
              )}

              {t.tests?.length > 0 && (
                <div>
                  <div className="text-[10.5px] font-bold uppercase tracking-wider mb-1.5 inline-flex items-center gap-1" style={{ color: "#6B7595" }}>
                    <FlaskConical size={10} /> Tests · {t.tests.length}
                  </div>
                  <div className="text-[12.5px]" style={{ color: "#2A3558" }}>
                    {t.tests.slice(0, 3).map((x) => x.name).join(" · ")}
                  </div>
                </div>
              )}

              {t.advice && (
                <div>
                  <div className="text-[10.5px] font-bold uppercase tracking-wider mb-1 inline-flex items-center gap-1" style={{ color: "#6B7595" }}>
                    <MessageCircle size={10} /> Advice
                  </div>
                  <p className="text-[12.5px] line-clamp-2" style={{ color: "#2A3558" }}>{t.advice}</p>
                </div>
              )}

              {t.follow_up && (
                <div className="text-[11.5px] inline-flex items-center gap-1" style={{ color: "#5B7CFA" }}>
                  <CalendarClock size={11} /> {t.follow_up}
                </div>
              )}

              <div className="flex items-center gap-2 mt-1">
                <button onClick={() => openEdit(t)} className="btn-ghost flex-1 text-[12px] py-2 inline-flex items-center justify-center gap-1.5" data-testid={`template-edit-${t.id}`}>
                  <Edit3 size={11} /> Edit
                </button>
                <button onClick={() => onDelete(t)} className="btn-ghost text-[12px] py-2 px-3 inline-flex items-center justify-center gap-1.5 hover:!bg-red-50" style={{ color: "#E85A5A" }} data-testid={`template-delete-${t.id}`}>
                  <Trash2 size={11} />
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="glass-card p-5 flex items-center gap-4 flex-wrap" style={{ background: "rgba(91,124,250,0.06)", borderLeft: "4px solid #5B7CFA" }}>
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "rgba(91,124,250,0.14)" }}>
          <Sparkles size={18} className="text-[#5B7CFA]" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="font-semibold text-[14px]" style={{ color: "#0F1836" }}>Apply templates inside any prescription</div>
          <div className="text-[12.5px]" style={{ color: "#6B7595" }}>
            Open the Quick Prescribe modal on any patient and tap "Apply template" to load a pack in one click.
          </div>
        </div>
      </section>

      {editing && <TemplateEditor value={editing} onChange={setEditing} onClose={close} onSave={save} saving={saving} />}
    </div>
  );
}

function TemplateEditor({ value, onChange, onClose, onSave, saving }) {
  const v = value;
  const set = (patch) => onChange({ ...v, ...patch });

  const setMed   = (i, patch) => set({ medications: v.medications.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const addMed   = () => set({ medications: [...(v.medications || []), { ...BLANK_MED }] });
  const delMed   = (i) => set({ medications: v.medications.filter((_, j) => j !== i) });

  const setTest  = (i, patch) => set({ tests: v.tests.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const addTest  = () => set({ tests: [...(v.tests || []), { ...BLANK_TEST }] });
  const delTest  = (i) => set({ tests: v.tests.filter((_, j) => j !== i) });

  const tagsRaw = (v.condition_tags || []).join(", ");
  const setTags = (s) => set({ condition_tags: s.split(",").map((t) => t.trim()).filter(Boolean) });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,24,54,0.4)", backdropFilter: "blur(6px)" }} onClick={onClose} data-testid="template-editor-backdrop">
      <div className="glass-card w-full max-w-[680px] max-h-[90vh] overflow-y-auto flex flex-col gap-4" onClick={(e) => e.stopPropagation()} data-testid="template-editor">
        <header className="flex items-start justify-between gap-3 sticky top-0 bg-white/40 backdrop-blur-md -m-6 p-6 mb-0 border-b border-white/40">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl" style={{ background: "rgba(91,124,250,0.10)" }}>
              {v.icon || "📋"}
            </div>
            <div>
              <div className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>{v._isNew ? "New template" : "Edit template"}</div>
              <div className="text-[12px]" style={{ color: "#6B7595" }}>Save a reusable Rx + test pack</div>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/70 flex items-center justify-center" data-testid="template-editor-close"><X size={14} /></button>
        </header>

        <div className="flex flex-col gap-3 px-1">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field label="Name (required)">
              <input value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Fever (viral)" className="input" data-testid="template-name-input" />
            </Field>
            <Field label="Icon">
              <select value={v.icon} onChange={(e) => set({ icon: e.target.value })} className="input !text-2xl !text-center !w-[72px]" data-testid="template-icon-select">
                {ICON_CHOICES.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Condition tags · comma separated">
            <input value={tagsRaw} onChange={(e) => setTags(e.target.value)} placeholder="fever, viral, paediatric" className="input" data-testid="template-tags-input" />
          </Field>

          <Section title="Medications" icon={Pill} onAdd={addMed} testid="template-meds">
            {v.medications.map((m, i) => (
              <div key={i} className="glass-soft p-3 rounded-2xl flex flex-col gap-2" data-testid={`template-med-row-${i}`}>
                <div className="flex items-center gap-2">
                  <input value={m.medication} onChange={(e) => setMed(i, { medication: e.target.value })} placeholder="Medication name" className="input flex-1" />
                  <button onClick={() => delMed(i)} className="btn-ghost px-2 py-2" title="Remove" aria-label="Remove medication" data-testid={`template-med-delete-${i}`}><Trash2 size={12} className="text-[#E85A5A]" /></button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <input value={m.dose} onChange={(e) => setMed(i, { dose: e.target.value })} placeholder="Dose · 500mg" className="input" />
                  <input value={m.frequency} onChange={(e) => setMed(i, { frequency: e.target.value })} placeholder="Frequency · 1-0-1" className="input" />
                  <input value={m.duration} onChange={(e) => setMed(i, { duration: e.target.value })} placeholder="Duration · 5 days" className="input" />
                </div>
                <input value={m.instructions} onChange={(e) => setMed(i, { instructions: e.target.value })} placeholder="Instructions · after food" className="input" />
              </div>
            ))}
          </Section>

          <Section title="Tests / investigations" icon={FlaskConical} onAdd={addTest} testid="template-tests">
            {v.tests.length === 0 ? (
              <div className="text-[12px]" style={{ color: "#6B7595" }}>None — click "Add" to attach lab orders.</div>
            ) : v.tests.map((t, i) => (
              <div key={i} className="glass-soft p-3 rounded-2xl flex items-center gap-2" data-testid={`template-test-row-${i}`}>
                <input value={t.name} onChange={(e) => setTest(i, { name: e.target.value })} placeholder="Test name (CBC, HbA1c…)" className="input flex-1" />
                <select value={t.urgency} onChange={(e) => setTest(i, { urgency: e.target.value })} className="input !w-[110px]">
                  <option value="routine">Routine</option>
                  <option value="urgent">Urgent</option>
                  <option value="stat">Stat</option>
                </select>
                <button onClick={() => delTest(i)} className="btn-ghost px-2 py-2" aria-label="Remove test" data-testid={`template-test-delete-${i}`}><Trash2 size={12} className="text-[#E85A5A]" /></button>
              </div>
            ))}
          </Section>

          <Field label="Advice for the patient">
            <textarea value={v.advice} onChange={(e) => set({ advice: e.target.value })} placeholder="Rest, fluids, return if breathlessness or rash appears." className="input min-h-[70px]" data-testid="template-advice-input" />
          </Field>

          <Field label="Follow-up plan (optional)">
            <input value={v.follow_up} onChange={(e) => set({ follow_up: e.target.value })} placeholder="Review in 3 days if no improvement" className="input" data-testid="template-followup-input" />
          </Field>
        </div>

        <footer className="flex items-center justify-end gap-2 sticky bottom-0 bg-white/40 backdrop-blur-md -m-6 p-6 mt-2 border-t border-white/40">
          <button onClick={onClose} className="btn-ghost" data-testid="template-editor-cancel">Cancel</button>
          <button onClick={onSave} disabled={saving} className="btn-primary inline-flex items-center gap-1.5" data-testid="template-editor-save">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {saving ? "Saving…" : (v._isNew ? "Create template" : "Save changes")}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "#6B7595" }}>{label}</span>
      {children}
    </label>
  );
}

function Section({ title, icon: Icon, onAdd, testid, children }) {
  return (
    <div className="flex flex-col gap-2 mt-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon size={13} className="text-[#5B7CFA]" />
          <span className="text-[12px] font-bold uppercase tracking-wider" style={{ color: "#0F1836" }}>{title}</span>
        </div>
        <button onClick={onAdd} className="btn-ghost text-[11px] py-1.5 px-2 inline-flex items-center gap-1" data-testid={`${testid}-add`}>
          <Plus size={11} /> Add
        </button>
      </div>
      <div className="flex flex-col gap-2" data-testid={`${testid}-list`}>{children}</div>
    </div>
  );
}

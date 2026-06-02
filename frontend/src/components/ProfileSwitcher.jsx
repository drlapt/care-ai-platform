import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Users, Plus, ChevronDown, Check, X, Loader2, UserPlus, User as UserIcon } from "lucide-react";
import { listProfiles, createProfile, switchProfile } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const REL_LABEL = {
  self: "You",
  mother: "Mother",
  father: "Father",
  spouse: "Spouse",
  child: "Child",
  sibling: "Sibling",
  family: "Family",
  guest: "Guest",
};

const REL_COLOR = {
  self: "#5B7CFA",
  mother: "#E85A5A",
  father: "#3CC97C",
  spouse: "#7C4DFF",
  child: "#F2994A",
  sibling: "#28A55B",
  family: "#7C4DFF",
  guest: "#9AA3BD",
};

export default function ProfileSwitcher() {
  const { user, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [max, setMax] = useState(5);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(null);
  const [form, setForm] = useState({ name: "", age: "", gender: "female", relationship: "family" });

  const load = () => listProfiles().then((d) => {
    setProfiles(d.profiles || []);
    setActiveId(d.active_profile_id);
    setMax(d.max || 5);
  }).catch(() => {});

  useEffect(() => { load(); }, [user?.linked_patient_id]);

  const active = profiles.find((p) => p.id === activeId) || profiles[0];

  const onSwitch = async (pid) => {
    if (pid === activeId) { setOpen(false); return; }
    setBusy(pid);
    try {
      await switchProfile(pid);
      await refresh?.();
      setActiveId(pid);
      toast.success("Switched profile");
      setOpen(false);
      // Force reload of patient-scoped data
      window.location.reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not switch");
    } finally {
      setBusy(null);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Name required"); return; }
    setBusy("create");
    try {
      await createProfile({
        name: form.name.trim(),
        age: form.age ? Number(form.age) : null,
        gender: form.gender,
        relationship: form.relationship,
      });
      toast.success(`Added ${form.name}`);
      setAdding(false);
      setForm({ name: "", age: "", gender: "female", relationship: "family" });
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not add profile");
    } finally {
      setBusy(null);
    }
  };

  if (!active) return null;

  const initial = (active.name || "?").charAt(0).toUpperCase();
  const color = REL_COLOR[active.relationship] || "#5B7CFA";

  return (
    <div className="relative" data-testid="profile-switcher">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="glass-soft px-3 py-2 inline-flex items-center gap-2.5 rounded-2xl hover:shadow-md transition"
        data-testid="profile-switcher-toggle"
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[12.5px] font-bold"
          style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
        >
          {initial}
        </div>
        <div className="text-left">
          <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#6B7595" }}>
            {REL_LABEL[active.relationship] || "Profile"}
          </div>
          <div className="font-semibold text-[13.5px]" style={{ color: "#0F1836" }}>{active.name}</div>
        </div>
        <ChevronDown size={14} className="text-[#6B7595]" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setAdding(false); }} />
          <div
            className="absolute z-50 right-0 top-[calc(100%+8px)] w-[320px] glass-card !p-3 flex flex-col gap-2"
            data-testid="profile-switcher-menu"
          >
            <div className="flex items-center justify-between px-1 pb-1">
              <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "#6B7595" }}>
                <Users size={11} className="inline mr-1" /> Profiles · {profiles.length}/{max}
              </div>
              {!adding && profiles.length < max && (
                <button
                  onClick={() => setAdding(true)}
                  className="text-[11px] font-semibold inline-flex items-center gap-1"
                  style={{ color: "#5B7CFA" }}
                  data-testid="profile-switcher-add-btn"
                >
                  <Plus size={11} /> Add
                </button>
              )}
            </div>

            {!adding && profiles.map((p) => {
              const c = REL_COLOR[p.relationship] || "#5B7CFA";
              const sel = p.id === activeId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSwitch(p.id)}
                  disabled={busy === p.id}
                  className="text-left px-2 py-2 rounded-xl hover:bg-white/80 transition flex items-center gap-2.5"
                  style={sel ? { background: `${c}10` } : {}}
                  data-testid={`profile-option-${p.id}`}
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-[13px] shrink-0"
                    style={{ background: `linear-gradient(135deg, ${c}, ${c}cc)` }}
                  >
                    {(p.name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[13.5px] truncate" style={{ color: "#0F1836" }}>{p.name}</div>
                    <div className="text-[11px] truncate" style={{ color: c }}>
                      {REL_LABEL[p.relationship] || "Profile"}
                      {p.age ? ` · ${p.age}y` : ""}
                      {p.consultation_count ? ` · ${p.consultation_count} visit${p.consultation_count === 1 ? "" : "s"}` : ""}
                    </div>
                  </div>
                  {sel && <Check size={14} style={{ color: c }} />}
                  {busy === p.id && <Loader2 size={14} className="animate-spin" style={{ color: c }} />}
                </button>
              );
            })}

            {!adding && profiles.length >= max && (
              <div className="px-2 py-2 text-[11px]" style={{ color: "#6B7595" }}>
                You've added all {max} profiles. Delete one in Settings to add another.
              </div>
            )}

            {adding && (
              <form onSubmit={submit} className="flex flex-col gap-2 px-1 pt-1" data-testid="profile-add-form">
                <div className="flex items-center justify-between">
                  <div className="text-[12px] font-bold inline-flex items-center gap-1" style={{ color: "#0F1836" }}>
                    <UserPlus size={12} /> Add a profile
                  </div>
                  <button type="button" onClick={() => setAdding(false)} className="w-6 h-6 rounded-full bg-white/70 flex items-center justify-center"><X size={11} /></button>
                </div>
                <input
                  className="input"
                  placeholder="Full name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  data-testid="profile-add-name"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="input"
                    placeholder="Age"
                    type="number"
                    value={form.age}
                    onChange={(e) => setForm({ ...form, age: e.target.value })}
                    data-testid="profile-add-age"
                  />
                  <select
                    className="input"
                    value={form.gender}
                    onChange={(e) => setForm({ ...form, gender: e.target.value })}
                    data-testid="profile-add-gender"
                  >
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <select
                  className="input"
                  value={form.relationship}
                  onChange={(e) => setForm({ ...form, relationship: e.target.value })}
                  data-testid="profile-add-rel"
                >
                  <option value="mother">Mother</option>
                  <option value="father">Father</option>
                  <option value="spouse">Spouse</option>
                  <option value="child">Child</option>
                  <option value="sibling">Sibling</option>
                  <option value="family">Other family</option>
                  <option value="guest">Guest</option>
                </select>
                <button type="submit" disabled={busy === "create"} className="btn-primary text-[12px] py-2 inline-flex items-center justify-center gap-1.5" data-testid="profile-add-submit">
                  {busy === "create" ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Save profile
                </button>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}

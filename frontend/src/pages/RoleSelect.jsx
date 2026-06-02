import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Stethoscope, UserCircle2, ShieldCheck, ArrowRight, Sparkles } from "lucide-react";
import { authSetRole } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const ROLES = [
  { id: "doctor", label: "Doctor", icon: Stethoscope, desc: "Manage patients, run AI-assisted consultations, and track your practice." },
  { id: "patient", label: "Patient", icon: UserCircle2, desc: "View your visits, prescriptions, and message your care team." },
  { id: "admin", label: "Admin", icon: ShieldCheck, desc: "Multi-doctor practice management, analytics, and organization settings." },
];

export default function RoleSelect() {
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user, refresh } = useAuth();

  const submit = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      await authSetRole(selected);
      await refresh();
      navigate(selected === "patient" ? "/portal" : "/dashboard", { replace: true });
    } catch (e) {
      toast.error("Could not save role. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" data-testid="role-select-page">
      <div className="max-w-[720px] w-full animate-fade-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B7CFA 0%, #7C4DFF 100%)" }}>
            <Sparkles className="text-white" size={18} />
          </div>
          <div>
            <div className="text-sm font-medium" style={{ color: "#6B7595" }}>Welcome, {user?.name}</div>
            <div className="font-display font-bold text-[22px]" style={{ color: "#0F1836" }}>How will you use Project Care?</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {ROLES.map((r) => {
            const active = selected === r.id;
            return (
              <button
                key={r.id}
                onClick={() => setSelected(r.id)}
                className={`glass-card text-left transition-all ${active ? "ring-2 ring-[#5B7CFA]" : ""}`}
                style={active ? { background: "rgba(91,124,250,0.10)" } : undefined}
                data-testid={`role-${r.id}`}
              >
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: active ? "linear-gradient(135deg,#5B7CFA,#7C4DFF)" : "rgba(91,124,250,0.12)" }}>
                  <r.icon size={22} className={active ? "text-white" : "text-[#5B7CFA]"} />
                </div>
                <h3 className="font-display font-bold text-[20px] mb-2" style={{ color: "#0F1836" }}>{r.label}</h3>
                <p className="text-[13px] leading-relaxed" style={{ color: "#6B7595" }}>{r.desc}</p>
              </button>
            );
          })}
        </div>

        <div className="flex justify-end">
          <button onClick={submit} disabled={!selected || loading} className="btn-primary inline-flex items-center gap-2" data-testid="role-continue">
            {loading ? "Saving…" : "Continue"} <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

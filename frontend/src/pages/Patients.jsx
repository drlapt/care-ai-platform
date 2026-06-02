import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, Plus, ChevronRight } from "lucide-react";
import { listPatients } from "@/lib/api";

export default function Patients() {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    listPatients()
      .then(setPatients)
      .catch(() => setPatients([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () =>
      patients.filter((p) => {
        const term = q.toLowerCase();
        return (
          (p.personal_info?.name || "").toLowerCase().includes(term) ||
          (p.chief_complaint || "").toLowerCase().includes(term)
        );
      }),
    [patients, q]
  );

  return (
    <div className="flex flex-col gap-6 animate-fade-up" data-testid="patients-page">
      <header className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-sm font-medium mb-2" style={{ color: "#6B7595" }}>Patient registry</div>
          <h1 className="font-display font-extrabold text-[44px] leading-none" style={{ color: "#0F1836" }}>Patients</h1>
        </div>
        <Link to="/patients/new" className="btn-primary inline-flex items-center gap-2" data-testid="new-patient-btn">
          <Plus size={18} /> New Patient
        </Link>
      </header>

      <div className="glass-card" style={{ padding: 18 }}>
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: "#6B7595" }} />
          <input
            className="form-input pl-11"
            placeholder="Search by name or complaint…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="patients-search-input"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="glass-card" style={{ height: 180 }}>
              <div className="shimmer w-full h-6 rounded mb-3" />
              <div className="shimmer w-3/4 h-4 rounded mb-2" />
              <div className="shimmer w-full h-4 rounded" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card text-center" data-testid="patients-empty">
          <div className="text-lg font-semibold mb-2" style={{ color: "#0F1836" }}>No patients yet</div>
          <div className="text-sm mb-5" style={{ color: "#6B7595" }}>Register your first patient to get started.</div>
          <Link to="/patients/new" className="btn-primary inline-flex items-center gap-2">
            <Plus size={18} /> New Patient
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => navigate(`/patients/${p.id}`)}
              className="glass-card text-left hover:-translate-y-1 transition-transform"
              data-testid={`patient-card-${p.id}`}
            >
              <div className="flex items-start gap-4 mb-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] text-white font-semibold text-lg flex items-center justify-center shrink-0">
                  {(p.personal_info?.name || "?").split(" ").map(n => n[0]).slice(0,2).join("")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[17px] truncate" style={{ color: "#0F1836" }}>{p.personal_info?.name}</div>
                  <div className="text-[13px]" style={{ color: "#6B7595" }}>
                    {p.personal_info?.age}y · {p.personal_info?.gender} · {p.personal_info?.phone}
                  </div>
                </div>
                <ChevronRight size={18} style={{ color: "#5B7CFA" }} />
              </div>

              <div className="text-[13px] line-clamp-2 mb-4" style={{ color: "#2A3558" }}>{p.chief_complaint}</div>

              <div className="flex items-center justify-between">
                <span className="badge">{p.consultation_count} consultations</span>
                <span className="text-[12px] font-medium" style={{ color: "#6B7595" }}>{p.profile_completeness}% complete</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

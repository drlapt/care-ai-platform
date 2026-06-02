import { useEffect, useState } from "react";
import { Search, Stethoscope, Baby, Heart, Activity, Brain, Eye, Bone, Scan, Flower2 } from "lucide-react";
import { getStats } from "@/lib/api";

const SPECIALTIES = [
  { name: "General", icon: Stethoscope },
  { name: "Pediatrics", icon: Baby },
  { name: "OB/GYN", icon: Flower2 },
  { name: "Internal", icon: Heart },
  { name: "Dermatology", icon: Scan },
  { name: "Mental Health", icon: Brain },
  { name: "Cardiology", icon: Activity },
  { name: "Orthopedics", icon: Bone },
  { name: "Infectious", icon: Eye },
];

export default function RightPanel() {
  const [query, setQuery] = useState("");
  const [stats, setStats] = useState({ queue_current: "C15", queue_position: "4 of 18", queue_eta: "16:10", total_patients: 0 });

  useEffect(() => {
    getStats().then(setStats).catch(() => {});
  }, []);

  const filtered = SPECIALTIES.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <aside className="right-panel flex flex-col gap-5" style={{ position: "sticky", top: 24, height: "calc(100vh - 48px)", overflowY: "auto" }} data-testid="right-panel">
      <section className="glass-card" data-testid="find-doctor-panel">
        <h3 className="font-display font-bold text-[20px] mb-4" style={{ color: "#0F1836" }}>Find a doctor</h3>
        <div className="relative mb-5">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: "#6B7595" }} />
          <input
            className="form-input pl-11 text-sm"
            placeholder="Search here…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="doctor-search-input"
          />
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          {filtered.map((s) => (
            <button key={s.name} className="specialty-card" data-testid={`specialty-${s.name.toLowerCase()}`}>
              <s.icon className="specialty-icon" strokeWidth={1.6} />
              <span className="text-[11px] font-semibold leading-tight" style={{ color: "#2A3558" }}>{s.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="glass-card" data-testid="queue-panel">
        <h3 className="font-display font-bold text-[20px] mb-4" style={{ color: "#0F1836" }}>Appointment queue</h3>

        <div className="glass-soft p-4 mb-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "#6B7595" }}>Cardiology</div>
            <div className="font-semibold text-[15px] mt-0.5" style={{ color: "#0F1836" }}>Dr. James Carter</div>
          </div>
          <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center shadow-sm">
            <Activity size={16} className="text-[#5B7CFA]" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <QueueStat label="Queue" value={stats.queue_current} testid="queue-current" />
          <QueueStat label="Position" value={stats.queue_position} testid="queue-position" />
          <QueueStat label="ETA" value={stats.queue_eta} testid="queue-eta" />
        </div>
      </section>
    </aside>
  );
}

function QueueStat({ label, value, testid }) {
  return (
    <div className="glass-soft p-3 text-center" data-testid={testid}>
      <div className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "#6B7595" }}>{label}</div>
      <div className="font-display font-bold text-[17px] mt-1" style={{ color: "#0F1836" }}>{value}</div>
    </div>
  );
}

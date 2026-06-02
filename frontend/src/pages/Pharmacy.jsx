import { useEffect, useState, useMemo } from "react";
import { Pill, Search, Clock, AlertCircle } from "lucide-react";
import { listPrescriptions } from "@/lib/api";

export default function Pharmacy() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");

  useEffect(() => { listPrescriptions().then(setItems).catch(() => setItems([])); }, []);

  const filtered = useMemo(() => items.filter((i) =>
    (i.medication || "").toLowerCase().includes(q.toLowerCase()) ||
    (i.patient_name || "").toLowerCase().includes(q.toLowerCase())
  ), [items, q]);

  return (
    <div className="flex flex-col gap-6 animate-fade-up" data-testid="pharmacy-page">
      <header>
        <div className="text-sm font-medium mb-2" style={{ color: "#6B7595" }}>Prescription management</div>
        <h1 className="font-display font-extrabold text-[44px] leading-none" style={{ color: "#0F1836" }}>Pharmacy</h1>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Total prescriptions" value={items.length} />
        <Stat label="Unique patients" value={new Set(items.map(i => i.patient_id)).size} />
        <Stat label="From consultations" value={items.filter(i => (i.source||"").startsWith("consultation")).length} />
        <Stat label="Active this week" value={items.filter(i => i.date && (Date.now() - new Date(i.date).getTime()) < 7*24*3600*1000).length} />
      </div>

      <div className="glass-card" style={{ padding: 16 }}>
        <div className="relative">
          <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: "#6B7595" }} />
          <input className="form-input pl-11" placeholder="Search by medication or patient…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="rx-search" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.length === 0 && (
          <div className="col-span-full glass-card text-center py-12">
            <div className="text-sm" style={{ color: "#6B7595" }}>No prescriptions found.</div>
          </div>
        )}
        {filtered.map((rx, i) => (
          <div key={`${rx.patient_id}-${i}`} className="glass-card" data-testid={`rx-card-${i}`}>
            <div className="flex items-start gap-3 mb-3">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "rgba(60,201,124,0.12)" }}>
                <Pill size={18} className="text-[#28A55B]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[16px] truncate" style={{ color: "#0F1836" }}>{rx.medication || "—"}</div>
                <div className="text-[12px] truncate" style={{ color: "#6B7595" }}>{rx.patient_name}</div>
              </div>
            </div>
            {rx.purpose && <div className="text-[13px] mb-2" style={{ color: "#2A3558" }}>{rx.purpose}</div>}
            <div className="flex flex-col gap-1 text-[12.5px]" style={{ color: "#2A3558" }}>
              {rx.when_to_take && <Row icon={Clock} label={rx.when_to_take} />}
              {rx.how_often && <div><span className="font-semibold">How often:</span> {rx.how_often}</div>}
              {rx.duration && <div><span className="font-semibold">Duration:</span> {rx.duration}</div>}
              {rx.frequency && <div><span className="font-semibold">Frequency:</span> {rx.frequency}</div>}
              {rx.warnings && (
                <div className="flex items-center gap-1.5 text-[#E85A5A] font-semibold mt-1"><AlertCircle size={12} /> {rx.warnings}</div>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between text-[11px]" style={{ color: "#6B7595" }}>
              <span>{rx.source}</span>
              {rx.date && <span>{new Date(rx.date).toLocaleDateString()}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ icon: Icon, label }) {
  return <div className="flex items-center gap-1.5"><Icon size={12} className="text-[#5B7CFA]" /> {label}</div>;
}

function Stat({ label, value }) {
  return (
    <div className="glass-card text-center">
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>{label}</div>
      <div className="font-display font-bold text-[32px] mt-1" style={{ color: "#0F1836" }}>{value}</div>
    </div>
  );
}

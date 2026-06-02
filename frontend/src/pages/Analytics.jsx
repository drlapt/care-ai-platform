import { useEffect, useState } from "react";
import { Users, Stethoscope, CalendarCheck, MessageCircle, Clock, AlertTriangle, TrendingUp } from "lucide-react";
import { getAnalytics } from "@/lib/api";

export default function Analytics() {
  const [data, setData] = useState(null);
  useEffect(() => { getAnalytics().then(setData).catch(() => setData(null)); }, []);

  if (!data) return <div className="glass-card" data-testid="analytics-loading">Loading analytics…</div>;

  const maxDay = Math.max(1, ...data.consultations_by_day.map(d => d.count));
  const maxCond = Math.max(1, ...data.top_conditions.map(c => c.count));

  return (
    <div className="flex flex-col gap-6 animate-fade-up" data-testid="analytics-page">
      <header>
        <div className="text-sm font-medium mb-2" style={{ color: "#6B7595" }}>Practice insights</div>
        <h1 className="font-display font-extrabold text-[44px] leading-none" style={{ color: "#0F1836" }}>Analytics</h1>
      </header>

      {/* Big KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi icon={Users} label="Total patients" value={data.total_patients} tint="#5B7CFA" />
        <Kpi icon={Stethoscope} label="Consultations" value={data.total_consultations} tint="#7C4DFF" />
        <Kpi icon={CalendarCheck} label="Appointments" value={data.total_appointments} tint="#3CC97C" />
        <Kpi icon={MessageCircle} label="Unread messages" value={data.unread_messages} tint="#F5A623" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
        {/* Time saved hero */}
        <div className="glass-card" data-testid="time-saved">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] flex items-center justify-center"><Clock size={16} className="text-white" /></div>
            <h3 className="font-display font-bold text-[20px]" style={{ color: "#0F1836" }}>Doctor time saved</h3>
          </div>
          <div className="flex items-end gap-4 flex-wrap">
            <div className="font-display font-extrabold text-[72px] leading-none text-gradient">{data.hours_saved}h</div>
            <div className="pb-3">
              <div className="text-[13px] font-semibold" style={{ color: "#2A3558" }}>{data.minutes_saved} minutes automated</div>
              <div className="text-[11px]" style={{ color: "#6B7595" }}>Based on 8 min/consultation average</div>
            </div>
          </div>
          <div className="glass-soft p-4 mt-5">
            <div className="text-[12px] font-semibold mb-1" style={{ color: "#5B7CFA" }}>💡 Insight</div>
            <div className="text-[13px]" style={{ color: "#2A3558" }}>
              At 40 consultations/week, AI-generated notes save your practice ~5.3 hours/week — roughly $400/week in saved admin time per doctor.
            </div>
          </div>
        </div>

        {/* Abnormal labs */}
        <div className="glass-card" data-testid="abnormal-labs">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-xl bg-[#E85A5A]/12 flex items-center justify-center"><AlertTriangle size={16} className="text-[#E85A5A]" /></div>
            <h3 className="font-display font-bold text-[20px]" style={{ color: "#0F1836" }}>Attention needed</h3>
          </div>
          <div className="flex flex-col gap-3">
            <Row label="Abnormal lab results" value={data.abnormal_labs} danger />
            <Row label="Unread patient messages" value={data.unread_messages} />
            <Row label="Patients with &lt; 80% profile" value={"—"} />
          </div>
        </div>
      </div>

      {/* Consultations timeline */}
      <div className="glass-card" data-testid="consultations-chart">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={16} className="text-[#5B7CFA]" />
          <h3 className="font-display font-bold text-[20px]" style={{ color: "#0F1836" }}>Consultations over time</h3>
        </div>
        {data.consultations_by_day.length === 0 ? (
          <div className="text-sm text-center py-8" style={{ color: "#6B7595" }}>No consultation history yet.</div>
        ) : (
          <div className="flex items-end gap-2 h-48">
            {data.consultations_by_day.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-2">
                <div className="text-[11px] font-semibold" style={{ color: "#2A3558" }}>{d.count}</div>
                <div className="w-full rounded-t-lg" style={{
                  height: `${(d.count / maxDay) * 100}%`,
                  minHeight: 8,
                  background: "linear-gradient(180deg,#5B7CFA,#7C4DFF)",
                }} />
                <div className="text-[10px]" style={{ color: "#6B7595" }}>{d.day.slice(5)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top conditions */}
      <div className="glass-card" data-testid="top-conditions">
        <h3 className="font-display font-bold text-[20px] mb-4" style={{ color: "#0F1836" }}>Top conditions seen</h3>
        {data.top_conditions.length === 0 ? (
          <div className="text-sm" style={{ color: "#6B7595" }}>Not enough data yet.</div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {data.top_conditions.map((c) => (
              <div key={c.name} className="flex items-center gap-3">
                <div className="text-[13px] font-semibold w-[40%] truncate" style={{ color: "#0F1836" }}>{c.name}</div>
                <div className="flex-1 h-3 rounded-full bg-white/60 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(c.count / maxCond) * 100}%`, background: "linear-gradient(90deg,#5B7CFA,#7C4DFF)" }} />
                </div>
                <div className="text-[12px] font-semibold" style={{ color: "#2A3558" }}>{c.count}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tint }) {
  return (
    <div className="glass-card" data-testid={`kpi-${label.toLowerCase().replace(/\s/g,'-')}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${tint}18` }}>
          <Icon size={16} style={{ color: tint }} />
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>{label}</div>
      </div>
      <div className="font-display font-bold text-[36px] leading-none" style={{ color: "#0F1836" }}>{value}</div>
    </div>
  );
}

function Row({ label, value, danger }) {
  return (
    <div className="glass-soft p-3 flex items-center justify-between">
      <div className="text-[13px]" style={{ color: "#2A3558" }} dangerouslySetInnerHTML={{ __html: label }} />
      <div className="font-display font-bold text-[20px]" style={{ color: danger && Number(value) > 0 ? "#E85A5A" : "#0F1836" }}>{value}</div>
    </div>
  );
}

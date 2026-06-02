import { Link } from "react-router-dom";
import { LineChart, Clock, ChevronRight } from "lucide-react";

function Spark({ data, color }) {
  if (!data || data.length === 0) {
    data = [2, 3, 2, 4, 3, 5, 4, 6, 5, 7];
  }
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const w = 200, h = 50;
  const pts = data.map((v, i) => {
    const x = (i / Math.max(1, data.length - 1)) * w;
    const y = h - ((v - min) / Math.max(1, max - min)) * h;
    return `${x},${y}`;
  }).join(" ");
  const area = `0,${h} ${pts} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-12" preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#spark-grad)" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function AnalyticsTeaser({ analytics }) {
  const byDay = (analytics?.consultations_by_day || []).slice(-10).map((d) => d.count);
  const hoursSaved = analytics?.hours_saved ?? 0;
  const totalConsults = analytics?.total_consultations ?? 0;
  const abnormal = analytics?.abnormal_labs ?? 0;

  return (
    <section className="glass-card flex flex-col gap-3" data-testid="analytics-teaser">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(91,124,250,0.12)" }}>
            <LineChart size={16} className="text-[#5B7CFA]" />
          </div>
          <h3 className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>Pulse</h3>
        </div>
        <Link to="/analytics" className="text-[12px] font-semibold inline-flex items-center gap-0.5" style={{ color: "#5B7CFA" }} data-testid="analytics-view-all">
          Open <ChevronRight size={12} />
        </Link>
      </header>

      <div className="glass-soft p-3 rounded-2xl">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "#6B7595" }}>Consults · last 10 days</div>
          <div className="text-[12px] font-semibold" style={{ color: "#5B7CFA" }}>{totalConsults} total</div>
        </div>
        <Spark data={byDay} color="#5B7CFA" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="glass-soft p-3 rounded-2xl flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(60,201,124,0.14)" }}>
            <Clock size={14} className="text-[#3CC97C]" />
          </div>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: "#6B7595" }}>AI saved</div>
            <div className="font-display font-bold text-[15px]" style={{ color: "#0F1836" }}>{hoursSaved} hrs</div>
          </div>
        </div>
        <div className="glass-soft p-3 rounded-2xl flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(232,90,90,0.14)" }}>
            <LineChart size={14} className="text-[#E85A5A]" />
          </div>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: "#6B7595" }}>Abnormal labs</div>
            <div className="font-display font-bold text-[15px]" style={{ color: "#0F1836" }}>{abnormal}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

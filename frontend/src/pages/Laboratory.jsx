import { useEffect, useState, useMemo } from "react";
import { FlaskConical, AlertTriangle, Check, TrendingUp, TrendingDown } from "lucide-react";
import { listLabResults } from "@/lib/api";

export default function Laboratory() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all"); // all|abnormal
  useEffect(() => { listLabResults().then(setItems).catch(() => setItems([])); }, []);

  const filtered = useMemo(() => filter === "abnormal" ? items.filter((i) => i.flag !== "normal") : items, [items, filter]);

  const abnormalCount = items.filter((i) => i.flag !== "normal").length;

  // Group by test for trends
  const byTest = useMemo(() => {
    const m = {};
    for (const it of items) {
      m[it.test_name] = m[it.test_name] || [];
      m[it.test_name].push(it);
    }
    Object.values(m).forEach((arr) => arr.sort((a, b) => (a.date || "").localeCompare(b.date || "")));
    return m;
  }, [items]);

  return (
    <div className="flex flex-col gap-6 animate-fade-up" data-testid="laboratory-page">
      <header>
        <div className="text-sm font-medium mb-2" style={{ color: "#6B7595" }}>Laboratory results</div>
        <h1 className="font-display font-extrabold text-[44px] leading-none" style={{ color: "#0F1836" }}>Laboratory</h1>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Total results" value={items.length} />
        <Stat label="Abnormal" value={abnormalCount} danger />
        <Stat label="High" value={items.filter(i => i.flag === "high").length} />
        <Stat label="Low" value={items.filter(i => i.flag === "low").length} />
      </div>

      <div className="glass-card" style={{ padding: 14 }}>
        <div className="flex gap-2">
          <button onClick={() => setFilter("all")} className={`px-4 py-2 rounded-2xl text-sm font-semibold transition ${filter === "all" ? "bg-white shadow-sm text-[#5B7CFA]" : "text-[#6B7595]"}`} data-testid="filter-all">All ({items.length})</button>
          <button onClick={() => setFilter("abnormal")} className={`px-4 py-2 rounded-2xl text-sm font-semibold transition ${filter === "abnormal" ? "bg-white shadow-sm text-[#E85A5A]" : "text-[#6B7595]"}`} data-testid="filter-abnormal">Abnormal ({abnormalCount})</button>
        </div>
      </div>

      <div className="glass-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-[20px]" style={{ color: "#0F1836" }}>Recent results</h3>
        </div>
        <div className="flex flex-col gap-2">
          {filtered.length === 0 && <div className="text-sm text-center py-8" style={{ color: "#6B7595" }}>No lab results.</div>}
          {filtered.map((r) => {
            const flagColor = r.flag === "high" ? "#E85A5A" : r.flag === "low" ? "#F5A623" : "#3CC97C";
            const FlagIcon = r.flag === "high" ? TrendingUp : r.flag === "low" ? TrendingDown : Check;
            return (
              <div key={r.id} className="glass-soft p-4 flex items-center gap-4 flex-wrap" data-testid={`lab-row-${r.id}`}>
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: `${flagColor}18` }}>
                  <FlaskConical size={18} style={{ color: flagColor }} />
                </div>
                <div className="flex-1 min-w-[180px]">
                  <div className="font-semibold text-[15px]" style={{ color: "#0F1836" }}>{r.test_name}</div>
                  <div className="text-[12px]" style={{ color: "#6B7595" }}>{r.patient_name}</div>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>Value</div>
                    <div className="font-display font-bold text-[18px]" style={{ color: flagColor }}>{r.value} <span className="text-[11px] font-semibold" style={{ color: "#6B7595" }}>{r.unit}</span></div>
                  </div>
                  {r.ref_low !== null && r.ref_high !== null && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>Ref. range</div>
                      <div className="text-[13px] font-medium" style={{ color: "#2A3558" }}>{r.ref_low} – {r.ref_high}</div>
                    </div>
                  )}
                  <span className={`badge inline-flex items-center gap-1 ${r.flag === "normal" ? "badge-success" : r.flag === "high" ? "badge-danger" : "badge-warning"}`}>
                    <FlagIcon size={10} /> {r.flag.toUpperCase()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {Object.keys(byTest).length > 0 && (
        <div className="glass-card">
          <h3 className="font-display font-bold text-[20px] mb-4" style={{ color: "#0F1836" }}>Trends</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(byTest).map(([test, arr]) => {
              const vals = arr.map(a => a.value);
              const max = Math.max(...vals);
              const min = Math.min(...vals);
              return (
                <div key={test} className="glass-soft p-4">
                  <div className="text-[13px] font-semibold mb-2" style={{ color: "#0F1836" }}>{test}</div>
                  <div className="flex items-end gap-1 h-16">
                    {arr.map((a, i) => {
                      const h = max === min ? 50 : ((a.value - min) / (max - min)) * 100;
                      const color = a.flag === "normal" ? "#3CC97C" : "#E85A5A";
                      return <div key={i} className="flex-1 rounded-t" style={{ height: `${Math.max(8, h)}%`, background: color, opacity: 0.7 }} />;
                    })}
                  </div>
                  <div className="text-[11px] mt-2" style={{ color: "#6B7595" }}>{arr.length} readings · latest {arr[arr.length-1].value} {arr[arr.length-1].unit}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, danger }) {
  return (
    <div className="glass-card text-center" data-testid={`stat-${label.toLowerCase().replace(/\s/g,'-')}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#6B7595" }}>{label}</div>
      <div className="font-display font-bold text-[32px] mt-1" style={{ color: danger && value > 0 ? "#E85A5A" : "#0F1836" }}>{value}</div>
    </div>
  );
}

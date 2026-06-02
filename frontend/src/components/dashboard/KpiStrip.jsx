import { Stethoscope, Users, CalendarClock, BellRing, Pill, Sparkles } from "lucide-react";

function tone(value, thresholds) {
  // thresholds: [{max, color}, {color (default)}]
  for (const t of thresholds) {
    if (typeof t.max === "number" && value <= t.max) return t.color;
    if (typeof t.min === "number" && value >= t.min) return t.color;
  }
  return thresholds[thresholds.length - 1].color;
}

function Kpi({ icon: Icon, label, value, sub, color = "#5B7CFA", pulse = false, testid }) {
  return (
    <div
      className="glass-card p-4 flex flex-col gap-3 transition hover:-translate-y-0.5 hover:shadow-lg"
      data-testid={testid}
    >
      <div className="flex items-center justify-between">
        <div
          className="w-10 h-10 rounded-2xl flex items-center justify-center"
          style={{ background: `${color}18` }}
        >
          <Icon size={18} style={{ color }} />
        </div>
        {pulse && (
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: color }} />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: color }} />
          </span>
        )}
      </div>
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "#6B7595" }}>{label}</div>
        <div className="font-display font-extrabold text-[28px] leading-tight mt-0.5" style={{ color: "#0F1836" }}>
          {value}
        </div>
        {sub && <div className="text-[11.5px] mt-0.5" style={{ color: "#6B7595" }}>{sub}</div>}
      </div>
    </div>
  );
}

export default function KpiStrip({ kpis }) {
  const {
    consultsToday = 0, consultsCompleted = 0,
    activePatients = 0, followupsDue = 0, overdueFollowups = 0,
    alertsCount = 0, rxToday = 0, satisfaction = null,
  } = kpis || {};

  const followupColor = tone(overdueFollowups, [
    { max: 0, color: "#6B7595" },
    { max: 4, color: "#F2994A" },
    { color: "#E85A5A" },
  ]);
  const alertColor = alertsCount > 0 ? "#E85A5A" : "#3CC97C";
  const satColor = !satisfaction ? "#6B7595" : (satisfaction >= 4.5 ? "#3CC97C" : satisfaction >= 4.0 ? "#F2994A" : "#E85A5A");

  return (
    <section
      className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3"
      data-testid="kpi-strip"
    >
      <Kpi
        icon={Stethoscope}
        label="Consults today"
        value={consultsToday}
        sub={`${consultsCompleted} done · ${Math.max(0, consultsToday - consultsCompleted)} pending`}
        color="#5B7CFA"
        testid="kpi-consults"
      />
      <Kpi
        icon={Users}
        label="Active patients"
        value={activePatients}
        sub="In your panel"
        color="#7C4DFF"
        testid="kpi-patients"
      />
      <Kpi
        icon={CalendarClock}
        label="Follow-ups due"
        value={followupsDue}
        sub={overdueFollowups > 0 ? `${overdueFollowups} overdue` : "On track"}
        color={followupColor}
        pulse={overdueFollowups >= 5}
        testid="kpi-followups"
      />
      <Kpi
        icon={BellRing}
        label="Open alerts"
        value={alertsCount}
        sub={alertsCount > 0 ? "Action needed" : "All clear"}
        color={alertColor}
        pulse={alertsCount > 0}
        testid="kpi-alerts"
      />
      <Kpi
        icon={Pill}
        label="Rx today"
        value={rxToday}
        sub="Issued this session"
        color="#3CC97C"
        testid="kpi-rx"
      />
      <Kpi
        icon={Sparkles}
        label="Satisfaction"
        value={satisfaction ? `${satisfaction.toFixed(1)}` : "—"}
        sub={satisfaction ? "out of 5" : "Awaiting feedback"}
        color={satColor}
        testid="kpi-satisfaction"
      />
    </section>
  );
}

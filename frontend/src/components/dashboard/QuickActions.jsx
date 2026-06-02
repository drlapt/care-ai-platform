import { Link } from "react-router-dom";
import { Stethoscope, UserPlus, Pill, FlaskConical, CalendarPlus, Sparkles } from "lucide-react";

const ACTIONS = [
  { label: "Start consultation", icon: Stethoscope, to: "/appointments", color: "#5B7CFA", testid: "qa-start-consult" },
  { label: "Add patient",         icon: UserPlus,    to: "/patients/new", color: "#7C4DFF", testid: "qa-add-patient" },
  { label: "Create Rx",           icon: Pill,        to: "/pharmacy", color: "#3CC97C", testid: "qa-create-rx" },
  { label: "Order lab",           icon: FlaskConical,to: "/laboratory", color: "#F2994A", testid: "qa-order-lab" },
  { label: "Add follow-up",       icon: CalendarPlus,to: "/followup", color: "#E85A5A", testid: "qa-add-followup" },
];

export default function QuickActions() {
  return (
    <section className="glass-card flex flex-col gap-3" data-testid="quick-actions-panel">
      <header className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(124,77,255,0.12)" }}>
          <Sparkles size={16} className="text-[#7C4DFF]" />
        </div>
        <h3 className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>Quick actions</h3>
      </header>
      <div className="grid grid-cols-2 gap-2">
        {ACTIONS.map(({ label, icon: Icon, to, color, testid }) => (
          <Link
            key={label}
            to={to}
            className="glass-soft p-3 flex items-center gap-2.5 hover:shadow-lg hover:-translate-y-0.5 transition"
            data-testid={testid}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: `${color}18` }}
            >
              <Icon size={16} style={{ color }} />
            </div>
            <span className="text-[12.5px] font-semibold" style={{ color: "#0F1836" }}>{label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

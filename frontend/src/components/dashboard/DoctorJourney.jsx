import { ShieldCheck, LayoutDashboard, Users, Bot, Stethoscope, FileText, Eye, Pill, AlertTriangle, CheckCircle, Calendar } from "lucide-react";

const STEPS = [
  { n: 1,  title: "Login",          desc: "Secure auth",          Icon: ShieldCheck, color: "#5B7CFA" },
  { n: 2,  title: "Dashboard",      desc: "Command center",       Icon: LayoutDashboard, color: "#5B7CFA" },
  { n: 3,  title: "Select patient", desc: "From queue",           Icon: Users, color: "#7C4DFF" },
  { n: 4,  title: "AI intake",      desc: "Pre-consult brief",    Icon: Bot, color: "#7C4DFF" },
  { n: 5,  title: "Consult",        desc: "Live with patient",    Icon: Stethoscope, color: "#7C4DFF" },
  { n: 6,  title: "AI summary",     desc: "Auto SOAP",            Icon: FileText, color: "#7C4DFF" },
  { n: 7,  title: "Review",         desc: "Doctor verifies",      Icon: Eye, color: "#5B7CFA" },
  { n: 8,  title: "Rx + Tests",     desc: "Build & order",        Icon: Pill, color: "#3CC97C" },
  { n: 9,  title: "Safety check",   desc: "Drug + allergy scan",  Icon: AlertTriangle, color: "#E85A5A" },
  { n: 10, title: "Finalize",       desc: "Sign & deliver",       Icon: CheckCircle, color: "#3CC97C" },
  { n: 11, title: "Follow-up",      desc: "24/7 Care AI",         Icon: Calendar, color: "#5B7CFA" },
];

export default function DoctorJourney() {
  return (
    <section className="glass-card flex flex-col gap-3" data-testid="doctor-journey">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="font-display font-bold text-[18px]" style={{ color: "#0F1836" }}>Your AI-assisted workflow</h3>
          <div className="text-[12px]" style={{ color: "#6B7595" }}>
            From login to follow-up — Care AI does the heavy lifting at every step.
          </div>
        </div>
      </header>

      <div className="overflow-x-auto -mx-2 px-2 pb-1 hide-scrollbar" data-testid="journey-rail">
        <div className="flex items-stretch gap-3 min-w-max">
          {STEPS.map(({ n, title, desc, Icon, color }, idx) => (
            <div key={n} className="flex items-center">
              <div
                className="glass-soft rounded-2xl px-3 py-3 w-[150px] flex flex-col gap-2 transition hover:-translate-y-0.5 hover:shadow-md"
                data-testid={`journey-step-${n}`}
                style={{ borderTop: `2px solid ${color}` }}
              >
                <div className="flex items-center justify-between">
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center"
                    style={{ background: `${color}18` }}
                  >
                    <Icon size={15} style={{ color }} />
                  </div>
                  <span
                    className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-md"
                    style={{ background: `${color}14`, color }}
                  >
                    {String(n).padStart(2, "0")}
                  </span>
                </div>
                <div>
                  <div className="font-semibold text-[13px] leading-tight" style={{ color: "#0F1836" }}>{title}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: "#6B7595" }}>{desc}</div>
                </div>
              </div>
              {idx < STEPS.length - 1 && (
                <div className="w-3 h-[1.5px] mx-1 shrink-0" style={{ background: "rgba(91,124,250,0.25)" }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Calendar, MessageSquare, Pill, FlaskConical,
  Settings, Users, UserCircle2, Sparkles,
  LogOut, BarChart3, Heart, BellRing, Clock, Video, FileText,
} from "lucide-react";
import { useAuth } from "@/lib/auth";

const NAV_DOCTOR = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, test: "nav-dashboard" },
  { to: "/patients", label: "Patients", icon: Users, test: "nav-patients" },
  { to: "/appointments", label: "Consultations", icon: Video, test: "nav-consultations" },
  { to: "/templates", label: "Templates", icon: FileText, test: "nav-templates" },
  { to: "/followup", label: "Follow-ups", icon: Sparkles, test: "nav-followup" },
  { to: "/alerts", label: "Alerts", icon: BellRing, test: "nav-alerts" },
  { to: "/laboratory", label: "Lab Results", icon: FlaskConical, test: "nav-laboratory" },
  { to: "/analytics", label: "Analytics", icon: BarChart3, test: "nav-analytics" },
  { to: "/reminders", label: "Reminders", icon: Clock, test: "nav-reminders" },
  { to: "/messages", label: "Messages", icon: MessageSquare, test: "nav-messages" },
  { to: "/pharmacy", label: "Pharmacy", icon: Pill, test: "nav-pharmacy" },
];

const NAV_PATIENT = [
  { to: "/portal", label: "My Health", icon: Heart, test: "nav-portal" },
  { to: "/followup", label: "24/7 Care AI", icon: Sparkles, test: "nav-followup" },
  { to: "/reminders", label: "My Reminders", icon: Clock, test: "nav-reminders" },
  { to: "/appointments", label: "Appointments", icon: Calendar, test: "nav-appointments" },
  { to: "/messages", label: "Messages", icon: MessageSquare, test: "nav-messages" },
  { to: "/pharmacy", label: "Prescriptions", icon: Pill, test: "nav-pharmacy" },
  { to: "/laboratory", label: "Lab Results", icon: FlaskConical, test: "nav-laboratory" },
];

export default function Sidebar() {
  const loc = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const isActive = (to) => (to === "/dashboard" ? loc.pathname === "/dashboard" : loc.pathname.startsWith(to));
  const NAV = user?.role === "patient" ? NAV_PATIENT : NAV_DOCTOR;

  return (
    <aside className="sidebar glass-card flex flex-col" style={{ padding: 20, position: "sticky", top: 24, height: "calc(100vh - 48px)" }} data-testid="sidebar">
      <div onClick={() => navigate(user?.role === "patient" ? "/portal" : "/dashboard")} className="flex items-center gap-3 mb-8 px-2 cursor-pointer">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B7CFA 0%, #7C4DFF 100%)", boxShadow: "0 6px 18px rgba(91,124,250,0.35)" }}>
          <Sparkles className="text-white" size={22} />
        </div>
        <div>
          <div className="font-display font-bold text-[18px] leading-tight" style={{ color: "#0F1836" }}>Project Care</div>
          <div className="text-[11px] leading-tight" style={{ color: "#6B7595" }}>AI-Powered Continuous Patient Care</div>
        </div>
      </div>

      <nav className="flex-1 flex flex-col gap-1.5 overflow-y-auto pr-1">
        {NAV.map(({ to, label, icon: Icon, test, soon }) => (
          <NavLink key={to} to={to} data-testid={test} className={() => `nav-item ${isActive(to) ? "active" : ""}`}>
            <Icon size={18} />
            <span className="flex-1">{label}</span>
            {soon && (
              <span className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md" style={{ background: "rgba(124,77,255,0.14)", color: "#7C4DFF" }}>
                Soon
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-4 pt-4 border-t border-white/60 flex items-center gap-3 px-2" data-testid="sidebar-user">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#5B7CFA] to-[#7C4DFF] flex items-center justify-center overflow-hidden">
          {user?.picture ? <img src={user.picture} alt="" className="w-full h-full object-cover" /> : <UserCircle2 className="text-white" size={20} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate" style={{ color: "#0F1836" }}>{user?.name || "—"}</div>
          <div className="text-xs capitalize" style={{ color: "#6B7595" }}>{user?.role || "—"}</div>
        </div>
        <button onClick={logout} className="w-8 h-8 rounded-full bg-white/70 flex items-center justify-center hover:bg-white transition" title="Logout" data-testid="logout-btn">
          <LogOut size={14} className="text-[#2A3558]" />
        </button>
      </div>
    </aside>
  );
}

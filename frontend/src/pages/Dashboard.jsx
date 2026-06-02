import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listPatients,
  listDoctorAlerts,
  listAppointments,
  listPrescriptions,
  listConsultationSessions,
  getAnalytics,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import KpiStrip from "@/components/dashboard/KpiStrip";
import ScheduleTimeline from "@/components/dashboard/ScheduleTimeline";
import LiveQueue from "@/components/dashboard/LiveQueue";
import ActiveConsultPanel from "@/components/dashboard/ActiveConsultPanel";
import AlertsSafetyPanel from "@/components/dashboard/AlertsSafetyPanel";
import QuickActions from "@/components/dashboard/QuickActions";
import AnalyticsTeaser from "@/components/dashboard/AnalyticsTeaser";
import DoctorJourney from "@/components/dashboard/DoctorJourney";
import WhatsAppActivity from "@/components/dashboard/WhatsAppActivity";

const today = () => new Date().toISOString().slice(0, 10);

function minutesSince(iso) {
  if (!iso) return 0;
  try {
    const t = new Date(iso).getTime();
    return Math.max(0, Math.round((Date.now() - t) / 60000));
  } catch {
    return 0;
  }
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isDoctor = user?.role === "doctor" || user?.role === "admin";
  const [patients, setPatients] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [appts, setAppts] = useState([]);
  const [rx, setRx] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [analytics, setAnalytics] = useState(null);

  // Patients land here only briefly before being routed to /portal in App router; guard anyway.
  useEffect(() => {
    if (user && user.role === "patient") navigate("/portal", { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    if (!isDoctor) return;
    Promise.all([
      listPatients().catch(() => []),
      listDoctorAlerts().catch(() => []),
      listAppointments().catch(() => []),
      listPrescriptions().catch(() => []),
      listConsultationSessions().catch(() => []),
      getAnalytics().catch(() => null),
    ]).then(([p, al, a, r, s, an]) => {
      setPatients(p); setAlerts(al); setAppts(a); setRx(r); setSessions(s); setAnalytics(an);
    });
  }, [isDoctor]);

  const td = today();

  const kpis = useMemo(() => {
    const todays = appts.filter((a) => a.date === td);
    const completed = todays.filter((a) => a.status === "completed" || a.status === "ended").length;
    const followups = appts.filter((a) => (a.type || "").toLowerCase().includes("follow") && ["scheduled", "requested"].includes(a.status));
    const overdue = followups.filter((a) => a.date < td).length;
    const rxToday = rx.filter((r) => (r.created_at || r.date || "").slice(0, 10) === td || (r.issued_at || "").slice(0, 10) === td).length;
    return {
      consultsToday: todays.length,
      consultsCompleted: completed,
      activePatients: patients.length,
      followupsDue: followups.length,
      overdueFollowups: overdue,
      alertsCount: alerts.filter((a) => a.status === "open" || !a.status).length,
      rxToday,
      satisfaction: null, // not yet tracked — KPI shows "—"
    };
  }, [appts, alerts, patients, rx, td]);

  const todaysSchedule = useMemo(() => {
    return appts
      .filter((a) => a.date === td)
      .sort((x, y) => (x.time || "").localeCompare(y.time || ""));
  }, [appts, td]);

  const liveQueue = useMemo(() => {
    // Patients waiting today: requested or scheduled, time <= now-ish, status not completed
    const queue = appts
      .filter((a) => a.date === td && ["requested", "scheduled"].includes(a.status))
      .map((a) => ({
        id: a.id,
        patient_name: a.patient_name,
        reason: a.reason || a.type,
        urgent: (a.reason || "").toLowerCase().includes("urgent") || (a.type || "").toLowerCase() === "emergency",
        intake_complete: sessions.some((s) => s.appointment_id === a.id && (s.intake_summary || (s.messages || []).length > 2)),
        waited_min: minutesSince(a.created_at),
      }));
    // Urgent first, then longest wait
    return queue.sort((a, b) => (Number(b.urgent) - Number(a.urgent)) || (b.waited_min - a.waited_min));
  }, [appts, sessions, td]);

  const activeSession = useMemo(() => {
    return sessions.find((s) => s.status === "in_progress" || s.status === "live" || s.status === "started" || s.status === "pending_rx") || null;
  }, [sessions]);

  if (!isDoctor) {
    return <div className="glass-card">Loading…</div>;
  }

  const date = new Date();

  return (
    <div className="flex flex-col gap-5 animate-fade-up" data-testid="dashboard-page">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-sm font-medium mb-2 inline-flex items-center gap-2" style={{ color: "#6B7595" }}>
            {date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </div>
          <h1 className="font-display font-extrabold text-[40px] sm:text-[48px] lg:text-[56px] leading-none" style={{ color: "#0F1836" }}>
            Command <span className="text-gradient">Center</span>
          </h1>
          <p className="text-sm mt-2 max-w-[600px]" style={{ color: "#6B7595" }}>
            Hi {user?.name?.split(" ")[0] || "Doctor"} — {kpis.consultsToday} consults today, {kpis.alertsCount} open alerts.
            Care AI has your back.
          </p>
        </div>
      </header>

      {/* KPI strip */}
      <KpiStrip kpis={kpis} />

      {/* Active consultation gets prominent space when one is live */}
      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-5">
        <ActiveConsultPanel session={activeSession} />
        <LiveQueue items={liveQueue} />
      </div>

      {/* Schedule + Alerts + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <ScheduleTimeline items={todaysSchedule} />
        <AlertsSafetyPanel alerts={alerts} />
        <QuickActions />
      </div>

      {/* Analytics + WhatsApp activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AnalyticsTeaser analytics={analytics} />
        <WhatsAppActivity />
      </div>

      {/* Doctor journey */}
      <DoctorJourney />
    </div>
  );
}

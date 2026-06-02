import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, ProtectedRoute } from "@/lib/auth";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Patients from "@/pages/Patients";
import PatientOnboarding from "@/pages/PatientOnboarding";
import PatientProfile from "@/pages/PatientProfile";
import Consultation from "@/pages/Consultation";
import ConsultationDetail from "@/pages/ConsultationDetail";
import Appointments from "@/pages/Appointments";
import Messages from "@/pages/Messages";
import Pharmacy from "@/pages/Pharmacy";
import Laboratory from "@/pages/Laboratory";
import Analytics from "@/pages/Analytics";
import Templates from "@/pages/Templates";
import PatientPortal from "@/pages/PatientPortal";
import FollowupChat from "@/pages/FollowupChat";
import Reminders from "@/pages/Reminders";
import Alerts from "@/pages/Alerts";
import PatientAlerts from "@/pages/PatientAlerts";
import ConsultationSession from "@/pages/ConsultationSession";
import Landing from "@/pages/Landing";
import Demo from "@/pages/Demo";
import Architecture from "@/pages/Architecture";
import Login from "@/pages/Login";
import AuthCallback from "@/pages/AuthCallback";
import RoleSelect from "@/pages/RoleSelect";
import SupportWidget from "@/components/SupportWidget";
import { useAuth } from "@/lib/auth";

function GlobalSupport() {
  const { user } = useAuth();
  if (!user) return null;
  return <SupportWidget />;
}

function AppRoutes() {
  const location = useLocation();
  // CRITICAL: synchronously intercept OAuth callback (before any other routing/auth checks)
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Landing />} />
      <Route path="/demo" element={<Demo />} />
      <Route path="/architecture" element={<Architecture />} />
      <Route path="/login" element={<Login />} />
      <Route path="/role-select" element={<ProtectedRoute><RoleSelect /></ProtectedRoute>} />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/patients" element={<Patients />} />
        <Route path="/patients/new" element={<PatientOnboarding />} />
        <Route path="/patients/:id" element={<PatientProfile />} />
        <Route path="/patients/:id/alerts" element={<ProtectedRoute roles={["doctor", "admin"]}><PatientAlerts /></ProtectedRoute>} />
        <Route path="/patients/:id/consultation" element={<Consultation />} />
        <Route path="/consultations/:id" element={<ConsultationDetail />} />
        <Route path="/appointments" element={<Appointments />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/pharmacy" element={<Pharmacy />} />
        <Route path="/laboratory" element={<Laboratory />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/templates" element={<ProtectedRoute roles={["doctor", "admin"]}><Templates /></ProtectedRoute>} />
        <Route path="/portal" element={<PatientPortal />} />
        <Route path="/followup" element={<FollowupChat />} />
        <Route path="/followup/:patientId" element={<FollowupChat />} />
        <Route path="/reminders" element={<Reminders />} />
        <Route path="/alerts" element={<ProtectedRoute roles={["doctor", "admin"]}><Alerts /></ProtectedRoute>} />
        <Route path="/consult/new" element={<ConsultationSession />} />
        <Route path="/consult/:sessionId" element={<ConsultationSession />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
          <GlobalSupport />
        </AuthProvider>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </div>
  );
}

export default App;

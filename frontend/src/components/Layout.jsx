import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import RightPanel from "./RightPanel";
import { useAuth } from "@/lib/auth";

export default function Layout() {
  const loc = useLocation();
  const { user } = useAuth();
  const focusMode =
    loc.pathname.includes("/consultation") ||
    loc.pathname.includes("/patients/new") ||
    loc.pathname.match(/^\/patients\/[^/]+$/) ||
    loc.pathname.startsWith("/messages") ||
    loc.pathname.startsWith("/analytics") ||
    loc.pathname.startsWith("/portal") ||
    loc.pathname.startsWith("/dashboard") ||
    loc.pathname.startsWith("/templates") ||
    loc.pathname.startsWith("/alerts") ||
    user?.role === "patient";

  return (
    <div className={focusMode ? "app-shell focus" : "app-shell"} style={focusMode ? { gridTemplateColumns: "260px 1fr" } : undefined}>
      <Sidebar />
      <main className="min-w-0" data-testid="main-content">
        <Outlet />
      </main>
      {!focusMode && <RightPanel />}
    </div>
  );
}

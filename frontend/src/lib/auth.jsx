import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { authMe, authLogout } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const u = await authMe();
      setUser(u);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    // CRITICAL: if returning from OAuth, skip /me - AuthCallback will handle it
    if (typeof window !== "undefined" && window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const logout = async () => {
    try { await authLogout(); } catch { /* ignore */ }
    setUser(null);
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass-card animate-pulse-soft px-8 py-6 font-medium" style={{ color: "#5B7CFA" }} data-testid="auth-loading">
          Verifying session…
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!user.role && location.pathname !== "/role-select") return <Navigate to="/role-select" replace />;
  if (roles && user.role && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return children;
}

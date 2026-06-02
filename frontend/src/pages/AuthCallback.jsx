import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { authExchangeSession } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function AuthCallback() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const hash = window.location.hash || "";
    const match = hash.match(/session_id=([^&]+)/);
    if (!match) {
      navigate("/login", { replace: true });
      return;
    }
    const session_id = decodeURIComponent(match[1]);

    (async () => {
      try {
        const res = await authExchangeSession(session_id);
        // Clear the hash
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        await refresh();
        if (res.needs_role) {
          navigate("/role-select", { replace: true });
        } else if (res.user?.role === "patient") {
          navigate("/portal", { replace: true });
        } else {
          navigate("/dashboard", { replace: true });
        }
      } catch (e) {
        console.error(e);
        toast.error("Sign-in failed. Please try again.");
        navigate("/login", { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="glass-card px-8 py-6 animate-pulse-soft font-medium" style={{ color: "#5B7CFA" }} data-testid="auth-callback">
        Completing sign-in…
      </div>
    </div>
  );
}

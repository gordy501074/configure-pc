import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import type { UserRole } from "../types";

/** Gate for authenticated users (customer/seller/admin). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, signingIn } = useAuth();
  const location = useLocation();
  if (signingIn) return null;
  if (!user) return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Gate for a specific role (e.g. admin). */
export function RequireRole({ role, children }: { role: UserRole; children: ReactNode }) {
  const { user, signingIn } = useAuth();
  if (signingIn) return null;
  if (!user || user.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}
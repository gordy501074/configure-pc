import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { Navbar } from "../components/ui";
import { getOnboarded } from "../lib/api";

export default function Layout() {
  const location = useLocation();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  // Re-fetch the onboarding flag whenever we navigate, so completing onboarding
  // (or the auth flow) updates the gate immediately instead of looping.
  useEffect(() => {
    let cancelled = false;
    setOnboarded(null);
    getOnboarded().then((v) => {
      if (!cancelled) setOnboarded(v);
    });
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  if (onboarded === null) return null;

  if (!onboarded && location.pathname !== "/onboarding" && location.pathname !== "/auth") {
    return <Navigate to="/onboarding" replace />;
  }

  const hideNavbar = location.pathname === "/onboarding" || location.pathname === "/auth";

  return (
    <div className="flex min-h-dvh flex-col">
      {!hideNavbar ? <Navbar /> : null}
      <main className="flex flex-1 flex-col py-6">
        <Outlet />
      </main>
      <footer className="mt-8 border-t bg-card py-5">
        <div className="container">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Сконфигурируй'КА — демо-конфигуратор. Данные
            вымышленные.
          </p>
        </div>
      </footer>
    </div>
  );
}
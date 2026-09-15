import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AppSettings } from "../types";
import { fetchSettings, saveSettingsRemote } from "./api";
import { useAuth } from "./auth";

interface ThemeCtx {
  theme: AppSettings["theme"];
  toggleTheme: () => void;
  setTheme: (t: AppSettings["theme"]) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

function applyTheme(theme: AppSettings["theme"]) {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [theme, setThemeState] = useState<AppSettings["theme"]>("light");

  // Load theme once we know the acting user.
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchSettings(userId).then((s) => {
      if (cancelled) return;
      setThemeState(s.theme);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const persist = useCallback(
    (next: AppSettings["theme"]) => {
      setThemeState(next);
      if (userId) saveSettingsRemote(userId, { theme: next }).catch(() => {});
    },
    [userId],
  );

  const setTheme = useCallback(
    (t: AppSettings["theme"]) => persist(t),
    [persist],
  );

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      persist(next);
      return next;
    });
  }, [persist]);

  const value = useMemo<ThemeCtx>(
    () => ({ theme, toggleTheme, setTheme }),
    [theme, toggleTheme, setTheme],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
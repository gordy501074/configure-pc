import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getSettings, setSettings } from "./storage";
import type { AppSettings } from "../types";

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
  const [theme, setThemeState] = useState<AppSettings["theme"]>(() =>
    getSettings().theme,
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((t: AppSettings["theme"]) => {
    setThemeState(t);
    setSettings({ ...getSettings(), theme: t });
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      setSettings({ ...getSettings(), theme: next });
      return next;
    });
  }, []);

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
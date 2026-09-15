import {
  createContext,
  useCallback,
  useMemo,
  useState,
  useContext,
  type ReactNode,
} from "react";
import type { User } from "../types";
import { getSession, setSession } from "./storage";

interface AuthCtx {
  user: User | null;
  signIn: (user: User) => void;
  signOut: () => void;
  isGuest: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => getSession());

  const signIn = useCallback((u: User) => {
    setSession(u);
    setUser(u);
  }, []);

  const signOut = useCallback(() => {
    setSession(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({ user, signIn, signOut, isGuest: user?.role === "guest" }),
    [user, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
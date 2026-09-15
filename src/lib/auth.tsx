import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useContext,
  type ReactNode,
} from "react";
import type { User } from "../types";
import { clearSessionId, getSessionId, setSessionId } from "./session";
import { getSession, signIn as apiSignIn, signOut as apiSignOut } from "./api";

interface AuthCtx {
  user: User | null;
  sessionId: string | null;
  signingIn: boolean;
  signIn: (user: Partial<User> & { name: string }) => Promise<User>;
  signOut: () => Promise<void>;
  isGuest: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [sessionId, setSessionIdState] = useState<string | null>(() => getSessionId());
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const sid = getSessionId();
    if (!sid) {
      setRestored(true);
      return;
    }
    getSession(sid).then((res) => {
      if (cancelled) return;
      if (res) setUser(res.user);
      else clearSessionId();
      setRestored(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (u: Partial<User> & { name: string }) => {
    const res = await apiSignIn(u);
    setSessionIdState(res.sessionId);
    setSessionId(res.sessionId);
    setUser(res.user);
    return res.user;
  }, []);

  const signOut = useCallback(async () => {
    const sid = getSessionId();
    if (sid) {
      try {
        await apiSignOut(sid);
      } catch {
        /* ignore */
      }
    }
    clearSessionId();
    setSessionIdState(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      sessionId,
      signingIn: !restored,
      signIn,
      signOut,
      isGuest: user?.role === "guest",
    }),
    [user, sessionId, restored, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
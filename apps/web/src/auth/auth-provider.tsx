import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import axios from "axios";

import { api, configureApiAuth } from "@/lib/api";
import { getStoredSession, setStoredSession, type StoredSession } from "@/lib/storage";

interface AuthContextValue {
  session: StoredSession | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, displayName: string, referralCode?: string | null) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  updateRecoveryEmail: (recoveryEmail: string | null) => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
  logout: () => void;
  refreshSession: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<StoredSession | null>(() =>
    typeof window === "undefined" ? null : getStoredSession(),
  );
  const [ready, setReady] = useState(false);

  async function refreshSession() {
    const current = getStoredSession();

    if (!current?.refreshToken) {
      setSession(null);
      setStoredSession(null);
      return null;
    }

    try {
      const response = await axios.post(`${api.defaults.baseURL}/auth/refresh`, {
        refreshToken: current.refreshToken,
      });

      setSession(response.data);
      setStoredSession(response.data);
      return response.data.accessToken as string;
    } catch {
      setSession(null);
      setStoredSession(null);
      return null;
    }
  }

  useEffect(() => {
    configureApiAuth({
      getAccessToken: () => getStoredSession()?.accessToken || null,
      refreshAccessToken: refreshSession,
    });
    setReady(true);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      ready,
      async login(username, password) {
        const response = await api.post("/auth/login", {
          username,
          password,
        });

        setSession(response.data);
        setStoredSession(response.data);
      },
      async register(username, email, password, displayName, referralCode) {
        const response = await api.post("/auth/register", {
          username,
          email,
          password,
          displayName,
          referralCode: referralCode || undefined,
        });

        setSession(response.data);
        setStoredSession(response.data);
      },
      async changePassword(currentPassword, newPassword) {
        const response = await api.post("/auth/change-password", {
          currentPassword,
          newPassword,
        });

        setSession(response.data);
        setStoredSession(response.data);
      },
      async updateRecoveryEmail(recoveryEmail) {
        const response = await api.put("/auth/recovery-email", {
          recoveryEmail,
        });

        const current = getStoredSession();

        if (current) {
          const nextSession = {
            ...current,
            user: {
              ...current.user,
              recoveryEmail: response.data.recoveryEmail,
            },
          };

          setSession(nextSession);
          setStoredSession(nextSession);
        }
      },
      async updateDisplayName(displayName) {
        const response = await api.put("/auth/me/display-name", {
          displayName,
        });

        const current = getStoredSession();

        if (current) {
          const nextSession = {
            ...current,
            user: {
              ...current.user,
              displayName: response.data.displayName,
            },
          };

          setSession(nextSession);
          setStoredSession(nextSession);
        }
      },
      logout() {
        setSession(null);
        setStoredSession(null);
      },
      refreshSession,
    }),
    [ready, session, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return context;
}

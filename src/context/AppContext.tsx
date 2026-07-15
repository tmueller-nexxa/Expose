import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AppData } from "../lib/types";
import {
  emptyAppData,
  isLoggedIn as readLocalAuth,
  loadAppData,
  saveAppData,
  setCloudUser,
  setLoggedIn as writeLocalAuth,
} from "../lib/storage";
import {
  authLogin,
  authLogout,
  authRegister,
  authReset,
  cloudEnabled,
  mapAuthError,
  onAuthChanged,
  type AuthUser,
} from "../lib/cloud";

interface AppContextValue {
  ready: boolean;
  loggedIn: boolean;
  cloudMode: boolean;
  authUser: AuthUser | null;
  // Im Cloud-Modus: echte Registrierung/Anmeldung/Passwort-Reset gegen Firebase.
  // Im lokalen Demo-Modus: jede nicht-leere Eingabe wird akzeptiert.
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  data: AppData;
  updateData: (updater: (prev: AppData) => AppData) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const cloud = cloudEnabled();
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedInState] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [data, setData] = useState<AppData>(emptyAppData());

  useEffect(() => {
    let alive = true;

    if (cloud) {
      // Sicherheitsnetz: falls Firebase in einer netzwerkgesperrten Umgebung
      // haengt, nicht ewig auf dem Ladebildschirm stehen bleiben.
      const safety = window.setTimeout(() => {
        if (alive) setReady(true);
      }, 6000);

      const unsub = onAuthChanged(async (u) => {
        if (!alive) return;
        window.clearTimeout(safety);
        setAuthUser(u);
        setCloudUser(u?.uid ?? null);
        if (u) {
          const loaded = await loadAppData();
          if (!alive) return;
          setData(loaded);
          setLoggedInState(true);
        } else {
          setData(emptyAppData());
          setLoggedInState(false);
        }
        setReady(true);
      });
      return () => {
        alive = false;
        window.clearTimeout(safety);
        unsub();
      };
    }

    // Lokaler Demo-Modus (kein Backend konfiguriert).
    (async () => {
      const loaded = await loadAppData();
      if (!alive) return;
      setData(loaded);
      setLoggedInState(readLocalAuth());
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [cloud]);

  const updateData = useCallback((updater: (prev: AppData) => AppData) => {
    setData((prev) => {
      const next = updater(prev);
      saveAppData(next);
      return next;
    });
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      if (cloud) {
        try {
          await authLogin(email, password);
        } catch (e) {
          throw new Error(mapAuthError(e));
        }
        return;
      }
      writeLocalAuth(true);
      setLoggedInState(true);
    },
    [cloud],
  );

  const register = useCallback(
    async (email: string, password: string) => {
      if (!cloud) {
        writeLocalAuth(true);
        setLoggedInState(true);
        return;
      }
      try {
        await authRegister(email, password);
      } catch (e) {
        throw new Error(mapAuthError(e));
      }
    },
    [cloud],
  );

  const resetPassword = useCallback(
    async (email: string) => {
      if (!cloud) return;
      try {
        await authReset(email);
      } catch (e) {
        throw new Error(mapAuthError(e));
      }
    },
    [cloud],
  );

  const logout = useCallback(async () => {
    if (cloud) {
      await authLogout();
      return;
    }
    writeLocalAuth(false);
    setLoggedInState(false);
  }, [cloud]);

  const value = useMemo(
    () => ({
      ready,
      loggedIn,
      cloudMode: cloud,
      authUser,
      login,
      register,
      resetPassword,
      logout,
      data,
      updateData,
    }),
    [ready, loggedIn, cloud, authUser, login, register, resetPassword, logout, data, updateData],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

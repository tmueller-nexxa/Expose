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
  setCloudErrorHandler,
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
  mapFirestoreError,
  onAuthChanged,
  type AuthUser,
} from "../lib/cloud";

interface AppContextValue {
  ready: boolean;
  loggedIn: boolean;
  cloudMode: boolean;
  authUser: AuthUser | null;
  // Fehler beim Laden/Speichern der Cloud-Daten (z.B. Sicherheitsregeln
  // fehlen noch). Wird angezeigt, damit die App nicht "einfach nichts tut".
  cloudError: string | null;
  clearCloudError: () => void;
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
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [data, setData] = useState<AppData>(emptyAppData());

  // Fehlgeschlagene Cloud-Speicherversuche (z.B. fehlende Sicherheitsregeln)
  // sichtbar machen, statt sie lautlos verschwinden zu lassen.
  useEffect(() => {
    if (!cloud) return;
    setCloudErrorHandler((msg) =>
      setCloudError(
        "Cloud-Speichern fehlgeschlagen (" +
          msg +
          "). Bitte prüfen, ob die Sicherheitsregeln deployt sind (SETUP-BACKEND.md, Schritt 7).",
      ),
    );
    return () => setCloudErrorHandler(null);
  }, [cloud]);

  useEffect(() => {
    let alive = true;

    if (cloud) {
      // Sicherheitsnetz: egal was passiert (Netzwerkproblem, fehlende
      // Sicherheitsregeln, haengende Anfrage) - der Ladebildschirm darf nie
      // fuer immer stehen bleiben.
      const safety = window.setTimeout(() => {
        if (alive) setReady(true);
      }, 8000);
      const finish = () => {
        window.clearTimeout(safety);
        if (alive) setReady(true);
      };

      const unsub = onAuthChanged(async (u) => {
        if (!alive) return;
        setAuthUser(u);
        setCloudUser(u?.uid ?? null);
        setCloudError(null);
        if (u) {
          try {
            const loaded = await loadAppData();
            if (!alive) return;
            setData(loaded);
            setLoggedInState(true);
          } catch (e) {
            if (!alive) return;
            console.error("Cloud-Daten konnten nicht geladen werden:", e);
            // Trotzdem anmelden (mit leeren Daten), aber Fehler sichtbar
            // machen - typischste Ursache: Sicherheitsregeln noch nicht
            // deployt (siehe SETUP-BACKEND.md).
            setData(emptyAppData());
            setLoggedInState(true);
            setCloudError(
              "Cloud-Daten konnten nicht geladen werden (" +
                mapFirestoreError(e) +
                "). Bitte prüfen, ob die Sicherheitsregeln deployt sind (SETUP-BACKEND.md, Schritt 7).",
            );
          }
        } else {
          setData(emptyAppData());
          setLoggedInState(false);
        }
        finish();
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
      cloudError,
      clearCloudError: () => setCloudError(null),
      login,
      register,
      resetPassword,
      logout,
      data,
      updateData,
    }),
    [
      ready,
      loggedIn,
      cloud,
      authUser,
      cloudError,
      login,
      register,
      resetPassword,
      logout,
      data,
      updateData,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

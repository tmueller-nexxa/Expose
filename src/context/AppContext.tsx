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
  isLoggedIn as readAuth,
  loadAppData,
  saveAppData,
  setLoggedIn as writeAuth,
} from "../lib/storage";

interface AppContextValue {
  ready: boolean;
  loggedIn: boolean;
  login: () => void;
  logout: () => void;
  data: AppData;
  updateData: (updater: (prev: AppData) => AppData) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedInState] = useState(false);
  const [data, setData] = useState<AppData>(emptyAppData());

  useEffect(() => {
    let alive = true;
    (async () => {
      const loaded = await loadAppData();
      if (!alive) return;
      setData(loaded);
      setLoggedInState(readAuth());
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const updateData = useCallback((updater: (prev: AppData) => AppData) => {
    setData((prev) => {
      const next = updater(prev);
      // Persistiere asynchron (nicht blockierend).
      void saveAppData(next);
      return next;
    });
  }, []);

  const login = useCallback(() => {
    writeAuth(true);
    setLoggedInState(true);
  }, []);

  const logout = useCallback(() => {
    writeAuth(false);
    setLoggedInState(false);
  }, []);

  const value = useMemo(
    () => ({ ready, loggedIn, login, logout, data, updateData }),
    [ready, loggedIn, login, logout, data, updateData],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

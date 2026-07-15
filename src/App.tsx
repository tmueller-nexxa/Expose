import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useApp } from "./context/AppContext";
import { LoginPage } from "./pages/LoginPage";
import { HomePage } from "./pages/HomePage";
import { DataPage } from "./pages/DataPage";
import { EditorPage } from "./pages/EditorPage";
import type { ReactNode } from "react";

function RequireAuth({ children }: { children: ReactNode }) {
  const { loggedIn } = useApp();
  const location = useLocation();
  if (!loggedIn) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

function CloudErrorBanner() {
  const { cloudError, clearCloudError } = useApp();
  if (!cloudError) return null;
  return (
    <div className="cloud-error-banner">
      <span>{cloudError}</span>
      <button onClick={clearCloudError} aria-label="Meldung schließen">
        ✕
      </button>
    </div>
  );
}

export default function App() {
  const { ready } = useApp();

  if (!ready) {
    return <div className="loading-screen">Wird geladen …</div>;
  }

  return (
    <>
      <CloudErrorBanner />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <HomePage />
            </RequireAuth>
          }
        />
        <Route
          path="/data"
          element={
            <RequireAuth>
              <DataPage />
            </RequireAuth>
          }
        />
        <Route
          path="/editor/:type"
          element={
            <RequireAuth>
              <EditorPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

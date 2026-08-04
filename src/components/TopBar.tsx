import { NavLink, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { IconLogout } from "./Icons";

export function TopBar() {
  const { logout, cloudMode, authUser } = useApp();
  const navigate = useNavigate();

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo-mark">E</span>
        Exposé&nbsp;KI
      </div>
      <nav>
        <NavLink to="/" end>
          Start
        </NavLink>
        <NavLink to="/data">Datenbereich</NavLink>
        <NavLink to="/ki-expose">KI Exposé</NavLink>
        <NavLink to="/exposes">Meine Exposés</NavLink>
      </nav>
      <div className="spacer" />
      {cloudMode && authUser?.email && (
        <span className="hint" style={{ marginRight: 4 }}>
          {authUser.email}
        </span>
      )}
      <button
        className="btn btn-ghost"
        onClick={async () => {
          await logout();
          navigate("/login");
        }}
      >
        <IconLogout size={18} /> Abmelden
      </button>
    </header>
  );
}

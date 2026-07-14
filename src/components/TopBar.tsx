import { NavLink, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { IconLogout } from "./Icons";

export function TopBar() {
  const { logout } = useApp();
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
      </nav>
      <div className="spacer" />
      <button
        className="btn btn-ghost"
        onClick={() => {
          logout();
          navigate("/login");
        }}
      >
        <IconLogout size={18} /> Abmelden
      </button>
    </header>
  );
}

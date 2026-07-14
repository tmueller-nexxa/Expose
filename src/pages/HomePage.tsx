import { useNavigate } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { useApp } from "../context/AppContext";
import { EXPOSE_TYPES, type ExposeType } from "../lib/types";
import {
  IconApartment,
  IconBuilding,
  IconCheck,
  IconHome,
  IconShop,
} from "../components/Icons";
import "./HomePage.css";

const ICONS: Record<ExposeType, JSX.Element> = {
  einfamilienhaus: <IconHome size={28} />,
  wohnung: <IconApartment size={28} />,
  mehrfamilienhaus: <IconBuilding size={28} />,
  gewerbe: <IconShop size={28} />,
};

export function HomePage() {
  const navigate = useNavigate();
  const { data } = useApp();

  const hasExamples = Object.values(data.examples).some((a) => a.length > 0);
  const hasStyle = data.styleTexts.length > 0;
  const hasLogo = !!data.logo;
  const hasKey = !!data.api.apiKey;

  const setup = [
    { label: "Beispiel-Exposés", done: hasExamples },
    { label: "Stiltexte", done: hasStyle },
    { label: "Logo", done: hasLogo },
    { label: "API-Key", done: hasKey },
  ];

  return (
    <div className="app-shell">
      <TopBar />
      <div className="page-wrap">
        <div className="home-head">
          <h1>Neues Exposé erstellen</h1>
          <p>
            Wählen Sie den Immobilientyp. Der Aufbau richtet sich nach Ihren im
            Datenbereich hinterlegten Beispielen.
          </p>
        </div>

        <div className="setup-banner">
          <div className="status-dots">
            {setup.map((s) => (
              <div key={s.label} className={`setup-item ${s.done ? "done" : ""}`}>
                <span className="tick">
                  <IconCheck size={13} />
                </span>
                {s.label}
              </div>
            ))}
          </div>
          <button className="btn btn-outline" onClick={() => navigate("/data")}>
            Datenbereich öffnen
          </button>
        </div>

        <div className="type-grid">
          {EXPOSE_TYPES.map((t) => (
            <button
              key={t.id}
              className={`type-card ${t.id}`}
              onClick={() => navigate(`/editor/${t.id}`)}
            >
              <div className="icon-wrap">{ICONS[t.id]}</div>
              <h3>{t.label}</h3>
              <div className="desc">{t.description}</div>
              <span className="go">Exposé öffnen →</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

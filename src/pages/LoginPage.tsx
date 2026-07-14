import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { IconCheck } from "../components/Icons";
import "./LoginPage.css";

export function LoginPage() {
  const { login, loggedIn } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // Bereits angemeldet? Dann direkt weiter (z.B. Reload auf /login).
  useEffect(() => {
    if (loggedIn) navigate("/", { replace: true });
  }, [loggedIn, navigate]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Bitte E-Mail und Passwort eingeben.");
      return;
    }
    // Demo-Login: jede gueltige Eingabe wird akzeptiert.
    login();
    navigate("/", { replace: true });
  }

  return (
    <div className="login-screen">
      <div className="login-hero">
        <div className="mark">
          <span className="box">E</span>
          Exposé&nbsp;KI
        </div>
        <div>
          <h1>Professionelle Exposés in Minuten statt Stunden.</h1>
          <p>
            Laden Sie Ihre Bilder hoch – die KI erkennt jedes Motiv, schreibt in
            Ihrem Stil und platziert die Texte punktgenau. Sie behalten die
            volle Kontrolle.
          </p>
        </div>
        <div className="feats">
          <div className="feat">
            <span className="dot">
              <IconCheck size={16} />
            </span>
            Ihr Layout &amp; Schreibstil werden übernommen
          </div>
          <div className="feat">
            <span className="dot">
              <IconCheck size={16} />
            </span>
            Bilderkennung platziert Texte ohne Wichtiges zu verdecken
          </div>
          <div className="feat">
            <span className="dot">
              <IconCheck size={16} />
            </span>
            Alles frei per Maus anpassbar
          </div>
        </div>
      </div>

      <div className="login-form-side">
        <form className="login-card" onSubmit={handleSubmit}>
          <h2>Willkommen zurück</h2>
          <div className="sub">Melden Sie sich an, um fortzufahren.</div>

          {error && <div className="login-error">{error}</div>}

          <div className="field">
            <label htmlFor="email">E-Mail-Adresse</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="username"
              placeholder="makler@immobilien.de"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Passwort</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button className="btn btn-primary btn-lg" type="submit" style={{ width: "100%" }}>
            Anmelden
          </button>

          <div className="login-demo-note">
            Demo-Zugang: Beliebige E-Mail und Passwort eingeben.
          </div>
        </form>
      </div>
    </div>
  );
}

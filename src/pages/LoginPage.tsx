import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { IconCheck } from "../components/Icons";
import { SkylineBanner } from "../components/Illustrations";
import "./LoginPage.css";

type Mode = "login" | "register" | "reset";

export function LoginPage() {
  const { login, register, resetPassword, loggedIn, data, cloudMode } = useApp();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  // Bereits angemeldet? Dann direkt weiter (z.B. Reload auf /login).
  useEffect(() => {
    if (loggedIn) navigate("/", { replace: true });
  }, [loggedIn, navigate]);

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setInfo("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");

    if (!email.trim() || (mode !== "reset" && !password.trim())) {
      setError("Bitte E-Mail und Passwort eingeben.");
      return;
    }
    if (mode === "register" && password !== password2) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }
    if (mode === "register" && password.length < 6) {
      setError("Das Passwort muss mindestens 6 Zeichen haben.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
        navigate("/", { replace: true });
      } else if (mode === "register") {
        await register(email.trim(), password);
        navigate("/", { replace: true });
      } else {
        await resetPassword(email.trim());
        setInfo("Falls ein Konto existiert, wurde eine E-Mail zum Zurücksetzen versendet.");
        setMode("login");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<Mode, string> = {
    login: "Willkommen zurück",
    register: "Konto erstellen",
    reset: "Passwort zurücksetzen",
  };
  const subs: Record<Mode, string> = {
    login: "Melden Sie sich an, um fortzufahren.",
    register: "Legen Sie Ihr Makler-Konto an.",
    reset: "Wir senden Ihnen einen Link zum Zurücksetzen.",
  };
  const buttonLabels: Record<Mode, string> = {
    login: "Anmelden",
    register: "Konto erstellen",
    reset: "Link senden",
  };

  return (
    <div className="login-screen">
      <div className={`login-hero ${data.cover ? "has-cover" : ""}`}>
        {data.cover ? (
          <div
            className="hero-cover"
            style={{ backgroundImage: `url(${data.cover.dataUrl})` }}
          />
        ) : (
          <div className="hero-skyline">
            <SkylineBanner />
          </div>
        )}
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
          <h2>{titles[mode]}</h2>
          <div className="sub">{subs[mode]}</div>

          {error && <div className="login-error">{error}</div>}
          {info && <div className="login-info">{info}</div>}

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

          {mode !== "reset" && (
            <div className="field">
              <label htmlFor="password">Passwort</label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}

          {mode === "register" && (
            <div className="field">
              <label htmlFor="password2">Passwort wiederholen</label>
              <input
                id="password2"
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
              />
            </div>
          )}

          {mode === "login" && cloudMode && (
            <button
              type="button"
              className="login-link"
              onClick={() => switchMode("reset")}
            >
              Passwort vergessen?
            </button>
          )}

          <button
            className="btn btn-primary btn-lg"
            type="submit"
            disabled={busy}
            style={{ width: "100%", marginTop: 6 }}
          >
            {busy ? "Bitte warten …" : buttonLabels[mode]}
          </button>

          {cloudMode ? (
            <div className="login-switch">
              {mode === "login" ? (
                <>
                  Noch kein Konto?{" "}
                  <button type="button" onClick={() => switchMode("register")}>
                    Jetzt registrieren
                  </button>
                </>
              ) : (
                <>
                  Bereits ein Konto?{" "}
                  <button type="button" onClick={() => switchMode("login")}>
                    Zur Anmeldung
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="login-demo-note">
              Demo-Zugang (kein Backend verbunden): Beliebige E-Mail und
              Passwort eingeben.
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

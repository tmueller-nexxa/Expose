import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { AppProvider } from "./context/AppContext";
import { ensureScriptFontLoaded } from "./editor/fit";
import "./styles/global.css";

// Schwungschrift gleich beim Start holen: sie wird beim Aufbau eines Exposés
// zum AUSMESSEN der Ueberschriften gebraucht, kommt bis dahin aber nirgends
// sichtbar vor - der Browser wuerde sie von sich aus also gar nicht laden
// (siehe ensureScriptFontLoaded). Bewusst ohne Warten: die Generierung wartet
// bei Bedarf selbst darauf.
void ensureScriptFontLoaded();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </HashRouter>
  </React.StrictMode>,
);

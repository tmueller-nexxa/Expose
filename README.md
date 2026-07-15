# Exposé KI

Webbasierte App, mit der ein Immobilienmakler per KI automatisch professionelle
Exposés erstellt. Bilder hochladen → die KI erkennt jedes Motiv, schreibt im
Schreibstil des Maklers und platziert die Texte punktgenau, ohne Wichtiges im
Bild zu verdecken. Alles bleibt frei per Maus anpassbar.

## Funktionen

- **Login/Registrierung** mit echten Nutzerkonten (Firebase Auth), wenn ein
  Backend verbunden ist – sonst lokaler Demo-Modus (jede Eingabe akzeptiert)
- **Typ-Auswahl**: Einfamilienhaus · Wohnung · Mehrfamilienhaus · Gewerbeimmobilie
- **Datenbereich** mit vier Uploads:
  1. **Beispiel-Exposés** (PDF/Bilder) je Typ – die KI liest sie ein und
     **übernimmt die Seitenstruktur** (Seitenzahl, Bild-/Text-/Logo-Bereiche,
     Überschriften) per Button „Aufbau aus Beispielen übernehmen". Seiten wie
     Impressum/AGB/Widerrufsbelehrung/Kontakt werden **1:1** übernommen (Fotos
     darauf – außer beim Kontakt – werden durch Platzhalter ersetzt)
  2. **Schreibstil-Texte** – die KI übernimmt Tonfall und Wortwahl
  3. **Logo & Titelbild** – Logo wird automatisch auf jeder Seite platziert
  4. **API-Key** (Anthropic Claude) inkl. Modellauswahl und Verbindungstest –
     entfällt, wenn der Server-Proxy (siehe unten) aktiv ist
- **Editor im Acrobat-Stil**: große Seite links, auswählbare Thumbnails rechts
- **Drag & Drop** von Bildern auf jede Seite (Bildflächen oder frei)
- **„Generieren"**: analysiert jedes Bild per KI, erzeugt passenden Text im
  Maklerstil, bestimmt eine ruhige Fläche (die nichts Wichtiges verdeckt) und
  positioniert Text + Fläche automatisch. Die Schriftgröße wird so gewählt,
  dass der Text sauber in die Fläche passt, ohne überzustehen.
- **Frei verschieb- und skalierbar**: Texte, Flächen und Bilder per Maus
- **PDF-Export** über die Druckfunktion des Browsers ("Als PDF speichern")

## Technik

- **React 18 + TypeScript + Vite**
- **Backend (optional, empfohlen): Firebase** – Authentication (E-Mail/
  Passwort), Firestore (strukturierte Daten) und Storage (Bilder/PDFs), pro
  Nutzer strikt getrennt über Sicherheitsregeln (`firestore.rules`,
  `storage.rules`). Ohne konfiguriertes Firebase läuft die App automatisch im
  **lokalen Demo-Modus** (IndexedDB im Browser) – siehe
  [`SETUP-BACKEND.md`](./SETUP-BACKEND.md) zum Einrichten.
- **Anthropic Claude** (Vision + Text) – entweder direkt aus dem Browser mit
  einem selbst hinterlegten API-Key, oder sicher über eine **Cloud Function**
  (`functions/`), die den Key serverseitig geheim hält (empfohlen).
- **pdf.js** für PDF-Vorschauen und die Seitenanalyse

## Entwicklung

```bash
npm install
npm run dev        # Entwicklungsserver (http://localhost:5173)
npm run build      # Produktions-Build nach dist/
npm run preview    # Build lokal ausliefern
npm run typecheck  # nur TypeScript prüfen
```

## Nutzung

1. Anmelden.
2. Im **Datenbereich** Beispiele, Stiltexte und Logo hochladen sowie den
   Anthropic-API-Key eintragen (Verbindung testen).
3. Im Datenbereich pro Typ „Aufbau aus Beispielen übernehmen" klicken – die KI
   leitet die Seitenstruktur aus dem Beispiel-Exposé ab.
4. Auf der Startseite den Immobilientyp wählen – der Blanko-Aufbau erscheint
   (bei vorhandener gelernter Struktur exakt danach, sonst als Standardvorlage).
5. Bilder per Drag & Drop auf die Seiten ziehen.
6. Oben **„Generieren"** klicken. Die KI schreibt und platziert die Texte.
7. Bei Bedarf alles per Maus feinjustieren und über **Export** als PDF sichern.

## Backend einrichten

Siehe [`SETUP-BACKEND.md`](./SETUP-BACKEND.md) für die Schritt-für-Schritt-
Anleitung (Firebase-Projekt anlegen, Sicherheitsregeln deployen, optional den
Server-Proxy für den Anthropic-Key einrichten). Ohne diese Schritte läuft die
App weiterhin unverändert im lokalen Demo-Modus.

## Hinweise

- Der Aufbau der Vorlagen orientiert sich an typischen Exposé-Strukturen. Eine
  exakte, pixelgenaue Übernahme fremder PDF-Layouts ist bewusst nicht
  versprochen – die Vorlagen bilden den Aufbau professionell nach.

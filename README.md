# Exposé KI

Webbasierte App, mit der ein Immobilienmakler per KI automatisch professionelle
Exposés erstellt. Bilder hochladen → die KI erkennt jedes Motiv, schreibt im
Schreibstil des Maklers und platziert die Texte punktgenau, ohne Wichtiges im
Bild zu verdecken. Alles bleibt frei per Maus anpassbar.

## Funktionen

- **Login-Startseite** (Demo-Login: beliebige E-Mail + Passwort)
- **Typ-Auswahl**: Einfamilienhaus · Wohnung · Mehrfamilienhaus · Gewerbeimmobilie
- **Datenbereich** mit vier Uploads:
  1. **Beispiel-Exposés** (PDF/Bilder) je Typ – ihr Aufbau dient als Vorlage
  2. **Schreibstil-Texte** – die KI übernimmt Tonfall und Wortwahl
  3. **Logo** – wird automatisch auf jeder Seite platziert
  4. **API-Key** (Anthropic Claude) inkl. Modellauswahl und Verbindungstest
- **Editor im Acrobat-Stil**: große Seite links, auswählbare Thumbnails rechts
- **Drag & Drop** von Bildern auf jede Seite (Bildflächen oder frei)
- **„Generieren"**: analysiert jedes Bild per KI, erzeugt passenden Text im
  Maklerstil, bestimmt eine ruhige Fläche (die nichts Wichtiges verdeckt) und
  positioniert Text + Fläche automatisch. Die Schriftgröße wird so gewählt,
  dass der Text sauber in die Fläche passt, ohne überzustehen.
- **Frei verschieb- und skalierbar**: Texte, Flächen und Bilder per Maus
- **PDF-Export** über die Druckfunktion des Browsers ("Als PDF speichern")

## Technik

- **React 18 + TypeScript + Vite**, komplett clientseitig
- **IndexedDB** für Uploads/Projekte, `localStorage` für den Login-Status
- **Anthropic Claude** (Vision + Text) – Aufruf direkt aus dem Browser mit dem
  vom Makler hinterlegten API-Key. Der Key verlässt den Browser nur Richtung
  Anthropic-API.
- **pdf.js** für PDF-Vorschauen

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
3. Auf der Startseite den Immobilientyp wählen – der Blanko-Aufbau erscheint.
4. Bilder per Drag & Drop auf die Seiten ziehen.
5. Oben **„Generieren"** klicken. Die KI schreibt und platziert die Texte.
6. Bei Bedarf alles per Maus feinjustieren und über **Export** als PDF sichern.

## Hinweise

- Die App läuft aktuell lokal im Browser (keine Server-/Betriebskosten). Ein
  Backend mit echten Nutzerkonten lässt sich später ergänzen.
- Der Aufbau der Vorlagen orientiert sich an typischen Exposé-Strukturen. Eine
  exakte, pixelgenaue Übernahme fremder PDF-Layouts ist bewusst nicht
  versprochen – die Vorlagen bilden den Aufbau professionell nach.

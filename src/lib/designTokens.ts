// Farb-/Schrift-Tokens des Luxus-Exposé-Designs (siehe luxuryTemplate.ts) -
// zentral exportiert, damit dieselben Schriften und Farben auch im Editor
// bei manuell hinzugefügten/bearbeiteten Textfeldern auswählbar sind.
//
// Palette (vom Nutzer vorgegeben): dunkler Marmor-Hintergrund (Saphirblau)
// als Leinwand, helle Perlen-Elfenbein-Blöcke für Eckdaten/Beschreibung/
// Lage, Anthrazitgrau als Haupttext darin, Navy für strukturelle
// Überschriften/Labels, Platingrau für Header-Labels auf dem dunklen
// Hintergrund, Silber für dünne Rahmen (Fotos, Makler-Profil), Champagner-
// Gold ausschließlich für Kaufpreis-Hervorhebungen.

// Dunkler Marmor-Hintergrund - die primäre "Leinwand" jeder Seite.
export const EXPOSE_SAPPHIRE = "#0f2350";
// Helle Inhaltsblöcke (Eckdaten/Beschreibung/Lage) auf dem dunklen Grund.
export const EXPOSE_PEARL = "#f3efe6";
// Haupttext/Beschreibungen INNERHALB der Perlen-Elfenbein-Blöcke.
export const EXPOSE_ANTHRACITE = "#2b2e33";
// Strukturelle Labels/Überschriften (z.B. Abschnittstitel).
export const EXPOSE_NAVY = "#1f3b63";
// Ausschließlich für die Hervorhebung von Kaufpreis-Angaben reserviert.
export const EXPOSE_GOLD = "#c6a768";
// Header-/Kicker-Labels direkt auf dem dunklen Hintergrund.
export const EXPOSE_PLATINUM = "#c7cbd1";
// Dünne, präzise Rahmen um Fotos und den Makler-Profilbereich.
export const EXPOSE_SILVER = "#b9c0c7";

export const EXPOSE_SCRIPT_FONT = "'Tangerine', Georgia, 'Times New Roman', serif";

// Farben, die im Editor als Textfarbe für Text-/Überschriftelemente zur
// Auswahl stehen. Champagner-Gold ist bewusst dabei, aber nur für manuell
// hervorgehobene Kaufpreis-Angaben gedacht (siehe Label).
export const EXPOSE_TEXT_COLORS: { label: string; value: string }[] = [
  { label: "Anthrazit", value: EXPOSE_ANTHRACITE },
  { label: "Navy", value: EXPOSE_NAVY },
  { label: "Platin", value: EXPOSE_PLATINUM },
  { label: "Gold (Preis)", value: EXPOSE_GOLD },
];

export const EXPOSE_FONTS: { label: string; value: string | undefined }[] = [
  { label: "Standard", value: undefined },
  { label: "Schwungschrift", value: EXPOSE_SCRIPT_FONT },
];

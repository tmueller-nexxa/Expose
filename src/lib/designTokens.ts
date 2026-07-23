// Farb-/Schrift-Tokens des Luxus-Exposé-Designs (siehe luxuryTemplate.ts) -
// zentral exportiert, damit dieselben Schriften und Farben auch im Editor
// bei manuell hinzugefügten/bearbeiteten Textfeldern auswählbar sind.

export const EXPOSE_INK = "#211f1a";
export const EXPOSE_MUTED = "#6b6459";
export const EXPOSE_GOLD = "#a9822f";
export const EXPOSE_CREAM = "#faf7f1";
export const EXPOSE_WHITE = "#ffffff";
export const EXPOSE_SCRIPT_FONT = "'Tangerine', Georgia, 'Times New Roman', serif";

// Nur die Farben, die im Exposé tatsächlich als TEXTfarbe verwendet werden
// (INK für Überschriften, MUTED für Fließtext, GOLD für die Eyebrow-Labels) -
// WHITE/CREAM kommen im Design nur als Hintergrundflächen vor.
export const EXPOSE_TEXT_COLORS: { label: string; value: string }[] = [
  { label: "Dunkel", value: EXPOSE_INK },
  { label: "Gedämpft", value: EXPOSE_MUTED },
  { label: "Gold", value: EXPOSE_GOLD },
];

export const EXPOSE_FONTS: { label: string; value: string | undefined }[] = [
  { label: "Standard", value: undefined },
  { label: "Schwungschrift", value: EXPOSE_SCRIPT_FONT },
];

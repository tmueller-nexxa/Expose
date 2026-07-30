// A4-Hochformat als Referenzgroesse (96 dpi). Alle Positionen/Groessen der
// Elemente sind Anteile (0..1); Schriftgroessen beziehen sich auf diese
// Referenzbreite und werden beim Rendern mit dem Skalierungsfaktor multipliziert.
export const REF_W = 794;
export const REF_H = 1123;
export const PAGE_RATIO = REF_H / REF_W; // ~1.414

// Zeilenhoehe, mit der Textfelder tatsaechlich gerendert werden (siehe
// CanvasElement.tsx). Gemeinsame Konstante, weil die Grundlinien-Berechnung
// (textBaselineOffsetFrac in editor/fit.ts) exakt denselben Wert braucht -
// laufen die beiden auseinander, sitzt z.B. die Seitenzahl nicht mehr dort,
// wo sie berechnet wurde.
export const TEXT_LINE_HEIGHT = 1.35;

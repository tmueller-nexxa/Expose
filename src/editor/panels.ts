// Hintergrundboxen von Textfeldern.
//
// Die farbige Flaeche hinter einer Ueberschrift oder einem Beschreibungstext
// ist ein EIGENES Element (eine Form), nicht die Hintergrundfarbe des
// Textfelds - nur so laesst sie sich mit Rundungen und eigenem Innenabstand
// gestalten. Ohne Kopplung bliebe sie beim Bearbeiten aber stehen, waehrend
// der Text darueber groesser oder kleiner wird: die Schrift ragte dann aus
// ihrer Box heraus oder schwamm in einer viel zu grossen Flaeche.
//
// Hier steht die Zuordnung Text -> Flaeche und die Umrechnung: die Flaeche
// behaelt ihren Innenabstand und folgt jeder Aenderung von Groesse und
// Position des Textfelds.

import type { PageElement, ShapeElement, TextElement } from "../lib/types";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Hoechstens so viel groesser als das Textfeld darf eine Flaeche sein, um noch
// als dessen Hintergrundbox zu gelten. Verhindert, dass eine seitengrosse
// Farbflaeche oder ein ganzer Inhaltsblock faelschlich mitwaechst.
const MAX_PANEL_AREA_FACTOR = 3;
// Kleine Toleranz beim Umschliessen (Rundungsfehler aus frueheren Rechnungen).
const ENCLOSE_TOLERANCE = 0.02;

function encloses(shape: ShapeElement, box: Box): boolean {
  return (
    shape.x <= box.x + ENCLOSE_TOLERANCE &&
    shape.y <= box.y + ENCLOSE_TOLERANCE &&
    shape.x + shape.w >= box.x + box.w - ENCLOSE_TOLERANCE &&
    shape.y + shape.h >= box.y + box.h - ENCLOSE_TOLERANCE
  );
}

// Findet die Hintergrundbox eines Textfelds - zuerst ueber den ausdruecklichen
// Verweis, sonst ueber die Geometrie (fuer Exposés, die vor der Einfuehrung
// des Verweises entstanden sind).
export function findPanel(
  elements: PageElement[],
  text: TextElement,
): ShapeElement | null {
  const explicit = elements.find(
    (e): e is ShapeElement => e.kind === "shape" && e.panelFor === text.id,
  );
  if (explicit) return explicit;

  const textArea = Math.max(text.w * text.h, 1e-6);
  const candidates = elements.filter(
    (e): e is ShapeElement =>
      e.kind === "shape" &&
      e.z < text.z &&
      encloses(e, text) &&
      e.w * e.h <= textArea * MAX_PANEL_AREA_FACTOR,
  );
  if (candidates.length === 0) return null;

  // Eine Flaeche, auf der MEHRERE Textfelder liegen, ist ein gemeinsamer
  // Block (z.B. das Feld mit den drei Argumente-Bloecken der Titelseite) -
  // sie darf nicht der Groesse eines einzelnen Textes folgen.
  const single = candidates.filter(
    (shape) =>
      elements.filter(
        (e) => (e.kind === "text" || e.kind === "heading") && encloses(shape, e),
      ).length === 1,
  );
  if (single.length === 0) return null;

  // Die engste Flaeche gewinnt - sie ist die Box dieses Textes.
  return single.reduce((a, b) => (a.w * a.h <= b.w * b.h ? a : b));
}

// Neue Masse der Hintergrundbox, nachdem sich das Textfeld von "before" auf
// "after" geaendert hat. Der Innenabstand auf jeder Seite bleibt genau so, wie
// er war - egal ob er aus dem Standarddesign stammt oder aus einer
// uebernommenen Vorlage.
export function panelBox(panel: ShapeElement, before: Box, after: Box): Box {
  const padL = before.x - panel.x;
  const padT = before.y - panel.y;
  const padR = panel.x + panel.w - (before.x + before.w);
  const padB = panel.y + panel.h - (before.y + before.h);
  const x = after.x - padL;
  const y = after.y - padT;
  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    // Auf die Seite begrenzen, damit eine gewachsene Box nicht ueber den Rand
    // hinauslaeuft.
    w: Math.min(after.w + padL + padR, 1 - Math.max(0, x)),
    h: Math.min(after.h + padT + padB, 1 - Math.max(0, y)),
  };
}

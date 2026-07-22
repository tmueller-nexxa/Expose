// "KI Exposé": ein fest hinterlegtes, hochwertiges Luxus-Design - bewusst
// NICHT aus den Beispiel-Exposés kopiert (nur deren grober Seitenaufbau
// fliesst ein, siehe ai.ts/analyzeExposeStructure). Schwungvolle Schreib-
// schrift-Überschriften (Tangerine), ruhige Farbpalette, grosszügige
// Weissräume. Die KI liefert pro Abschnitt bereits zugeordnete Fotos +
// fertige Texte (siehe KiExposePage.tsx) - hier werden daraus nur noch die
// Page/PageElement-Objekte gebaut.

import type {
  ExposeSection,
  ExposeType,
  LogoElement,
  Page,
  PageElement,
  StoredFile,
} from "./types";
import { uid } from "./util";
import { fitTextBoxHeight } from "../editor/fit";

// --- Design-Sprache --------------------------------------------------------

const INK = "#211f1a";
const MUTED = "#6b6459";
const GOLD = "#a9822f";
const CREAM = "#faf7f1";
const WHITE = "#ffffff";
// Schwungschrift - bei gleicher px-Groesse optisch deutlich kleiner als eine
// gewoehnliche Serife, darum bei allen Verwendungsstellen entsprechend groesser
// dimensioniert (siehe SCRIPT_SCALE).
const SERIF = "'Tangerine', Georgia, 'Times New Roman', serif";
const SCRIPT_SCALE = 1.6;

const MARGIN = 0.09;
const CONTENT_W = 1 - MARGIN * 2;

let z = 1;

function heading(
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: Partial<{
    fontSize: number;
    align: "left" | "center" | "right";
    color: string;
    // Wieviel vertikaler Raum (Seitenanteil) der Ueberschrift maximal zur
    // Verfuegung steht, bevor die Schrift verkleinert wird - verhindert,
    // dass lange Ueberschriften bei der grossen Schwungschrift ueber den
    // Seitenrand hinauswachsen. Ohne Angabe wird grosszuegig auf Basis von h
    // geschaetzt.
    maxH: number;
  }> = {},
): PageElement {
  const maxFontSize = opts.fontSize ?? Math.round(30 * SCRIPT_SCALE);
  const minFontSize = Math.max(16, Math.round(maxFontSize * 0.55));
  const budgetH = opts.maxH ?? h * 2.2;
  // Schriftgroesse an die verfuegbare Flaeche anpassen (schrumpft bei langen
  // Ueberschriften), statt immer die volle Groesse zu nutzen und die Box
  // beliebig wachsen zu lassen - das wuerde sonst bei mehrzeiligen
  // Schwungschrift-Ueberschriften ueber den unteren Seitenrand hinauslaufen.
  // Nutzt fitTextBoxHeight fuer die Probe UND die finale Hoehe (dieselbe
  // Funktion, damit Breiten-/Polsterannahmen konsistent bleiben - sonst
  // koennte die spaeter berechnete Hoehe trotzdem das Budget sprengen).
  let fontSize = maxFontSize;
  let minH = h;
  if (text.trim()) {
    fontSize = minFontSize;
    for (let size = maxFontSize; size >= minFontSize; size--) {
      const candidateH = fitTextBoxHeight(text, w, size, 700, SERIF);
      if (candidateH <= budgetH) {
        fontSize = size;
        break;
      }
    }
    minH = fitTextBoxHeight(text, w, fontSize, 700, SERIF);
  }
  return {
    id: uid("el"),
    kind: "heading",
    x,
    y,
    w,
    h: Math.max(h, minH),
    z: z++,
    text,
    fontSize,
    align: opts.align ?? "left",
    color: opts.color ?? INK,
    background: "rgba(0,0,0,0)",
    fontWeight: 700,
    fontFamily: SERIF,
  };
}

function eyebrow(text: string, x: number, y: number, w: number): PageElement {
  return {
    id: uid("el"),
    kind: "text",
    x,
    y,
    w,
    h: 0.028,
    z: z++,
    text: text.toUpperCase(),
    fontSize: 12,
    align: "left",
    color: GOLD,
    background: "rgba(0,0,0,0)",
    fontWeight: 700,
  };
}

function body(text: string, x: number, y: number, w: number, h: number): PageElement {
  // Waechst automatisch mit dem tatsaechlichen Textinhalt, damit nachfolgende
  // Elemente (Fotos, naechster Block) korrekt danach positioniert werden
  // koennen, statt eine feste, ggf. zu kleine Hoehe anzunehmen.
  const minH = text.trim() ? fitTextBoxHeight(text, w, 13.5, 400) : 0;
  return {
    id: uid("el"),
    kind: "text",
    x,
    y,
    w,
    h: Math.max(h, minH),
    z: z++,
    text,
    fontSize: 13.5,
    align: "left",
    color: MUTED,
    background: "rgba(0,0,0,0)",
    fontWeight: 400,
  };
}

// Dezente Flaeche hinter einem Textblock, damit Ueberschrift/Text nie direkt
// auf dem blanken Seitenhintergrund "schweben", sondern immer auf einer zum
// Stil passenden Flaeche liegen. Wird VOR den eigentlichen Textelementen mit
// einer niedrigen, fixen z-Ebene angelegt, damit sie garantiert dahinter
// liegt (z-Zaehler beginnt bei 1 und waechst nur, Fotos liegen fix bei 2).
function panel(x: number, y: number, w: number, h: number, color: string): PageElement {
  return {
    id: uid("el"),
    kind: "shape",
    x,
    y,
    w,
    h,
    z: 0,
    color,
    radius: 10,
  };
}

function rule(x: number, y: number, w: number, color = GOLD): PageElement {
  return {
    id: uid("el"),
    kind: "shape",
    x,
    y,
    w,
    h: 0.004,
    z: z++,
    color,
  };
}

function image(x: number, y: number, w: number, h: number, src: string): PageElement {
  return {
    id: uid("el"),
    kind: "image",
    x,
    y,
    w,
    h,
    z: 2,
    src,
    fit: "cover",
  };
}

function logoBadge(logo: StoredFile | null, onPhoto: boolean): PageElement[] {
  if (!logo) return [];
  const w = 0.16;
  const h = 0.045;
  const x = 1 - MARGIN - w;
  const y = 0.035;
  const els: PageElement[] = [];
  if (onPhoto) {
    els.push({
      id: uid("el"),
      kind: "shape",
      x: x - 0.012,
      y: y - 0.008,
      w: w + 0.024,
      h: h + 0.016,
      z: z++,
      color: "rgba(255,255,255,0.92)",
      radius: 4,
    });
  }
  const logoEl: LogoElement = { id: uid("el"), kind: "logo", x, y, w, h, z: z++, src: logo.dataUrl };
  els.push(logoEl);
  return els;
}

function page(title: string, background: string, elements: PageElement[]): Page {
  return { id: uid("pg"), title, background, elements };
}

// --- Foto-Layouts -----------------------------------------------------------
// Ordnet 1-4 Fotos innerhalb einer Flaeche als Bildelemente an.

function photoLayout(photos: string[], x: number, y: number, w: number, h: number): PageElement[] {
  const gap = 0.014;
  const n = Math.min(photos.length, 4);
  if (n === 0) return [];
  if (n === 1) return [image(x, y, w, h, photos[0])];
  if (n === 2) {
    const hh = (h - gap) / 2;
    return [image(x, y, w, hh, photos[0]), image(x, y + hh + gap, w, hh, photos[1])];
  }
  if (n === 3) {
    const bigH = h * 0.6;
    const smallW = (w - gap) / 2;
    const smallH = h - bigH - gap;
    return [
      image(x, y, w, bigH, photos[0]),
      image(x, y + bigH + gap, smallW, smallH, photos[1]),
      image(x + smallW + gap, y + bigH + gap, smallW, smallH, photos[2]),
    ];
  }
  const hw = (w - gap) / 2;
  const hh = (h - gap) / 2;
  return [
    image(x, y, hw, hh, photos[0]),
    image(x + hw + gap, y, hw, hh, photos[1]),
    image(x, y + hh + gap, hw, hh, photos[2]),
    image(x + hw + gap, y + hh + gap, hw, hh, photos[3]),
  ];
}

// --- Seiten pro Abschnittstyp ------------------------------------------------

function titlePage(
  headline: string,
  subtitle: string,
  photos: string[],
  logo: StoredFile | null,
  typeLabel: string,
): Page {
  const heroH = 0.6;
  const els: PageElement[] = [];
  if (photos[0]) els.push(image(0, 0, 1, heroH, photos[0]));
  else els.push({ id: uid("el"), kind: "shape", x: 0, y: 0, w: 1, h: heroH, z: 1, color: "#e7e2d8" });
  els.push(...logoBadge(logo, true));

  // Ueberschrift/Untertitel zuerst bauen (ohne zu pushen), um ihre
  // tatsaechliche Hoehe zu kennen, BEVOR Panel und Folgeelemente anhand
  // dieser Hoehe positioniert werden - verhindert Ueberlappung bei
  // mehrzeiligen Ueberschriften der Schwungschrift.
  const headingEl = heading(headline || "Exposé", MARGIN, heroH + 0.1, CONTENT_W, 0.14, {
    fontSize: Math.round(40 * SCRIPT_SCALE),
    maxH: 0.2,
  });
  const subtitleEl = subtitle
    ? body(subtitle, MARGIN, headingEl.y + headingEl.h + 0.025, CONTENT_W, 0.06)
    : null;
  const blockEnd = subtitleEl ? subtitleEl.y + subtitleEl.h : headingEl.y + headingEl.h;

  els.push(panel(0, heroH, 1, Math.min(1, blockEnd + 0.04) - heroH, WHITE));
  els.push(rule(MARGIN, heroH + 0.075, 0.14));
  els.push(eyebrow(typeLabel, MARGIN, heroH + 0.045, CONTENT_W));
  els.push(headingEl);
  if (subtitleEl) els.push(subtitleEl);
  return page("Titelseite", CREAM, els);
}

function twoColPage(
  title: string,
  text: string,
  photos: string[],
  logo: StoredFile | null,
  photoLeft: boolean,
): Page {
  const textW = 0.36;
  const photoW = CONTENT_W - textW - 0.05;
  const textX = photoLeft ? 1 - MARGIN - textW : MARGIN;
  const photoX = photoLeft ? MARGIN : 1 - MARGIN - photoW;
  const els: PageElement[] = [...logoBadge(logo, false)];

  const headingEl = heading(title, textX, 0.165, textW, 0.09, {
    fontSize: Math.round(25 * SCRIPT_SCALE),
    maxH: 0.16,
  });
  const bodyTop = headingEl.y + headingEl.h + 0.02;
  const bodyEl = body(text, textX, bodyTop, textW, Math.max(0.1, 0.92 - bodyTop));

  const panelBottom = Math.min(0.94, bodyEl.y + bodyEl.h + 0.03);
  els.push(panel(textX - 0.035, 0.13, textW + 0.07, panelBottom - 0.13, CREAM));

  els.push(eyebrow("Exposé", MARGIN, 0.09, CONTENT_W));
  els.push(rule(textX, 0.145, 0.1));
  els.push(headingEl);
  els.push(bodyEl);
  els.push(...photoLayout(photos, photoX, 0.14, photoW, 0.76));
  return page(title, WHITE, els);
}

function stackedPage(title: string, text: string, photos: string[], logo: StoredFile | null): Page {
  const els: PageElement[] = [...logoBadge(logo, false)];

  const headingEl = heading(title, MARGIN, 0.165, CONTENT_W, 0.07, {
    fontSize: Math.round(25 * SCRIPT_SCALE),
    maxH: 0.14,
  });
  const bodyTop = headingEl.y + headingEl.h + 0.02;
  const bodyEl = body(text, MARGIN, bodyTop, CONTENT_W, 0.14);
  const photoTop = Math.min(0.62, bodyEl.y + bodyEl.h + 0.03);
  const photoH = Math.max(0.25, 0.94 - photoTop);

  const panelBottom = Math.min(photoTop - 0.02, 0.94);
  els.push(panel(MARGIN - 0.035, 0.13, CONTENT_W + 0.07, panelBottom - 0.13, CREAM));

  els.push(eyebrow("Exposé", MARGIN, 0.09, CONTENT_W));
  els.push(rule(MARGIN, 0.145, 0.1));
  els.push(headingEl);
  els.push(bodyEl);
  els.push(...photoLayout(photos, MARGIN, photoTop, CONTENT_W, photoH));
  return page(title, WHITE, els);
}

function grundrissPage(title: string, text: string, photos: string[], logo: StoredFile | null): Page {
  const els: PageElement[] = [...logoBadge(logo, false)];

  const headingEl = heading(title, MARGIN, 0.165, CONTENT_W, 0.07, {
    fontSize: Math.round(25 * SCRIPT_SCALE),
    maxH: 0.14,
  });
  const hasPhoto = Boolean(photos[0]);
  const photoTop = headingEl.y + headingEl.h + 0.03;
  const photoArea = hasPhoto ? 0.55 : 0;
  if (hasPhoto) els.push(image(MARGIN, photoTop, CONTENT_W, photoArea, photos[0]));
  const textTop = photoTop + photoArea + (hasPhoto ? 0.03 : 0);
  const bodyEl = body(text, MARGIN, textTop, CONTENT_W, Math.max(0.12, 0.94 - textTop));

  const panelBottom = Math.min(0.94, hasPhoto ? photoTop - 0.02 : bodyEl.y + bodyEl.h + 0.03);
  els.push(panel(MARGIN - 0.035, 0.13, CONTENT_W + 0.07, panelBottom - 0.13, CREAM));

  els.push(eyebrow("Exposé", MARGIN, 0.09, CONTENT_W));
  els.push(rule(MARGIN, 0.145, 0.1));
  els.push(headingEl);
  els.push(bodyEl);
  return page(title, WHITE, els);
}

function galeriePage(title: string, photos: string[], logo: StoredFile | null): Page {
  const els: PageElement[] = [...logoBadge(logo, false)];

  const headingEl = heading(title, MARGIN, 0.165, CONTENT_W, 0.07, {
    fontSize: Math.round(25 * SCRIPT_SCALE),
    maxH: 0.14,
  });
  const photoTop = headingEl.y + headingEl.h + 0.03;

  const panelBottom = Math.min(0.94, photoTop - 0.02);
  els.push(panel(MARGIN - 0.035, 0.13, CONTENT_W + 0.07, panelBottom - 0.13, CREAM));

  els.push(eyebrow("Exposé", MARGIN, 0.09, CONTENT_W));
  els.push(rule(MARGIN, 0.145, 0.1));
  els.push(headingEl);
  els.push(...photoLayout(photos, MARGIN, photoTop, CONTENT_W, Math.max(0.3, 0.94 - photoTop)));
  return page(title, WHITE, els);
}

// Fuer Abschnitte ohne zugeordnete Fotos: reiner Textblock auf Karte statt
// eine grosse, leere Fotoflaeche zu reservieren.
function textOnlyPage(title: string, text: string, logo: StoredFile | null): Page {
  const els: PageElement[] = [...logoBadge(logo, false)];

  const headingEl = heading(title, MARGIN, 0.22, CONTENT_W, 0.09, {
    fontSize: Math.round(28 * SCRIPT_SCALE),
    maxH: 0.16,
  });
  const bodyTop = headingEl.y + headingEl.h + 0.03;
  const bodyEl = body(text, MARGIN, bodyTop, CONTENT_W, Math.max(0.2, 0.7 - bodyTop));

  const panelBottom = Math.min(0.94, bodyEl.y + bodyEl.h + 0.04);
  els.push(panel(MARGIN - 0.04, 0.16, CONTENT_W + 0.08, panelBottom - 0.16, CREAM));

  els.push(eyebrow("Exposé", MARGIN, 0.09, CONTENT_W));
  els.push(rule(MARGIN, 0.19, 0.1));
  els.push(headingEl);
  els.push(bodyEl);
  return page(title, WHITE, els);
}

function kontaktPage(logo: StoredFile | null, photos: string[]): Page {
  const els: PageElement[] = [];
  if (logo) {
    const w = 0.3;
    els.push({ id: uid("el"), kind: "logo", x: (1 - w) / 2, y: 0.14, w, h: w * 0.32, z: z++, src: logo.dataUrl });
  }

  const headingEl = heading("Ihr Ansprechpartner", 0.1, 0.35, 0.8, 0.08, {
    fontSize: Math.round(27 * SCRIPT_SCALE),
    align: "center",
    maxH: 0.14,
  });
  const detailsEl: PageElement = {
    id: uid("el"),
    kind: "text",
    x: 0.2,
    y: headingEl.y + headingEl.h + 0.02,
    w: 0.6,
    h: 0.12,
    z: z++,
    text: "",
    fontSize: 15,
    align: "center",
    color: MUTED,
    background: "rgba(0,0,0,0)",
    fontWeight: 400,
  };
  const panelBottom = Math.min(0.62, detailsEl.y + detailsEl.h + 0.03);

  els.push(panel(0.15, 0.28, 0.7, panelBottom - 0.28, WHITE));
  els.push(rule(0.5 - 0.06, 0.32, 0.12));
  els.push(headingEl);
  els.push(detailsEl);
  if (photos[0]) els.push(image(0.32, panelBottom + 0.03, 0.36, 0.26, photos[0]));
  return page("Kontakt", CREAM, els);
}

// --- Zusammenbau -------------------------------------------------------------

export interface KiExposeSectionInput {
  section: ExposeSection;
  photos: string[]; // DataURLs, bereits zugeordnet
  headline: string;
  text: string;
}

const TYPE_LABEL: Record<ExposeType, string> = {
  einfamilienhaus: "Einfamilienhaus",
  wohnung: "Eigentumswohnung",
  mehrfamilienhaus: "Mehrfamilienhaus",
  gewerbe: "Gewerbeimmobilie",
};

export function buildLuxuryPages(
  type: ExposeType,
  inputs: KiExposeSectionInput[],
  logo: StoredFile | null,
  overflowPhotos: string[],
): Page[] {
  z = 1;
  const pages: Page[] = [];
  let altSide = false;

  for (const { section, photos, headline, text } of inputs) {
    const title = headline || section.title;
    switch (section.kind) {
      case "titel":
        pages.push(titlePage(title, text, photos, logo, TYPE_LABEL[type]));
        break;
      case "grundriss":
        pages.push(grundrissPage(title, text, photos, logo));
        break;
      case "galerie":
        pages.push(galeriePage(title, photos, logo));
        break;
      case "kontakt":
        pages.push(kontaktPage(logo, photos));
        break;
      default:
        if (photos.length === 0) {
          pages.push(textOnlyPage(title, text, logo));
        } else if (photos.length >= 3) {
          pages.push(stackedPage(title, text, photos, logo));
        } else {
          pages.push(twoColPage(title, text, photos, logo, altSide));
          altSide = !altSide;
        }
    }
  }

  // Uebrig gebliebene, keinem Abschnitt zugeordnete Fotos nicht verwerfen -
  // als zusaetzliche Galerie-Seite(n) anhaengen.
  for (let i = 0; i < overflowPhotos.length; i += 4) {
    const chunk = overflowPhotos.slice(i, i + 4);
    pages.push(galeriePage(i === 0 ? "Weitere Impressionen" : "Impressionen", chunk, logo));
  }

  return pages;
}

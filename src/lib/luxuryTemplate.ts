// "KI Exposé": ein fest hinterlegtes, hochwertiges Luxus-Design - bewusst
// NICHT aus den Beispiel-Exposés kopiert (nur deren grober Seitenaufbau
// fliesst ein, siehe ai.ts/analyzeExposeStructure). Schwungvolle Schreib-
// schrift-Überschriften (Tangerine), ruhige Farbpalette, grosszügige
// Weissräume. Die KI liefert pro Abschnitt bereits zugeordnete Fotos +
// fertige Texte (siehe KiExposePage.tsx) - hier werden daraus nur noch die
// Page/PageElement-Objekte gebaut.

import type {
  BoilerplateKind,
  ExposeSection,
  ExposeType,
  LogoElement,
  Page,
  PageElement,
  StoredFile,
} from "./types";
import { uid } from "./util";
import {
  fitTextBoxHeight,
  splitTextToFitLines,
  textBaselineOffsetFrac,
} from "../editor/fit";
import { REF_H, REF_W } from "../editor/constants";
import {
  EXPOSE_CREAM as CREAM,
  EXPOSE_GOLD as GOLD,
  EXPOSE_INK as INK,
  EXPOSE_LIGHT_GREY as GREY,
  EXPOSE_MUTED as MUTED,
  EXPOSE_SCRIPT_FONT as SERIF,
  EXPOSE_WHITE as WHITE,
} from "./designTokens";

// --- Design-Sprache --------------------------------------------------------
//
// Farben/Schwungschrift sind in designTokens.ts zentral definiert (dort auch
// fuer den Editor exportiert, damit manuell hinzugefuegte Textfelder dieselben
// Optionen anbieten koennen).

// Schwungschrift - bei gleicher px-Groesse optisch deutlich kleiner als eine
// gewoehnliche Serife, darum bei allen Verwendungsstellen entsprechend groesser
// dimensioniert (siehe SCRIPT_SCALE).
const SCRIPT_SCALE = 1.6;

const MARGIN = 0.09;
const CONTENT_W = 1 - MARGIN * 2;
// Untere Grenze fuer TEXT-Flaechen (Ueberschrift/Fliesstext-Panels) - liegt
// bewusst OBERHALB der Seitenzahl (siehe pageNumberMark(), Box beginnt bei
// 1-MARGIN-0.04 = 0.87), damit deren Hintergrundbox nie ein Textpanel
// ueberlappt. Fotoflaechen sind davon ausgenommen (siehe photoLayout()-
// Aufrufe) - ein Foto darf bis in die Ecke reichen, die Seitenzahl liegt
// dank hohem z-Wert dann einfach sichtbar darueber.
const CONTENT_BOTTOM = 0.85;

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

function body(
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: Partial<{
    // Wieviel vertikaler Raum (Seitenanteil) der Text maximal zur Verfuegung
    // hat, bevor die Schrift verkleinert wird - verhindert, dass ein langer
    // Absatz ueber den unteren Seitenrand hinauswaechst (analog zu heading()).
    maxH: number;
    // Erlaubt, den Schrumpf-Boden fuer besonders lange/dichte Inhalte
    // (z.B. die Eckdaten-Fakten-Liste) weiter abzusenken als der normale
    // Fliesstext-Mindeststandard.
    minFontSize: number;
  }> = {},
): PageElement {
  const maxFontSize = 13.5;
  const minFontSize = opts.minFontSize ?? 10.5;
  const budgetH = opts.maxH ?? h * 3;
  // Die Boxhoehe folgt ausschliesslich dem tatsaechlichen Textinhalt (nicht
  // einer geraten Mindesthoehe) - nur so kann die Hintergrundflaeche
  // (textPanel) wirklich an die Groesse des Fliesstexts angepasst sein.
  // Schrumpft die Schrift, wenn der Text sonst das Hoehenbudget sprengen
  // wuerde (analog zu heading()).
  let fontSize = maxFontSize;
  let finalH = h;
  if (text.trim()) {
    fontSize = minFontSize;
    for (let size = maxFontSize; size >= minFontSize; size -= 0.5) {
      const candidateH = fitTextBoxHeight(text, w, size, 400);
      if (candidateH <= budgetH) {
        fontSize = size;
        break;
      }
    }
    finalH = Math.max(0.02, fitTextBoxHeight(text, w, fontSize, 400));
  }
  return {
    id: uid("el"),
    kind: "text",
    x,
    y,
    w,
    h: finalH,
    z: z++,
    text,
    fontSize,
    align: "left",
    color: MUTED,
    background: "rgba(0,0,0,0)",
    fontWeight: 400,
  };
}

// Dezente Flaeche hinter einem Textblock, damit er nie direkt auf dem
// blanken Seitenhintergrund "schwebt", sondern auf einer zum Stil
// passenden Flaeche liegt. Wird VOR den eigentlichen Textelementen mit
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

// Gleichmaessiger Rand rund um Ueberschrift bzw. Fliesstext (in Pixeln der
// Referenzgroesse umgerechnet, damit der Abstand oben/unten/links/rechts
// optisch gleich breit wirkt, auch wenn x/w und y/h an unterschiedliche
// Seitenmasse gekoppelt sind). Die Flaeche wird direkt aus der tatsaechlichen
// Box des jeweiligen Textelements abgeleitet - waechst der Text (mehr
// Zeilen, groessere Schrift), waechst die Flaeche automatisch mit.
const TEXT_PAD_PX = 10;
const TEXT_PAD_X = TEXT_PAD_PX / REF_W;
const TEXT_PAD_Y = TEXT_PAD_PX / REF_H;
// Mindestabstand zwischen zwei aufeinanderfolgenden Textelementen (z.B.
// Ueberschrift -> Fliesstext), damit ihre jeweils eigenen Flaechen sich
// nicht beruehren/ueberlappen, sondern sichtbar als zwei getrennte Karten
// erscheinen.
const TEXT_PANEL_GAP = TEXT_PAD_Y * 2 + 0.012;

function textPanel(el: PageElement, color: string): PageElement {
  return panel(el.x - TEXT_PAD_X, el.y - TEXT_PAD_Y, el.w + TEXT_PAD_X * 2, el.h + TEXT_PAD_Y * 2, color);
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

// Seitenzahl unten rechts in der Ecke, in der Schwungschrift, goldene
// Schriftfarbe, OHNE Hintergrundbox und ohne Schatten (frei auf dem
// Seitenhintergrund) - wird auf JEDE erzeugte Seite gelegt (siehe Ende von
// buildLuxuryPages()). Nutzt bewusst einen fest hohen z-Wert (nicht den
// laufenden Zaehler) statt der normalen panel()/textPanel()-Helfer (die auf
// z:0 liegen) - so bleibt die Seitenzahl auf JEDER Seite sichtbar obenauf,
// auch auf Seiten mit einem grossflaechigen Foto, das sonst bis in die
// untere rechte Ecke reicht.
//
// Abstand zum rechten und unteren Blattrand, in Millimetern auf A4 - bewusst
// NICHT der Inhaltsrand MARGIN (0,09), der fuer die Seitenzahl viel zu gross
// ist und sie deutlich vor der Ecke absetzen wuerde.
//
// Beide Werte beziehen sich auf die SCHRIFT, nicht auf die umgebende Box -
// die Box wird unten aus ihnen zurueckgerechnet:
//   - rechts: die rechte TEXTkante (rechtsbuendig gesetzt, der Abstand gilt
//     damit unveraendert fuer ein-, zwei- und dreistellige Seitenzahlen)
//   - unten: die Schrift-GRUNDLINIE. Die Ziffern der Schwungschrift haben
//     keine Unterlaenge (nachgemessen: 0), die Grundlinie ist hier also
//     zugleich die sichtbare Unterkante der Ziffer.
const PAGE_NUM_Z = 900;
const PAGE_NUM_FONT_SIZE = 46;
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PAGE_NUM_MARGIN_MM = 5;
const PAGE_NUM_EDGE_RIGHT = PAGE_NUM_MARGIN_MM / A4_WIDTH_MM; // ~0,0238 der Breite (~19 px)
const PAGE_NUM_BASELINE_BOTTOM = PAGE_NUM_MARGIN_MM / A4_HEIGHT_MM; // ~0,0168 der Hoehe (~19 px)
function pageNumberMark(n: number): PageElement[] {
  const text = String(n);
  // Rechtsbuendig: damit liegt die rechte TEXTkante immer exakt auf
  // 1 - PAGE_NUM_EDGE_RIGHT, voellig unabhaengig davon, wie breit die Box ist
  // oder wieviele Ziffern die Zahl hat. Die Box wird bewusst etwas
  // grosszuegiger als der Text gewaehlt (statt exakt zugeschnitten), damit
  // auch drei-/vierstellige Seitenzahlen und die ausladenden Schnoerkel der
  // Schwungschrift nie am Boxrand abgeschnitten werden.
  const w = 0.08;
  const x = 1 - PAGE_NUM_EDGE_RIGHT - w;
  // Ein Textfeld rendert seinen Text an der OBERKANTE beginnend, der gemessene
  // Abstand bezieht sich aber auf die GRUNDLINIE - daher den Grundlinien-
  // Versatz (halber Durchschuss + Oberlaenge der real geladenen Schrift,
  // siehe textBaselineOffsetFrac) von der Zielposition zurueckrechnen.
  const y =
    1 - PAGE_NUM_BASELINE_BOTTOM - textBaselineOffsetFrac(PAGE_NUM_FONT_SIZE, 700, SERIF);
  // Bei so kleinem Randabstand ragt die grosszuegige Box unten ueber das Blatt
  // hinaus - auf den verbleibenden Platz begrenzen, damit sie vollstaendig auf
  // der Seite liegt. Die Ziffer selbst braucht nur die erste Zeile und bleibt
  // dadurch unangetastet; abgeschnitten wuerde allenfalls leerer Raum.
  const h = Math.min(fitTextBoxHeight(text, w, PAGE_NUM_FONT_SIZE, 700, SERIF), 1 - y);
  const textEl: PageElement = {
    id: uid("el"),
    kind: "text",
    x,
    y,
    w,
    h,
    z: PAGE_NUM_Z,
    text,
    fontSize: PAGE_NUM_FONT_SIZE,
    align: "right",
    color: GOLD,
    background: "rgba(0,0,0,0)",
    fontWeight: 700,
    fontFamily: SERIF,
  };
  return [textEl];
}

// Seitenzahl unten rechts auf JEDER Seite der uebergebenen Liste, fortlaufend
// 1..N - wird vom Aufrufer EINMAL auf die vollstaendige, zusammengesetzte
// Seitenliste angewendet (Inhaltsseiten + Standardseiten), damit die
// Nummerierung ueber die gesamte Ausgabe hinweg fortlaufend bleibt, egal aus
// wie vielen buildXPages()-Aufrufen sich die Liste zusammensetzt.
export function addPageNumbers(pages: Page[]): void {
  pages.forEach((p, i) => p.elements.push(...pageNumberMark(i + 1)));
}

function image(x: number, y: number, w: number, h: number, src: string, fit: "cover" | "contain" = "cover"): PageElement {
  return {
    id: uid("el"),
    kind: "image",
    x,
    y,
    w,
    h,
    z: 2,
    src,
    fit,
  };
}

// Logo-Badge oben rechts auf dem Titelbild - erscheint NUR auf der ersten
// Seite. Erwartet bereits eine weiss/transparent aufbereitete Version des
// Logos (siehe invertLogoToWhite() in imageEdit.ts), darum keine eigene
// Hintergrundflaeche dahinter (die wuerde ein weisses Logo unsichtbar
// machen) - das Logo liegt direkt auf dem Foto.
function heroLogoBadge(logo: StoredFile | null): PageElement[] {
  if (!logo) return [];
  // 200% Groesse (doppelte Breite/Hoehe ggue. dem urspruenglichen Badge) -
  // vorher war das Logo auf dem Titelfoto kaum lesbar.
  const w = 0.32;
  const h = 0.09;
  const x = 1 - MARGIN - w;
  const y = 0.035;
  // Fester z-Wert oberhalb von IMAGE_Z (2, siehe image()) statt des
  // laufenden Zaehlers z++ - der steht auf der allerersten Seite (fast immer
  // die Titelseite) noch bei 1 und wuerde das Logo sonst HINTER dem
  // Titelfoto einsortieren (unsichtbar).
  const logoEl: LogoElement = { id: uid("el"), kind: "logo", x, y, w, h, z: 3, src: logo.dataUrl };
  return [logoEl];
}

// Grosser "Exposé"-Schriftzug oben links auf dem Titelfoto, in der
// Schwungschrift - statischer Marken-/Rubrik-Schriftzug, kein KI-generierter
// Inhalt, darum ohne den Auto-Schrumpf-Mechanismus von heading(). z:4 ist
// BEWUSST hoeher als das Logo-Badge (z:3) und alles andere auf der
// Titelseite - der Schriftzug soll immer die oberste Ebene sein, nie von
// etwas anderem verdeckt werden.
function exposeMark(): PageElement {
  return {
    id: uid("el"),
    kind: "heading",
    x: MARGIN,
    y: 0.035,
    w: 0.6,
    h: 0.16,
    z: 4,
    text: "Exposé",
    fontSize: 106,
    align: "left",
    color: WHITE,
    background: "rgba(0,0,0,0)",
    fontWeight: 700,
    fontFamily: SERIF,
    // Ohne eigene Hintergrundflaeche (liegt direkt auf dem Titelfoto) -
    // ohne Schlagschatten auf hellen Fotobereichen (Himmel, helle Fassade)
    // technisch vorhanden, aber optisch unsichtbar. Siehe TextElement.textShadow.
    textShadow: true,
  };
}

function page(title: string, background: string, elements: PageElement[]): Page {
  return { id: uid("pg"), title, background, elements };
}

// --- Foto-Layouts -----------------------------------------------------------
// Ordnet 1-4 Fotos innerhalb einer Flaeche als Bildelemente an.

// Ohne zugeordnete Fotos (KI hat keinen Treffer gefunden/keine Fotos
// uebrig) wird die Fotoflaeche NICHT einfach weggelassen, sondern zeigt
// mindestens einen leeren Bild-Platzhalter (image() mit src:"") - der
// Nutzer sieht so klar, wo noch ein Foto fehlt, und kann eines per
// Drag&Drop nachtraeglich einfuegen, statt vor einer scheinbar
// vollstaendigen, aber leeren Seite zu stehen.
function photoLayout(
  photos: string[],
  x: number,
  y: number,
  w: number,
  h: number,
  minCount = 1,
  // "contain" statt "cover" fuer Inhalte, die NICHT beschnitten werden
  // duerfen (z.B. technische Grundriss-Zeichnungen) - eine Foto-Komposition
  // darf zugunsten der Bildwirkung beschnitten werden, eine Planzeichnung
  // muss dagegen immer vollstaendig sichtbar bleiben.
  fit: "cover" | "contain" = "cover",
): PageElement[] {
  const gap = 0.014;
  const list = photos.length > 0 ? photos : Array.from({ length: Math.max(1, minCount) }, () => "");
  const n = Math.min(list.length, 4);
  if (n === 0) return [];
  if (n === 1) return [image(x, y, w, h, list[0], fit)];
  if (n === 2) {
    const hh = (h - gap) / 2;
    return [image(x, y, w, hh, list[0], fit), image(x, y + hh + gap, w, hh, list[1], fit)];
  }
  if (n === 3) {
    const bigH = h * 0.6;
    const smallW = (w - gap) / 2;
    const smallH = h - bigH - gap;
    return [
      image(x, y, w, bigH, list[0], fit),
      image(x, y + bigH + gap, smallW, smallH, list[1], fit),
      image(x + smallW + gap, y + bigH + gap, smallW, smallH, list[2], fit),
    ];
  }
  const hw = (w - gap) / 2;
  const hh = (h - gap) / 2;
  return [
    image(x, y, hw, hh, list[0], fit),
    image(x + hw + gap, y, hw, hh, list[1], fit),
    image(x, y + hh + gap, hw, hh, list[2], fit),
    image(x + hw + gap, y + hh + gap, hw, hh, list[3], fit),
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
  // Leeres Bild-Element statt einer blossen Farbflaeche, wenn kein Titelfoto
  // zugeordnet wurde - eine Farbflaeche ist kein Drop-Ziel, ein leeres
  // image()-Element schon (siehe photoLayout()-Kommentar oben).
  els.push(image(0, 0, 1, heroH, photos[0] ?? ""));
  els.push(exposeMark());
  els.push(...heroLogoBadge(logo));

  // Ueberschrift/Untertitel zuerst bauen (ohne zu pushen), um ihre
  // tatsaechliche Hoehe zu kennen, BEVOR Panel und Folgeelemente anhand
  // dieser Hoehe positioniert werden - verhindert Ueberlappung bei
  // mehrzeiligen Ueberschriften der Schwungschrift.
  const headingEl = heading(headline || "Exposé", MARGIN, heroH + 0.1, CONTENT_W, 0.09, {
    fontSize: Math.round(26 * SCRIPT_SCALE),
    maxH: 0.13,
  });
  const subtitleTop = headingEl.y + headingEl.h + TEXT_PANEL_GAP;
  const subtitleEl = subtitle
    ? body(subtitle, MARGIN, subtitleTop, CONTENT_W, 0.06, { maxH: CONTENT_BOTTOM - subtitleTop })
    : null;

  els.push(textPanel(headingEl, WHITE));
  if (subtitleEl) els.push(textPanel(subtitleEl, GREY));
  els.push(rule(MARGIN, heroH + 0.075, 0.14));
  els.push(eyebrow(typeLabel, MARGIN, heroH + 0.045, CONTENT_W));
  els.push(headingEl);
  if (subtitleEl) els.push(subtitleEl);
  return page("Titelseite", CREAM, els);
}

function twoColPage(title: string, text: string, photos: string[], photoLeft: boolean): Page {
  const textW = 0.36;
  const photoW = CONTENT_W - textW - 0.05;
  const textX = photoLeft ? 1 - MARGIN - textW : MARGIN;
  const photoX = photoLeft ? MARGIN : 1 - MARGIN - photoW;
  const els: PageElement[] = [];

  const headingEl = heading(title, textX, 0.165, textW, 0.09, {
    fontSize: Math.round(25 * SCRIPT_SCALE),
    maxH: 0.16,
  });
  const bodyTop = headingEl.y + headingEl.h + TEXT_PANEL_GAP;
  const bodyEl = body(text, textX, bodyTop, textW, Math.max(0.1, CONTENT_BOTTOM - 0.02 - bodyTop), {
    maxH: CONTENT_BOTTOM - bodyTop,
  });

  els.push(textPanel(headingEl, CREAM));
  els.push(textPanel(bodyEl, GREY));
  els.push(eyebrow("Exposé", MARGIN, 0.09, CONTENT_W));
  els.push(rule(textX, 0.145, 0.1));
  els.push(headingEl);
  els.push(bodyEl);
  els.push(...photoLayout(photos, photoX, 0.14, photoW, 0.76));
  return page(title, WHITE, els);
}

function stackedPage(title: string, text: string, photos: string[]): Page {
  const els: PageElement[] = [];

  const headingEl = heading(title, MARGIN, 0.165, CONTENT_W, 0.07, {
    fontSize: Math.round(25 * SCRIPT_SCALE),
    maxH: 0.14,
  });
  const bodyTop = headingEl.y + headingEl.h + TEXT_PANEL_GAP;
  const bodyEl = body(text, MARGIN, bodyTop, CONTENT_W, 0.14, { maxH: 0.62 - bodyTop });
  const photoTop = Math.min(0.62, bodyEl.y + bodyEl.h + 0.03);
  const photoH = Math.max(0.25, 0.94 - photoTop);

  els.push(textPanel(headingEl, CREAM));
  els.push(textPanel(bodyEl, GREY));
  els.push(eyebrow("Exposé", MARGIN, 0.09, CONTENT_W));
  els.push(rule(MARGIN, 0.145, 0.1));
  els.push(headingEl);
  els.push(bodyEl);
  els.push(...photoLayout(photos, MARGIN, photoTop, CONTENT_W, photoH));
  return page(title, WHITE, els);
}

// Zeigt ALLE zugeordneten Grundriss-Bilder (nicht nur das erste) - ein
// Grundriss-Abschnitt fasst typischerweise mehrere Geschosse zusammen
// (Keller-, Erd-, Obergeschoss), die alle sichtbar sein muessen, nicht nur
// eines davon.
function grundrissPage(title: string, text: string, photos: string[]): Page {
  const els: PageElement[] = [];

  const headingEl = heading(title, MARGIN, 0.165, CONTENT_W, 0.07, {
    fontSize: Math.round(25 * SCRIPT_SCALE),
    maxH: 0.14,
  });
  // Fotoflaeche wird IMMER reserviert (auch ohne zugeordnetes Foto) - zeigt
  // dann einen leeren Platzhalter statt die Seite ohne jeden Hinweis auf den
  // fehlenden Grundriss durchlaufen zu lassen (siehe photoLayout()).
  const photoTop = headingEl.y + headingEl.h + 0.03;
  const photoArea = 0.55;
  // "contain" statt "cover": eine Grundriss-Zeichnung ist keine Foto-
  // Komposition, sie muss immer VOLLSTAENDIG sichtbar bleiben statt
  // (wie ein Foto) auf die Zielflaeche zurechtgeschnitten zu werden.
  els.push(...photoLayout(photos, MARGIN, photoTop, CONTENT_W, photoArea, 1, "contain"));
  const textTop = photoTop + photoArea + 0.03;
  const bodyEl = body(text, MARGIN, textTop, CONTENT_W, Math.max(0.12, CONTENT_BOTTOM - textTop), {
    maxH: CONTENT_BOTTOM - textTop,
  });

  els.push(textPanel(headingEl, CREAM));
  els.push(textPanel(bodyEl, GREY));
  els.push(eyebrow("Exposé", MARGIN, 0.09, CONTENT_W));
  els.push(rule(MARGIN, 0.145, 0.1));
  els.push(headingEl);
  els.push(bodyEl);
  return page(title, WHITE, els);
}

function galeriePage(title: string, photos: string[]): Page {
  const els: PageElement[] = [];

  const headingEl = heading(title, MARGIN, 0.165, CONTENT_W, 0.07, {
    fontSize: Math.round(25 * SCRIPT_SCALE),
    maxH: 0.14,
  });
  const photoTop = headingEl.y + headingEl.h + 0.03;

  els.push(textPanel(headingEl, CREAM));
  els.push(eyebrow("Exposé", MARGIN, 0.09, CONTENT_W));
  els.push(rule(MARGIN, 0.145, 0.1));
  els.push(headingEl);
  els.push(...photoLayout(photos, MARGIN, photoTop, CONTENT_W, Math.max(0.3, 0.94 - photoTop)));
  return page(title, WHITE, els);
}

// Eigene Vorlage speziell fuer den "Eckdaten"-Abschnitt: reine Fakten-Liste
// (Wohnflaeche, Zimmer, Baujahr, Kaufpreis usw.), darum bewusst OHNE
// konkurrierende Fotoflaeche, mit der Ueberschrift weiter oben (mehr Platz
// fuer den Text darunter) und einem deutlich groesszuegigeren Hoehenbudget
// samt abgesenktem Schrumpf-Boden (siehe body()) - verhindert, dass die
// potenziell laengere Fakten-Aufzaehlung ueber die Kartenflaeche hinauswaechst
// oder unleserlich klein/gequetscht wirkt.
function eckdatenPage(title: string, text: string): Page {
  const els: PageElement[] = [];

  const headingEl = heading(title, MARGIN, 0.13, CONTENT_W, 0.08, {
    fontSize: Math.round(25 * SCRIPT_SCALE),
    maxH: 0.12,
  });
  const bodyTop = headingEl.y + headingEl.h + TEXT_PANEL_GAP;
  const bodyEl = body(text, MARGIN, bodyTop, CONTENT_W, Math.max(0.2, CONTENT_BOTTOM - bodyTop), {
    maxH: CONTENT_BOTTOM - bodyTop,
    minFontSize: 9,
  });

  els.push(textPanel(headingEl, CREAM));
  els.push(textPanel(bodyEl, GREY));
  els.push(eyebrow("Exposé", MARGIN, 0.09, CONTENT_W));
  els.push(rule(MARGIN, 0.115, 0.1));
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
    y: headingEl.y + headingEl.h + TEXT_PANEL_GAP,
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
  const contentBottom = Math.min(0.62, detailsEl.y + detailsEl.h + 0.03);

  els.push(textPanel(headingEl, WHITE));
  els.push(textPanel(detailsEl, GREY));
  els.push(rule(0.5 - 0.06, 0.32, 0.12));
  els.push(headingEl);
  els.push(detailsEl);
  if (photos[0]) els.push(image(0.32, contentBottom + 0.03, 0.36, 0.26, photos[0]));
  return page("Kontakt", CREAM, els);
}

// Fuer eingescannte/gerenderte Dokumentseiten (z.B. die erste, wichtigste
// Seite eines Energieausweises) - der Seiteninhalt (Kennwerte, Diagramme)
// steckt bereits fertig im Bild selbst, darum nur Titel + grossflaechiges
// Bild, kein zusaetzlich generierter Fliesstext.
function documentPage(title: string, img: string): Page {
  const els: PageElement[] = [];

  const headingEl = heading(title, MARGIN, 0.09, CONTENT_W, 0.07, {
    fontSize: Math.round(25 * SCRIPT_SCALE),
    maxH: 0.14,
  });
  const photoTop = headingEl.y + headingEl.h + 0.03;

  els.push(textPanel(headingEl, CREAM));
  els.push(rule(MARGIN, 0.075, 0.1));
  els.push(headingEl);
  // "contain" statt "cover": ein Dokumentenscan (Energieausweis-Kennwerte/
  // -Diagramme) darf nicht beschnitten werden - jeder Rand kann relevante
  // Angaben tragen.
  els.push(image(MARGIN, photoTop, CONTENT_W, Math.max(0.3, 0.94 - photoTop), img, "contain"));
  return page(title, WHITE, els);
}

// --- Standardseiten (Vorwort/Impressum/AGB/Widerruf/Ansprechpartner) im
// neuen Design ----------------------------------------------------------
//
// Diese Seiten werden NICHT mehr 1:1 als Bild der Originalvorlage
// uebernommen, sondern aus dem wortgetreu aus der PDF-Textebene
// extrahierten Text neu im "KI Exposé"-Design gebaut (siehe
// BoilerplatePage.text, Extraktion in lib/pdf.ts). Der rechtssichere
// Wortlaut bleibt dabei exakt erhalten, nur Schrift/Farben/Layout wechseln
// auf das neue Design.

const LEGAL_FONT_SIZE = 12;
const LEGAL_LINE_HEIGHT = 1.5;

// Baut aus einem (ggf. langen) Rechtstext so viele Seiten wie noetig -
// Schriftverkleinerung allein reicht bei mehrseitigen AGB/Widerrufs-
// belehrungen nicht aus, ohne unleserlich zu werden, darum echte
// Pagination statt Schrumpfen (siehe splitTextToFitLines()).
function legalTextPages(title: string, text: string): Page[] {
  const result: Page[] = [];
  let remaining = text.trim();
  let part = 1;
  const bodyTop = 0.2;
  const bodyWpx = CONTENT_W * REF_W;
  while (remaining) {
    const pageTitle = part === 1 ? title : `${title} (Fortsetzung)`;
    const els: PageElement[] = [];
    const headingEl = heading(pageTitle, MARGIN, 0.09, CONTENT_W, 0.07, {
      fontSize: Math.round(22 * SCRIPT_SCALE),
      maxH: 0.11,
    });
    const maxLines = Math.max(
      4,
      Math.floor(((CONTENT_BOTTOM - bodyTop) * REF_H) / (LEGAL_FONT_SIZE * LEGAL_LINE_HEIGHT)),
    );
    const { fits, rest } = splitTextToFitLines(
      remaining,
      LEGAL_FONT_SIZE,
      400,
      bodyWpx,
      maxLines,
      undefined,
    );
    const bodyEl: PageElement = {
      id: uid("el"),
      kind: "text",
      x: MARGIN,
      y: bodyTop,
      w: CONTENT_W,
      h: fitTextBoxHeight(fits, CONTENT_W, LEGAL_FONT_SIZE, 400) || 0.02,
      z: z++,
      text: fits,
      fontSize: LEGAL_FONT_SIZE,
      align: "left",
      color: MUTED,
      background: "rgba(0,0,0,0)",
      fontWeight: 400,
    };
    els.push(textPanel(headingEl, CREAM));
    els.push(textPanel(bodyEl, GREY));
    els.push(rule(MARGIN, 0.075, 0.1));
    els.push(headingEl);
    els.push(bodyEl);
    result.push(page(pageTitle, WHITE, els));
    remaining = rest.trim();
    part += 1;
    // Sicherheitsnetz gegen eine Endlosschleife, falls splitTextToFitLines
    // bei extrem ungewoehnlichem Text (z.B. ein einzelnes, nicht umbrechbares
    // sehr langes "Wort") keinen Fortschritt mehr macht.
    if (part > 30) break;
  }
  return result;
}

// Ansprechpartner-Seite: Text (Name/Kontaktdaten/kurzer Absatz) wortgetreu
// aus der Vorlage uebernommen, dazu bis zu zwei aus der Originalseite
// herausgeloeste Fotos (Makler-Portrait + ein weiteres, z.B. Guetesiegel/
// Auszeichnung) sowie das Makler-Logo unten links - im neuen Design.
function ansprechpartnerPage(
  text: string,
  images: string[],
  logo: StoredFile | null,
): Page {
  const els: PageElement[] = [];
  const headingEl = heading("Ihr Ansprechpartner", MARGIN, 0.09, CONTENT_W, 0.09, {
    fontSize: Math.round(27 * SCRIPT_SCALE),
    maxH: 0.14,
  });
  const textTop = headingEl.y + headingEl.h + TEXT_PANEL_GAP;
  const textW = images.length > 0 ? 0.42 : CONTENT_W;
  const bodyEl = body(text, MARGIN, textTop, textW, Math.max(0.15, CONTENT_BOTTOM - textTop), {
    maxH: CONTENT_BOTTOM - textTop,
  });

  els.push(textPanel(headingEl, CREAM));
  els.push(textPanel(bodyEl, GREY));
  els.push(rule(MARGIN, 0.075, 0.1));
  els.push(headingEl);
  els.push(bodyEl);

  // Fotos rechts daneben - erstes (groesstes/erstes gefundenes) Bild
  // prominent, ein zweites kleiner darunter.
  if (images.length > 0) {
    const photoX = 1 - MARGIN - 0.38;
    if (images.length === 1) {
      els.push(image(photoX, textTop, 0.38, CONTENT_BOTTOM - textTop, images[0]));
    } else {
      const bigH = (CONTENT_BOTTOM - textTop) * 0.62;
      els.push(image(photoX, textTop, 0.38, bigH, images[0]));
      els.push(image(photoX, textTop + bigH + 0.02, 0.38, CONTENT_BOTTOM - textTop - bigH - 0.02, images[1]));
    }
  }

  // Logo unten links (wie in der Originalvorlage), klein/dezent.
  if (logo) {
    const lw = 0.22;
    const lh = lw * 0.32;
    els.push({ id: uid("el"), kind: "logo", x: MARGIN, y: 1 - MARGIN - lh, w: lw, h: lh, z: z++, src: logo.dataUrl });
  }

  return page("Ansprechpartner", CREAM, els);
}

const BOILERPLATE_ORDER: BoilerplateKind[] = ["vorwort", "impressum", "agb", "widerruf", "kontakt"];

const BOILERPLATE_TITLE: Record<BoilerplateKind, string> = {
  vorwort: "Vorwort",
  impressum: "Impressum",
  agb: "Allgemeine Geschäftsbedingungen",
  widerruf: "Widerrufsbelehrung",
  kontakt: "Ansprechpartner",
};

export interface BoilerplateLuxuryInput {
  kind: BoilerplateKind;
  // Kompletter, ueber alle Quellseiten dieser Art zusammengefuegter Text.
  text: string;
}

// Baut die Standardseiten (Vorwort/Impressum/AGB/Widerruf/Ansprechpartner)
// im neuen "KI Exposé"-Design aus dem wortgetreu extrahierten Text -
// Ersatz fuer die bisherige 1:1-Bilduebernahme (siehe templates.ts/
// boilerplatePages(), die fuer den klassischen Editor-Ablauf unveraendert
// weiterverwendet wird). Nur die Ansprechpartner-Seite bekommt zusaetzlich
// die aus der Originalseite herausgeloesten Fotos + das Logo.
export function buildBoilerplateLuxuryPages(
  inputs: BoilerplateLuxuryInput[],
  kontaktImages: string[],
  logo: StoredFile | null,
): Page[] {
  const byKind = new Map<BoilerplateKind, string>();
  for (const inp of inputs) {
    const prev = byKind.get(inp.kind);
    byKind.set(inp.kind, prev ? `${prev}\n\n${inp.text}` : inp.text);
  }
  const result: Page[] = [];
  for (const kind of BOILERPLATE_ORDER) {
    const text = byKind.get(kind)?.trim();
    if (!text) continue;
    if (kind === "kontakt") {
      result.push({ ...ansprechpartnerPage(text, kontaktImages, logo), title: BOILERPLATE_TITLE[kind] });
    } else {
      const built = legalTextPages(BOILERPLATE_TITLE[kind], text);
      built.forEach((p) => result.push({ ...p, title: BOILERPLATE_TITLE[kind] }));
    }
  }
  return result;
}

// --- Zusammenbau -------------------------------------------------------------

// Erkennt den "Eckdaten"-Abschnitt am Titel (unabhaengig von der erkannten
// Art) - dieselbe Erkennung wie fuer die Datenblatt-Text-Isolation in
// ai.ts/writeSectionTextsChunk.
const ECKDATEN_TITLE_RE = /eckdaten/i;

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
  // Logo-Badge oben rechts erscheint NUR auf der Titelseite und erwartet
  // eine weiss/transparent aufbereitete Version (siehe invertLogoToWhite()) -
  // faellt ohne Angabe auf das normale Logo zurueck. Die Kontaktseite nutzt
  // weiterhin das normale (nicht invertierte) Logo, da sie keinen Fotohinter-
  // grund hat.
  heroLogo: StoredFile | null = logo,
  // ALLE Seiten eines hochgeladenen Energieausweises (bereits als Bilder
  // gerendert, siehe KiExposePage.tsx) - jede wird als EIGENE, einzelne
  // Seite eingefuegt (direkt vor Kontakt, sonst am Ende), NICHT als
  // normales Foto in andere Abschnitte gemischt.
  energieausweisImages: string[] = [],
): Page[] {
  z = 1;
  const pages: Page[] = [];
  let altSide = false;
  let pendingEnergieausweis = energieausweisImages;
  // Baut fuer JEDE Energieausweis-Seite eine eigene documentPage - bei
  // mehreren Seiten mit fortlaufender Nummer im Titel, bei genau einer ohne
  // (bisheriges Verhalten/bisheriger Titel bleibt erhalten).
  const buildEnergieausweisPages = (images: string[]): Page[] =>
    images.map((img, i) => {
      const title = images.length > 1 ? `Energieausweis ${i + 1}/${images.length}` : "Energieausweis";
      return { ...documentPage(title, img), title };
    });

  for (const { section, photos, headline, text } of inputs) {
    const title = headline || section.title;
    let built: Page;
    // "Eckdaten" bekommt unabhaengig von der erkannten Art (meist "sonstiges"
    // oder "objektbeschreibung") immer die dedizierte Fakten-Vorlage, nicht
    // die generische Text-/Foto-Seite.
    if (ECKDATEN_TITLE_RE.test(section.title) && section.kind !== "titel" && section.kind !== "kontakt") {
      built = eckdatenPage(title, text);
    } else {
      switch (section.kind) {
        case "titel":
          built = titlePage(title, text, photos, heroLogo, TYPE_LABEL[type]);
          break;
        case "grundriss":
          built = grundrissPage(title, text, photos);
          break;
        case "galerie":
          built = galeriePage(title, photos);
          break;
        case "kontakt":
          if (pendingEnergieausweis.length > 0) {
            pages.push(...buildEnergieausweisPages(pendingEnergieausweis));
            pendingEnergieausweis = [];
          }
          built = kontaktPage(logo, photos);
          break;
        default:
          // Auch OHNE zugeordnetes Foto (photos.length === 0) wird die
          // zweispaltige Vorlage genutzt statt eines reinen Textblocks -
          // twoColPage() reserviert die Fotoflaeche ueber photoLayout()
          // trotzdem und zeigt dann einen leeren Platzhalter (siehe dort),
          // damit fehlende Fotos immer sichtbar/nachtraeglich befuellbar
          // bleiben statt kommentarlos zu verschwinden.
          if (photos.length >= 3) {
            built = stackedPage(title, text, photos);
          } else {
            built = twoColPage(title, text, photos, altSide);
            altSide = !altSide;
          }
      }
    }
    // Die Miniaturansicht/Seiten-Beschriftung zeigt IMMER den urspruenglich
    // ausgelesenen Abschnittsnamen (nicht die kreative KI-Überschrift) -
    // damit 1:1 nachvollziehbar bleibt, welche Seite zu welchem Abschnitt
    // des analysierten Seitenaufbaus gehoert.
    pages.push({ ...built, title: section.title });
  }

  // Kein Kontakt-Abschnitt in der Struktur gefunden (Sonderfall) - Energie-
  // ausweis trotzdem nicht verwerfen, ans Ende der Inhaltsseiten anhaengen.
  if (pendingEnergieausweis.length > 0) {
    pages.push(...buildEnergieausweisPages(pendingEnergieausweis));
  }

  // Uebrig gebliebene, keinem Abschnitt zugeordnete Fotos nicht verwerfen -
  // als zusaetzliche Galerie-Seite(n) anhaengen.
  for (let i = 0; i < overflowPhotos.length; i += 4) {
    const chunk = overflowPhotos.slice(i, i + 4);
    pages.push(galeriePage(i === 0 ? "Weitere Impressionen" : "Impressionen", chunk));
  }

  return pages;
}

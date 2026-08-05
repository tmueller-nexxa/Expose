// "KI Exposé" IM DESIGN DER VORLAGE.
//
// Statt des fest hinterlegten Luxus-Designs (luxuryTemplate.ts) wird hier der
// aus dem Beispiel-Exposé uebernommene Seitenaufbau verwendet: Farben,
// Formen/Banner, Schriftgroessen und die Anordnung von Text- und Fotoflaechen
// stammen 1:1 aus der Vorlage (eingelesen im Datenbereich, siehe
// analyzePagesDesign() in ai.ts und die Ablage als StoredLayout). Neu sind
// ausschliesslich die INHALTE: die hochgeladenen Fotos wandern in die
// Fotoflaechen, die von der KI geschriebenen Texte in die Textflaechen.
//
// Bewusst werden nur LEERE Textflaechen befuellt: Text, der beim Einlesen
// wortgetreu uebernommen wurde (Rubriken-/Abschnittslabels auf farbigen
// Flaechen, z.B. "OBJEKTBESCHREIBUNG"), gehoert zum Design der Vorlage und
// bleibt unveraendert stehen.

import { REF_H, REF_W } from "../editor/constants";
import {
  fitFontSize,
  fitFontSizeForWidth,
  fitTextBoxHeight,
  splitTextToFitLines,
  textBaselineOffsetFrac,
} from "../editor/fit";
import { EXPOSE_BAR_COLOR, EXPOSE_BAR_HEIGHT } from "./luxuryTemplate";
import type { TitleHighlight } from "./ai";
import { TEXT_LINE_HEIGHT } from "../editor/constants";
import type { BoilerplateLuxuryInput, KiExposeSectionInput } from "./luxuryTemplate";
import type {
  BoilerplateKind,
  DesignPage,
  ExposeAddress,
  ExposeSection,
  ExposeSectionKind,
  Page,
  PageElement,
  StoredFile,
  StoredLayout,
  TextElement,
} from "./types";
import { uid } from "./util";

// Untergrenze fuer die Schriftgroesse in einer uebernommenen Textflaeche.
// Der neue Text ist selten genau so lang wie der Text der Vorlage - passt er
// nicht, wird verkleinert statt die Flaeche (und damit das Design) zu
// verschieben. Unter dieser Grenze waere er nicht mehr lesbar.
const MIN_TEXT_SIZE = 9;

// Wieviel Platz eine Textflaeche nach unten hoechstens dazugewinnen darf,
// wenn der Text selbst bei kleinster Schrift nicht hineinpasst - nur bis
// kurz vor den Seitenrand, damit nichts aus der Seite herauslaeuft.
const PAGE_BOTTOM_LIMIT = 0.96;

function isTextEl(el: PageElement): el is TextElement {
  return el.kind === "text" || el.kind === "heading";
}

function orderedPages(layout: StoredLayout): DesignPage[] {
  return [...layout.pages].sort((a, b) => a.order - b.order);
}

// Leseabfolge: oben vor unten, bei gleicher Hoehe links vor rechts.
function readingOrder<T extends { x: number; y: number }>(els: T[]): T[] {
  return [...els].sort((a, b) => (Math.abs(a.y - b.y) > 0.02 ? a.y - b.y : a.x - b.x));
}

const KIND_RULES: [RegExp, ExposeSectionKind][] = [
  [/titel|deckblatt|cover/i, "titel"],
  [/lage|umgebung|standort|infrastruktur/i, "lage"],
  [/grundriss|plan|geschoss/i, "grundriss"],
  [/ausstattung|technik|energie/i, "ausstattung"],
  [/kontakt|ansprechpartner|beratung/i, "kontakt"],
  [/galerie|impression|einblick|weitere/i, "galerie"],
  [/objekt|beschreib|haus|wohnung|immobilie/i, "objektbeschreibung"],
];

function kindForTitle(title: string, index: number): ExposeSectionKind {
  for (const [re, kind] of KIND_RULES) if (re.test(title)) return kind;
  // Die erste Seite eines Exposés ist immer die Titelseite - auch wenn ihr
  // ausgelesener Name das nicht hergibt.
  return index === 0 ? "titel" : "sonstiges";
}

// Leitet den Seitenaufbau direkt aus dem uebernommenen Design ab: eine Seite
// der Vorlage = ein Abschnitt, mit genau so vielen Fotos, wie die Vorlage auf
// dieser Seite vorsieht. Damit entfaellt die separate Struktur-Analyse - der
// Aufbau IST der der Vorlage, nicht eine Zusammenfassung davon.
export function sectionsFromLayout(layout: StoredLayout): ExposeSection[] {
  return orderedPages(layout).map((p, i) => ({
    kind: kindForTitle(p.title, i),
    title: p.title || `Seite ${i + 1}`,
    photoCount: p.elements.filter((e) => e.kind === "image").length,
  }));
}

// Setzt einen Text in eine uebernommene Textflaeche: Schriftgroesse der
// Vorlage als Obergrenze, bei laengerem Text verkleinern, und erst wenn auch
// das nicht reicht, die Flaeche nach unten wachsen lassen.
function fillTextElement(el: TextElement, text: string): void {
  el.text = text;
  const boxW = el.w * REF_W;
  const boxH = el.h * REF_H;
  const size = fitFontSize(text, boxW, boxH, {
    max: el.fontSize,
    min: Math.min(el.fontSize, MIN_TEXT_SIZE),
    weight: el.fontWeight,
    fontFamily: el.fontFamily,
  });
  el.fontSize = size;
  const needed = fitTextBoxHeight(text, el.w, size, el.fontWeight, el.fontFamily);
  if (needed > el.h) {
    el.h = Math.min(needed, Math.max(el.h, PAGE_BOTTOM_LIMIT - el.y));
  }
}

// Verteilt Ueberschrift und Fliesstext auf die noch leeren Textflaechen der
// Seite. Gibt es nur EINE leere Flaeche, landen beide darin (durch eine
// Leerzeile getrennt) - besser als generierten Text zu verlieren, nur weil
// die Vorlage auf dieser Seite bloss ein Textfeld vorsieht.
function fillTexts(elements: PageElement[], headline: string, text: string): void {
  const empty = readingOrder(
    elements.filter((e): e is TextElement => isTextEl(e) && !e.text.trim()),
  );
  if (empty.length === 0) return;

  const head = headline.trim();
  const bodyText = text.trim();

  if (empty.length === 1) {
    const combined = [head, bodyText].filter(Boolean).join("\n\n");
    if (combined) fillTextElement(empty[0], combined);
    return;
  }

  // Ueberschriftflaeche: die als "heading" erkannte, sonst die mit der
  // groessten Schrift - das ist in jeder Vorlage die Ueberschriftzeile.
  const headSlot =
    empty.find((e) => e.kind === "heading") ??
    [...empty].sort((a, b) => b.fontSize - a.fontSize)[0];
  if (head) fillTextElement(headSlot, head);

  const bodySlots = empty.filter((e) => e !== headSlot);
  if (!bodyText || bodySlots.length === 0) return;

  if (bodySlots.length === 1) {
    fillTextElement(bodySlots[0], bodyText);
    return;
  }

  // Mehrspaltige Vorlagen: den Text an Absatzgrenzen auf die Spalten
  // verteilen, gewichtet nach ihrer Flaeche - so bleibt die Spaltenaufteilung
  // der Vorlage erhalten, statt eine Spalte zu ueberfuellen und die anderen
  // leer zu lassen.
  const paragraphs = bodyText.split(/\n+/).filter((p) => p.trim());
  const areas = bodySlots.map((s) => s.w * s.h);
  const areaSum = areas.reduce((a, b) => a + b, 0) || 1;
  let taken = 0;
  bodySlots.forEach((slot, i) => {
    const isLast = i === bodySlots.length - 1;
    const share = Math.max(1, Math.round((areas[i] / areaSum) * paragraphs.length));
    const part = isLast
      ? paragraphs.slice(taken)
      : paragraphs.slice(taken, taken + share);
    taken += part.length;
    if (part.length > 0) fillTextElement(slot, part.join("\n"));
  });
}

interface FillOptions {
  photos?: string[];
  headline?: string;
  text?: string;
  logo?: StoredFile | null;
  // Dokumentenscans (Energieausweis) duerfen nicht beschnitten werden.
  fit?: "cover" | "contain";
  // Uebernommene Beschriftungen der Vorlage entfernen - fuer zusaetzlich
  // angehaengte Seiten, die dieselbe Gestaltung, aber nicht dieselbe
  // Beschriftung tragen sollen.
  clearLabels?: boolean;
}

function pageFromDesign(design: DesignPage, opts: FillOptions): Page {
  const elements: PageElement[] = design.elements.map((e) => ({ ...e, id: uid("el") }));

  if (opts.clearLabels) {
    for (const el of elements) if (isTextEl(el)) el.text = "";
  }

  const photos = opts.photos ?? [];
  const imageEls = readingOrder(elements.filter((e) => e.kind === "image"));
  imageEls.forEach((el, i) => {
    if (el.kind !== "image") return;
    el.src = photos[i] ?? "";
    if (opts.fit) el.fit = opts.fit;
  });

  if (opts.logo) {
    for (const el of elements) if (el.kind === "logo") el.src = opts.logo.dataUrl;
  }

  fillTexts(elements, opts.headline ?? "", opts.text ?? "");

  return {
    id: uid("pg"),
    title: design.title,
    background: design.background || "#ffffff",
    elements,
  };
}

// Waehlt die Vorlagenseite mit der groessten Fotoflaeche - Grundlage fuer
// zusaetzlich angehaengte Bildseiten (uebrige Fotos, Energieausweis), damit
// auch diese im Design der Vorlage erscheinen statt in einem Fremddesign.
function photoHeaviestPage(pages: DesignPage[]): DesignPage | null {
  let best: DesignPage | null = null;
  let bestArea = 0;
  for (const p of pages) {
    const area = p.elements
      .filter((e) => e.kind === "image")
      .reduce((sum, e) => sum + e.w * e.h, 0);
    if (area > bestArea) {
      bestArea = area;
      best = p;
    }
  }
  return best;
}

function photoSlotCount(p: DesignPage): number {
  return p.elements.filter((e) => e.kind === "image").length;
}

export function buildLayoutPages(
  layout: StoredLayout,
  inputs: KiExposeSectionInput[],
  logo: StoredFile | null,
  overflowPhotos: string[] = [],
  energieausweisImages: string[] = [],
  // Anschrift des Objekts und Internetadresse des Buueros - fuer die beiden
  // festen Felder der Titelseite (siehe fillTitleFields).
  address: ExposeAddress = { street: "", city: "" },
  website = "",
  // Die drei neu geschriebenen Argumente-Bloecke der Titelseite.
  titleHighlights: TitleHighlight[] = [],
): Page[] {
  const designs = orderedPages(layout);
  const pages: Page[] = [];

  inputs.forEach((input, i) => {
    const design = designs[i];
    if (!design) return;
    const built = pageFromDesign(design, {
      photos: input.photos,
      headline: input.headline || input.section.title,
      text: input.text,
      logo,
    });
    // Titelseite: Kopfzeile (Balken + "EXPOSÉ" + Logo) ist gesetzt und wird
    // ergaenzt, falls die Erfassung der Vorlage sie nicht hergegeben hat.
    if (i === 0) {
      // Vor dem Befuellen festhalten, welche Textfelder ihren Inhalt schon aus
      // der Vorlage mitbrachten - pageFromDesign() uebernimmt die Elemente in
      // unveraenderter Reihenfolge, die Zuordnung ueber den Index stimmt also.
      const fromTemplate = design.elements.map((e) => isTextEl(e) && !!e.text.trim());
      ensureExposeHeader(built, logo);
      fillTitleFields(built, layout, address, website);
      fillTitleHighlights(built, titleHighlights, fromTemplate);
    }
    pages.push(built);
  });

  // Energieausweis: jede Seite einzeln, auf der bildstaerksten Vorlagenseite
  // aufgebaut und unbeschnitten ("contain") eingesetzt.
  const docTemplate = photoHeaviestPage(designs);
  if (docTemplate && energieausweisImages.length > 0) {
    energieausweisImages.forEach((img, i) => {
      const title =
        energieausweisImages.length > 1
          ? `Energieausweis ${i + 1}/${energieausweisImages.length}`
          : "Energieausweis";
      const built = pageFromDesign(docTemplate, {
        photos: [img],
        headline: title,
        fit: "contain",
        logo,
        clearLabels: true,
      });
      pages.push({ ...built, title });
    });
  }

  // Uebrig gebliebene, keinem Abschnitt zugeordnete Fotos nicht verwerfen - auf
  // weiteren Seiten im Design der Vorlage anhaengen.
  if (overflowPhotos.length > 0) {
    const galleryTemplate =
      [...designs].sort((a, b) => photoSlotCount(b) - photoSlotCount(a))[0] ?? null;
    const slots = galleryTemplate ? photoSlotCount(galleryTemplate) : 0;
    if (galleryTemplate && slots > 0) {
      for (let i = 0; i < overflowPhotos.length; i += slots) {
        const chunk = overflowPhotos.slice(i, i + slots);
        const title = i === 0 ? "Weitere Impressionen" : "Impressionen";
        const built = pageFromDesign(galleryTemplate, {
          photos: chunk,
          headline: title,
          logo,
          clearLabels: true,
        });
        pages.push({ ...built, title });
      }
    }
  }

  return pages;
}

// --- Kopfzeile der Titelseite --------------------------------------------
//
// Jede Titelseite traegt oben den "Exposé"-Schriftzug und das Logo auf einem
// weissen, halbtransparenten Balken ueber die volle Seitenbreite - so wie im
// Beispiel-Exposé (dort nachgemessen, siehe EXPOSE_BAR_HEIGHT in
// luxuryTemplate.ts). Wurde beim Einlesen der Vorlage bereits ein solcher
// Balken/Schriftzug erfasst, bleibt er unangetastet; fehlt er, wird er
// ergaenzt - er soll IMMER vorhanden sein.
//
// Masse aus der Vorlage (Anteile der Seite):
//   Schriftzug: links 0,030, Breite 0,459, Grundlinie 0,147
//   Logo:       rechte Kante 0,956, Breite 0,269, oben 0,015, Hoehe 0,119
const HEADER_TEXT = "EXPOSÉ";
const HEADER_TEXT_X = 0.03;
const HEADER_TEXT_W = 0.4585;
const HEADER_TEXT_BASELINE = 0.147;
const HEADER_TEXT_WEIGHT = 800;
const HEADER_LOGO_RIGHT = 0.956;
const HEADER_LOGO_W = 0.269;
const HEADER_LOGO_Y = 0.015;
const HEADER_LOGO_H = 0.119;
// Ebenen: sicher ueber allem, was aus der Vorlage kommt (Formen ab z 10,
// Fotos auf der hintersten Ebene) - die Kopfzeile darf nie verdeckt werden.
const HEADER_BAR_Z = 800;
const HEADER_LOGO_Z = 801;
const HEADER_MARK_Z = 802;

function hasHeaderBar(page: Page): boolean {
  return page.elements.some(
    (e) => e.kind === "shape" && e.y <= 0.02 && e.w >= 0.9 && e.h >= 0.08,
  );
}

export function ensureExposeHeader(page: Page, logo: StoredFile | null): void {
  if (!hasHeaderBar(page)) {
    page.elements.push({
      id: uid("el"),
      kind: "shape",
      x: 0,
      y: 0,
      w: 1,
      h: EXPOSE_BAR_HEIGHT,
      z: HEADER_BAR_Z,
      color: EXPOSE_BAR_COLOR,
    });
  }

  const hasMark = page.elements.some(
    (e) => isTextEl(e) && e.y < 0.2 && /expos/i.test(e.text),
  );
  if (!hasMark) {
    const fontSize = Math.floor(
      fitFontSizeForWidth(HEADER_TEXT, HEADER_TEXT_W, HEADER_TEXT_WEIGHT),
    );
    const y = HEADER_TEXT_BASELINE - textBaselineOffsetFrac(fontSize, HEADER_TEXT_WEIGHT);
    page.elements.push({
      id: uid("el"),
      kind: "heading",
      x: HEADER_TEXT_X,
      y: Math.max(0, y),
      w: HEADER_TEXT_W,
      h: fitTextBoxHeight(HEADER_TEXT, HEADER_TEXT_W, fontSize, HEADER_TEXT_WEIGHT),
      z: HEADER_MARK_Z,
      text: HEADER_TEXT,
      fontSize,
      align: "left",
      color: "#ffffff",
      background: "rgba(0,0,0,0)",
      fontWeight: HEADER_TEXT_WEIGHT,
      // Weiss auf hellem Balken/Foto braucht die Abgrenzung, sonst
      // verschwindet der Schriftzug ueber einem hellen Himmel.
      textShadow: true,
    });
  }

  const hasLogo = page.elements.some((e) => e.kind === "logo" && e.y < 0.2 && e.src);
  if (!hasLogo && logo) {
    page.elements.push({
      id: uid("el"),
      kind: "logo",
      x: HEADER_LOGO_RIGHT - HEADER_LOGO_W,
      y: HEADER_LOGO_Y,
      w: HEADER_LOGO_W,
      h: HEADER_LOGO_H,
      z: HEADER_LOGO_Z,
      src: logo.dataUrl,
    });
  }
}

// --- Adresse und Internetadresse auf der Titelseite ----------------------
//
// Die Titelseite der Vorlage traegt unten zwei goldene Felder: im oberen die
// Anschrift des Objekts (Strasse mit Hausnummer, darunter PLZ und Ort), im
// unteren die Internetadresse des Buueros. Beide gehoeren zum festen Aufbau
// und werden IMMER gefuellt.
//
// Beim Einlesen der Vorlage wird Text, der auf einer Farbflaeche liegt,
// wortgetreu uebernommen (er gilt dort als Rubriklabel) - in diesen beiden
// Feldern stand danach also noch die Anschrift des BEISPIEL-Objekts. Genau
// die wird hier durch die des neuen Objekts ersetzt.
//
// Masse aus der Vorlage (Seite 1 bei 150 dpi vermessen), falls die Felder
// ergaenzt werden muessen:
//   Adressfeld:  x 0, y 0,7413, Breite 0,4819, Hoehe 0,0746
//   Web-Feld:    x 0, y 0,8712, Breite 0,4819, Hoehe 0,0581
//   Text jeweils ab x 0,0234; Goldton der Vorlage #bc9c22
const ADDRESS_BOX = { x: 0, y: 0.7413, w: 0.4819, h: 0.0746 };
const WEBSITE_BOX = { x: 0, y: 0.8712, w: 0.4819, h: 0.0581 };
const TITLE_FIELD_TEXT_X = 0.0234;
const TITLE_FIELD_FONT_SIZE = 22;
const TITLE_FIELD_INK = "#1a1a1a";
const FALLBACK_GOLD = "#bc9c22";
const TITLE_FIELD_Z = 810;

// Deutsche Postleitzahl + Ort - das zuverlaessigste Merkmal fuer ein
// Adressfeld (und in einem Titelseiten-Label sonst nirgends zu erwarten).
const ADDRESS_RE = /\b\d{5}\b\s+\p{L}/u;
const URL_RE = /(?:https?:\/\/|www\.)\S+\.\p{L}{2,}/u;

function formatAddress(address: ExposeAddress): string {
  const line2 = [address.zip?.trim(), address.city.trim()].filter(Boolean).join(" ");
  return [address.street.trim(), line2].filter(Boolean).join("\n");
}

// Haeufigste Farbe der Formflaechen einer Vorlage - dient als Farbe fuer ein
// nachtraeglich ergaenztes Feld, damit es zum Design passt.
function accentColor(layout: StoredLayout): string {
  const colors = orderedPages(layout)
    .flatMap((p) => p.elements)
    .filter((e) => e.kind === "shape" && e.w < 0.95)
    .map((e) => (e as { color: string }).color);
  return mostCommon(colors) ?? FALLBACK_GOLD;
}

function addTitleField(
  page: Page,
  box: { x: number; y: number; w: number; h: number },
  text: string,
  color: string,
): void {
  page.elements.push({
    id: uid("el"),
    kind: "shape",
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    z: TITLE_FIELD_Z,
    color,
  });
  const textW = box.w - TITLE_FIELD_TEXT_X * 2;
  const fontSize = fitFontSize(text, textW * REF_W, box.h * 0.8 * REF_H, {
    max: TITLE_FIELD_FONT_SIZE,
    min: 11,
    weight: 700,
  });
  const h = fitTextBoxHeight(text, textW, fontSize, 700);
  page.elements.push({
    id: uid("el"),
    kind: "text",
    x: box.x + TITLE_FIELD_TEXT_X,
    y: box.y + Math.max(0, (box.h - h) / 2),
    w: textW,
    h,
    z: TITLE_FIELD_Z + 1,
    text,
    fontSize,
    align: "left",
    color: TITLE_FIELD_INK,
    background: "rgba(0,0,0,0)",
    fontWeight: 700,
  });
}

export function fillTitleFields(
  page: Page,
  layout: StoredLayout,
  address: ExposeAddress,
  website: string,
): void {
  const addressText = formatAddress(address);
  const site = website.trim();

  // 1) Anschrift: das aus der Vorlage uebernommene Adressfeld weiterverwenden
  // (dort stimmen Position, Schriftgroesse und Farbe bereits) und nur seinen
  // Inhalt austauschen.
  const addressSlot = page.elements.find(
    (e): e is TextElement => isTextEl(e) && ADDRESS_RE.test(e.text),
  );
  if (addressText) {
    if (addressSlot) fillTextElement(addressSlot, addressText);
    else addTitleField(page, ADDRESS_BOX, addressText, accentColor(layout));
  }

  // 2) Internetadresse: die der Vorlage steht bereits richtig - sie wird nur
  // ersetzt, wenn im Datenbereich eine eigene hinterlegt ist.
  const siteSlot = page.elements.find(
    (e): e is TextElement => isTextEl(e) && e !== addressSlot && URL_RE.test(e.text),
  );
  if (siteSlot) {
    if (site) fillTextElement(siteSlot, site);
  } else if (site) {
    addTitleField(page, WEBSITE_BOX, site, accentColor(layout));
  }
}

// --- Titelseite: die drei Argumente-Bloecke ------------------------------
//
// Die Titelseite der Vorlage traegt drei Bloecke aus je einer Schlagzeile
// ("ECHT.SOLIDE.WERTIGES ZUHAUSE.") und zwei bis drei Zeilen Text. Sie liegen
// auf einer Flaeche und wurden beim Einlesen deshalb WORTGETREU uebernommen -
// dort steht also noch das, was zum Beispielobjekt gehoert. Hier wird der
// Inhalt gegen die neu geschriebenen Bloecke getauscht (siehe
// writeTitleHighlights() in ai.ts), waehrend Position, Schriftgroesse,
// Farbe und Ausrichtung der Vorlage erhalten bleiben.

// Schlagzeile im Stil der Vorlage: Grossbuchstaben, mit Punkten verbunden,
// mit Punkt abgeschlossen. Der Objekttyp im Banner ("EINFAMILIENHAUS") faellt
// bewusst NICHT darunter - er hat keinen Schlusspunkt.
const HIGHLIGHT_HEAD_RE = /^[\p{Lu}\d][\p{Lu}\d\s.\-–&]{3,}\.$/u;

function isHighlightHead(el: TextElement): boolean {
  const t = el.text.trim();
  return t.includes(".") && HIGHLIGHT_HEAD_RE.test(t);
}

// Liefert die Bloecke der Vorlage als Tonfall-Vorbild fuer die Textgenerierung.
export function titleHighlightSample(layout: StoredLayout): string {
  const title = orderedPages(layout)[0];
  if (!title) return "";
  const texts = readingOrder(title.elements.filter(isTextEl).filter((e) => e.text.trim()));
  const out: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    if (!isHighlightHead(texts[i])) continue;
    const body = texts[i + 1] && !isHighlightHead(texts[i + 1]) ? texts[i + 1].text.trim() : "";
    out.push(body ? `${texts[i].text.trim()}\n${body}` : texts[i].text.trim());
  }
  return out.slice(0, 3).join("\n\n");
}

// Der Textblock einer Schlagzeile steht DIREKT DARUNTER in derselben Spalte.
// Nur "das naechste Feld in Leserichtung" zu nehmen genuegt nicht: auf der
// Titelseite liegen die goldenen Felder (Anschrift, Internetadresse) auf
// nahezu gleicher Hoehe links daneben und wuerden sonst mitgefuellt -
// gemessen an der Vorlage liegt das Web-Feld bei y 0,891, der dritte
// Textblock bei y 0,887.
function bodyForHeadline(head: TextElement, candidates: TextElement[]): TextElement | null {
  let best: TextElement | null = null;
  for (const el of candidates) {
    if (el === head || el.y <= head.y) continue;
    if (isHighlightHead(el)) continue;
    // Nur Felder derselben Spalte: die waagerechten Bereiche muessen sich
    // deutlich ueberlappen.
    const overlap = Math.min(head.x + head.w, el.x + el.w) - Math.max(head.x, el.x);
    if (overlap < Math.min(head.w, el.w) * 0.5) continue;
    if (!best || el.y < best.y) best = el;
  }
  return best;
}

// fromTemplate: fuer jedes Element der Seite, ob es seinen Text SCHON in der
// Vorlage hatte. Nur solche Felder gehoeren zu den Argumente-Bloecken - die
// leeren Textflaechen der Vorlage nehmen den Abschnittstext auf und duerfen
// nicht mit einem Block ueberschrieben werden (auf der Titelseite der Vorlage
// liegt genau so eine leere Spalte direkt neben den Bloecken).
export function fillTitleHighlights(
  page: Page,
  highlights: TitleHighlight[],
  fromTemplate: boolean[],
): void {
  if (highlights.length === 0) return;
  // Anschrift und Internetadresse haben ihre eigenen Felder (siehe
  // fillTitleFields) und duerfen hier nicht ueberschrieben werden.
  const candidates = readingOrder(
    page.elements
      .filter((_, i) => fromTemplate[i] ?? false)
      .filter(isTextEl)
      .filter((e) => !ADDRESS_RE.test(e.text) && !URL_RE.test(e.text)),
  );
  const heads = candidates.filter(isHighlightHead);
  const taken = new Set<TextElement>();
  heads.slice(0, highlights.length).forEach((head, i) => {
    const h = highlights[i];
    if (h.headline) fillTextElement(head, h.headline);
    const bodyEl = bodyForHeadline(head, candidates.filter((c) => !taken.has(c)));
    if (h.text && bodyEl) {
      fillTextElement(bodyEl, h.text);
      taken.add(bodyEl);
    }
  });
}

// --- Seitenzahlen im Design der Vorlage ----------------------------------
//
// Die Schwungschrift-Seitenzahl des fest hinterlegten Luxus-Designs (siehe
// pageNumberMark() in luxuryTemplate.ts) passt nicht mehr, sobald das Exposé
// im Design der Vorlage entsteht - sie waere der einzige Rest des alten
// Designs. Stattdessen wird die Ziffer in der Typografie der Vorlage gesetzt:
// deren Schriftfarbe, deren Schriftgroessenordnung, Standardschrift statt
// Schwungschrift.
//
// Position unveraendert wie zuvor festgelegt: 5 mm vom rechten und vom
// unteren Blattrand, gemessen an der rechten Textkante bzw. der Grundlinie.
const PAGE_NUM_Z = 900;
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PAGE_NUM_MARGIN_MM = 5;
const PAGE_NUM_EDGE_RIGHT = PAGE_NUM_MARGIN_MM / A4_WIDTH_MM;
const PAGE_NUM_BASELINE_BOTTOM = PAGE_NUM_MARGIN_MM / A4_HEIGHT_MM;
const PAGE_NUM_MIN_SIZE = 10;
const PAGE_NUM_MAX_SIZE = 18;

// Haeufigster Wert einer Liste - fuer Schriftfarbe/-groesse der Vorlage die
// robustere Wahl als ein Mittelwert (ein einzelner Ausreisser, z.B. ein
// weisses Label auf einem farbigen Banner, verschoebe den Mittelwert).
function mostCommon<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | undefined;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function pageNumberStyle(layout: StoredLayout): { color: string; fontSize: number } {
  const texts = orderedPages(layout)
    .flatMap((p) => p.elements)
    .filter(isTextEl);
  // Fliesstextfarbe der Vorlage: sie ist auf deren Seitenhintergrund
  // garantiert lesbar - anders als z.B. eine Bannerfarbe.
  const bodies = texts.filter((e) => e.kind === "text");
  const color = mostCommon((bodies.length > 0 ? bodies : texts).map((e) => e.color)) ?? "#888888";
  const size = mostCommon(bodies.map((e) => e.fontSize)) ?? 12;
  return {
    color,
    fontSize: Math.min(PAGE_NUM_MAX_SIZE, Math.max(PAGE_NUM_MIN_SIZE, Math.round(size))),
  };
}

export function addLayoutPageNumbers(pages: Page[], layout: StoredLayout): void {
  const { color, fontSize } = pageNumberStyle(layout);
  const w = 0.08;
  const x = 1 - PAGE_NUM_EDGE_RIGHT - w;
  // Ein Textfeld setzt seinen Text ab der OBERKANTE, der Abstand gilt aber
  // fuer die GRUNDLINIE - darum den Grundlinienversatz zurueckrechnen.
  const y = 1 - PAGE_NUM_BASELINE_BOTTOM - textBaselineOffsetFrac(fontSize, 700);
  pages.forEach((p, i) => {
    const text = String(i + 1);
    p.elements.push({
      id: uid("el"),
      kind: "text",
      x,
      y,
      w,
      h: Math.min(fitTextBoxHeight(text, w, fontSize, 700), 1 - y),
      z: PAGE_NUM_Z,
      text,
      fontSize,
      align: "right",
      color,
      background: "rgba(0,0,0,0)",
      fontWeight: 700,
    });
  });
}

// --- Standardseiten im Design der Vorlage --------------------------------
//
// Vorwort/Impressum/AGB/Widerrufsbelehrung/Ansprechpartner werden ebenfalls
// im uebernommenen Design aufgebaut, damit das Exposé bis zur letzten Seite
// aus einem Guss ist. Uebernommen wird dabei die GESTALTUNG der Vorlage
// (Farben, Formen, Textflaechen) - NICHT die Originalseiten selbst: deren
// Inhalt kommt weiterhin ausschliesslich als wortgetreu extrahierter Text.

const BOILERPLATE_ORDER: BoilerplateKind[] = ["vorwort", "impressum", "agb", "widerruf", "kontakt"];

const BOILERPLATE_TITLE: Record<BoilerplateKind, string> = {
  vorwort: "Vorwort",
  impressum: "Impressum",
  agb: "Allgemeine Geschäftsbedingungen",
  widerruf: "Widerrufsbelehrung",
  kontakt: "Ansprechpartner",
};

// Sicherheitsnetz gegen eine Endlosschleife, falls ein Text bei sehr kleinen
// Textflaechen nicht mehr weiter aufgeteilt werden kann.
const MAX_LEGAL_PAGES = 30;

// Kuerzester Rest, fuer den sich noch eine Folgeseite lohnt.
const MIN_CONTINUATION_CHARS = 40;

function textArea(p: DesignPage): number {
  return p.elements
    .filter((e): e is TextElement => isTextEl(e) && !e.text.trim())
    .reduce((sum, e) => sum + e.w * e.h, 0);
}

// Vorlagenseite mit der groessten freien TEXTflaeche - Grundlage fuer die
// Rechtstexte. Fotoflaechen zaehlen dabei gegen die Seite: eine Seite, die
// vor allem Bilder zeigt, taugt nicht als Textseite.
function textHeaviestPage(pages: DesignPage[]): DesignPage | null {
  let best: DesignPage | null = null;
  let bestScore = -Infinity;
  for (const p of pages) {
    const imgArea = p.elements
      .filter((e) => e.kind === "image")
      .reduce((sum, e) => sum + e.w * e.h, 0);
    const score = textArea(p) - imgArea;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

// Wieviele Zeilen in eine Textflaeche passen, ohne sie zu vergroessern.
function slotLineCapacity(el: TextElement): number {
  return Math.max(1, Math.floor((el.h * REF_H) / (el.fontSize * TEXT_LINE_HEIGHT)));
}

// Giesst einen (langen) Text der Reihe nach in die uebergebenen Textflaechen -
// jede behaelt ihre Schriftgroesse aus der Vorlage, was nicht mehr passt,
// wird als Rest zurueckgegeben und landet auf einer Folgeseite.
function pourText(slots: TextElement[], text: string): { rest: string; lastSlot: TextElement | null } {
  let remaining = text.trim();
  let lastSlot: TextElement | null = null;
  for (const slot of slots) {
    if (!remaining || !slot) break;
    const { fits, rest } = splitTextToFitLines(
      remaining,
      slot.fontSize,
      slot.fontWeight,
      slot.w * REF_W,
      slotLineCapacity(slot),
      slot.fontFamily,
    );
    if (!fits.trim()) break;
    slot.text = fits;
    slot.h = Math.min(
      Math.max(slot.h, fitTextBoxHeight(fits, slot.w, slot.fontSize, slot.fontWeight, slot.fontFamily)),
      Math.max(slot.h, PAGE_BOTTOM_LIMIT - slot.y),
    );
    remaining = rest.trim();
    lastSlot = slot;
  }
  return { rest: remaining, lastSlot };
}

// Baut eine Standardseite aus einer Vorlagenseite: Beschriftungen der Vorlage
// bleiben (sie gehoeren zur Gestaltung), Fotoflaechen entfallen bei reinen
// Textseiten, Ueberschrift und Text kommen aus dem extrahierten Seitentext.
function boilerplatePageFromDesign(
  design: DesignPage,
  title: string,
  text: string,
  images: string[],
  logo: StoredFile | null,
): { page: Page; rest: string; lastSlot: TextElement | null } {
  const all: PageElement[] = design.elements.map((e) => ({ ...e, id: uid("el") }));
  // Ohne Bilder fuer diese Seite bleiben sonst leere Fotoplatzhalter mitten
  // im Rechtstext stehen.
  const dropped: PageElement[] =
    images.length > 0 ? [] : all.filter((e) => e.kind === "image");
  const elements = all.filter((e) => !dropped.includes(e));

  // Der frei gewordene Streifen der entfallenen Fotoflaechen faellt an die
  // darunterliegenden Textspalten - sonst klaffte auf jeder Rechtsseite ein
  // grosses Loch, waehrend der Text darunter auf viele Seiten zerfaellt.
  if (dropped.length > 0) {
    const freedTop = Math.min(...dropped.map((e) => e.y));
    for (const el of elements) {
      if (!isTextEl(el) || el.text.trim() || el.y <= freedTop) continue;
      el.h += el.y - freedTop;
      el.y = freedTop;
    }
  }

  const imageEls = readingOrder(elements.filter((e) => e.kind === "image"));
  imageEls.forEach((el, i) => {
    if (el.kind === "image") el.src = images[i] ?? "";
  });
  if (logo) for (const el of elements) if (el.kind === "logo") el.src = logo.dataUrl;

  const empty = readingOrder(
    elements.filter((e): e is TextElement => isTextEl(e) && !e.text.trim()),
  );
  const headSlot =
    empty.find((e) => e.kind === "heading") ??
    [...empty].sort((a, b) => b.fontSize - a.fontSize)[0];
  if (headSlot) fillTextElement(headSlot, title);
  const bodySlots = empty.filter((e) => e !== headSlot);

  // Gibt es ausser der Ueberschrift keine Textflaeche, wandert der Text in die
  // Ueberschriftflaeche - sonst ginge der (rechtlich relevante) Inhalt verloren.
  const poured = bodySlots.length > 0 ? pourText(bodySlots, text) : pourText([headSlot], text);

  return {
    page: {
      id: uid("pg"),
      title,
      background: design.background || "#ffffff",
      // Textflaechen, die leer geblieben sind (der Text war kuerzer als die
      // Vorlage vorsieht), entfallen - sonst stuende auf einer fertigen
      // Rechtsseite ein leerer Platzhalterrahmen.
      elements: elements.filter((e) => !isTextEl(e) || e.text.trim()),
    },
    rest: poured.rest,
    lastSlot: poured.lastSlot,
  };
}

export function buildLayoutBoilerplatePages(
  layout: StoredLayout,
  inputs: BoilerplateLuxuryInput[],
  kontaktImages: string[],
  logo: StoredFile | null,
): Page[] {
  const designs = orderedPages(layout);
  const textTemplate = textHeaviestPage(designs);
  // Hat die Vorlage nirgends eine freie Textflaeche (unvollstaendig erkanntes
  // Design), gaebe es keinen Ort fuer die Rechtstexte. Dann lieber gar nichts
  // liefern - der Aufrufer baut die Standardseiten in dem Fall wie bisher auf,
  // statt dass der rechtlich relevante Text verloren geht.
  if (!textTemplate || textArea(textTemplate) <= 0) return [];
  // Ansprechpartner: eine Vorlagenseite MIT Fotoflaeche, damit Portrait und
  // Stilpunkte-Foto ihren Platz haben.
  const kontaktTemplate =
    kontaktImages.length > 0 ? photoHeaviestPage(designs) ?? textTemplate : textTemplate;

  const byKind = new Map<BoilerplateKind, string>();
  for (const inp of inputs) {
    const prev = byKind.get(inp.kind);
    byKind.set(inp.kind, prev ? `${prev}\n\n${inp.text}` : inp.text);
  }

  const result: Page[] = [];
  for (const kind of BOILERPLATE_ORDER) {
    const text = byKind.get(kind)?.trim();
    if (!text) continue;
    const baseTitle = BOILERPLATE_TITLE[kind];
    const design = kind === "kontakt" ? kontaktTemplate : textTemplate;
    const images = kind === "kontakt" ? kontaktImages : [];
    let remaining = text;
    let part = 1;
    while (remaining && part <= MAX_LEGAL_PAGES) {
      const title = part === 1 ? baseTitle : `${baseTitle} (Fortsetzung)`;
      const built = boilerplatePageFromDesign(design, title, remaining, images, logo);
      result.push({ ...built.page, title: baseTitle });
      if (built.rest === remaining) break; // kein Fortschritt -> abbrechen
      // Ein winziger Rest (haeufig eine versprengte Seitenzahl aus der
      // Textebene der Vorlage) bekommt keine eigene Seite mehr, sondern haengt
      // sich an den letzten gefuellten Textblock an - sonst entstuende eine
      // fast leere Folgeseite mit einem einzelnen Zeichen darauf.
      if (built.rest && built.rest.length < MIN_CONTINUATION_CHARS && built.lastSlot) {
        const slot = built.lastSlot;
        slot.text = `${slot.text}\n${built.rest}`;
        slot.h = Math.min(
          Math.max(slot.h, fitTextBoxHeight(slot.text, slot.w, slot.fontSize, slot.fontWeight, slot.fontFamily)),
          Math.max(slot.h, PAGE_BOTTOM_LIMIT - slot.y),
        );
        break;
      }
      remaining = built.rest;
      part += 1;
    }
  }
  return result;
}

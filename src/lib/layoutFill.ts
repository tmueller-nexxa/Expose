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
import { fitFontSize, fitTextBoxHeight, splitTextToFitLines } from "../editor/fit";
import { TEXT_LINE_HEIGHT } from "../editor/constants";
import type { BoilerplateLuxuryInput, KiExposeSectionInput } from "./luxuryTemplate";
import type {
  BoilerplateKind,
  DesignPage,
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
): Page[] {
  const designs = orderedPages(layout);
  const pages: Page[] = [];

  inputs.forEach((input, i) => {
    const design = designs[i];
    if (!design) return;
    pages.push(
      pageFromDesign(design, {
        photos: input.photos,
        headline: input.headline || input.section.title,
        text: input.text,
        logo,
      }),
    );
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

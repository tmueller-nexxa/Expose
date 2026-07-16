// Blanko-Vorlagen pro Expose-Typ.
//
// Sobald ein Beispiel-Exposé analysiert wurde, wird JEDE Seite 1:1 als Bild
// uebernommen (Design, Schrift, Icons, Farben, Groessen - exakt wie im
// Original). Erkannte Fotobereiche werden aus dem Bild entfernt und durch
// Platzhalter ersetzt; bei Inhaltsseiten zusaetzlich der objektspezifische
// Text. Ohne analysiertes Beispiel dient ein handgebauter Blanko-Aufbau als
// Startpunkt (Bild-Platzhalter, die per Drag&Drop befuellt werden).

import type {
  CapturedPage,
  ExposeProject,
  ExposeType,
  Page,
  PageElement,
  StoredBoilerplate,
  StoredFile,
  StoredLayout,
} from "./types";
import { clamp, uid } from "./util";
import { REF_H } from "../editor/constants";

// Baut aus einer 1:1 uebernommenen Seite (Inhalts- oder Standardseite) ein
// Page-Objekt: gesperrter Vollbild-Hintergrund + Foto-Platzhalter an den
// erkannten (und aus dem Bild entfernten) Fotostellen.
function capturedPageToPage(
  p: CapturedPage,
  source: "boilerplate" | "layout",
): Page {
  const elements: PageElement[] = [
    {
      id: uid("el"),
      kind: "image",
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      z: 1,
      src: p.image,
      fit: "contain",
      fromBoilerplate: true,
      locked: true,
    },
  ];
  let z = 2;
  for (const slot of p.photoSlots ?? []) {
    elements.push({
      id: uid("el"),
      kind: "image",
      x: slot.x,
      y: slot.y,
      w: slot.w,
      h: slot.h,
      z: z++,
      src: "",
      fit: "cover",
    });
  }
  // Entfernte Textstellen (nur Inhaltsseiten) als leere, frei editierbare
  // Textfelder wieder einsetzen - Position/Größe 1:1 wie im Original,
  // Inhalt frei (neuer Objekttext statt des entfernten Originaltexts).
  for (const slot of p.textSlots ?? []) {
    const fontSize = Math.round(clamp(slot.h * REF_H * 0.5, 11, 42));
    elements.push({
      id: uid("el"),
      kind: "text",
      x: slot.x,
      y: slot.y,
      w: slot.w,
      h: slot.h,
      z: z++,
      text: "",
      fontSize,
      align: "left",
      color: "#1f2d3d",
      background: "rgba(0,0,0,0)",
      fontWeight: 400,
    });
  }
  return {
    id: uid("pg"),
    title: p.title,
    background: "#ffffff",
    elements,
    sourcePage: { kind: source, id: p.id },
  };
}

function boilerplatePages(bp: StoredBoilerplate | null): Page[] {
  if (!bp || bp.pages.length === 0) return [];
  return [...bp.pages]
    .sort((a, b) => a.order - b.order)
    .map((p) => capturedPageToPage(p, "boilerplate"));
}

function layoutPages(layout: StoredLayout | null): Page[] {
  if (!layout || layout.pages.length === 0) return [];
  return [...layout.pages]
    .sort((a, b) => a.order - b.order)
    .map((p) => capturedPageToPage(p, "layout"));
}

// --- Handgebauter Blanko-Aufbau (Fallback ohne analysiertes Beispiel) ----

let zCounter = 1;

function heading(
  text: string,
  x: number,
  y: number,
  w: number,
  opts: Partial<{ fontSize: number; color: string; align: "left" | "center" | "right"; weight: number }> = {},
): PageElement {
  return {
    id: uid("el"),
    kind: "heading",
    x,
    y,
    w,
    h: 0.06,
    z: zCounter++,
    text,
    fontSize: opts.fontSize ?? 28,
    align: opts.align ?? "left",
    color: opts.color ?? "#1f2d3d",
    background: "rgba(0,0,0,0)",
    fontWeight: opts.weight ?? 700,
  };
}

function imageSlot(x: number, y: number, w: number, h: number): PageElement {
  return {
    id: uid("el"),
    kind: "image",
    x,
    y,
    w,
    h,
    z: zCounter++,
    src: "",
    fit: "cover",
  };
}

function accentBar(color: string): PageElement {
  return {
    id: uid("el"),
    kind: "heading",
    x: 0.06,
    y: 0.135,
    w: 0.12,
    h: 0.006,
    z: zCounter++,
    text: "",
    fontSize: 8,
    align: "left",
    color,
    background: color,
    fontWeight: 400,
  };
}

function logoSlot(logo: StoredFile | null): PageElement | null {
  if (!logo) return null;
  return {
    id: uid("el"),
    kind: "logo",
    x: 0.68,
    y: 0.05,
    w: 0.26,
    h: 0.09,
    z: 999,
    src: logo.dataUrl,
  };
}

const ACCENT: Record<ExposeType, string> = {
  einfamilienhaus: "#c8a04b",
  wohnung: "#1f8f6f",
  mehrfamilienhaus: "#2f6f8f",
  gewerbe: "#7a4b8f",
};

const TITLE: Record<ExposeType, string> = {
  einfamilienhaus: "Einfamilienhaus",
  wohnung: "Wohnung",
  mehrfamilienhaus: "Mehrfamilienhaus",
  gewerbe: "Gewerbeimmobilie",
};

function page(title: string, elements: (PageElement | null)[]): Page {
  return {
    id: uid("pg"),
    title,
    background: "#ffffff",
    elements: elements.filter((e): e is PageElement => e !== null),
  };
}

function titlePage(
  logo: StoredFile | null,
  accent: string,
  title: string,
): Page {
  return page("Titelseite", [
    logoSlot(logo),
    imageSlot(0.06, 0.18, 0.88, 0.52),
    accentBar(accent),
    heading("EXPOSÉ", 0.06, 0.1, 0.6, { fontSize: 15, color: accent, weight: 600 }),
    heading(title, 0.06, 0.74, 0.88, { fontSize: 40, weight: 800 }),
    heading("Musterstraße 1 · 12345 Musterstadt", 0.06, 0.83, 0.88, {
      fontSize: 18,
      color: "#5b6b7b",
      weight: 400,
    }),
  ]);
}

function contactPage(logo: StoredFile | null, accent: string): Page {
  return page("Kontakt", [
    logoSlot(logo),
    accentBar(accent),
    heading("Ihr Ansprechpartner", 0.06, 0.09, 0.88, { fontSize: 26 }),
    heading("Max Mustermann · Immobilienmakler", 0.06, 0.22, 0.88, {
      fontSize: 20,
      weight: 600,
    }),
    heading("Telefon: 0123 / 456 789", 0.06, 0.3, 0.88, {
      fontSize: 16,
      color: "#5b6b7b",
      weight: 400,
    }),
    heading("E-Mail: kontakt@makler.de", 0.06, 0.35, 0.88, {
      fontSize: 16,
      color: "#5b6b7b",
      weight: 400,
    }),
    imageSlot(0.06, 0.45, 0.42, 0.45),
  ]);
}

// Standard-Aufbau (Haus / Gewerbe): Titel, Objekt, Lage, Ausstattung, Kontakt.
function defaultPages(
  logo: StoredFile | null,
  accent: string,
  title: string,
): Page[] {
  return [
    titlePage(logo, accent, title),
    page("Objektbeschreibung", [
      logoSlot(logo),
      accentBar(accent),
      heading("Objektbeschreibung", 0.06, 0.09, 0.88, { fontSize: 26 }),
      imageSlot(0.06, 0.2, 0.88, 0.42),
      imageSlot(0.06, 0.66, 0.42, 0.26),
      imageSlot(0.52, 0.66, 0.42, 0.26),
    ]),
    page("Lage & Umgebung", [
      logoSlot(logo),
      accentBar(accent),
      heading("Lage & Umgebung", 0.06, 0.09, 0.88, { fontSize: 26 }),
      imageSlot(0.06, 0.2, 0.55, 0.7),
      imageSlot(0.64, 0.2, 0.3, 0.335),
      imageSlot(0.64, 0.565, 0.3, 0.325),
    ]),
    page("Ausstattung & Grundriss", [
      logoSlot(logo),
      accentBar(accent),
      heading("Ausstattung & Grundriss", 0.06, 0.09, 0.88, { fontSize: 26 }),
      imageSlot(0.06, 0.2, 0.42, 0.7),
      imageSlot(0.52, 0.2, 0.42, 0.7),
    ]),
    contactPage(logo, accent),
  ];
}

// Wohnungs-Aufbau (Etagenwohnung): Wohnraeume, Grundriss/Wohnflaeche, Anbindung.
function wohnungPages(
  logo: StoredFile | null,
  accent: string,
  title: string,
): Page[] {
  return [
    titlePage(logo, accent, title),
    page("Wohnräume", [
      logoSlot(logo),
      accentBar(accent),
      heading("Wohnräume", 0.06, 0.09, 0.88, { fontSize: 26 }),
      imageSlot(0.06, 0.2, 0.88, 0.4),
      imageSlot(0.06, 0.64, 0.42, 0.28),
      imageSlot(0.52, 0.64, 0.42, 0.28),
    ]),
    page("Grundriss & Wohnfläche", [
      logoSlot(logo),
      accentBar(accent),
      heading("Grundriss & Wohnfläche", 0.06, 0.09, 0.88, { fontSize: 26 }),
      imageSlot(0.06, 0.2, 0.56, 0.7),
      imageSlot(0.66, 0.2, 0.28, 0.335),
      imageSlot(0.66, 0.565, 0.28, 0.325),
    ]),
    page("Lage & Anbindung", [
      logoSlot(logo),
      accentBar(accent),
      heading("Lage & Anbindung", 0.06, 0.09, 0.88, { fontSize: 26 }),
      imageSlot(0.06, 0.2, 0.88, 0.44),
      imageSlot(0.06, 0.68, 0.42, 0.24),
      imageSlot(0.52, 0.68, 0.42, 0.24),
    ]),
    contactPage(logo, accent),
  ];
}

export function createProject(
  type: ExposeType,
  logo: StoredFile | null,
  boilerplate: StoredBoilerplate | null = null,
): ExposeProject {
  zCounter = 1;
  const accent = ACCENT[type];
  const title = TITLE[type];

  const pages =
    type === "wohnung"
      ? wohnungPages(logo, accent, title)
      : defaultPages(logo, accent, title);

  return {
    id: uid("proj"),
    type,
    title: `${title} – Exposé`,
    pages: [...pages, ...boilerplatePages(boilerplate)],
    updatedAt: Date.now(),
    builtFrom: projectStamp(null, boilerplate),
  };
}

// Kombinierter Stempel aus Struktur + Standardseiten. Aendert sich einer davon,
// erkennt der Editor, dass eine neuere Vorlage vorliegt.
export function projectStamp(
  layout: StoredLayout | null,
  bp: StoredBoilerplate | null,
): string {
  const l = layout ? `layout:${layout.createdAt}` : "default";
  return `${l}|bp:${bp?.createdAt ?? 0}`;
}

// Projekt aus dem 1:1 uebernommenen Beispiel-Exposé (Inhaltsseiten) + den
// globalen Standardseiten. Ohne analysierte Inhaltsseiten wird der
// handgebaute Blanko-Aufbau als Startpunkt verwendet.
export function createProjectFromLayout(
  type: ExposeType,
  layout: StoredLayout,
  logo: StoredFile | null,
  boilerplate: StoredBoilerplate | null = null,
): ExposeProject {
  const captured = layoutPages(layout);
  const base = captured.length > 0 ? captured : createProject(type, logo).pages;
  return {
    id: uid("proj"),
    type,
    title: `${TITLE[type]} – Exposé`,
    pages: [...base, ...boilerplatePages(boilerplate)],
    updatedAt: Date.now(),
    builtFrom: projectStamp(layout, boilerplate),
  };
}

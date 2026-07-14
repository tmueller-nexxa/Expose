// Blanko-Vorlagen pro Expose-Typ. Bilden den strukturellen Aufbau eines
// professionellen Exposes ab (Titelseite, Objektbeschreibung, Lage,
// Ausstattung, Kontakt). Bild-Platzhalter sind leere Bild-Elemente, die
// per Drag&Drop befuellt werden.

import type {
  ExposeProject,
  ExposeType,
  Page,
  PageElement,
  StoredFile,
} from "./types";
import { uid } from "./util";

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

export function createProject(
  type: ExposeType,
  logo: StoredFile | null,
): ExposeProject {
  zCounter = 1;
  const accent = ACCENT[type];
  const title = TITLE[type];

  const pages: Page[] = [
    // 1 · Titelseite
    page("Titelseite", [
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
    ]),

    // 2 · Objektbeschreibung
    page("Objektbeschreibung", [
      logoSlot(logo),
      accentBar(accent),
      heading("Objektbeschreibung", 0.06, 0.09, 0.88, { fontSize: 26 }),
      imageSlot(0.06, 0.2, 0.88, 0.42),
      imageSlot(0.06, 0.66, 0.42, 0.26),
      imageSlot(0.52, 0.66, 0.42, 0.26),
    ]),

    // 3 · Lage & Umgebung
    page("Lage & Umgebung", [
      logoSlot(logo),
      accentBar(accent),
      heading("Lage & Umgebung", 0.06, 0.09, 0.88, { fontSize: 26 }),
      imageSlot(0.06, 0.2, 0.55, 0.7),
      imageSlot(0.64, 0.2, 0.3, 0.335),
      imageSlot(0.64, 0.565, 0.3, 0.325),
    ]),

    // 4 · Ausstattung & Grundriss
    page("Ausstattung & Grundriss", [
      logoSlot(logo),
      accentBar(accent),
      heading("Ausstattung & Grundriss", 0.06, 0.09, 0.88, { fontSize: 26 }),
      imageSlot(0.06, 0.2, 0.42, 0.7),
      imageSlot(0.52, 0.2, 0.42, 0.7),
    ]),

    // 5 · Kontakt
    page("Kontakt", [
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
    ]),
  ];

  return {
    id: uid("proj"),
    type,
    title: `${title} – Exposé`,
    pages,
    updatedAt: Date.now(),
  };
}

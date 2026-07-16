// Blanko-Vorlagen pro Expose-Typ. Bilden den strukturellen Aufbau eines
// professionellen Exposes ab (Titelseite, Objektbeschreibung, Lage,
// Ausstattung, Kontakt). Bild-Platzhalter sind leere Bild-Elemente, die
// per Drag&Drop befuellt werden.

import type {
  ExposeProject,
  ExposeType,
  LayoutPage,
  Page,
  PageElement,
  StoredBoilerplate,
  StoredFile,
  StoredLayout,
  TextElement,
} from "./types";
import { uid } from "./util";
import { REF_H } from "../editor/constants";

// Standardseiten anhaengen: Vorlage (Text/Schriften/Grafik 1:1) als gesperrter
// Hintergrund; erkannte Fotobereiche werden durch Platzhalter ersetzt.
function boilerplatePages(bp: StoredBoilerplate | null): Page[] {
  if (!bp || bp.pages.length === 0) return [];
  return [...bp.pages]
    .sort((a, b) => a.order - b.order)
    .map((p) => {
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
      // Foto-Platzhalter (leer, per Drag&Drop befuellbar) ueber den alten Fotos.
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
      return {
        id: uid("pg"),
        title: p.title,
        background: "#ffffff",
        elements,
        boilerplateId: p.id,
      };
    });
}

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

// Eindeutiger Stempel einer gelernten Struktur (zum Abgleich mit dem Projekt).
export function layoutStamp(layout: StoredLayout): string {
  return `layout:${layout.createdAt}`;
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

// --- Projekt aus der KI-gelernten Struktur (Beispiel-Exposé) -------------

function textElement(
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: {
    fontSize: number;
    weight: number;
    color: string;
    align: "left" | "center" | "right";
    kind: "heading" | "text";
  },
): TextElement {
  return {
    id: uid("el"),
    kind: opts.kind,
    x,
    y,
    w,
    h,
    z: zCounter++,
    text,
    fontSize: opts.fontSize,
    align: opts.align,
    color: opts.color,
    background: "rgba(0,0,0,0)",
    fontWeight: opts.weight,
  };
}

function blocksToPage(
  lp: LayoutPage,
  logo: StoredFile | null,
  accent: string,
): Page {
  zCounter = 1;
  const elements: PageElement[] = [];
  for (const b of lp.blocks) {
    if (b.type === "image") {
      elements.push(imageSlot(b.x, b.y, b.w, b.h));
    } else if (b.type === "logo") {
      if (logo) {
        elements.push({
          id: uid("el"),
          kind: "logo",
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
          z: 999,
          src: logo.dataUrl,
        });
      } else {
        elements.push(
          textElement("LOGO", b.x, b.y, b.w, Math.max(b.h, 0.04), {
            fontSize: 14,
            weight: 700,
            color: accent,
            align: "left",
            kind: "heading",
          }),
        );
      }
    } else if (b.type === "heading") {
      // Schriftgroesse aus Blockhoehe ableiten.
      const fs = Math.min(44, Math.max(13, Math.round(b.h * REF_H * 0.55)));
      elements.push(
        textElement(
          b.text || "Überschrift",
          b.x,
          b.y,
          b.w,
          Math.max(b.h, 0.04),
          {
            fontSize: fs,
            weight: 700,
            color: "#1f2d3d",
            align: b.align ?? "left",
            kind: "heading",
          },
        ),
      );
    } else {
      // text
      elements.push(
        textElement(
          b.text || "Beschreibungstext – hier bearbeiten …",
          b.x,
          b.y,
          b.w,
          Math.max(b.h, 0.06),
          {
            fontSize: 14,
            weight: 400,
            color: "#5b6b7b",
            align: b.align ?? "left",
            kind: "text",
          },
        ),
      );
    }
  }
  return {
    id: uid("pg"),
    title: lp.title || "Seite",
    background: "#ffffff",
    elements,
  };
}

export function createProjectFromLayout(
  type: ExposeType,
  layout: StoredLayout,
  logo: StoredFile | null,
  boilerplate: StoredBoilerplate | null = null,
): ExposeProject {
  const accent = ACCENT[type];
  const contentPages = layout.pages.map((lp) => blocksToPage(lp, logo, accent));
  const base =
    contentPages.length > 0 ? contentPages : createProject(type, logo).pages;
  return {
    id: uid("proj"),
    type,
    title: `${TITLE[type]} – Exposé`,
    pages: [...base, ...boilerplatePages(boilerplate)],
    updatedAt: Date.now(),
    builtFrom: projectStamp(layout, boilerplate),
  };
}

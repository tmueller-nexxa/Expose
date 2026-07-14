// Zentrale Typdefinitionen der Anwendung.

export type ExposeType =
  | "einfamilienhaus"
  | "wohnung"
  | "mehrfamilienhaus"
  | "gewerbe";

export const EXPOSE_TYPES: {
  id: ExposeType;
  label: string;
  short: string;
  description: string;
  icon: string;
}[] = [
  {
    id: "einfamilienhaus",
    label: "Einfamilienhaus",
    short: "EFH",
    description: "Klassisches Wohnhaus fuer eine Familie",
    icon: "home",
  },
  {
    id: "wohnung",
    label: "Wohnung",
    short: "WHG",
    description: "Eigentums- oder Mietwohnung / Etagenwohnung",
    icon: "apartment",
  },
  {
    id: "mehrfamilienhaus",
    label: "Mehrfamilienhaus",
    short: "MFH",
    description: "Wohngebaeude mit mehreren Einheiten / Kapitalanlage",
    icon: "building",
  },
  {
    id: "gewerbe",
    label: "Gewerbeimmobilie",
    short: "GEW",
    description: "Buero, Laden, Halle oder Praxisflaeche",
    icon: "shop",
  },
];

// Eine gespeicherte Datei (Bild, PDF, Logo ...) als DataURL.
export interface StoredFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  dataUrl: string;
  addedAt: number;
}

// Ein hochgeladener Stiltext (fuer die Schreibstil-Uebernahme).
export interface StyleText {
  id: string;
  name: string;
  content: string;
  addedAt: number;
}

export interface ApiSettings {
  provider: "anthropic";
  apiKey: string;
  model: string;
}

// Persistente Nutzerdaten (Uploads, Keys ...).
export interface AppData {
  examples: Record<ExposeType, StoredFile[]>;
  styleTexts: StyleText[];
  logo: StoredFile | null;
  api: ApiSettings;
}

// --- Editor / Dokument-Modell -------------------------------------------

export type ElementKind = "image" | "text" | "logo" | "heading";

export interface BaseElement {
  id: string;
  kind: ElementKind;
  // Position + Groesse als Anteil (0..1) relativ zur Seite -> aufloesungsunabhaengig.
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  locked?: boolean;
}

export interface ImageElement extends BaseElement {
  kind: "image";
  src: string; // DataURL
  fit: "cover" | "contain";
  // Von der KI erkannter Bildinhalt (nach Analyse gesetzt).
  analysis?: {
    important: string;
    safeArea: { x: number; y: number; w: number; h: number };
  };
}

export interface TextElement extends BaseElement {
  kind: "text" | "heading";
  text: string;
  fontSize: number;
  align: "left" | "center" | "right";
  color: string;
  background: string; // rgba - halbtransparente Flaeche
  fontWeight: number;
  // Verweist auf das Bild, zu dem der Text generiert wurde.
  linkedImageId?: string;
  generated?: boolean;
}

export interface LogoElement extends BaseElement {
  kind: "logo";
  src: string;
}

export type PageElement =
  | ImageElement
  | TextElement
  | LogoElement;

export interface Page {
  id: string;
  title: string;
  background: string;
  elements: PageElement[];
}

export interface ExposeProject {
  id: string;
  type: ExposeType;
  title: string;
  pages: Page[];
  updatedAt: number;
}

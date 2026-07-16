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

// --- Aus Beispiel-Exposés gelernte Seitenstruktur -----------------------

export type LayoutBlockType = "image" | "heading" | "text" | "logo";

export interface LayoutBlock {
  type: LayoutBlockType;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string; // generischer Platzhaltertext bei heading/text
  align?: "left" | "center" | "right";
}

export interface LayoutPage {
  title: string;
  blocks: LayoutBlock[];
}

// Die von der KI aus den Beispielen abgeleitete Struktur eines Typs.
export interface StoredLayout {
  pages: LayoutPage[];
  source: string; // Name der analysierten Beispieldatei
  pageCount: number;
  createdAt: number;
}

// Standardseiten (Impressum, AGB, Widerruf, Kontakt), die 1:1 als exakte
// Seitenkopie (Bild) uebernommen werden - gilt fuer ALLE Expose-Typen.
export type BoilerplateKind = "impressum" | "agb" | "widerruf" | "kontakt";

export interface BoilerplatePage {
  id: string;
  kind: BoilerplateKind;
  title: string;
  image: string; // DataURL der Seitenkopie (Text/Grafik/Formatierung 1:1)
  order: number; // urspruengliche Seitenreihenfolge
  // Fotobereiche, die durch Platzhalter ersetzt werden (Anteile 0..1).
  // Nur bei Impressum/AGB/Widerruf; Kontakt behaelt sein Foto.
  photoSlots?: { x: number; y: number; w: number; h: number }[];
}

export interface StoredBoilerplate {
  pages: BoilerplatePage[];
  source: string;
  createdAt: number;
}

// Persistente Nutzerdaten (Uploads, Keys ...).
export interface AppData {
  examples: Record<ExposeType, StoredFile[]>;
  styleTexts: StyleText[];
  logo: StoredFile | null;
  // Titelbild / Objektfoto fuer Login- und Startseiten-Hero.
  cover: StoredFile | null;
  api: ApiSettings;
  // Pro Typ: aus den Beispielen uebernommene Seitenstruktur (oder null).
  layouts: Record<ExposeType, StoredLayout | null>;
  // Global: 1:1 uebernommene Standardseiten (fuer alle Typen).
  boilerplate: StoredBoilerplate | null;
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
  // Exakte Seitenkopie einer Standardseite (Impressum/AGB/...): nicht vom
  // Nutzer platziert und von der Textgenerierung ausgenommen.
  fromBoilerplate?: boolean;
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
  // Bei Standardseiten: Referenz auf die urspruengliche BoilerplatePage.id
  // in AppData.boilerplate, damit Aenderungen (z.B. Foto entfernen) auch in
  // der globalen Vorlage nachgezogen werden koennen.
  boilerplateId?: string;
}

export interface ExposeProject {
  id: string;
  type: ExposeType;
  title: string;
  pages: Page[];
  updatedAt: number;
  // Herkunft des Aufbaus: "default" oder Zeitstempel der gelernten Struktur.
  // So erkennt der Editor, ob eine neuere Beispiel-Struktur vorliegt.
  builtFrom?: string;
}

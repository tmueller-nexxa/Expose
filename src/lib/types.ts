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

// --- Aus Beispiel-Exposés 1:1 uebernommene Seiten ------------------------
//
// Jede Seite eines Beispiel-Exposés wird komplett 1:1 als Bild uebernommen
// (Design, Schrift, Icons, Farben, Groessen - exakt wie im Original). Nur
// erkannte Bildbereiche (und bei Inhaltsseiten zusaetzlich Textbereiche)
// werden aus dem Bild entfernt, damit sie durch neue Fotos/Texte ersetzt
// werden koennen.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Gemeinsame Basis fuer jede 1:1 uebernommene Seite.
export interface CapturedPage {
  id: string;
  title: string;
  image: string; // DataURL der Seitenkopie (Design/Schrift/Icons/Farben 1:1)
  order: number; // urspruengliche Seitenreihenfolge
  // Fotobereiche, die aus dem Bild entfernt wurden und durch Platzhalter
  // ersetzt werden (Anteile 0..1).
  photoSlots?: Rect[];
}

// Inhaltsseiten (Titelseite, Objektbeschreibung, Lage, Ausstattung, ...):
// zusaetzlich zu Fotos wird auch der objektspezifische Text entfernt, das
// Design (Rahmen, Icons, Farben, statische Beschriftungen) bleibt 1:1.
export interface StoredLayout {
  pages: CapturedPage[];
  source: string; // Name der analysierten Beispieldatei
  pageCount: number;
  createdAt: number;
}

// Standardseiten (Impressum, AGB, Widerruf, Kontakt), die 1:1 als exakte
// Seitenkopie (Bild) uebernommen werden - gilt fuer ALLE Expose-Typen. Der
// Text bleibt hier vollstaendig erhalten, nur Fotos werden zu Platzhaltern
// (Kontakt behaelt sogar sein Foto = Makler-Portrait).
export type BoilerplateKind = "impressum" | "agb" | "widerruf" | "kontakt";

export interface BoilerplatePage extends CapturedPage {
  kind: BoilerplateKind;
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
  // Bei 1:1 uebernommenen Seiten: Referenz auf die urspruengliche
  // CapturedPage/BoilerplatePage.id, damit Aenderungen (z.B. Foto entfernen)
  // auch in der gespeicherten Vorlage nachgezogen werden koennen.
  // "boilerplate" -> AppData.boilerplate (global), "layout" -> AppData.layouts[type].
  sourcePage?: { kind: "boilerplate" | "layout"; id: string };
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

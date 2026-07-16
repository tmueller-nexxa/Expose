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

// --- Aus Beispiel-Exposés uebernommene Seiten ----------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Standardseiten (Impressum, AGB, Widerruf, Kontakt): komplett 1:1 als
// Bild uebernommen (Design, Schrift, Icons, Farben, Groessen exakt wie im
// Original) - hier zaehlt der wortgetreue, rechtssichere Text mehr als
// freie Bearbeitbarkeit. Nur erkannte Fotobereiche werden aus dem Bild
// entfernt und durch Platzhalter ersetzt (Kontakt behaelt sein Foto).
export interface CapturedImagePage {
  id: string;
  title: string;
  image: string; // DataURL der Seitenkopie (Design/Schrift/Icons/Farben 1:1)
  order: number; // urspruengliche Seitenreihenfolge
  photoSlots?: Rect[];
}

export type BoilerplateKind = "impressum" | "agb" | "widerruf" | "kontakt";

export interface BoilerplatePage extends CapturedImagePage {
  kind: BoilerplateKind;
}

export interface StoredBoilerplate {
  pages: BoilerplatePage[];
  source: string;
  createdAt: number;
}

// Inhaltsseiten (Titelseite, Objektbeschreibung, Lage, Ausstattung, ...):
// KEIN eingebettetes Bild - stattdessen wird der grafische Aufbau der
// Originalseite 1:1 als editierbare Vektor-Elemente nachgebaut (Formen/
// Banner in Originalfarbe, Text in Originalgroesse/-farbe/-ausrichtung,
// Bildflaechen als leere, frei befuellbare Platzhalter). So bleibt das
// Design exakt erhalten, ohne dass ein Original-Foto oder ein per
// Freistellung beschaedigter Bildhintergrund uebernommen wird.
export interface DesignPage {
  id: string;
  title: string;
  order: number;
  background: string; // Seiten-Hintergrundfarbe (Hex), 1:1 wie im Original
  elements: PageElement[];
}

export interface StoredLayout {
  pages: DesignPage[];
  source: string; // Name der analysierten Beispieldatei
  pageCount: number;
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

export type ElementKind = "image" | "text" | "logo" | "heading" | "shape";

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
  // Position/Zoom des Fotos INNERHALB des Rahmens (unabhaengig von dessen
  // Groesse/Position auf der Seite) - per Doppelklick "Bild anpassen".
  // imgScale: 1 = Originalausschnitt (object-fit: cover), >1 = hineingezoomt.
  // imgX/imgY: Verschiebung als Anteil der Rahmengroesse, Bereich
  // +/-(imgScale-1)/2 (so bleibt der Rahmen immer vollstaendig gefuellt).
  imgScale?: number;
  imgX?: number;
  imgY?: number;
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

// Farbige Dekorationsflaeche (Banner, Balken, Kachel ...) - bildet die
// grafischen Elemente einer Original-Vorlage 1:1 in Farbe/Position/Groesse
// nach, ohne ein eingebettetes Foto zu sein.
export interface ShapeElement extends BaseElement {
  kind: "shape";
  color: string; // Fuellfarbe (Hex/rgba)
  radius?: number; // Eckenradius in px bei 794px Referenzbreite
}

export type PageElement =
  | ImageElement
  | TextElement
  | LogoElement
  | ShapeElement;

export interface Page {
  id: string;
  title: string;
  background: string;
  elements: PageElement[];
  // Bei 1:1 als Bild uebernommenen Standardseiten: Referenz auf die
  // urspruengliche BoilerplatePage.id, damit Aenderungen (z.B. Foto
  // entfernen) auch in AppData.boilerplate nachgezogen werden koennen.
  // Inhaltsseiten (Vektor-Nachbau) haben keine Bild-Quelle und damit auch
  // keine sourcePage.
  sourcePage?: { kind: "boilerplate"; id: string };
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

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

export type BoilerplateKind =
  | "vorwort"
  | "impressum"
  | "agb"
  | "widerruf"
  | "kontakt";

export interface BoilerplatePage extends CapturedImagePage {
  kind: BoilerplateKind;
  // Wortgetreuer Seitentext (Zeilenumbrueche erhalten) - Grundlage fuer den
  // Neuaufbau der Standardseiten im "KI Exposé"-Design (siehe
  // luxuryTemplate.ts/buildBoilerplateLuxuryPages). Stammt entweder aus der
  // echten PDF-Textebene, oder - falls die Seite als flaches Bild ohne
  // Textebene eingebettet war - aus einer KI-Bildtranskription (siehe
  // transcribeBoilerplateText() in lib/ai.ts, aufgerufen in DataPage.tsx).
  // Optional, da beides fehlschlagen kann (z.B. kein API-Key vorhanden).
  text?: string;
  // Die EINZIGEN Bildinhalte, die aus einer Standardseite uebernommen werden
  // (beim Einlesen der Vorlage herausgeloest, siehe DataPage.tsx): das
  // Portraitfoto des Maklers und das Stilpunkte-/Guetesiegel-Abzeichen der
  // Ansprechpartner-Seite. Alles uebrige der Originalseite (Hintergruende,
  // Farbflaechen, Schmuckelemente) wird bewusst NICHT weitergegeben - die
  // Seiten werden ausschliesslich aus Text + diesen Fotos neu aufgebaut.
  personPhoto?: string;
  stylePhoto?: string;
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

// --- "KI Exposé": komplett automatisch generiertes Exposé ---------------
//
// Der Nutzer laedt nur Rohmaterial hoch (Fotos + Datenblaetter) - die KI
// ordnet die Fotos eigenstaendig passenden Seiten zu und schreibt die
// Texte. Der SEITENAUFBAU (Reihenfolge/Zweck, keine Farben/Grafiken) wird
// dabei aus den Beispiel-Exposés im Datenbereich abgeleitet; das grafische
// Design ist ein fest hinterlegtes, einheitliches Luxus-Design (siehe
// luxuryTemplate.ts) - unabhaengig von den Beispielen.

export type ExposeSectionKind =
  | "titel"
  | "objektbeschreibung"
  | "lage"
  | "ausstattung"
  | "grundriss"
  | "galerie"
  | "kontakt"
  | "sonstiges";

export interface ExposeSection {
  kind: ExposeSectionKind;
  title: string; // Anzeigename, z.B. "Lage & Umgebung"
  photoCount: number; // typische Fotoanzahl auf dieser Seite im Beispiel
}

// Schlanker, wiederverwendbarer Seitenaufbau pro Typ - bleibt erhalten, bis
// der Nutzer ihn ueber "Neu generieren" ersetzt (mit Rueckgaengig-Option).
export interface KiExposeStructure {
  sections: ExposeSection[];
  source: string; // Name der analysierten Beispieldatei(en)
  createdAt: number;
}

// --- Exposé-Archiv: gespeicherte, wieder aufrufbare Exposés --------------

// Objektadresse - Grundlage fuer den automatisch vergebenen Exposé-Namen
// (Beispiel: "Expose001-Am Waldberg3-Lüdenscheid").
export interface ExposeAddress {
  street: string; // Strasse + Hausnummer, z.B. "Am Waldberg 3"
  city: string; // Ort, z.B. "Lüdenscheid"
  // Postleitzahl, z.B. "58509". Steht auf der Titelseite zusammen mit dem
  // Ort in der zweiten Zeile des Adressfelds; fuer den Exposé-Namen wird sie
  // bewusst NICHT verwendet.
  zip?: string;
}

// Schlanker Katalogeintrag fuer die Uebersicht "Meine Exposés". Bewusst OHNE
// die Seiten selbst: die enthalten bei einem fertigen Exposé viele Megabyte
// Bilddaten: die Liste muss aber schnell und vollstaendig ladbar sein. Die
// Seiten liegen darum getrennt unter der jeweiligen id (siehe storage.ts).
export interface ExposeEntry {
  id: string;
  exposeNo: number;
  name: string;
  type: ExposeType;
  address: ExposeAddress;
  pageCount: number;
  createdAt: number;
  updatedAt: number;
  // Kleines Vorschaubild (Titelfoto, herunterskaliert) fuer die Liste.
  thumbnail?: string;
}

// Persistente Nutzerdaten (Uploads, Keys ...).
export interface AppData {
  examples: Record<ExposeType, StoredFile[]>;
  styleTexts: StyleText[];
  logo: StoredFile | null;
  // Titelbild / Objektfoto fuer Login- und Startseiten-Hero.
  cover: StoredFile | null;
  // Eigene Internetadresse des Maklerbueros - erscheint auf der Titelseite
  // im unteren der beiden goldenen Kaesten. Wird beim Einlesen einer Vorlage
  // automatisch aus deren Impressum vorbelegt, bleibt aber aenderbar.
  website: string;
  api: ApiSettings;
  // Pro Typ: aus den Beispielen uebernommene Seitenstruktur (oder null).
  layouts: Record<ExposeType, StoredLayout | null>;
  // Global: 1:1 uebernommene Standardseiten (fuer alle Typen).
  boilerplate: StoredBoilerplate | null;
  // "KI Exposé": Rohmaterial (Fotos/Datenblaetter) pro Typ, dauerhaft.
  kiExposeFiles: Record<ExposeType, StoredFile[]>;
  // "KI Exposé": abgeleiteter Seitenaufbau pro Typ + vorherige Version fuer
  // "Rueckgaengig" nach einer Neu-Generierung.
  kiExposeStructure: Record<ExposeType, KiExposeStructure | null>;
  kiExposeStructurePrevious: Record<ExposeType, KiExposeStructure | null>;
  // "KI Exposé": Anschrift des Objekts pro Typ - Grundlage fuer den beim
  // Generieren vergebenen Exposé-Namen. Wird beim Hochladen eines
  // Datenblatts per KI vorgeschlagen und bleibt danach korrigierbar.
  kiExposeAddress: Record<ExposeType, ExposeAddress>;
  // Zuletzt vergebene Exposé-Nummer. Wird ausschliesslich hochgezaehlt: eine
  // einmal vergebene Nummer wird NIE wiederverwendet, auch nicht, wenn das
  // zugehoerige Exposé geloescht wurde (die Nummer steht in Angeboten/
  // E-Mails/Ausdrucken und muss dauerhaft eindeutig auf ein Objekt zeigen).
  exposeCounter: number;
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
  // Weitere hochgeladene Fotos DESSELBEN Raums (Datei-IDs aus
  // AppData.kiExposeFiles) - im Editor per Knopf im Bild durchschaltbar.
  // Bewusst nur die IDs statt der Bilddaten: die Fotos liegen bereits im
  // Datenbestand, ein zweites Mal im Exposé gespeichert waeren es je nach
  // Objekt viele Megabyte doppelt.
  altFileIds?: string[];
  // Groesse vor dem Umschalten auf "seitenfuellend" - damit derselbe Knopf
  // das Bild wieder auf seinen Platz im Layout zuruecksetzen kann.
  prevBox?: { x: number; y: number; w: number; h: number; z: number };
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
  // Optionale abweichende Schriftart (CSS font-family), z.B. eine Serife
  // fuer Luxus-Ueberschriften. Ohne Angabe wird die Standardschrift geerbt.
  fontFamily?: string;
  // Verweist auf das Bild, zu dem der Text generiert wurde.
  linkedImageId?: string;
  generated?: boolean;
  // Dunkler Schlagschatten hinter der Schrift - fuer Text OHNE eigene
  // Hintergrundflaeche (background: transparent), der direkt auf einem Foto
  // liegt. Ohne das ist heller/weisser Text auf hellen Fotobereichen (z.B.
  // Himmel, helle Fassade) unsichtbar, obwohl er technisch vorhanden ist.
  textShadow?: boolean;
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
  // --- Archiv-Kopfdaten (nur bei archivierten Exposés gesetzt) ------------
  // Vorhanden, sobald das Exposé unter einer Nummer abgelegt wurde. Der
  // Editor traegt Aenderungen darueber automatisch ins Archiv zurueck (siehe
  // saveProject() in storage.ts), damit die gespeicherte Fassung immer dem
  // entspricht, was zuletzt bearbeitet wurde.
  exposeNo?: number;
  name?: string;
  address?: ExposeAddress;
  createdAt?: number;
}

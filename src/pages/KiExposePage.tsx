import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { Dropzone } from "../components/Dropzone";
import { useApp } from "../context/AppContext";
import {
  EXPOSE_TYPES,
  type ApiSettings,
  type ExposeAddress,
  type ExposeSection,
  type ExposeType,
  type StoredBoilerplate,
  type StoredFile,
  type StoredLayout,
} from "../lib/types";
import {
  aiReady,
  analyzeExposeStructure,
  analyzeKontaktPhotos,
  analyzePhotoSections,
  extractObjectAddress,
  MAX_STRUCTURE_PAGES,
  MODEL_OPTIONS,
  pickPriorityPhotos,
  transcribeBoilerplateText,
  writeExposeSectionTexts,
} from "../lib/ai";
import { aiProxyUrl } from "../firebase.config";
import { detectBoilerplate } from "../lib/boilerplate";
import { boilerplatePages } from "../lib/templates";
import {
  addPageNumbers,
  buildBoilerplateLuxuryPages,
  buildLuxuryPages,
  type BoilerplateLuxuryInput,
  type KiExposeSectionInput,
} from "../lib/luxuryTemplate";
import {
  addLayoutPageNumbers,
  buildLayoutBoilerplatePages,
  buildLayoutPages,
  sectionsFromLayout,
} from "../lib/layoutFill";
import { colorDistance, computeImageSignature, cropRegionFromImage, hammingDistance, invertLogoToWhite } from "../lib/imageEdit";
import { ensureScriptFontLoaded } from "../editor/fit";
import { saveProjectNow } from "../lib/storage";
import { buildExposeName, fileToDataUrl, formatBytes, uid } from "../lib/util";
import { extractPdfText, renderPdfPages } from "../lib/pdf";
import type { ExposeProject, Page } from "../lib/types";
import {
  IconCheck,
  IconImage,
  IconSparkle,
  IconTrash,
  IconUpload,
} from "../components/Icons";
import "./DataPage.css";
import "./KiExposePage.css";

// Dieselbe Konstante wie in ai.ts (dort re-exportiert) verwenden, statt
// eine eigene, potenziell abweichende Obergrenze zu pflegen - genau ein
// solches Auseinanderlaufen (hier 30, dort intern noch 20) hat zuvor dazu
// gefuehrt, dass bereits gerenderte Beispiel-Seiten in der Struktur-Analyse
// still wieder abgeschnitten wurden.
const MAX_ANALYZE_PAGES = MAX_STRUCTURE_PAGES;

const TYPE_LABEL: Record<ExposeType, string> = {
  einfamilienhaus: "Einfamilienhaus",
  wohnung: "Eigentumswohnung",
  mehrfamilienhaus: "Mehrfamilienhaus",
  gewerbe: "Gewerbeimmobilie",
};

// Erkennt eine PDF-Seite, die ein reines TEXTdokument ist (z.B. die
// Sanierungs-/Eckdatenliste eines Datenblatts). Solche Seiten liefern nur
// ihren Text fuer die Texterstellung und duerfen NICHT als Foto verwendet
// werden - sonst erscheint eine Textseite als vermeintliches Foto im Exposé.
//
// Bewusst eng gefasst: es wird NUR aussortiert, wenn alle drei Bedingungen
// zugleich zutreffen - viel Text UND kein einziges eingebettetes Rasterbild
// UND kaum Vektorzeichnung. Damit bleiben die Faelle sicher erhalten, auf die
// es ankommt:
//   - Grundriss-/Planzeichnung (CAD): viele Pfade -> bleibt Foto
//   - eingescannter Plan / Seite mit echtem Foto: imageCount > 0 -> bleibt Foto
//   - Foto-Seite eines gestalteten Exposés: wenig Text -> bleibt Foto
// Die Schwellen sind an echten Exposé-/Datenblattseiten gemessen: reine
// Foto-/Planseiten kommen dort auf 17-85 Zeichen, gemischte Seiten auf
// ~440-560, reine Textseiten (Vorwort/Impressum/AGB/Eckdaten) auf 800-2800.
const TEXT_ONLY_MIN_CHARS = 500;
const TEXT_ONLY_MAX_PATHS = 80;
function isTextOnlyPdfPage(p: { text: string; imageCount: number; pathCount: number }): boolean {
  return (
    p.text.trim().length >= TEXT_ONLY_MIN_CHARS &&
    p.imageCount === 0 &&
    p.pathCount < TEXT_ONLY_MAX_PATHS
  );
}

// Titelabschnitt bekommt IMMER Vorrang vor allen anderen Abschnitten bei der
// Fotowahl - wird per pickPriorityPhotos() VOR der normalen Zuordnung aus dem
// GESAMTEN Pool reserviert (siehe Kommentar bei der Verwendung unten).
const TITLE_PHOTO_CRITERION =
  "Ein repraesentatives Aussen-/Uebersichtsfoto fuer die TITELSEITE der Immobilie (Fassade, Gesamtansicht von aussen, oder eine Luftaufnahme). Die Titelseite hat IMMER Vorrang vor allen anderen Abschnitten bei der Fotowahl - waehle das mit Abstand am besten geeignete Foto dafuer aus, auch wenn es fuer einen anderen Abschnitt ebenfalls gut passen wuerde.";

// "Vorteile auf einen Blick"/"WOW-Effekt"-Abschnitte sollen bevorzugt
// allgemeine Impressions-Fotos bekommen statt leer auszugehen, weil
// spezifischere Raum-Abschnitte alle passenden Fotos zuerst beanspruchen.
const VORTEILE_TITLE_RE = /wow-effekt|highlight|vorteile/i;
const VORTEILE_PHOTO_CRITERION =
  "Bis zu drei besonders eindrucksvolle, ALLGEMEINE Impressions-Fotos (Gesamtansichten/reprasentative Aufnahmen, KEINE Detailaufnahmen einzelner Kleinigkeiten) fuer einen Abschnitt, der die staerksten Vorzuege der Immobilie auf einen Blick zeigen soll - bevorzuge Fotos, die sich allgemein als Impression eignen, gegenueber Fotos, die eindeutig nur zu einem einzelnen, spezifischen Raum gehoeren.";

// Ab dieser Textlaenge gilt eine Standardseite als brauchbar transkribiert -
// darunter (leer oder nur ein paar Zeichen Kopfzeile) wird der Text per
// KI-Bildtranskription nachgeholt. Gleiche Schwelle wie beim Einlesen der
// Vorlage im Datenbereich (DataPage.tsx).
const MIN_BOILERPLATE_TEXT_LEN = 20;

// Standardseiten (Vorwort/Impressum/AGB/Widerruf/Ansprechpartner) im neuen
// "KI Exposé"-Design statt der bisherigen 1:1-Bilduebernahme (siehe
// buildBoilerplateLuxuryPages() in luxuryTemplate.ts) - NUR fuer diesen
// Ablauf, der klassische Editor-Ablauf nutzt weiterhin boilerplatePages()
// unveraendert.
//
// Fehlt der Text, wird er HIER nachgeholt statt auf die Bilduebernahme
// zurueckzufallen: gewonnen wird er sonst nur beim separaten Schritt "Aufbau
// aus Beispielen uebernehmen" (DataPage.tsx). Eine Vorlage, die davor - oder
// mit einem aelteren Stand - eingelesen wurde, bliebe dadurch dauerhaft ohne
// Text und saemtliche Standardseiten kaemen weiterhin als Rasterbild samt
// Originaldesign heraus (genau das gemeldete Verhalten). Mit dem Nachholen
// greift das neue Design unabhaengig davon, wann die Vorlage eingelesen wurde.
async function buildBoilerplateSection(
  api: ApiSettings,
  boilerplate: StoredBoilerplate | null,
  logo: StoredFile | null,
  // Aus dem Beispiel uebernommenes Design: liegt es vor, entstehen auch die
  // Standardseiten darin, damit das Exposé bis zur letzten Seite aus einem
  // Guss ist. Uebernommen wird dabei die GESTALTUNG der Vorlage - der Inhalt
  // dieser Seiten bleibt der wortgetreu extrahierte Text.
  layout: StoredLayout | null,
) {
  if (!boilerplate || boilerplate.pages.length === 0) return [];

  const texts = boilerplate.pages.map((p) => p.text?.trim() ?? "");
  const missing = texts
    .map((t, i) => (t.length < MIN_BOILERPLATE_TEXT_LEN ? i : -1))
    .filter((i) => i >= 0);
  if (missing.length > 0 && aiReady(api)) {
    try {
      const ocr = await transcribeBoilerplateText(
        api,
        missing.map((i) => boilerplate.pages[i].image),
      );
      missing.forEach((pageIdx, k) => {
        const t = ocr[k]?.trim();
        if (t) texts[pageIdx] = t;
      });
    } catch {
      /* Transkription fehlgeschlagen - unten greift der Bild-Fallback. */
    }
  }

  // Erst wenn auch danach KEINE einzige Seite Text hat (z.B. ohne API-Zugang),
  // bleibt als letzter Ausweg die alte 1:1-Bilduebernahme - besser als die
  // rechtlich relevanten Seiten ganz zu verlieren.
  const hasAnyText = texts.some((t) => t.length > 0);
  if (!hasAnyText) return boilerplatePages(boilerplate);

  const inputs: BoilerplateLuxuryInput[] = boilerplate.pages
    .map((p, i) => ({ kind: p.kind, text: texts[i] }))
    .filter((p) => p.text.length > 0);

  // Fotos der Ansprechpartner-Seite (Makler-Portrait + ggf. Stilpunkte-/
  // Guetesiegel-Badge) aus der Originalseite herausloesen - die Seite wird
  // nicht mehr als Bild uebernommen, darum muessen die Fotos einzeln als
  // eigene Bild-Elemente weiterleben. Das Logo kommt direkt aus dem
  // Datenbereich (data.logo), nicht aus der Seite herausgeschnitten.
  // Dediziertes, eng gefasstes Werkzeug (analyzeKontaktPhotos) statt der
  // generischen page_design-Blockerkennung: verhindert, dass z.B. ein
  // Text-/Adressblock faelschlich als Foto erkannt wird und dadurch das
  // eigentliche Portraitfoto verloren geht.
  const kontaktPages = boilerplate.pages.filter((p) => p.kind === "kontakt");
  const kontaktImages: string[] = [];
  // Bevorzugt die bereits BEIM EINLESEN herausgeloesten Fotos verwenden
  // (siehe DataPage.tsx) - dann faellt hier keine erneute Bilderkennung an.
  const preExtracted = kontaktPages.find((p) => p.personPhoto || p.stylePhoto);
  if (preExtracted) {
    if (preExtracted.personPhoto) kontaktImages.push(preExtracted.personPhoto);
    if (preExtracted.stylePhoto) kontaktImages.push(preExtracted.stylePhoto);
  } else if (kontaktPages.length > 0 && aiReady(api)) {
    try {
      const results = await analyzeKontaktPhotos(api, kontaktPages.map((p) => p.image));
      let personPhoto: string | null = null;
      let stylePhoto: string | null = null;
      for (let i = 0; i < kontaktPages.length; i++) {
        const r = results[i];
        if (!personPhoto && r?.personPhoto) {
          personPhoto = await cropRegionFromImage(kontaktPages[i].image, r.personPhoto);
        }
        if (!stylePhoto && r?.stylePhoto) {
          stylePhoto = await cropRegionFromImage(kontaktPages[i].image, r.stylePhoto);
        }
      }
      // Reihenfolge fest: Personenfoto zuerst (gross/prominent), Stilpunkte-
      // Badge danach (kleiner) - passt zur Bild-Anordnung in ansprechpartnerPage().
      if (personPhoto) kontaktImages.push(personPhoto);
      if (stylePhoto) kontaktImages.push(stylePhoto);
    } catch {
      /* Fotoerkennung fehlgeschlagen - Seite bekommt dann kein Foto, Text bleibt trotzdem erhalten. */
    }
  }

  if (layout && layout.pages.length > 0) {
    const inDesign = buildLayoutBoilerplatePages(layout, inputs, kontaktImages, logo);
    // Leeres Ergebnis heisst: die Vorlage bietet keine brauchbare Textflaeche
    // (siehe dort) - dann greift der bisherige Aufbau, damit die Texte nicht
    // verloren gehen.
    if (inDesign.length > 0) return inDesign;
  }
  return buildBoilerplateLuxuryPages(inputs, kontaktImages, logo);
}

type Phase = "struktur" | "fotos" | "texte" | "aufbau";

export function KiExposePage() {
  const { data, updateData } = useApp();
  const navigate = useNavigate();
  const [activeType, setActiveType] = useState<ExposeType>("einfamilienhaus");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ phase: Phase; done: number; total: number } | null>(
    null,
  );
  const [resultMsg, setResultMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [addressBusy, setAddressBusy] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const files = data.kiExposeFiles[activeType];
  const structure = data.kiExposeStructure[activeType];
  const previousStructure = data.kiExposeStructurePrevious[activeType];
  // Aus dem Beispiel-Exposé uebernommenes Design (Datenbereich). Ist eines
  // vorhanden, wird das Exposé darin aufgebaut - siehe generate().
  const activeLayout = data.layouts[activeType];
  const address = data.kiExposeAddress[activeType];

  function setAddress(patch: Partial<ExposeAddress>) {
    updateData((prev) => ({
      ...prev,
      kiExposeAddress: {
        ...prev.kiExposeAddress,
        [activeType]: { ...prev.kiExposeAddress[activeType], ...patch },
      },
    }));
  }

  // Anschrift aus den Datenblaettern vorschlagen. Liest nur die Textebene der
  // PDFs (kein Rendern - siehe extractPdfText) und ueberschreibt eine bereits
  // eingetragene Adresse NUR auf ausdrueckliche Anforderung ueber den Knopf
  // (force), nie automatisch nach einem Upload.
  async function suggestAddress(pdfs: StoredFile[], force: boolean) {
    if (pdfs.length === 0 || !aiReady(data.api)) return;
    if (!force && (address.street || address.city)) return;
    setAddressBusy(true);
    try {
      let text = "";
      for (const f of pdfs) {
        text += `\n\n${await extractPdfText(f.dataUrl)}`;
        if (text.length > 12000) break;
      }
      const found = await extractObjectAddress(data.api, text);
      if (found && (found.street || found.city)) setAddress(found);
    } catch {
      /* Vorschlag fehlgeschlagen - die Felder bleiben zur Handeingabe leer. */
    } finally {
      setAddressBusy(false);
    }
  }

  // --- Datei-Uploads -------------------------------------------------------
  async function addFiles(list: File[]) {
    const stored: StoredFile[] = [];
    for (const f of list) {
      stored.push({
        id: uid("kfile"),
        name: f.name,
        mime: f.type || "application/octet-stream",
        size: f.size,
        dataUrl: await fileToDataUrl(f),
        addedAt: Date.now(),
      });
    }
    updateData((prev) => ({
      ...prev,
      kiExposeFiles: {
        ...prev.kiExposeFiles,
        [activeType]: [...prev.kiExposeFiles[activeType], ...stored],
      },
    }));
    // Frisch hochgeladene Datenblaetter gleich nach der Objektanschrift
    // durchsuchen - daraus entsteht spaeter der Name des gespeicherten Exposés.
    void suggestAddress(
      stored.filter((f) => f.mime === "application/pdf"),
      false,
    );
  }

  function removeFile(id: string) {
    updateData((prev) => ({
      ...prev,
      kiExposeFiles: {
        ...prev.kiExposeFiles,
        [activeType]: prev.kiExposeFiles[activeType].filter((f) => f.id !== id),
      },
    }));
  }

  // --- Seitenaufbau aus den Datenbereich-Beispielen ableiten ----------------
  async function extractStructure(): Promise<ExposeSection[] | null> {
    const examples = data.examples[activeType];
    if (examples.length === 0) {
      setResultMsg({
        ok: false,
        msg: `Bitte zuerst im Datenbereich mindestens ein Beispiel-Exposé für „${TYPE_LABEL[activeType]}" hochladen – daraus wird der Seitenaufbau abgeleitet.`,
      });
      return null;
    }
    const pdf = examples.find((f) => f.mime === "application/pdf");
    let pageImages: string[];
    let pageSignals: { text: string; imageCount: number }[];
    if (pdf) {
      const rendered = await renderPdfPages(pdf.dataUrl, MAX_ANALYZE_PAGES, 1000);
      pageImages = rendered.map((p) => p.image).filter(Boolean);
      pageSignals = rendered.map((p) => ({ text: p.text, imageCount: p.imageCount }));
    } else {
      const imgs = examples.filter((f) => f.mime.startsWith("image/")).slice(0, MAX_ANALYZE_PAGES);
      pageImages = imgs.map((f) => f.dataUrl);
      pageSignals = imgs.map(() => ({ text: "", imageCount: 0 }));
    }
    if (pageImages.length === 0) {
      setResultMsg({ ok: false, msg: "Aus dem Beispiel konnten keine Seiten gelesen werden." });
      return null;
    }
    // Nur Inhaltsseiten fliessen in den Seitenaufbau ein (keine Standardseiten).
    const kinds = detectBoilerplate(pageSignals);
    const contentImages = pageImages.filter((_, i) => !kinds[i]);
    const res = await analyzeExposeStructure(
      data.api,
      contentImages.length > 0 ? contentImages : pageImages,
      activeType,
    );
    if (!res.ok) {
      setResultMsg({ ok: false, msg: res.message });
      return null;
    }
    return res.sections;
  }

  async function regenerateStructure() {
    setResultMsg(null);
    setGenerating(true);
    setProgress({ phase: "struktur", done: 0, total: 1 });
    try {
      const sections = await extractStructure();
      if (!sections) return;
      updateData((prev) => ({
        ...prev,
        kiExposeStructurePrevious: {
          ...prev.kiExposeStructurePrevious,
          [activeType]: prev.kiExposeStructure[activeType],
        },
        kiExposeStructure: { ...prev.kiExposeStructure, [activeType]: {
          sections,
          source: data.examples[activeType][0]?.name ?? "Beispiel",
          createdAt: Date.now(),
        } },
      }));
      setResultMsg({ ok: true, msg: "Seitenaufbau neu generiert." });
    } catch (err) {
      setResultMsg({ ok: false, msg: (err as Error).message });
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  }

  function undoStructure() {
    updateData((prev) => ({
      ...prev,
      kiExposeStructure: { ...prev.kiExposeStructure, [activeType]: prev.kiExposeStructurePrevious[activeType] },
      kiExposeStructurePrevious: { ...prev.kiExposeStructurePrevious, [activeType]: prev.kiExposeStructure[activeType] },
    }));
  }

  // --- Exposé generieren -----------------------------------------------------
  async function generate() {
    setResultMsg(null);
    if (files.length === 0) {
      setResultMsg({ ok: false, msg: "Bitte zuerst Fotos und/oder Datenblätter hochladen." });
      return;
    }
    if (!aiReady(data.api)) {
      setResultMsg({
        ok: false,
        msg: aiProxyUrl ? "Bitte zuerst anmelden." : "Bitte zuerst einen API-Key im Datenbereich eintragen.",
      });
      return;
    }
    setGenerating(true);
    try {
      // 1) Seitenaufbau: liegt das DESIGN des Beispiel-Exposés vor (im
      // Datenbereich uebernommen), ist dessen Aufbau massgeblich - eine
      // Vorlagenseite entspricht dann genau einem Abschnitt, mit so vielen
      // Fotos, wie die Vorlage dort vorsieht. Die separate Struktur-Analyse
      // entfaellt in dem Fall: der Aufbau IST der der Vorlage, nicht eine
      // Zusammenfassung davon.
      const layout = data.layouts[activeType];
      const useLayout = !!layout && layout.pages.length > 0;
      let sections = useLayout ? sectionsFromLayout(layout) : structure?.sections ?? null;
      let source = useLayout ? layout.source : structure?.source ?? "";
      if (!sections) {
        setProgress({ phase: "struktur", done: 0, total: 1 });
        sections = await extractStructure();
        if (!sections) return;
        source = data.examples[activeType][0]?.name ?? "Beispiel";
        updateData((prev) => ({
          ...prev,
          kiExposeStructure: {
            ...prev.kiExposeStructure,
            [activeType]: { sections: sections!, source, createdAt: Date.now() },
          },
        }));
      }

      // 2) Fotos sammeln (echte Fotos + gerenderte PDF-Seiten), Datenblatt-Text extrahieren.
      // Doppelt hochgeladene/gerenderte Bilder werden hier bereits heraus-
      // gefiltert, damit dasselbe Foto niemals auf mehreren Seiten des
      // Exposés landet. Ein reiner DataURL-Vergleich reicht dafuer NICHT -
      // dasselbe Foto kann z.B. einmal direkt hochgeladen und einmal (neu
      // komprimiert) als gerenderte PDF-Seite erneut im Pool landen, mit
      // unterschiedlicher DataURL trotz gleichem Bildinhalt. Darum zusaetzlich
      // ein Wahrnehmungs-Hash-Vergleich (siehe imageEdit.ts) auf visuelle
      // Naehe. Der Struktur-Hash allein reicht NICHT (kollabiert bei
      // einfarbigen Flaechen auf dasselbe Bitmuster egal welcher Farbe) -
      // ein Duplikat wird nur erkannt, wenn ZUSAETZLICH auch die
      // Durchschnittsfarbe nahe beieinander liegt.
      const DUPLICATE_HASH_THRESHOLD = 6; // von 64 Bits (8x8-Hash)
      const DUPLICATE_COLOR_THRESHOLD = 20; // euklidischer RGB-Abstand
      // Der Dateiname jedes Fotos wird mit durchgereicht (siehe PhotoInput in
      // ai.ts) und hat Vorrang bei der Abschnitts-Zuordnung. Bei aus einem PDF
      // gerenderten Seiten (z.B. Grundriss-Scans) wird zusaetzlich der ECHTE,
      // aus der PDF-Textebene extrahierte Seitentext mitgegeben - haeufig
      // steht dort die Geschossbezeichnung ("Grundriss Erdgeschoss" o.ae.),
      // was zuverlaessiger ist als ein optisch aus dem Bild herausgelesenes
      // Klein-Label.
      const photoPool: { src: string; name: string; pageText?: string }[] = [];
      const photoSignatures: { hash: string; avgColor: [number, number, number] }[] = [];
      const seenExact = new Set<string>();
      const addPhoto = async (src: string, name: string, pageText?: string) => {
        if (seenExact.has(src)) return;
        seenExact.add(src);
        let sig: { hash: string; avgColor: [number, number, number] } | null = null;
        try {
          sig = await computeImageSignature(src);
        } catch {
          sig = null;
        }
        if (
          sig &&
          sig.hash &&
          photoSignatures.some(
            (s) =>
              hammingDistance(s.hash, sig!.hash) <= DUPLICATE_HASH_THRESHOLD &&
              colorDistance(s.avgColor, sig!.avgColor) <= DUPLICATE_COLOR_THRESHOLD,
          )
        ) {
          return;
        }
        if (sig && sig.hash) photoSignatures.push(sig);
        photoPool.push({ src, name, pageText });
      };
      let datasheetText = "";
      const imageFiles = files.filter((f) => f.mime.startsWith("image/"));
      const pdfFiles = files.filter((f) => f.mime === "application/pdf");
      // Energieausweis-PDFs (am Dateinamen erkannt) werden GESONDERT
      // behandelt: ALLE Seiten werden uebernommen, jede als eigene, einzelne
      // Seite ins Exposé eingefügt - nicht als normales Foto in den
      // Foto-Pool anderer Abschnitte gemischt, und ihr Text (Energiekennwerte)
      // fliesst NICHT in die allgemeine Texterstellung ein (siehe Punkt
      // 4/writeExposeSectionTexts).
      const ENERGIEAUSWEIS_RE = /energieausweis|energiepass|enev/i;
      const energieausweisFiles = pdfFiles.filter((f) => ENERGIEAUSWEIS_RE.test(f.name));
      const datasheetPdfFiles = pdfFiles.filter((f) => !ENERGIEAUSWEIS_RE.test(f.name));

      const energieausweisImages: string[] = [];
      for (const f of energieausweisFiles) {
        const rendered = await renderPdfPages(f.dataUrl, 20, 1400);
        for (const p of rendered) if (p.image) energieausweisImages.push(p.image);
      }

      for (const f of imageFiles) await addPhoto(f.dataUrl, f.name);
      for (const f of datasheetPdfFiles) {
        const rendered = await renderPdfPages(f.dataUrl, 6, 1000);
        for (let idx = 0; idx < rendered.length; idx++) {
          const p = rendered[idx];
          // Reine TEXTseiten eines Datenblatts (z.B. die Sanierungs-/
          // Eckdatenliste) liefern nur ihren Text - sie duerfen NICHT als
          // Foto in den Pool wandern, sonst landet eine Textseite als
          // vermeintliches Foto im Exposé (z.B. auf einer Galerie-Seite).
          // Gezeichnete Plaene (Grundrisse) und Seiten mit echten Fotos
          // bleiben dagegen erhalten - siehe isTextOnlyPdfPage().
          if (p.image && !isTextOnlyPdfPage(p)) {
            const name = rendered.length > 1 ? `${f.name} (Seite ${idx + 1})` : f.name;
            await addPhoto(p.image, name, p.text);
          }
          if (p.text) datasheetText += `\n\n[${f.name}]\n${p.text}`;
        }
      }
      if (photoPool.length === 0 && !datasheetText.trim() && energieausweisImages.length === 0) {
        setResultMsg({ ok: false, msg: "Aus den hochgeladenen Dateien konnten weder Fotos noch Text gelesen werden." });
        return;
      }

      // 3) Fotos den KONKRETEN Abschnitten zuordnen (per Index, nicht nur
      // grober Art) - so bekommt z.B. "Bad" seine eigenen Fotos und teilt
      // sie sich nicht mit "Küche", nur weil beide dieselbe Art haben.
      //
      // VORAB-Reservierung fuer priorisierte Abschnitte: die normale
      // Zuordnung (analyzePhotoSections) bewertet Fotos in Batches von 4
      // weitgehend UNABHAENGIG gegen ALLE Abschnitte - dabei kann ein gutes
      // Aussenfoto an einen inhaltlich aehnlich klingenden Abschnitt gehen
      // (z.B. "Ein Zuhause, das von außen überzeugt"), waehrend die
      // Titelseite leer ausgeht, obwohl sie IMMER Vorrang haben soll.
      // Darum: Titelfoto (und bevorzugte Impressions-Fotos fuer "Vorteile"/
      // "WOW-Effekt"-Abschnitte) VOR der allgemeinen Zuordnung in einem
      // eigenen, den GESAMTEN Pool vergleichenden Aufruf reservieren und aus
      // dem Pool entfernen, bevor die normale Zuordnung ueberhaupt zum Zug
      // kommt.
      const bySection: { src: string; caption: string }[][] = sections.map(() => []);
      const overflow: string[] = [];
      const consumed = new Set<number>();
      const candidatesFor = () =>
        photoPool.map((p, origIndex) => ({ ...p, origIndex })).filter((p) => !consumed.has(p.origIndex));

      if (photoPool.length > 0) {
        setProgress({ phase: "fotos", done: 0, total: photoPool.length });

        const titelSectionIdx = sections.findIndex((s) => s.kind === "titel");
        if (titelSectionIdx >= 0) {
          const candidates = candidatesFor();
          const picks = await pickPriorityPhotos(data.api, candidates, TITLE_PHOTO_CRITERION, 1);
          for (const pick of picks) {
            const orig = candidates[pick.index];
            if (!orig) continue;
            consumed.add(orig.origIndex);
            bySection[titelSectionIdx].push({ src: orig.src, caption: pick.caption });
          }
        }

        for (let i = 0; i < sections.length; i++) {
          if (!VORTEILE_TITLE_RE.test(sections[i].title)) continue;
          const candidates = candidatesFor();
          if (candidates.length === 0) continue;
          const picks = await pickPriorityPhotos(data.api, candidates, VORTEILE_PHOTO_CRITERION, 3);
          for (const pick of picks) {
            const orig = candidates[pick.index];
            if (!orig) continue;
            consumed.add(orig.origIndex);
            bySection[i].push({ src: orig.src, caption: pick.caption });
          }
        }

        const remainingPool = candidatesFor();
        const reservedCount = photoPool.length - remainingPool.length;
        if (remainingPool.length > 0) {
          const res = await analyzePhotoSections(
            data.api,
            remainingPool.map(({ src, name, pageText }) => ({ src, name, pageText })),
            sections,
            (done) => setProgress({ phase: "fotos", done: reservedCount + done, total: photoPool.length }),
          );
          if (!res.ok) {
            setResultMsg({ ok: false, msg: res.message });
            return;
          }
          res.photos.forEach((a, i) => {
            const orig = remainingPool[i];
            if (a.sectionIndex >= 0 && a.sectionIndex < sections.length) {
              bySection[a.sectionIndex].push({ src: orig.src, caption: a.caption });
            } else {
              overflow.push(orig.src);
            }
          });
        }
      }

      // Fotos direkt dem zugewiesenen Abschnitt zuordnen; alles ohne
      // passenden Abschnitt oder ueber dem Kappungslimit geht in eine
      // Galerie-Seite statt verworfen zu werden.
      // "Grundriss" bekommt bewusst ein hohes Limit: die Struktur-Analyse
      // fasst mehrere Grundriss-Seiten (z.B. Keller-, Erd-, Obergeschoss) zu
      // EINEM Abschnitt zusammen (siehe analyzeExposeStructure-Prompt) - der
      // Abschnitt muss darum alle zugehoerigen Grundriss-Bilder aufnehmen
      // koennen, nicht nur eines.
      const capFor = (kind: (typeof sections)[number]["kind"]) =>
        kind === "titel" ? 1 : kind === "grundriss" ? 6 : kind === "galerie" || kind === "kontakt" ? 4 : 3;
      const sectionPhotos: { src: string; caption: string }[][] = sections.map((s, i) => {
        const cap = capFor(s.kind);
        const list = bySection[i];
        if (list.length > cap) overflow.push(...list.slice(cap).map((p) => p.src));
        return list.slice(0, cap);
      });
      const overflowPhotos: string[] = overflow;

      // 4) Abschnittstexte schreiben.
      setProgress({ phase: "texte", done: 0, total: sections.length });
      const captionsBySection = sectionPhotos.map((list) => list.map((p) => p.caption));
      const textRes = await writeExposeSectionTexts(
        data.api,
        activeType,
        sections,
        captionsBySection,
        datasheetText,
        data.styleTexts,
        (done, total) => setProgress({ phase: "texte", done, total }),
      );
      if (!textRes.ok) {
        setResultMsg({ ok: false, msg: textRes.message });
        return;
      }

      // 5) Luxus-Seiten bauen + Standardseiten (Impressum/AGB/…) anhängen.
      setProgress({ phase: "aufbau", done: 0, total: 1 });
      // Vor dem Aufbau sicherstellen, dass die Schwungschrift wirklich da ist:
      // die Ueberschriftengroessen werden mit ihr AUSGEMESSEN, und ohne sie
      // faellt die Messung auf eine deutlich breitere Ersatzschrift zurueck -
      // die Ueberschriften kaemen dann viel zu klein heraus.
      await ensureScriptFontLoaded();
      // Anschrift des Objekts (Eingabefelder oben auf dieser Seite) - fliesst
      // sowohl in die beiden festen Felder der Titelseite als auch weiter
      // unten in den Namen des gespeicherten Exposés ein.
      const street = address.street.trim();
      const zip = (address.zip ?? "").trim();
      const city = address.city.trim();
      const inputs: KiExposeSectionInput[] = sections.map((section, i) => ({
        section,
        photos: sectionPhotos[i].map((p) => p.src),
        headline: textRes.texts[i]?.headline ?? "",
        text: textRes.texts[i]?.text ?? "",
      }));
      // Mit uebernommenem Design: Farben, Formen, Schriftgroessen und die
      // Anordnung der Text-/Fotoflaechen kommen 1:1 aus dem Beispiel-Exposé,
      // eingesetzt werden nur die neuen Fotos und die neuen Texte.
      // Ohne Design-Uebernahme bleibt es beim fest hinterlegten Luxus-Design.
      let pages: Page[];
      if (useLayout) {
        pages = buildLayoutPages(
          layout,
          inputs,
          data.logo,
          overflowPhotos,
          energieausweisImages,
          { street, zip, city },
          data.website,
        );
      } else {
        // Logo-Badge auf der Titelseite liegt direkt auf dem Foto - dafuer
        // eine weiss/transparent aufbereitete Version des Logos verwenden,
        // damit es ohne eigene Hintergrundflaeche freigestellt erscheint.
        const heroLogo = data.logo
          ? { ...data.logo, mime: "image/png", dataUrl: await invertLogoToWhite(data.logo.dataUrl) }
          : null;
        pages = buildLuxuryPages(activeType, inputs, data.logo, overflowPhotos, heroLogo, energieausweisImages);
      }
      const boilerplateSection = await buildBoilerplateSection(
        data.api,
        data.boilerplate,
        data.logo,
        useLayout ? layout : null,
      );
      const allPages = [...pages, ...boilerplateSection];
      // Im uebernommenen Design bekommt auch die Seitenzahl die Typografie der
      // Vorlage - die Schwungschrift-Ziffer des Luxus-Designs waere dort der
      // einzige verbliebene Rest des alten Designs.
      if (useLayout) addLayoutPageNumbers(allPages, layout);
      else addPageNumbers(allPages);

      // Exposé-Nummer vergeben und Namen daraus bilden. Die Nummer wird
      // ausschliesslich hochgezaehlt und nie wiederverwendet - auch nicht,
      // wenn ein Exposé spaeter geloescht wird (siehe AppData.exposeCounter).
      const exposeNo = data.exposeCounter + 1;
      const name =
        street || city
          ? buildExposeName(exposeNo, street, city)
          : // Ohne Anschrift bleibt der Objekttyp als Unterscheidungsmerkmal -
            // besser als eine Liste aus lauter blossen Nummern.
            buildExposeName(exposeNo, TYPE_LABEL[activeType], "");
      const now = Date.now();
      const project: ExposeProject = {
        id: uid("proj"),
        type: activeType,
        title: `${TYPE_LABEL[activeType]} – Exposé`,
        pages: allPages,
        updatedAt: now,
        builtFrom: `ki-expose:${now}`,
        exposeNo,
        name,
        address: { street, zip, city },
        createdAt: now,
      };
      // Legt das Exposé zugleich im Archiv ab (exposeNo ist gesetzt) - es ist
      // damit ab sofort unter "Meine Exposés" wieder aufrufbar.
      await saveProjectNow(project);
      updateData((prev) => ({
        ...prev,
        exposeCounter: Math.max(prev.exposeCounter, exposeNo),
      }));
      setResultMsg({
        ok: true,
        msg: `Exposé „${name}" aus „${source}" generiert und gespeichert – wird geöffnet …`,
      });
      navigate(`/editor/${activeType}`);
    } catch (err) {
      setResultMsg({ ok: false, msg: (err as Error).message });
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  }

  const photoCount = files.filter((f) => f.mime.startsWith("image/")).length;
  const pdfCount = files.filter((f) => f.mime === "application/pdf").length;

  const phaseLabel: Record<Phase, string> = {
    struktur: "Seitenaufbau wird aus dem Beispiel abgeleitet …",
    fotos: `Fotos werden analysiert … ${progress?.done ?? 0}/${progress?.total ?? 0}`,
    texte: `Texte werden geschrieben … ${progress?.done ?? 0}/${progress?.total ?? 0} Abschnitte`,
    aufbau: "Exposé wird zusammengestellt …",
  };

  return (
    <div className="app-shell">
      <TopBar />
      <div className="page-wrap">
        <div className="data-head">
          <h1>
            <span style={{ verticalAlign: "-4px", marginRight: 8, display: "inline-block" }}>
              <IconSparkle size={26} />
            </span>
            KI Exposé
          </h1>
          <p>
            Laden Sie Fotos und Datenblätter hoch – die KI übernimmt den Seitenaufbau aus Ihren
            Beispielen im Datenbereich, ordnet die Fotos passenden Seiten zu, schreibt die Texte
            und gestaltet ein komplett neues, hochwertiges Exposé-Design.
          </p>
        </div>

        <section className="card data-section">
          <div className="section-head">
            <span className="s-icon">
              <IconUpload size={20} />
            </span>
            <div>
              <div className="num">SCHRITT 1</div>
              <h2>Objekttyp & Rohmaterial</h2>
            </div>
          </div>

          <div className="type-tabs">
            {EXPOSE_TYPES.map((t) => (
              <button
                key={t.id}
                className={`type-tab ${activeType === t.id ? "active" : ""}`}
                onClick={() => {
                  setActiveType(t.id);
                  setResultMsg(null);
                }}
              >
                {t.label}
                {data.kiExposeFiles[t.id].length > 0 && ` (${data.kiExposeFiles[t.id].length})`}
              </button>
            ))}
          </div>

          <p className="section-desc">
            Fotos (Innen-/Außenansichten, Grundriss-Scans, Lagepläne …) und PDF-Datenblätter für „
            {TYPE_LABEL[activeType]}". Mehrfachauswahl und Ordner-Upload möglich.
          </p>

          <div className="ki-upload-row">
            <Dropzone
              accept="image/*,application/pdf"
              onFiles={addFiles}
              title="Dateien hochladen"
              hint="Fotos (JPG/PNG) oder PDF-Datenblätter · per Klick oder Drag & Drop"
            />
            <button
              type="button"
              className="btn btn-outline ki-folder-btn"
              onClick={() => folderInputRef.current?.click()}
            >
              <IconUpload size={18} /> Ordner hochladen
            </button>
            <input
              ref={folderInputRef}
              type="file"
              hidden
              // @ts-expect-error – nicht-standardisiertes, aber breit unterstuetztes Attribut fuer Ordner-Auswahl.
              webkitdirectory=""
              directory=""
              multiple
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []).filter(
                  (f) => f.type.startsWith("image/") || f.type === "application/pdf",
                );
                if (list.length > 0) void addFiles(list);
                e.target.value = "";
              }}
            />
          </div>

          <div className="ki-address">
            <div className="ki-address-head">
              <strong>Objektanschrift</strong>
              <span className="hint">
                Bildet den Namen des gespeicherten Exposés – z.&nbsp;B.{" "}
                <code>
                  {buildExposeName(
                    data.exposeCounter + 1,
                    address.street.trim() || "Am Waldberg 3",
                    address.city.trim() || "Lüdenscheid",
                  )}
                </code>
              </span>
            </div>
            <div className="ki-address-fields">
              <label>
                Straße &amp; Hausnummer
                <input
                  type="text"
                  value={address.street}
                  placeholder="Am Waldberg 3"
                  onChange={(e) => setAddress({ street: e.target.value })}
                />
              </label>
              <label className="ki-address-zip">
                PLZ
                <input
                  type="text"
                  value={address.zip ?? ""}
                  placeholder="58509"
                  onChange={(e) => setAddress({ zip: e.target.value })}
                />
              </label>
              <label>
                Ort
                <input
                  type="text"
                  value={address.city}
                  placeholder="Lüdenscheid"
                  onChange={(e) => setAddress({ city: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="btn btn-outline"
                disabled={addressBusy || pdfCount === 0 || !aiReady(data.api)}
                onClick={() =>
                  suggestAddress(
                    files.filter((f) => f.mime === "application/pdf"),
                    true,
                  )
                }
                title={
                  pdfCount === 0
                    ? "Erst ein PDF-Datenblatt hochladen"
                    : "Anschrift erneut aus den Datenblättern lesen"
                }
              >
                {addressBusy ? "Wird gelesen …" : "Aus Datenblatt übernehmen"}
              </button>
            </div>
          </div>

          {files.length > 0 && (
            <>
              <div className="hint" style={{ marginTop: 10 }}>
                {photoCount} Foto(s), {pdfCount} PDF-Datenblatt/-blätter
              </div>
              <div className="file-grid">
                {files.map((f) => (
                  <div className="file-card" key={f.id}>
                    <button className="del" onClick={() => removeFile(f.id)} title="Entfernen">
                      <IconTrash size={14} />
                    </button>
                    <div className="thumb">
                      {f.mime.startsWith("image/") ? (
                        <img src={f.dataUrl} alt={f.name} />
                      ) : (
                        <IconImage size={26} />
                      )}
                    </div>
                    <div className="meta">
                      <div className="fname">{f.name}</div>
                      <div className="fsize">{formatBytes(f.size)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="card data-section">
          <div className="section-head">
            <span className="s-icon">
              <IconSparkle size={20} />
            </span>
            <div>
              <div className="num">SCHRITT 2</div>
              <h2>Design & Seitenaufbau</h2>
            </div>
          </div>
          {activeLayout ? (
            <>
              <p className="section-desc">
                Das Design Ihres Beispiel-Exposés wird vollständig übernommen: Farben, Formen,
                Schriftgrößen und die Anordnung der Text- und Fotoflächen. Eingesetzt werden
                ausschließlich die neuen Fotos und die neu geschriebenen Texte.
              </p>
              <div className="lp-current">
                <span className="badge badge-ok">
                  <IconCheck size={13} /> Design aus „{activeLayout.source}"
                </span>
                <span className="lp-current-text">
                  {activeLayout.pages.length} Seite(n):{" "}
                  {activeLayout.pages
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((p) => p.title)
                    .join(", ")}
                </span>
              </div>
              <div className="hint" style={{ marginTop: 8 }}>
                Im <a href="#/data">Datenbereich</a> lässt sich das übernommene Design verwerfen –
                dann wird wieder das hinterlegte Luxus-Design verwendet.
              </div>
            </>
          ) : (
            <>
          <p className="section-desc">
            Wird einmalig aus Ihren Beispiel-Exposés im Datenbereich abgeleitet (nur Reihenfolge/
            Zweck der Seiten, keine Farben oder Grafiken) und danach für „{TYPE_LABEL[activeType]}"
            wiederverwendet.
          </p>

          {structure ? (
            <div className="lp-current">
              <span className="badge badge-ok">
                <IconCheck size={13} /> Aufbau aktiv
              </span>
              <span className="lp-current-text">
                {structure.sections.length} Abschnitt(e): {structure.sections.map((s) => s.title).join(", ")}
              </span>
              <button className="btn btn-outline" onClick={regenerateStructure} disabled={generating}>
                Neu generieren
              </button>
              {previousStructure && (
                <button className="btn btn-ghost" onClick={undoStructure} disabled={generating}>
                  Rückgängig
                </button>
              )}
            </div>
          ) : (
            <div className="hint">
              Wird beim ersten „Exposé generieren" automatisch erstellt (Datenbereich-Beispiel
              erforderlich).
            </div>
          )}
            </>
          )}
        </section>

        <section className="card data-section">
          <div className="section-head">
            <span className="s-icon">
              <IconSparkle size={20} />
            </span>
            <div>
              <div className="num">SCHRITT 3</div>
              <h2>Exposé generieren</h2>
            </div>
          </div>
          <p className="section-desc">
            Die KI betrachtet alle Fotos, ordnet sie den passenden Seiten zu und schreibt die
            Texte im hinterlegten Schreibstil. Das Ergebnis öffnet sich danach im Editor.
          </p>

          <button
            className="btn btn-generate btn-lg"
            onClick={generate}
            disabled={generating || files.length === 0 || !aiReady(data.api)}
          >
            <IconSparkle size={18} /> {generating ? "Wird generiert …" : "Exposé generieren"}
          </button>

          {progress && (
            <div className="lp-progress" style={{ marginTop: 14 }}>
              <div className="lp-progress-label">{phaseLabel[progress.phase]}</div>
              <div className="lp-progress-bar">
                <div
                  style={{
                    width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 8}%`,
                  }}
                />
              </div>
            </div>
          )}

          {resultMsg && (
            <div className={`key-status ${resultMsg.ok ? "ok" : "err"}`}>
              {resultMsg.ok && <IconCheck size={16} />}
              {resultMsg.msg}
            </div>
          )}

          {!aiReady(data.api) && (
            <div className="hint" style={{ marginTop: 8 }}>
              Kein API-Zugang eingerichtet – bitte im{" "}
              <a href="#/data">Datenbereich</a> anmelden bzw. einen API-Key hinterlegen. Modell:{" "}
              {MODEL_OPTIONS.find((m) => m.id === data.api.model)?.label ?? data.api.model}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

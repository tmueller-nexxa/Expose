import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { Dropzone } from "../components/Dropzone";
import { useApp } from "../context/AppContext";
import {
  EXPOSE_TYPES,
  type ExposeSection,
  type ExposeType,
  type StoredFile,
} from "../lib/types";
import {
  aiReady,
  analyzeExposeStructure,
  analyzePhotoSections,
  MODEL_OPTIONS,
  writeExposeSectionTexts,
} from "../lib/ai";
import { aiProxyUrl } from "../firebase.config";
import { detectBoilerplate } from "../lib/boilerplate";
import { boilerplatePages } from "../lib/templates";
import { buildLuxuryPages, type KiExposeSectionInput } from "../lib/luxuryTemplate";
import { colorDistance, computeImageSignature, hammingDistance, invertLogoToWhite } from "../lib/imageEdit";
import { saveProjectNow } from "../lib/storage";
import { fileToDataUrl, formatBytes, uid } from "../lib/util";
import { renderPdfPages } from "../lib/pdf";
import type { ExposeProject } from "../lib/types";
import {
  IconCheck,
  IconImage,
  IconSparkle,
  IconTrash,
  IconUpload,
} from "../components/Icons";
import "./DataPage.css";
import "./KiExposePage.css";

const MAX_ANALYZE_PAGES = 20;

const TYPE_LABEL: Record<ExposeType, string> = {
  einfamilienhaus: "Einfamilienhaus",
  wohnung: "Eigentumswohnung",
  mehrfamilienhaus: "Mehrfamilienhaus",
  gewerbe: "Gewerbeimmobilie",
};

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
  const folderInputRef = useRef<HTMLInputElement>(null);

  const files = data.kiExposeFiles[activeType];
  const structure = data.kiExposeStructure[activeType];
  const previousStructure = data.kiExposeStructurePrevious[activeType];

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
      // 1) Seitenaufbau: vorhandenen wiederverwenden oder neu ableiten.
      let sections = structure?.sections ?? null;
      let source = structure?.source ?? "";
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
      const photoPool: string[] = [];
      const photoSignatures: { hash: string; avgColor: [number, number, number] }[] = [];
      const seenExact = new Set<string>();
      const addPhoto = async (src: string) => {
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
        photoPool.push(src);
      };
      let datasheetText = "";
      const imageFiles = files.filter((f) => f.mime.startsWith("image/"));
      const pdfFiles = files.filter((f) => f.mime === "application/pdf");
      // Energieausweis-PDFs (am Dateinamen erkannt) werden GESONDERT
      // behandelt: nur die erste (wichtigste) Seite wird verwendet und als
      // eigene, einzelne Seite ins Exposé eingefügt - nicht als normales
      // Foto in den Foto-Pool anderer Abschnitte gemischt, und ihr Text
      // (Energiekennwerte) fliesst NICHT in die allgemeine Texterstellung
      // ein (siehe Punkt 4/writeExposeSectionTexts).
      const ENERGIEAUSWEIS_RE = /energieausweis|energiepass|enev/i;
      const energieausweisFiles = pdfFiles.filter((f) => ENERGIEAUSWEIS_RE.test(f.name));
      const datasheetPdfFiles = pdfFiles.filter((f) => !ENERGIEAUSWEIS_RE.test(f.name));

      let energieausweisImage: string | null = null;
      for (const f of energieausweisFiles) {
        if (energieausweisImage) continue; // nur die erste gefundene Datei verwenden
        const rendered = await renderPdfPages(f.dataUrl, 1, 1400);
        if (rendered[0]?.image) energieausweisImage = rendered[0].image;
      }

      for (const f of imageFiles) await addPhoto(f.dataUrl);
      for (const f of datasheetPdfFiles) {
        const rendered = await renderPdfPages(f.dataUrl, 6, 1000);
        for (const p of rendered) {
          if (p.image) await addPhoto(p.image);
          if (p.text) datasheetText += `\n\n[${f.name}]\n${p.text}`;
        }
      }
      if (photoPool.length === 0 && !datasheetText.trim() && !energieausweisImage) {
        setResultMsg({ ok: false, msg: "Aus den hochgeladenen Dateien konnten weder Fotos noch Text gelesen werden." });
        return;
      }

      // 3) Fotos den KONKRETEN Abschnitten zuordnen (per Index, nicht nur
      // grober Art) - so bekommt z.B. "Bad" seine eigenen Fotos und teilt
      // sie sich nicht mit "Küche", nur weil beide dieselbe Art haben.
      let assignments: { sectionIndex: number; caption: string }[] = [];
      if (photoPool.length > 0) {
        setProgress({ phase: "fotos", done: 0, total: photoPool.length });
        const res = await analyzePhotoSections(data.api, photoPool, sections, (done, total) =>
          setProgress({ phase: "fotos", done, total }),
        );
        if (!res.ok) {
          setResultMsg({ ok: false, msg: res.message });
          return;
        }
        assignments = res.photos;
      }

      // Fotos direkt dem zugewiesenen Abschnitt zuordnen; alles ohne
      // passenden Abschnitt oder ueber dem Kappungslimit geht in eine
      // Galerie-Seite statt verworfen zu werden.
      const capFor = (kind: (typeof sections)[number]["kind"]) =>
        kind === "titel" ? 1 : kind === "grundriss" ? 1 : kind === "galerie" || kind === "kontakt" ? 4 : 3;
      const bySection: { src: string; caption: string }[][] = sections.map(() => []);
      const overflow: string[] = [];
      photoPool.forEach((src, i) => {
        const a = assignments[i] ?? { sectionIndex: -1, caption: "" };
        if (a.sectionIndex >= 0 && a.sectionIndex < sections.length) {
          bySection[a.sectionIndex].push({ src, caption: a.caption });
        } else {
          overflow.push(src);
        }
      });
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
      const inputs: KiExposeSectionInput[] = sections.map((section, i) => ({
        section,
        photos: sectionPhotos[i].map((p) => p.src),
        headline: textRes.texts[i]?.headline ?? "",
        text: textRes.texts[i]?.text ?? "",
      }));
      // Logo-Badge auf der Titelseite liegt direkt auf dem Foto - dafuer
      // eine weiss/transparent aufbereitete Version des Logos verwenden,
      // damit es ohne eigene Hintergrundflaeche freigestellt erscheint.
      const heroLogo = data.logo
        ? { ...data.logo, mime: "image/png", dataUrl: await invertLogoToWhite(data.logo.dataUrl) }
        : null;
      const pages = buildLuxuryPages(activeType, inputs, data.logo, overflowPhotos, heroLogo, energieausweisImage);

      const project: ExposeProject = {
        id: uid("proj"),
        type: activeType,
        title: `${TYPE_LABEL[activeType]} – Exposé`,
        pages: [...pages, ...boilerplatePages(data.boilerplate)],
        updatedAt: Date.now(),
        builtFrom: `ki-expose:${Date.now()}`,
      };
      await saveProjectNow(project);
      setResultMsg({ ok: true, msg: `Exposé aus „${source}" generiert – wird geöffnet …` });
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
              <h2>Seitenaufbau</h2>
            </div>
          </div>
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

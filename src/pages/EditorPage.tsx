import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApp } from "../context/AppContext";
import {
  EXPOSE_TYPES,
  type ExposeProject,
  type ExposeType,
  type ImageElement,
  type PageElement,
  type ShapeElement,
  type TextElement,
} from "../lib/types";
import {
  createProject,
  createProjectFromLayout,
  IMAGE_Z,
  projectStamp,
} from "../lib/templates";
import { loadProject, saveProject, saveProjectNow } from "../lib/storage";
import { generateImageText, generatePageText } from "../lib/ai";
import { EXPOSE_FONTS, EXPOSE_LIGHT_GREY, EXPOSE_TEXT_COLORS } from "../lib/designTokens";
import { eraseRegionsFromImage } from "../lib/imageEdit";
import { clamp, fileToDataUrl, uid } from "../lib/util";
import { fitFontSize, fitTextBoxHeight } from "../editor/fit";
import { REF_H, REF_W } from "../editor/constants";
import { PageCanvas } from "../editor/PageCanvas";
import { startPointerDrag } from "../editor/pointer";
import {
  IconArrowLeft,
  IconCheck,
  IconDownload,
  IconImage,
  IconSparkle,
  IconText,
  IconTrash,
} from "../components/Icons";
import "./EditorPage.css";

// Breite der Miniaturansichten-Leiste (rechts): Grenzen + Speicherung.
const THUMB_RAIL_KEY = "expose-ki-thumb-rail-width";
const THUMB_RAIL_MIN = 140;
const THUMB_RAIL_MAX = 420;
const THUMB_RAIL_DEFAULT = 190;
const THUMB_RAIL_PADDING = 28; // 14px links + rechts (siehe .thumb-rail)

function loadThumbRailWidth(): number {
  const raw = Number(localStorage.getItem(THUMB_RAIL_KEY));
  if (Number.isFinite(raw) && raw >= THUMB_RAIL_MIN && raw <= THUMB_RAIL_MAX) {
    return raw;
  }
  return THUMB_RAIL_DEFAULT;
}

// Hat der Nutzer bereits eigene Bilder platziert? (Standardseiten zaehlen nicht.)
function hasPlacedImages(project: ExposeProject): boolean {
  return project.pages.some((pg) =>
    pg.elements.some(
      (e) =>
        e.kind === "image" &&
        (e as ImageElement).src &&
        !(e as ImageElement).fromBoilerplate,
    ),
  );
}

export function EditorPage() {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const { data, updateData } = useApp();
  const exType = (type ?? "einfamilienhaus") as ExposeType;
  const typeMeta = EXPOSE_TYPES.find((t) => t.id === exType);

  const [project, setProject] = useState<ExposeProject | null>(null);
  const projectRef = useRef<ExposeProject | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [canvasWidth, setCanvasWidth] = useState(560);
  const [thumbRailWidth, setThumbRailWidth] = useState(loadThumbRailWidth);
  // Es liegt eine neuere Beispiel-Struktur vor als das offene Projekt.
  const [structureUpdate, setStructureUpdate] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  function onThumbRailResizeStart(e: React.PointerEvent) {
    const startWidth = thumbRailWidth;
    startPointerDrag(
      e,
      (dx) => {
        // Griff liegt am linken Rand der rechten Leiste: nach links ziehen
        // (dx negativ) vergroessert die Breite, nach rechts verkleinert sie.
        const next = clamp(startWidth - dx, THUMB_RAIL_MIN, THUMB_RAIL_MAX);
        setThumbRailWidth(next);
      },
      () => {
        setThumbRailWidth((w) => {
          localStorage.setItem(THUMB_RAIL_KEY, String(w));
          return w;
        });
      },
    );
  }

  // Projekt laden oder aus Vorlage erstellen.
  useEffect(() => {
    let alive = true;
    (async () => {
      const existing = await loadProject(exType);
      const layout = data.layouts[exType];
      const bp = data.boilerplate;
      const fresh = layout
        ? createProjectFromLayout(exType, layout, data.logo, bp)
        : createProject(exType, data.logo, bp);
      const stamp = projectStamp(layout, bp);

      let proj = existing ?? fresh;
      let saveIt = !existing;
      let updateHint = false;

      // Neuere gelernte Struktur / Standardseiten als das gespeicherte Projekt?
      // "KI Exposé"-Projekte sind bewusst NICHT aus layout/bp abgeleitet
      // (eigenes Luxus-Design) - der Hinweis waere hier irrefuehrend.
      const isKiExpose = existing?.builtFrom?.startsWith("ki-expose") ?? false;
      if (existing && !isKiExpose && existing.builtFrom !== stamp && (layout || bp)) {
        if (!hasPlacedImages(existing)) {
          // Noch keine Bilder platziert -> neue Vorlage direkt uebernehmen.
          proj = fresh;
          saveIt = true;
        } else {
          // Es steckt schon Arbeit drin -> nur Hinweis anbieten.
          updateHint = true;
        }
      }

      if (!alive) return;
      projectRef.current = proj;
      setProject(proj);
      setStructureUpdate(updateHint);
      if (saveIt) void saveProject(proj);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exType]);

  // Canvas-Breite an Viewport anpassen.
  useLayoutEffect(() => {
    function measure() {
      const w = viewportRef.current?.clientWidth ?? 700;
      setCanvasWidth(clamp(w - 60, 320, 720));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const commit = useCallback((next: ExposeProject) => {
    next.updatedAt = Date.now();
    projectRef.current = next;
    setProject(next);
    void saveProject(next);
  }, []);

  const mutatePages = useCallback(
    (fn: (pages: ExposeProject["pages"]) => ExposeProject["pages"]) => {
      const cur = projectRef.current;
      if (!cur) return;
      commit({ ...cur, pages: fn(cur.pages) });
    },
    [commit],
  );

  const patchElement = useCallback(
    (elId: string, patch: Partial<PageElement>) => {
      mutatePages((pages) =>
        pages.map((pg) => ({
          ...pg,
          elements: pg.elements.map((e) =>
            e.id === elId ? ({ ...e, ...patch } as PageElement) : e,
          ),
        })),
      );
    },
    [mutatePages],
  );

  // Wie patchElement, aber fuer Textfelder: waechst die Box automatisch
  // nach unten, falls Text/Schriftgroesse sonst nicht mehr vollstaendig
  // hineinpassen wuerden - damit nirgends Schrift abgeschnitten wird.
  const patchTextGrow = useCallback(
    (elId: string, patch: Partial<TextElement>) => {
      const cur = projectRef.current;
      const el = cur?.pages[pageIndex]?.elements.find((e) => e.id === elId) as
        | TextElement
        | undefined;
      if (!el) {
        patchElement(elId, patch);
        return;
      }
      const merged = { ...el, ...patch };
      if (merged.text.trim()) {
        const needed = fitTextBoxHeight(merged.text, merged.w, merged.fontSize, merged.fontWeight, merged.fontFamily);
        if (needed > merged.h) {
          patch = { ...patch, h: Math.min(needed, 1 - merged.y) };
        }
      }
      patchElement(elId, patch);
    },
    [patchElement, pageIndex],
  );

  const deleteElement = useCallback(
    (elId: string) => {
      const cur = projectRef.current;
      const el = cur?.pages[pageIndex]?.elements.find((e) => e.id === elId);
      // Ein befuelltes Foto wird nur GELEERT (Platzhalter bleibt an Ort und
      // Stelle mit seiner Groesse erhalten) - erst ein leerer Platzhalter
      // wird beim naechsten Loeschen komplett entfernt. So geht der
      // muehsam positionierte/skalierte Rahmen nicht verloren, nur weil man
      // das eingefuegte Foto wieder loeschen will.
      if (el?.kind === "image" && !el.locked && el.src) {
        mutatePages((pages) =>
          pages.map((pg) => ({
            ...pg,
            elements: pg.elements.map((e) =>
              e.id === elId
                ? ({ ...e, src: "", imgScale: 1, imgX: 0, imgY: 0, z: IMAGE_Z } as ImageElement)
                : e,
            ),
          })),
        );
        return;
      }
      mutatePages((pages) =>
        pages.map((pg) => ({
          ...pg,
          // Gesperrte Elemente (z.B. der 1:1-Hintergrund der Standardseiten)
          // duerfen nie geloescht werden.
          elements: pg.elements.filter((e) => e.id !== elId || e.locked),
        })),
      );
      setSelectedId(null);
    },
    [mutatePages, pageIndex],
  );

  const maxZ = useCallback(() => {
    const cur = projectRef.current;
    if (!cur) return 1;
    let m = 1;
    for (const pg of cur.pages)
      for (const e of pg.elements) if (e.z > m) m = e.z;
    return m;
  }, []);

  // --- Drop-Handler ------------------------------------------------------
  async function dropFileToElement(elId: string, file: File) {
    if (!file.type.startsWith("image/")) {
      flash("Bitte eine Bilddatei ablegen.", true);
      return;
    }
    const src = await fileToDataUrl(file);
    // Zoom/Position auf das neue Foto zuruecksetzen - eine fuer das alte
    // Foto passende Verschiebung/Zoomstufe passt nicht zum neuen Bild. z
    // immer auf die hinterste Ebene setzen, damit das Foto nie Formen/Text
    // verdeckt (auch falls es zuvor per "In den Vordergrund" verschoben war).
    patchElement(elId, {
      src,
      fit: "cover",
      imgScale: 1,
      imgX: 0,
      imgY: 0,
      z: IMAGE_Z,
    } as Partial<ImageElement>);
    setSelectedId(elId);
  }

  async function dropFileToCanvas(xFrac: number, yFrac: number, file: File) {
    if (!file.type.startsWith("image/")) {
      flash("Bitte eine Bilddatei ablegen.", true);
      return;
    }
    const src = await fileToDataUrl(file);
    const w = 0.34;
    const h = 0.26;
    // Fotos liegen immer auf der hintersten Ebene (siehe dropFileToElement).
    const newEl: ImageElement = {
      id: uid("el"),
      kind: "image",
      x: clamp(xFrac - w / 2, 0, 1 - w),
      y: clamp(yFrac - h / 2, 0, 1 - h),
      w,
      h,
      z: IMAGE_Z,
      src,
      fit: "cover",
    };
    const pageId = projectRef.current?.pages[pageIndex]?.id;
    mutatePages((pages) =>
      pages.map((pg) =>
        pg.id === pageId ? { ...pg, elements: [...pg.elements, newEl] } : pg,
      ),
    );
    setSelectedId(newEl.id);
  }

  function flash(msg: string, err = false) {
    setToast({ msg, err });
    window.setTimeout(() => setToast(null), err ? 5000 : 3500);
  }

  // Entfernt eine komplette Seite (nicht nur ein einzelnes Element) aus dem
  // Exposé - mit Rueckfrage, da nicht rueckgaengig zu machen. Verschiebt die
  // aktuelle Auswahl sinnvoll mit, falls die aktive oder eine davor liegende
  // Seite geloescht wird.
  function deletePage(index: number) {
    const cur = projectRef.current;
    if (!cur) return;
    if (cur.pages.length <= 1) {
      flash("Die letzte verbleibende Seite kann nicht gelöscht werden.", true);
      return;
    }
    const pg = cur.pages[index];
    if (!pg) return;
    if (
      !window.confirm(
        `Seite ${index + 1} ("${pg.title}") wirklich löschen? Das kann nicht rückgängig gemacht werden.`,
      )
    ) {
      return;
    }
    const newLen = cur.pages.length - 1;
    mutatePages((pages) => pages.filter((_, i) => i !== index));
    setSelectedId(null);
    setEditingId(null);
    setPageIndex((prev) => {
      if (prev > index) return prev - 1;
      if (prev === index) return Math.min(prev, newLen - 1);
      return prev;
    });
    flash("Seite gelöscht.");
  }

  // Speichert das Exposé sofort (statt auf den ueblichen Debounce fuer
  // laufende Interaktions-Edits zu warten) - gibt dem Nutzer eine
  // verlaessliche, sichtbare Bestaetigung, dass der aktuelle Stand wirklich
  // persistiert ist, statt sich auf das unsichtbare Auto-Save verlassen zu
  // muessen.
  async function handleSaveNow() {
    const cur = projectRef.current;
    if (!cur) return;
    setSaving(true);
    try {
      await saveProjectNow(cur);
      flash("Exposé gespeichert.");
    } catch (e) {
      flash(`Speichern fehlgeschlagen: ${(e as Error).message}`, true);
    } finally {
      setSaving(false);
    }
  }

  // Entfernt (uebermalt) den Bereich unter einem Platzhalter direkt aus dem
  // gesperrten 1:1-Hintergrund der Seite - das Foto ist danach wirklich weg,
  // nicht nur mit dem Platzhalter ueberdeckt.
  async function erasePhotoUnderSelected() {
    const cur = projectRef.current;
    if (!cur) return;
    const pg = cur.pages[pageIndex];
    const target = pg?.elements.find((e) => e.id === selectedId);
    if (!target || target.kind !== "image") return;
    const bg = pg.elements.find(
      (e) => e.kind === "image" && e.locked && (e as ImageElement).fromBoilerplate,
    ) as ImageElement | undefined;
    if (!bg) return;

    const rect = { x: target.x, y: target.y, w: target.w, h: target.h };
    const erased = await eraseRegionsFromImage(bg.src, [rect]);
    mutatePages((pages) =>
      pages.map((p) =>
        p.id === pg.id
          ? {
              ...p,
              elements: p.elements.map((e) =>
                e.id === bg.id ? ({ ...e, src: erased } as ImageElement) : e,
              ),
            }
          : p,
      ),
    );

    // Auch die GLOBALE Vorlage aktualisieren, sonst haette "Neu aufbauen"
    // wieder das Original-Foto (die globale Vorlage ist die Quelle beim
    // Neuaufbau). Nur Standardseiten haben eine Bild-Quelle - Inhaltsseiten
    // sind Vektor-Nachbauten ohne eingebettetes Foto.
    const source = pg.sourcePage;
    if (source?.kind === "boilerplate") {
      updateData((prev) => {
        if (!prev.boilerplate) return prev;
        return {
          ...prev,
          boilerplate: {
            ...prev.boilerplate,
            pages: prev.boilerplate.pages.map((bp) =>
              bp.id === source.id
                ? {
                    ...bp,
                    image: erased,
                    photoSlots: [...(bp.photoSlots ?? []), rect],
                  }
                : bp,
            ),
          },
        };
      });
    }

    flash("Foto aus dem Hintergrund entfernt.");
  }

  // Fuegt der aktuellen Seite manuell einen leeren Foto-Platzhalter hinzu -
  // unabhaengig von der KI-Erkennung. Nuetzlich, wenn auf einer Standardseite
  // (oder sonst wo) noch ein Foto sichtbar ist, das automatisch nicht erkannt
  // wurde: Platzhalter hinzufuegen, dann per Maus ueber das Foto ziehen.
  function addPlaceholder() {
    const w = 0.4;
    const h = 0.3;
    // Fotos liegen immer auf der hintersten Ebene (siehe dropFileToElement).
    const newEl: ImageElement = {
      id: uid("el"),
      kind: "image",
      x: (1 - w) / 2,
      y: (1 - h) / 2,
      w,
      h,
      z: IMAGE_Z,
      src: "",
      fit: "cover",
    };
    const pageId = projectRef.current?.pages[pageIndex]?.id;
    mutatePages((pages) =>
      pages.map((pg) =>
        pg.id === pageId ? { ...pg, elements: [...pg.elements, newEl] } : pg,
      ),
    );
    setSelectedId(newEl.id);
    setEditingId(null);
    flash("Platzhalter hinzugefügt – per Maus über das Foto ziehen und in der Größe anpassen.");
  }

  // Fuegt der aktuellen Seite manuell ein leeres, frei editierbares Textfeld
  // hinzu - nuetzlich, wenn an einer Stelle noch Originaltext sichtbar ist,
  // der automatisch nicht erkannt wurde.
  function addTextPlaceholder() {
    const w = 0.5;
    const h = 0.08;
    const newEl: TextElement = {
      id: uid("el"),
      kind: "text",
      x: (1 - w) / 2,
      y: (1 - h) / 2,
      w,
      h,
      z: maxZ() + 1,
      text: "",
      fontSize: 18,
      align: "left",
      color: "#1f2d3d",
      background: "rgba(0,0,0,0)",
      fontWeight: 400,
    };
    const pageId = projectRef.current?.pages[pageIndex]?.id;
    mutatePages((pages) =>
      pages.map((pg) =>
        pg.id === pageId ? { ...pg, elements: [...pg.elements, newEl] } : pg,
      ),
    );
    setSelectedId(newEl.id);
    setEditingId(newEl.id);
    flash("Textfeld hinzugefügt – Text eingeben, per Maus verschieben und in der Größe anpassen.");
  }

  // --- Generieren --------------------------------------------------------
  async function handleGenerate() {
    const cur = projectRef.current;
    if (!cur) return;
    if (!data.api.apiKey) {
      flash("Kein API-Key hinterlegt. Bitte im Datenbereich eintragen.", true);
      return;
    }
    // Befuellte Bilder (keine Logos/Boilerplate) PRO SEITE gruppieren - liegen
    // mehrere Fotos auf derselben Seite, bekommen sie GEMEINSAM einen
    // einzigen zusammenfassenden Text statt je einen eigenen Text pro Bild
    // (siehe generatePageText in ai.ts).
    const jobs: { pageIdx: number; imgs: ImageElement[] }[] = [];
    cur.pages.forEach((pg, idx) => {
      const imgs = pg.elements.filter(
        (e) => e.kind === "image" && (e as ImageElement).src && !(e as ImageElement).fromBoilerplate,
      ) as ImageElement[];
      if (imgs.length > 0) jobs.push({ pageIdx: idx, imgs });
    });

    if (jobs.length === 0) {
      flash("Bitte zuerst Bilder auf den Seiten platzieren.", true);
      return;
    }

    setProgress({ done: 0, total: jobs.length });
    let failures = 0;
    const totalImages = jobs.reduce((sum, j) => sum + j.imgs.length, 0);

    for (let i = 0; i < jobs.length; i++) {
      const { pageIdx, imgs } = jobs[i];
      setPageIndex(pageIdx);
      const ids = imgs.map((im) => im.id);
      setAnalyzingIds((s) => {
        const n = new Set(s);
        ids.forEach((id) => n.add(id));
        return n;
      });

      const res =
        imgs.length === 1
          ? await generateImageText(data.api, imgs[0].src, exType, data.styleTexts)
          : await generatePageText(data.api, imgs.map((im) => im.src), exType, data.styleTexts);

      setAnalyzingIds((s) => {
        const n = new Set(s);
        ids.forEach((id) => n.delete(id));
        return n;
      });

      if (res.ok) {
        const primaryIdx: number =
          "primaryIndex" in res && typeof res.primaryIndex === "number" ? res.primaryIndex : 0;
        const primary = imgs[primaryIdx] ?? imgs[0];
        applyGeneratedText(pageIdx, primary, res, ids);
      } else {
        failures++;
        flash(`Fehler bei einer Seite: ${res.message}`, true);
      }
      setProgress({ done: i + 1, total: jobs.length });
    }

    setProgress(null);
    if (failures === 0) {
      flash(`Fertig! ${jobs.length} Text${jobs.length > 1 ? "e" : ""} für ${totalImages} Bild${totalImages > 1 ? "er" : ""} generiert.`);
    } else {
      flash(
        `${jobs.length - failures} von ${jobs.length} Texten generiert (${failures} Fehler).`,
        true,
      );
    }
  }

  function applyGeneratedText(
    pageIdx: number,
    img: ImageElement,
    res: {
      headline: string;
      text: string;
      important: string;
      safeArea: { x: number; y: number; w: number; h: number };
    },
    // Bild-IDs, die durch diesen (ggf. zusammengefassten) Text abgedeckt
    // sind - bereits vorhandene generierte Texte zu JEDEM dieser Bilder
    // werden ersetzt, nicht nur zum primaeren Bild.
    coveredImageIds: string[] = [img.id],
  ) {
    const sa = res.safeArea;
    // Absolute Position der Textflaeche = innerhalb des Bildes.
    let bx = img.x + sa.x * img.w;
    let by = img.y + sa.y * img.h;
    let bw = sa.w * img.w;
    let bh = sa.h * img.h;
    // In Bildgrenzen halten + Mindestgroesse.
    bw = clamp(bw, 0.18, img.w);
    bh = clamp(bh, 0.1, img.h);
    bx = clamp(bx, img.x, img.x + img.w - bw);
    by = clamp(by, img.y, img.y + img.h - bh);

    const headline = res.headline.trim();
    const body = res.text.trim();
    const text = headline ? `${headline}\n${body}` : body;

    const fontSize = fitFontSize(text, bw * REF_W, bh * REF_H, {
      min: 9,
      max: 20,
      weight: 500,
    });
    // Sicherheitsnetz: passt der Text selbst bei der kleinsten Schriftgroesse
    // nicht in die vorgeschlagene Flaeche, die Box innerhalb des Bildes
    // vergroessern statt Schrift abzuschneiden.
    if (text.trim()) {
      const needed = fitTextBoxHeight(text, bw, fontSize, 500);
      if (needed > bh) bh = Math.min(needed, img.y + img.h - by);
    }

    const cur = projectRef.current;
    if (!cur) return;

    mutatePages((pages) =>
      pages.map((pg, idx) => {
        if (idx !== pageIdx) return pg;
        // Bestehenden generierten Text zu JEDEM abgedeckten Bild ersetzen
        // (bei mehreren Bildern auf der Seite ggf. mehrere alte Einzeltexte).
        const covered = new Set(coveredImageIds);
        const cleaned = pg.elements.filter(
          (e) =>
            !(
              (e.kind === "text" || e.kind === "heading") &&
              (e as TextElement).linkedImageId &&
              covered.has((e as TextElement).linkedImageId as string)
            ),
        );
        const newText: TextElement = {
          id: uid("el"),
          kind: "text",
          x: bx,
          y: by,
          w: bw,
          h: bh,
          z: maxZ() + 1,
          text,
          fontSize,
          align: "left",
          color: "#1f2d3d",
          background: EXPOSE_LIGHT_GREY,
          fontWeight: 500,
          linkedImageId: img.id,
          generated: true,
        };
        // Analyse am Bild vermerken.
        const withAnalysis = cleaned.map((e) =>
          e.id === img.id
            ? ({
                ...e,
                analysis: { important: res.important, safeArea: sa },
              } as ImageElement)
            : e,
        );
        return { ...pg, elements: [...withAnalysis, newText] };
      }),
    );
  }

  function rebuildFromStructure() {
    const layout = data.layouts[exType];
    const msg = layout
      ? "Aktuellen Aufbau verwerfen und neu aus den analysierten Beispielen aufbauen? Bereits platzierte Bilder und Texte gehen dabei verloren."
      : "Aktuellen Aufbau verwerfen und die Standardvorlage wiederherstellen? Bereits platzierte Bilder und Texte gehen dabei verloren.";
    if (!window.confirm(msg)) return;
    const proj = layout
      ? createProjectFromLayout(exType, layout, data.logo, data.boilerplate)
      : createProject(exType, data.logo, data.boilerplate);
    commit(proj);
    setPageIndex(0);
    setSelectedId(null);
    setEditingId(null);
    setStructureUpdate(false);
    flash(
      layout
        ? "Aufbau aus den Beispielen übernommen."
        : "Standardaufbau wiederhergestellt.",
    );
  }

  if (!project || !typeMeta) {
    return <div className="loading-screen">Exposé wird vorbereitet …</div>;
  }

  const hasLayout = !!data.layouts[exType];
  const page = project.pages[pageIndex];
  const selected = page.elements.find((e) => e.id === selectedId) ?? null;
  const hasImages = project.pages.some((pg) =>
    pg.elements.some((e) => e.kind === "image" && (e as ImageElement).src),
  );

  return (
    <div className="editor-shell">
      <header className="editor-header">
        <button className="btn btn-ghost" onClick={() => navigate("/")}>
          <IconArrowLeft size={18} /> Zurück
        </button>
        <span className="type-pill">{typeMeta.label}</span>
        <span className="title">{project.title}</span>
        {hasLayout && (
          <span className="badge badge-ok" title="Aufbau aus Beispiel-Exposés übernommen">
            Aufbau aus Beispiel
          </span>
        )}

        <div className="spacer" />

        {progress ? (
          <div className="gen-progress">
            <div className="gen-bar">
              <div style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            KI arbeitet … {progress.done}/{progress.total}
          </div>
        ) : (
          <span className="hint">
            {hasImages
              ? "Bereit zum Generieren"
              : "Bilder per Drag & Drop auf die Seiten ziehen"}
          </span>
        )}

        <button
          className="btn btn-ghost"
          onClick={addPlaceholder}
          disabled={!!progress}
          title="Leeren Foto-Platzhalter auf dieser Seite hinzufügen (z.B. über ein verbliebenes Foto ziehen)"
        >
          <IconImage size={18} /> Platzhalter
        </button>
        <button
          className="btn btn-ghost"
          onClick={addTextPlaceholder}
          disabled={!!progress}
          title="Leeres Textfeld auf dieser Seite hinzufügen (z.B. für einen entfernten Titel/Text)"
        >
          <IconText size={18} /> Textfeld
        </button>
        <button
          className="btn btn-ghost"
          onClick={rebuildFromStructure}
          disabled={!!progress}
          title={
            hasLayout
              ? "Seiten neu aus den analysierten Beispielen aufbauen"
              : "Standardaufbau wiederherstellen"
          }
        >
          Neu aufbauen
        </button>
        <button
          className="btn btn-outline"
          onClick={handleSaveNow}
          disabled={saving}
          title="Aktuellen Stand des Exposés sofort speichern"
        >
          <IconCheck size={18} /> {saving ? "Speichert …" : "Speichern"}
        </button>
        <button
          className="btn btn-outline"
          onClick={() => window.print()}
          title="Als PDF exportieren"
        >
          <IconDownload size={18} /> Export
        </button>
        <button
          className="btn btn-generate btn-lg"
          onClick={handleGenerate}
          disabled={!!progress}
        >
          <IconSparkle size={18} /> Generieren
        </button>
      </header>

      {structureUpdate && (
        <div className="structure-banner">
          <span>
            <strong>Neue Struktur aus Ihrem Beispiel verfügbar.</strong> Ihr
            aktuelles Exposé nutzt noch den alten Aufbau. Übernehmen? (Platzierte
            Bilder gehen dabei verloren.)
          </span>
          <div className="row">
            <button className="btn btn-primary" onClick={rebuildFromStructure}>
              Neue Struktur übernehmen
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setStructureUpdate(false)}
            >
              Später
            </button>
          </div>
        </div>
      )}

      <div className="editor-body">
        <div className="canvas-viewport" ref={viewportRef}>
          {!hasImages && (
            <div className="editor-empty-hint">
              Ziehen Sie Bilder auf die Bildflächen – dann „Generieren" klicken
            </div>
          )}
          <div className="page-shadow">
            <PageCanvas
              page={page}
              width={canvasWidth}
              editable={!progress}
              selectedId={selectedId}
              editingId={editingId}
              analyzingIds={analyzingIds}
              onSelect={(id) => {
                setSelectedId(id);
                if (id !== editingId) setEditingId(null);
              }}
              onChange={patchElement}
              onStartEdit={(id) => {
                setSelectedId(id);
                setEditingId(id);
              }}
              onCommitText={(id, text) => {
                patchTextGrow(id, { text });
                setEditingId(null);
              }}
              onDropFileToElement={dropFileToElement}
              onDropFileToCanvas={dropFileToCanvas}
            />
          </div>
          <div className="canvas-caption">
            Seite {pageIndex + 1} von {project.pages.length} · {page.title}
          </div>

          {selected && !selected.locked && (
            <Inspector
              element={selected}
              onPatch={(patch) =>
                selected.kind === "text" || selected.kind === "heading"
                  ? patchTextGrow(selected.id, patch as Partial<TextElement>)
                  : patchElement(selected.id, patch)
              }
              onDelete={() => deleteElement(selected.id)}
              onEdit={() => {
                setEditingId(selected.id);
              }}
              onFront={() => patchElement(selected.id, { z: maxZ() + 1 })}
              onErasePhoto={
                selected.kind === "image" &&
                page.elements.some(
                  (e) =>
                    e.kind === "image" &&
                    e.locked &&
                    (e as ImageElement).fromBoilerplate,
                )
                  ? erasePhotoUnderSelected
                  : undefined
              }
            />
          )}
        </div>

        <aside className="thumb-rail" style={{ width: thumbRailWidth }}>
          <div
            className="thumb-rail-resizer"
            onPointerDown={onThumbRailResizeStart}
            title="Breite der Miniaturansichten ziehen"
          />
          <h4>Seiten</h4>
          {project.pages.map((pg, i) => (
            <div
              key={pg.id}
              className={`thumb ${i === pageIndex ? "active" : ""}`}
              onClick={() => {
                setPageIndex(i);
                setSelectedId(null);
                setEditingId(null);
              }}
            >
              <div className="frame">
                <PageCanvas
                  page={pg}
                  width={thumbRailWidth - THUMB_RAIL_PADDING}
                  editable={false}
                  selectedId={null}
                  editingId={null}
                  analyzingIds={analyzingIds}
                  onSelect={() => {}}
                  onChange={() => {}}
                  onStartEdit={() => {}}
                  onCommitText={() => {}}
                  onDropFileToElement={() => {}}
                  onDropFileToCanvas={() => {}}
                />
                <button
                  type="button"
                  className="thumb-delete-btn"
                  title="Seite löschen"
                  onClick={(e) => {
                    e.stopPropagation();
                    deletePage(i);
                  }}
                >
                  <IconTrash size={13} />
                </button>
              </div>
              <div className="num-label">
                {i + 1} · {pg.title}
              </div>
            </div>
          ))}
        </aside>
      </div>

      {toast && (
        <div className={`gen-toast ${toast.err ? "err" : ""}`}>
          {!toast.err && <IconCheck size={16} />} {toast.msg}
        </div>
      )}

      {/* Druck-/Export-Ansicht (nur beim Drucken sichtbar) */}
      <PrintView project={project} />
    </div>
  );
}

// --- Inspector -----------------------------------------------------------
function Inspector({
  element,
  onPatch,
  onDelete,
  onEdit,
  onFront,
  onErasePhoto,
}: {
  element: PageElement;
  onPatch: (patch: Partial<PageElement>) => void;
  onDelete: () => void;
  onEdit: () => void;
  onFront: () => void;
  onErasePhoto?: () => void;
}) {
  const isText = element.kind === "text" || element.kind === "heading";
  const t = element as TextElement;
  const img = element as ImageElement;
  const shape = element as ShapeElement;

  return (
    <div className="inspector" onPointerDown={(e) => e.stopPropagation()}>
      {element.kind === "shape" && (
        <div className="grp">
          <span className="lbl">Farbe</span>
          <input
            type="color"
            className="color-input"
            value={/^#[0-9a-fA-F]{6}$/.test(shape.color) ? shape.color : "#c8a04b"}
            onChange={(e) => onPatch({ color: e.target.value } as Partial<ShapeElement>)}
          />
        </div>
      )}

      {isText && (
        <>
          <div className="grp">
            {(["left", "center", "right"] as const).map((a) => (
              <button
                key={a}
                className={`tool ${t.align === a ? "active" : ""}`}
                onClick={() => onPatch({ align: a } as Partial<TextElement>)}
                title={`Ausrichtung ${a}`}
              >
                {a === "left" ? "⯇" : a === "center" ? "≡" : "⯈"}
              </button>
            ))}
          </div>
          <div className="sep" />
          <div className="grp">
            <span className="lbl">Schrift</span>
            <button
              className="tool"
              onClick={() =>
                onPatch({ fontSize: Math.max(8, t.fontSize - 2) } as Partial<TextElement>)
              }
            >
              −
            </button>
            <span className="lbl">{Math.round(t.fontSize)}</span>
            <button
              className="tool"
              onClick={() =>
                onPatch({ fontSize: t.fontSize + 2 } as Partial<TextElement>)
              }
            >
              +
            </button>
          </div>
          <div className="sep" />
          <div className="grp">
            <span className="lbl">Schriftart</span>
            {EXPOSE_FONTS.map((f) => (
              <button
                key={f.label}
                className={`tool ${(t.fontFamily || undefined) === f.value ? "active" : ""}`}
                style={{ fontFamily: f.value, fontSize: f.value ? 18 : 14 }}
                onClick={() => onPatch({ fontFamily: f.value } as Partial<TextElement>)}
                title={f.label}
              >
                Aa
              </button>
            ))}
          </div>
          <div className="sep" />
          <div className="grp">
            <span className="lbl">Farbe</span>
            {EXPOSE_TEXT_COLORS.map((c) => (
              <button
                key={c.value}
                className={`swatch ${t.color === c.value ? "active" : ""}`}
                style={{ background: c.value }}
                onClick={() => onPatch({ color: c.value } as Partial<TextElement>)}
                title={c.label}
              />
            ))}
            <input
              type="color"
              className="color-input"
              value={/^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color : "#1f2d3d"}
              onChange={(e) => onPatch({ color: e.target.value } as Partial<TextElement>)}
              title="Eigene Farbe"
            />
          </div>
          <div className="sep" />
          <div className="grp">
            <span className="lbl">Fläche</span>
            <button
              className={`tool ${
                t.background.startsWith("rgba(0,0,0,0") ? "" : "active"
              }`}
              onClick={() =>
                onPatch({
                  background: t.background.startsWith("rgba(0,0,0,0")
                    ? EXPOSE_LIGHT_GREY
                    : "rgba(0,0,0,0)",
                } as Partial<TextElement>)
              }
              title="Hintergrundfläche an/aus"
            >
              ▢
            </button>
          </div>
          <div className="sep" />
          <button className="btn btn-ghost" onClick={onEdit}>
            Text bearbeiten
          </button>
        </>
      )}

      {element.kind === "image" && (
        <div className="grp">
          <span className="lbl">Bild</span>
          <button
            className={`tool ${img.fit === "cover" ? "active" : ""}`}
            onClick={() => onPatch({ fit: "cover" } as Partial<ImageElement>)}
            title="Füllen"
          >
            ⬛
          </button>
          <button
            className={`tool ${img.fit === "contain" ? "active" : ""}`}
            onClick={() => onPatch({ fit: "contain" } as Partial<ImageElement>)}
            title="Einpassen"
          >
            ▭
          </button>
        </div>
      )}

      {element.kind === "image" && img.src && (
        <>
          <div className="sep" />
          <div className="grp">
            <span className="lbl">Zoom</span>
            <button
              className="tool"
              onClick={() => {
                const next = Math.max(1, (img.imgScale ?? 1) - 0.15);
                const bound = Math.max(0, (next - 1) / 2);
                onPatch({
                  imgScale: next,
                  imgX: Math.min(Math.max(img.imgX ?? 0, -bound), bound),
                  imgY: Math.min(Math.max(img.imgY ?? 0, -bound), bound),
                } as Partial<ImageElement>);
              }}
            >
              −
            </button>
            <span className="lbl">{Math.round((img.imgScale ?? 1) * 100)}%</span>
            <button
              className="tool"
              onClick={() => {
                const next = Math.min(4, (img.imgScale ?? 1) + 0.15);
                onPatch({ imgScale: next } as Partial<ImageElement>);
              }}
            >
              +
            </button>
          </div>
          <div className="sep" />
          <button className="btn btn-ghost" onClick={onEdit}>
            Bild anpassen
          </button>
        </>
      )}

      {onErasePhoto && (
        <>
          <div className="sep" />
          <button
            className="btn btn-ghost"
            onClick={onErasePhoto}
            title="Das Originalfoto an dieser Stelle aus dem Hintergrund entfernen (nicht nur überdecken)"
          >
            Foto entfernen
          </button>
        </>
      )}

      <div className="sep" />
      <button className="tool" onClick={onFront} title="In den Vordergrund">
        ⬆
      </button>
      <button
        className="btn btn-danger"
        onClick={onDelete}
        title={
          element.kind === "image" && img.src
            ? "Foto entfernen (Platzhalter bleibt erhalten)"
            : "Element löschen"
        }
      >
        <IconTrash size={16} />
      </button>
    </div>
  );
}

// --- Druckansicht --------------------------------------------------------
function PrintView({ project }: { project: ExposeProject }) {
  return (
    <div className="print-root">
      {project.pages.map((pg) => (
        <div className="print-page" key={pg.id}>
          <PageCanvas
            page={pg}
            width={REF_W}
            editable={false}
            selectedId={null}
            editingId={null}
            analyzingIds={new Set()}
            onSelect={() => {}}
            onChange={() => {}}
            onStartEdit={() => {}}
            onCommitText={() => {}}
            onDropFileToElement={() => {}}
            onDropFileToCanvas={() => {}}
          />
        </div>
      ))}
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApp } from "../context/AppContext";
import {
  EXPOSE_TYPES,
  type ExposeProject,
  type ExposeType,
  type ImageElement,
  type PageElement,
  type TextElement,
} from "../lib/types";
import {
  createProject,
  createProjectFromLayout,
  projectStamp,
} from "../lib/templates";
import { loadProject, saveProject } from "../lib/storage";
import { generateImageText } from "../lib/ai";
import { clamp, fileToDataUrl, uid } from "../lib/util";
import { fitFontSize } from "../editor/fit";
import { REF_H, REF_W } from "../editor/constants";
import { PageCanvas } from "../editor/PageCanvas";
import {
  IconArrowLeft,
  IconCheck,
  IconDownload,
  IconSparkle,
  IconTrash,
} from "../components/Icons";
import "./EditorPage.css";

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
  const { data } = useApp();
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
  const [canvasWidth, setCanvasWidth] = useState(560);
  // Es liegt eine neuere Beispiel-Struktur vor als das offene Projekt.
  const [structureUpdate, setStructureUpdate] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

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
      if (existing && existing.builtFrom !== stamp && (layout || bp)) {
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

  const deleteElement = useCallback(
    (elId: string) => {
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
    [mutatePages],
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
    patchElement(elId, { src, fit: "cover" } as Partial<ImageElement>);
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
    const newEl: ImageElement = {
      id: uid("el"),
      kind: "image",
      x: clamp(xFrac - w / 2, 0, 1 - w),
      y: clamp(yFrac - h / 2, 0, 1 - h),
      w,
      h,
      z: maxZ() + 1,
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

  // --- Generieren --------------------------------------------------------
  async function handleGenerate() {
    const cur = projectRef.current;
    if (!cur) return;
    if (!data.api.apiKey) {
      flash("Kein API-Key hinterlegt. Bitte im Datenbereich eintragen.", true);
      return;
    }
    // Alle befuellten Bilder (keine Logos) sammeln.
    const jobs: { pageIdx: number; img: ImageElement }[] = [];
    cur.pages.forEach((pg, idx) => {
      for (const e of pg.elements) {
        if (
          e.kind === "image" &&
          (e as ImageElement).src &&
          !(e as ImageElement).fromBoilerplate
        ) {
          jobs.push({ pageIdx: idx, img: e as ImageElement });
        }
      }
    });

    if (jobs.length === 0) {
      flash("Bitte zuerst Bilder auf den Seiten platzieren.", true);
      return;
    }

    setProgress({ done: 0, total: jobs.length });
    let failures = 0;

    for (let i = 0; i < jobs.length; i++) {
      const { pageIdx, img } = jobs[i];
      setPageIndex(pageIdx);
      setAnalyzingIds((s) => new Set(s).add(img.id));

      const res = await generateImageText(data.api, img.src, exType, data.styleTexts);

      setAnalyzingIds((s) => {
        const n = new Set(s);
        n.delete(img.id);
        return n;
      });

      if (res.ok) {
        applyGeneratedText(pageIdx, img, res);
      } else {
        failures++;
        flash(`Fehler bei einem Bild: ${res.message}`, true);
      }
      setProgress({ done: i + 1, total: jobs.length });
    }

    setProgress(null);
    if (failures === 0) {
      flash(`Fertig! ${jobs.length} Text${jobs.length > 1 ? "e" : ""} generiert.`);
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

    const cur = projectRef.current;
    if (!cur) return;

    mutatePages((pages) =>
      pages.map((pg, idx) => {
        if (idx !== pageIdx) return pg;
        // Bestehenden generierten Text zu diesem Bild ersetzen.
        const cleaned = pg.elements.filter(
          (e) =>
            !(
              (e.kind === "text" || e.kind === "heading") &&
              (e as TextElement).linkedImageId === img.id
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
          background: "rgba(255,255,255,0.86)",
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
                patchElement(id, { text } as Partial<TextElement>);
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
              onPatch={(patch) => patchElement(selected.id, patch)}
              onDelete={() => deleteElement(selected.id)}
              onEdit={() => {
                setEditingId(selected.id);
              }}
              onFront={() => patchElement(selected.id, { z: maxZ() + 1 })}
            />
          )}
        </div>

        <aside className="thumb-rail">
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
                  width={162}
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
}: {
  element: PageElement;
  onPatch: (patch: Partial<PageElement>) => void;
  onDelete: () => void;
  onEdit: () => void;
  onFront: () => void;
}) {
  const isText = element.kind === "text" || element.kind === "heading";
  const t = element as TextElement;
  const img = element as ImageElement;

  return (
    <div className="inspector" onPointerDown={(e) => e.stopPropagation()}>
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
            <span className="lbl">Fläche</span>
            <button
              className={`tool ${
                t.background.startsWith("rgba(0,0,0,0") ? "" : "active"
              }`}
              onClick={() =>
                onPatch({
                  background: t.background.startsWith("rgba(0,0,0,0")
                    ? "rgba(255,255,255,0.86)"
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

      <div className="sep" />
      <button className="tool" onClick={onFront} title="In den Vordergrund">
        ⬆
      </button>
      <button className="btn btn-danger" onClick={onDelete}>
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

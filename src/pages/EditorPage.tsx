import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { pdfFirstPageToImage } from "../lib/pdf";
import { clamp, fileToDataUrl, uid } from "../lib/util";
import {
  ensureScriptFontLoaded,
  fitFontSize,
  fitTextBoxHeight,
  fitTextBoxWidth,
} from "../editor/fit";
import { REF_H, REF_W } from "../editor/constants";
import { findPanel, panelBox } from "../editor/panels";
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

// Zoomgrenzen und Schrittweite je Mausrad-Raste (Strg/Cmd+Mausrad).
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.12;
// Mausrad-Rasten innerhalb dieser Zeit und ohne nennenswerte Mausbewegung
// gelten als EINE zusammenhaengende Zoom-Geste mit gemeinsamem Ankerpunkt.
const ZOOM_GESTURE_MS = 600;
const ZOOM_ANCHOR_TOLERANCE = 6;

// Stabile leere Auswahl fuer die nicht-interaktiven PageCanvas-Instanzen
// (Miniaturansichten, Druckansicht) - vermeidet, bei jedem Render ein neues
// Set anzulegen.
const EMPTY_SELECTION = new Set<string>();

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
  // Erst wenn beides steht, rendert die Komponente den Editor (siehe frueher
  // Rueckgabewert weiter unten) - vorher existieren Viewport/Seitenflaeche
  // noch nicht, an die sich Listener haengen liessen.
  const editorReady = !!project && !!typeMeta;
  const projectRef = useRef<ExposeProject | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  // Mehrfachauswahl: per Auswahlrahmen (Marquee) oder Strg/Cmd+Klick koennen
  // mehrere Elemente gleichzeitig ausgewaehlt sein. "selectedId" bleibt als
  // abgeleiteter Wert erhalten (nur gesetzt, wenn GENAU EIN Element
  // ausgewaehlt ist) - alle bisherigen, auf Einzelauswahl ausgelegten
  // Stellen (Werkzeugleiste, Loeschen, Ebenen …) funktionieren dadurch
  // unveraendert weiter und sind einfach inaktiv, solange 0 oder mehrere
  // Elemente ausgewaehlt sind.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedId = selectedIds.size === 1 ? Array.from(selectedIds)[0] : null;
  function selectSingle(id: string | null) {
    setSelectedIds(id ? new Set([id]) : new Set());
  }
  const [editingId, setEditingId] = useState<string | null>(null);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  // Grundbreite der Seitenansicht (aus der Fenstergroesse) und der davon
  // getrennte, per Strg/Cmd+Mausrad einstellbare Zoom. Die eigentliche
  // Darstellungsbreite ist das Produkt aus beidem - PageCanvas skaliert
  // saemtliche Inhalte ueber diese eine Breite (siehe scale dort), darum
  // genuegt das fuer einen sauberen, scharf gerenderten Zoom.
  const [baseCanvasWidth, setBaseCanvasWidth] = useState(560);
  const [zoom, setZoom] = useState(1);
  const canvasWidth = Math.round(baseCanvasWidth * zoom);
  const [thumbRailWidth, setThumbRailWidth] = useState(loadThumbRailWidth);
  // Es liegt eine neuere Beispiel-Struktur vor als das offene Projekt.
  const [structureUpdate, setStructureUpdate] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pageShadowRef = useRef<HTMLDivElement>(null);
  // Punkt unter dem Mauszeiger beim Zoomen (Anteil der Seite + Bildschirm-
  // position), damit er nach dem Neuaufbau wieder dorthin geschoben wird.
  const zoomAnchorRef = useRef<{
    fx: number;
    fy: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  // Haelt den Ankerpunkt ueber eine zusammenhaengende Zoom-Geste hinweg fest
  // (siehe ausfuehrliche Begruendung im wheel-Handler).
  const zoomGestureRef = useRef<{
    fx: number;
    fy: number;
    clientX: number;
    clientY: number;
    t: number;
  } | null>(null);

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
      // Auch hier gilt: die Standardseiten werden im neuen Design aufgebaut
      // und ihre Ueberschriften dafuer mit der Schwungschrift ausgemessen -
      // die muss dafuer geladen sein (siehe ensureScriptFontLoaded).
      await ensureScriptFontLoaded();
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

  // Canvas-Grundbreite an Viewport anpassen.
  useLayoutEffect(() => {
    function measure() {
      const w = viewportRef.current?.clientWidth ?? 700;
      setBaseCanvasWidth(clamp(w - 60, 320, 720));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Zoom per Strg/Cmd+Mausrad - zoomt AUSSCHLIESSLICH die Seitenansicht,
  // nicht die Oberflaeche: der Browser-Zoom (der auch die Bearbeitungsleiste
  // und alles andere mitskalieren wuerde) wird dafuer per preventDefault
  // unterdrueckt. Der Listener wird bewusst nativ und nicht-passiv registriert
  // - React haengt wheel-Handler am Wurzelelement passiv ein, dort waere
  // preventDefault wirkungslos.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return; // normales Scrollen unangetastet
      e.preventDefault();
      const pageEl = pageShadowRef.current;
      if (!pageEl) return;
      // Punkt unter dem Mauszeiger als Anteil der Seite merken - nach dem
      // Neuaufbau wird genau dieser Punkt wieder unter die Maus geschoben,
      // dadurch zoomt die Ansicht in den Bereich, auf den man zeigt.
      //
      // Dieser Anteil wird pro Zoom-GESTE nur EINMAL bestimmt und danach
      // festgehalten: solange die Seite noch vollstaendig in den sichtbaren
      // Bereich passt, gibt es nichts zu scrollen, die Seite verschiebt sich
      // beim Vergroessern also zwangslaeufig unter dem stehenden Mauszeiger.
      // Wuerde man den Anteil bei jeder Mausrad-Raste neu messen, wanderte
      // der Ankerpunkt genau um diesen Betrag mit (gemessen: 0,25 -> 0,36
      // ueber zehn Rasten) und man landete am Ende woanders als gezeigt.
      const r = pageEl.getBoundingClientRect();
      const now = performance.now();
      const prev = zoomGestureRef.current;
      const sameGesture =
        prev !== null &&
        now - prev.t < ZOOM_GESTURE_MS &&
        Math.abs(e.clientX - prev.clientX) <= ZOOM_ANCHOR_TOLERANCE &&
        Math.abs(e.clientY - prev.clientY) <= ZOOM_ANCHOR_TOLERANCE;
      const fx = sameGesture ? prev.fx : (e.clientX - r.left) / r.width;
      const fy = sameGesture ? prev.fy : (e.clientY - r.top) / r.height;
      zoomGestureRef.current = { fx, fy, clientX: e.clientX, clientY: e.clientY, t: now };
      zoomAnchorRef.current = { fx, fy, clientX: e.clientX, clientY: e.clientY };
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setZoom((z) => clamp(z * factor, MIN_ZOOM, MAX_ZOOM));
    }
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
    // Abhaengig von editorReady: solange das Projekt laedt, zeigt die
    // Komponente nur den Ladebildschirm - der Viewport existiert dann noch
    // gar nicht und der Listener liesse sich nicht anhaengen.
  }, [editorReady]);

  // Nach dem Zoom den gemerkten Punkt wieder unter den Mauszeiger schieben.
  // Muss VOR dem Zeichnen laufen (useLayoutEffect), sonst waere ein Sprung
  // sichtbar.
  useLayoutEffect(() => {
    const a = zoomAnchorRef.current;
    const vp = viewportRef.current;
    const pageEl = pageShadowRef.current;
    if (!a || !vp || !pageEl) return;
    zoomAnchorRef.current = null;
    const r = pageEl.getBoundingClientRect();
    const vpRect = vp.getBoundingClientRect();
    // Position der Seite INNERHALB des scrollbaren Inhalts (unabhaengig vom
    // aktuellen Scrollstand) - daraus laesst sich der Zielscrollwert absolut
    // berechnen. Bewusst absolut statt relativ ("scrollLeft += ..."): solange
    // die Seite noch in den sichtbaren Bereich passt, gibt es nichts zu
    // scrollen und der Browser kappt den Wert. Bei relativer Rechnung bliebe
    // dieser gekappte Anteil dauerhaft als Versatz stehen und wuerde sich
    // ueber mehrere Zoomschritte aufsummieren; absolut gerechnet stimmt die
    // Position wieder exakt, sobald genug Scrollraum da ist.
    const contentX = r.left + vp.scrollLeft - vpRect.left;
    const contentY = r.top + vp.scrollTop - vpRect.top;
    vp.scrollLeft = contentX + a.fx * r.width - (a.clientX - vpRect.left);
    vp.scrollTop = contentY + a.fy * r.height - (a.clientY - vpRect.top);
  }, [canvasWidth]);

  // Hochgeladene Fotos nach Datei-ID - Grundlage fuer das Durchschalten der
  // Fotos desselben Raums im Bild (siehe ImageElement.altFileIds). Bewusst aus
  // dem Datenbestand statt aus dem Exposé: so liegt jedes Foto nur EINMAL im
  // Speicher, nicht zusaetzlich als Kopie an jedem Bildelement.
  const photoById = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of data.kiExposeFiles[exType] ?? []) {
      if (f.mime.startsWith("image/")) out[f.id] = f.dataUrl;
    }
    return out;
  }, [data.kiExposeFiles, exType]);

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

  // Ergaenzt zu den angeforderten Aenderungen die ihrer Hintergrundboxen:
  // aendert ein Textfeld Groesse oder Position, folgt die farbige Flaeche
  // dahinter mit unveraendertem Innenabstand (siehe editor/panels.ts).
  const withPanelPatches = useCallback(
    (patches: { id: string; patch: Partial<PageElement> }[]) => {
      const cur = projectRef.current;
      if (!cur) return patches;
      const extra: { id: string; patch: Partial<PageElement> }[] = [];
      for (const pg of cur.pages) {
        for (const { id, patch } of patches) {
          const el = pg.elements.find((e) => e.id === id);
          // Nur FREITEXTE (Objekt-/Fotobeschreibungen). Ueberschriften bleiben
          // ausdruecklich aussen vor: ihre Flaeche ist Teil des Seitenaufbaus
          // und soll sich nicht mitverschieben oder -veraendern.
          if (!el || el.kind !== "text") continue;
          const before = { x: el.x, y: el.y, w: el.w, h: el.h };
          const after = {
            x: (patch as Partial<TextElement>).x ?? el.x,
            y: (patch as Partial<TextElement>).y ?? el.y,
            w: (patch as Partial<TextElement>).w ?? el.w,
            h: (patch as Partial<TextElement>).h ?? el.h,
          };
          if (
            after.x === before.x &&
            after.y === before.y &&
            after.w === before.w &&
            after.h === before.h
          ) {
            continue;
          }
          const panel = findPanel(pg.elements, el as TextElement);
          // Ist die Flaeche selbst Teil der Aenderung (z.B. weil beide
          // gemeinsam ausgewaehlt verschoben werden), waere ein zweiter
          // Patch eine doppelte Verschiebung.
          if (!panel || patches.some((p) => p.id === panel.id)) continue;
          extra.push({ id: panel.id, patch: panelBox(panel, before, after) });
        }
      }
      return extra.length > 0 ? [...patches, ...extra] : patches;
    },
    [],
  );

  const patchElement = useCallback(
    (elId: string, patch: Partial<PageElement>) => {
      const all = withPanelPatches([{ id: elId, patch }]);
      mutatePages((pages) =>
        pages.map((pg) => ({
          ...pg,
          elements: pg.elements.map((e) => {
            const p = all.find((x) => x.id === e.id);
            return p ? ({ ...e, ...p.patch } as PageElement) : e;
          }),
        })),
      );
    },
    [mutatePages, withPanelPatches],
  );

  // Bild auf Seitengroesse schalten - und beim erneuten Aufruf wieder auf
  // seinen Platz im Layout zurueck (die vorherige Groesse steht solange am
  // Element, siehe ImageElement.prevBox).
  //
  // Das seitenfuellende Bild wandert dabei hinter ALLE anderen Elemente der
  // Seite: laege es oben, verdeckte es Ueberschriften, Texte und Farbflaechen
  // vollstaendig und die Seite waere nur noch ein Foto.
  const toggleFullPage = useCallback(
    (elId: string) => {
      mutatePages((pages) =>
        pages.map((pg) => {
          const current = pg.elements.find((e) => e.id === elId);
          if (!current || current.kind !== "image") return pg;

          // Zurueck auf die vorherige Groesse: betrifft NUR dieses Element,
          // die Ebenen der uebrigen bleiben unangetastet.
          const prev = (current as ImageElement).prevBox;
          if (prev) {
            return {
              ...pg,
              elements: pg.elements.map((e) =>
                e.id === elId
                  ? { ...(e as ImageElement), ...prev, prevBox: undefined }
                  : e,
              ),
            };
          }

          const minZ = Math.min(...pg.elements.map((e) => e.z));
          // Ziel-Ebene liegt unter allen anderen. Negative Ebenen sind dabei
          // NICHT brauchbar: ein Element mit negativem z-index wird vom
          // Hintergrund der Seite ueberdeckt und ist damit unsichtbar. Faellt
          // die Ziel-Ebene unter 0, wandern darum alle Elemente der Seite um
          // denselben Betrag nach oben - die Reihenfolge bleibt gleich.
          const target = minZ - 1;
          const shift = target < 0 ? -target : 0;
          return {
            ...pg,
            elements: pg.elements.map((e) => {
              if (e.id !== elId || e.kind !== "image") {
                return shift ? { ...e, z: e.z + shift } : e;
              }
              const img = e as ImageElement;
              return {
                ...img,
                prevBox: { x: img.x, y: img.y, w: img.w, h: img.h, z: img.z + shift },
                x: 0,
                y: 0,
                w: 1,
                h: 1,
                z: target + shift,
              };
            }),
          };
        }),
      );
    },
    [mutatePages],
  );

  // Wie patchElement, aber fuer mehrere Elemente auf einmal (EIN gemeinsamer
  // Commit statt N einzelner) - fuer den gemeinsamen Verschiebe-Vorgang einer
  // Mehrfachauswahl (siehe PageCanvas.tsx/beginGroupDrag).
  const patchElements = useCallback(
    (rawPatches: { id: string; patch: Partial<PageElement> }[]) => {
      const patches = withPanelPatches(rawPatches);
      mutatePages((pages) =>
        pages.map((pg) => ({
          ...pg,
          elements: pg.elements.map((e) => {
            const p = patches.find((x) => x.id === e.id);
            return p ? ({ ...e, ...p.patch } as PageElement) : e;
          }),
        })),
      );
    },
    [mutatePages, withPanelPatches],
  );

  // Wie patchElement, aber fuer Textfelder: bei laengerem Text (oder
  // groesserer Schrift) waechst zuerst die BREITE (bis zum Seitenrand),
  // NICHT die Hoehe - ein Textfeld soll bei mehr Inhalt primaer breiter
  // werden statt unnoetig mehrzeilig umzubrechen und dadurch immer hoeher
  // zu werden. Breite UND Hoehe wachsen dabei nur, falls der Text sonst
  // abgeschnitten wuerde - eine vom Nutzer manuell (per Eckgriff) gesetzte
  // Groesse, auch kleiner als der Textbedarf, wird nie eigenmaechtig wieder
  // veraendert. Die Schriftgroesse selbst wird hier nie veraendert.
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
      // Nur neu einpassen, wenn sich Text ODER Schriftgroesse/-art
      // tatsaechlich aendern (das beeinflusst, wieviel Platz noetig ist) -
      // NICHT bei jeder Inspector-Aenderung (Farbe, Ausrichtung, Flaeche
      // usw. laufen ebenfalls ueber patchTextGrow). Sonst wuerde z.B. ein
      // Klick auf eine Textfarbe die vom Nutzer manuell gesetzte Groesse
      // ungefragt mit veraendern.
      const affectsSize =
        ("text" in patch && patch.text !== el.text) ||
        ("fontSize" in patch && patch.fontSize !== el.fontSize) ||
        ("fontFamily" in patch && patch.fontFamily !== el.fontFamily);
      if (affectsSize && merged.text.trim()) {
        // Breite darf nicht in ein anderes Element hineinwachsen, das
        // rechts daneben liegt und sich vertikal mit dieser Box ueberlappt
        // (z.B. ein Foto neben einer zweispaltigen Textspalte) - sonst
        // wuerde laengerer Text die Nachbarflaeche verdecken.
        const GAP = 0.02;
        let maxW = 1 - merged.x;
        for (const n of cur?.pages[pageIndex]?.elements ?? []) {
          if (n.id === elId) continue;
          const overlapsVertically = n.y < merged.y + merged.h && n.y + n.h > merged.y;
          const isToRight = n.x >= merged.x + merged.w - 0.001;
          if (overlapsVertically && isToRight) maxW = Math.min(maxW, n.x - merged.x - GAP);
        }
        // Nur FREITEXTE sind mit ihrer Hintergrundbox gekoppelt -
        // Ueberschriften verhalten sich unveraendert wie zuvor.
        const isFreeText = el.kind === "text";
        // Hat der Text eine farbige Box hinter sich, muss deren Rand mit auf
        // die Seite passen: der Text darf darum nur so weit wachsen, dass die
        // Box samt Innenabstand noch vollstaendig auf dem Blatt liegt.
        // Sonst waere die Box an der Seitenkante abgeschnitten und der
        // Innenabstand auf dieser Seite verschwaende.
        const panel = isFreeText ? findPanel(cur?.pages[pageIndex]?.elements ?? [], el) : null;
        const padR = panel ? Math.max(0, panel.x + panel.w - (el.x + el.w)) : 0;
        const padB = panel ? Math.max(0, panel.y + panel.h - (el.y + el.h)) : 0;
        maxW = Math.min(maxW, 1 - merged.x - padR);
        maxW = Math.max(merged.w, maxW);
        // Wird bei einem FREITEXT die Schriftgroesse (oder -art) geaendert,
        // folgt die Box in beide Richtungen: sie waechst mit groesserer
        // Schrift und schrumpft mit kleinerer wieder auf das noetige Mass.
        // Nur so kann die farbige Flaeche dahinter mitgehen, statt beim
        // Verkleinern zu gross stehen zu bleiben (siehe editor/panels.ts).
        //
        // Beim Aendern des TEXTES - und bei Ueberschriften generell - bleibt
        // es beim bisherigen Verhalten: dort wird nur gewachsen, damit eine
        // per Eckgriff gesetzte Groesse nicht ungefragt eingerissen wird.
        const sizeChanged =
          isFreeText &&
          (("fontSize" in patch && patch.fontSize !== el.fontSize) ||
            ("fontFamily" in patch && patch.fontFamily !== el.fontFamily));
        const neededW = fitTextBoxWidth(merged.text, merged.fontSize, maxW, merged.fontWeight, merged.fontFamily);
        const newW = sizeChanged ? Math.min(neededW, maxW) : Math.max(merged.w, neededW);
        const neededH = fitTextBoxHeight(merged.text, newW, merged.fontSize, merged.fontWeight, merged.fontFamily);
        const fittedH = Math.min(neededH, 1 - merged.y - padB);
        const newH = sizeChanged ? fittedH : Math.max(merged.h, fittedH);
        patch = { ...patch, w: newW, h: newH };
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
      selectSingle(null);
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

  const minZ = useCallback(() => {
    const cur = projectRef.current;
    if (!cur) return 0;
    let m = 0;
    for (const pg of cur.pages)
      for (const e of pg.elements) if (e.z < m) m = e.z;
    return m;
  }, []);

  // Ebenen-Reihenfolge aendern - gilt gleichermassen fuer alle Elementarten
  // (Texte, Hintergrundflaechen/Formen, Bilder, Logo), da die Stapel-
  // reihenfolge unabhaengig von der Art des Elements ist.
  const reorderElement = useCallback(
    (elId: string, mode: "front" | "back" | "forward" | "backward") => {
      if (mode === "front") {
        patchElement(elId, { z: maxZ() + 1 });
        return;
      }
      if (mode === "back") {
        patchElement(elId, { z: minZ() - 1 });
        return;
      }
      // Vorwaerts/rueckwaerts: mit dem direkten Nachbarn in der aktuellen
      // Stapelreihenfolge dieser Seite die z-Werte tauschen.
      const cur = projectRef.current;
      const pg = cur?.pages[pageIndex];
      const el = pg?.elements.find((e) => e.id === elId);
      if (!pg || !el) return;
      const sorted = [...pg.elements].sort((a, b) => a.z - b.z);
      const idx = sorted.findIndex((e) => e.id === elId);
      const neighbor = sorted[mode === "forward" ? idx + 1 : idx - 1];
      if (!neighbor) return; // bereits ganz vorn/hinten auf dieser Seite
      const elZ = el.z;
      const neighborZ = neighbor.z;
      mutatePages((pages) =>
        pages.map((p, i) => {
          if (i !== pageIndex) return p;
          return {
            ...p,
            elements: p.elements.map((e) => {
              if (e.id === el.id) return { ...e, z: neighborZ };
              if (e.id === neighbor.id) return { ...e, z: elZ };
              return e;
            }),
          };
        }),
      );
    },
    [maxZ, minZ, mutatePages, patchElement, pageIndex],
  );

  // --- Drop-Handler ------------------------------------------------------
  // Bildflaechen akzeptieren neben Bildern auch PDFs - haeufig liegen
  // Grundrisse/Energieausweise/Dokumente als PDF vor. Von einer abgelegten
  // PDF-Datei wird die erste Seite als Bild gerendert (dieselbe Technik wie
  // beim Einlesen von Beispiel-Exposés, siehe lib/pdf.ts).
  async function resolveDroppedImageSrc(file: File): Promise<string | null> {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      const pdfDataUrl = await fileToDataUrl(file);
      const img = await pdfFirstPageToImage(pdfDataUrl);
      if (!img) {
        flash("PDF konnte nicht gelesen werden.", true);
        return null;
      }
      return img;
    }
    if (file.type.startsWith("image/")) {
      return fileToDataUrl(file);
    }
    flash("Bitte eine Bild- oder PDF-Datei ablegen.", true);
    return null;
  }

  async function dropFileToElement(elId: string, file: File) {
    const src = await resolveDroppedImageSrc(file);
    if (!src) return;
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
    selectSingle(elId);
  }

  async function dropFileToCanvas(xFrac: number, yFrac: number, file: File) {
    const src = await resolveDroppedImageSrc(file);
    if (!src) return;
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
    selectSingle(newEl.id);
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
    selectSingle(null);
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
    selectSingle(newEl.id);
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
    selectSingle(newEl.id);
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
    selectSingle(null);
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
          <div className="page-shadow" ref={pageShadowRef}>
            <PageCanvas
              page={page}
              width={canvasWidth}
              editable={!progress}
              selectedIds={selectedIds}
              editingId={editingId}
              analyzingIds={analyzingIds}
              onSelect={(id, additive) => {
                if (id === null) {
                  setSelectedIds(new Set());
                  setEditingId(null);
                  return;
                }
                if (additive) {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                  setEditingId(null);
                  return;
                }
                selectSingle(id);
                if (id !== editingId) setEditingId(null);
              }}
              onSelectMany={(ids) => {
                setSelectedIds(new Set(ids));
                setEditingId(null);
              }}
              onChange={patchElement}
              onChangeMultiple={patchElements}
              onStartEdit={(id) => {
                selectSingle(id);
                setEditingId(id);
                // Beim Start von "Bild anpassen" sofort einen minimalen Zoom
                // setzen, falls das Bild noch auf 1 (unveraendert) steht -
                // bei imgScale genau 1 ist der Bewegungsspielraum (siehe
                // onImagePanDown in CanvasElement.tsx) rechnerisch 0, das
                // Foto liess sich also trotz "Ziehen zum Verschieben"-Hinweis
                // gar nicht bewegen, bevor man vorher manuell reingezoomt
                // hat. Mit einem kleinen Basis-Zoom funktioniert Ziehen
                // sofort, ohne dass sich am unveraenderten (nicht editierten)
                // Bild optisch etwas aendert.
                const cur = projectRef.current;
                const el = cur?.pages
                  .flatMap((p) => p.elements)
                  .find((e) => e.id === id);
                if (el?.kind === "image" && (el as ImageElement).src && (el.imgScale ?? 1) <= 1) {
                  patchElement(id, { imgScale: 1.15 } as Partial<ImageElement>);
                }
              }}
              onCommitText={(id, text) => {
                patchTextGrow(id, { text });
                setEditingId(null);
              }}
              onDropFileToElement={dropFileToElement}
              onDropFileToCanvas={dropFileToCanvas}
              onToggleFullPage={toggleFullPage}
              photoById={photoById}
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
              onReorder={(mode) => reorderElement(selected.id, mode)}
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
                selectSingle(null);
                setEditingId(null);
              }}
            >
              <div className="frame">
                <PageCanvas
                  page={pg}
                  width={thumbRailWidth - THUMB_RAIL_PADDING}
                  editable={false}
                  selectedIds={EMPTY_SELECTION}
                  editingId={null}
                  analyzingIds={analyzingIds}
                  onSelect={() => {}}
                  onSelectMany={() => {}}
                  onChange={() => {}}
                  onChangeMultiple={() => {}}
                  onStartEdit={() => {}}
                  onCommitText={() => {}}
                  onDropFileToElement={() => {}}
                  onDropFileToCanvas={() => {}}
                  onToggleFullPage={() => {}}
                  photoById={photoById}
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
  onReorder,
  onErasePhoto,
}: {
  element: PageElement;
  onPatch: (patch: Partial<PageElement>) => void;
  onDelete: () => void;
  onEdit: () => void;
  onReorder: (mode: "front" | "back" | "forward" | "backward") => void;
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
      <div className="grp">
        <span
          className="lbl"
          title="Liegt ein anderes Objekt darüber und blockiert den Klick? Mit gedrückter Alt-Taste klicken, um das darunterliegende Objekt auszuwählen."
        >
          Ebene
        </span>
        <button className="tool" onClick={() => onReorder("back")} title="Ganz nach hinten">
          ⏷
        </button>
        <button className="tool" onClick={() => onReorder("backward")} title="Eine Ebene nach hinten">
          ▼
        </button>
        <button className="tool" onClick={() => onReorder("forward")} title="Eine Ebene nach vorne">
          ▲
        </button>
        <button className="tool" onClick={() => onReorder("front")} title="Ganz nach vorne">
          ⏶
        </button>
      </div>
      <div className="sep" />
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
// Die Druckansicht ist nicht bedienbar - die Fotoliste bleibt darum leer
// (das Durchschalten der Fotos gibt es nur im Editor).
const NO_PHOTOS: Record<string, string> = {};

function PrintView({ project }: { project: ExposeProject }) {
  return (
    <div className="print-root">
      {project.pages.map((pg) => (
        <div className="print-page" key={pg.id}>
          <PageCanvas
            page={pg}
            width={REF_W}
            editable={false}
            selectedIds={EMPTY_SELECTION}
            editingId={null}
            analyzingIds={new Set()}
            onSelect={() => {}}
            onSelectMany={() => {}}
            onChange={() => {}}
            onChangeMultiple={() => {}}
            onStartEdit={() => {}}
            onCommitText={() => {}}
            onDropFileToElement={() => {}}
            onDropFileToCanvas={() => {}}
            onToggleFullPage={() => {}}
            photoById={NO_PHOTOS}
          />
        </div>
      ))}
    </div>
  );
}

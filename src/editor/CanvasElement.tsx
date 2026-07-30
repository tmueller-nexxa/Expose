import { useEffect, useRef, useState } from "react";
import type {
  ImageElement,
  LogoElement,
  PageElement,
  ShapeElement,
  TextElement,
} from "../lib/types";
import { clamp } from "../lib/util";
import { startPointerDrag } from "./pointer";
import { IconImage } from "../components/Icons";
import { CENTER_SNAP_FRAC, snapX, snapY } from "./snap";

// Snapt eine X-Position mit dem 8px-Raster - liegt die horizontale Mitte des
// Elements dabei nahe genug an der Seitenmitte (CENTER_SNAP_FRAC), wird
// stattdessen exakt zentriert und "centered" gemeldet (steuert die gruene
// Zentrier-Hilfslinie, siehe PageCanvas.tsx).
function snapCenterX(x: number, w: number): { x: number; centered: boolean } {
  const center = x + w / 2;
  if (Math.abs(center - 0.5) <= CENTER_SNAP_FRAC) {
    return { x: 0.5 - w / 2, centered: true };
  }
  return { x: snapX(x), centered: false };
}

interface Props {
  el: PageElement;
  scale: number;
  pageW: number;
  pageH: number;
  // "selected": Element ist Teil der aktuellen (ggf. mehrfachen) Auswahl -
  // steuert nur die visuelle Hervorhebung (Rahmen). "soloSelected": Element
  // ist die EINZIGE aktuelle Auswahl - steuert zusaetzlich die Resize-
  // Handles (Groesse mehrerer Elemente gleichzeitig zu aendern waere
  // mehrdeutig, darum nur bei Einzelauswahl moeglich).
  selected: boolean;
  soloSelected: boolean;
  selectionCount: number;
  editable: boolean;
  analyzing: boolean;
  editingId: string | null;
  // additive = Strg/Cmd war gedrueckt (Auswahl hinzufuegen/entfernen statt ersetzen).
  onSelect: (id: string, additive: boolean) => void;
  onChange: (id: string, patch: Partial<PageElement>) => void;
  onStartEdit: (id: string) => void;
  onCommitText: (id: string, text: string) => void;
  onDropFile: (id: string, file: File) => void;
  // Startet einen gemeinsamen Verschiebe-Vorgang fuer die GESAMTE aktuelle
  // Mehrfachauswahl (wird nur aufgerufen, wenn dieses Element bereits Teil
  // einer Mehrfachauswahl ist) - liefert eine Update-Funktion, die pro
  // Pointer-Tick mit der kumulierten Verschiebung (Pixel) aufgerufen wird
  // und zurueckmeldet, ob gerade zentriert wurde (fuer die Hilfslinie).
  onBeginGroupDrag: (anchorId: string) => (dxPx: number, dyPx: number) => boolean;
  onCenterGuide: (show: boolean) => void;
}

// Ecken UND Kanten - an jeder Seite laesst sich die Groesse per Ziehen aendern.
type HandlePos = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";
const HANDLES: HandlePos[] = ["nw", "ne", "sw", "se", "n", "s", "e", "w"];

export function CanvasElement(props: Props) {
  const {
    el,
    scale,
    pageW,
    pageH,
    selected,
    soloSelected,
    selectionCount,
    editable,
    analyzing,
    editingId,
    onSelect,
    onChange,
    onStartEdit,
    onCommitText,
    onDropFile,
    onBeginGroupDrag,
    onCenterGuide,
  } = props;

  const [dropOver, setDropOver] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);
  const isText = el.kind === "text" || el.kind === "heading";
  const editing = editable && isText && editingId === el.id;
  // "Bild anpassen"-Modus: Foto per Doppelklick unabhaengig vom Rahmen
  // verschieben/zoomen (Rahmen selbst bleibt dabei unveraendert).
  const imgEditing =
    editable &&
    el.kind === "image" &&
    !el.locked &&
    Boolean((el as ImageElement).src) &&
    editingId === el.id;

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.textContent = (el as TextElement).text;
      editRef.current.focus();
      const range = document.createRange();
      range.selectNodeContents(editRef.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const style: React.CSSProperties = {
    left: el.x * pageW,
    top: el.y * pageH,
    width: el.w * pageW,
    height: el.h * pageH,
    zIndex: el.z,
  };

  function onBodyDown(e: React.PointerEvent) {
    if (!editable) return;
    // Strg/Cmd+Klick: nur Auswahl umschalten (hinzufuegen/entfernen), kein
    // gleichzeitiges Verschieben starten - Standardverhalten in Design-Tools.
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      onSelect(el.id, true);
      return;
    }
    // War dieses Element bereits Teil einer Mehrfachauswahl, bleibt die
    // GESAMTE Auswahl fuer einen moeglichen gemeinsamen Verschiebe-Vorgang
    // erhalten - erst ein reiner Klick OHNE Ziehen (siehe unten) reduziert
    // sie danach auf dieses eine Element. Andernfalls ersetzt der Klick die
    // Auswahl sofort wie bisher.
    const wasSelected = selected;
    const groupMode = wasSelected && selectionCount > 1;
    if (!wasSelected) onSelect(el.id, false);
    if (imgEditing) {
      onImagePanDown(e);
      return;
    }
    if (editing || el.locked) return;

    if (groupMode) {
      const update = onBeginGroupDrag(el.id);
      let moved = false;
      startPointerDrag(
        e,
        (dx, dy) => {
          if (!moved && Math.hypot(dx, dy) > 2) moved = true;
          onCenterGuide(update(dx, dy));
        },
        () => {
          onCenterGuide(false);
          if (!moved) onSelect(el.id, false);
        },
      );
      return;
    }

    const s = { x: el.x, y: el.y, w: el.w, h: el.h };
    startPointerDrag(
      e,
      (dx, dy) => {
        const rawX = clamp(s.x + dx / pageW, 0, 1 - s.w);
        const rawY = snapY(clamp(s.y + dy / pageH, 0, 1 - s.h));
        const { x: snappedX, centered } = snapCenterX(rawX, s.w);
        onCenterGuide(centered);
        onChange(el.id, { x: snappedX, y: rawY });
      },
      () => onCenterGuide(false),
    );
  }

  // Verschiebt das Foto INNERHALB des Rahmens (Position/Zoom des Bildes),
  // nicht den Rahmen selbst. Verschiebung ist auf +/-(scale-1)/2 begrenzt,
  // damit der Rahmen immer vollstaendig gefuellt bleibt (kein leerer Rand).
  function onImagePanDown(e: React.PointerEvent) {
    const img = el as ImageElement;
    const s = img.imgScale ?? 1;
    const bound = Math.max(0, (s - 1) / 2);
    const start = { x: img.imgX ?? 0, y: img.imgY ?? 0 };
    startPointerDrag(e, (dx, dy) => {
      onChange(el.id, {
        imgX: clamp(start.x + dx / (el.w * pageW), -bound, bound),
        imgY: clamp(start.y + dy / (el.h * pageH), -bound, bound),
      } as Partial<ImageElement>);
    });
  }

  function onImageWheel(e: React.WheelEvent) {
    if (!imgEditing) return;
    e.preventDefault();
    e.stopPropagation();
    const img = el as ImageElement;
    const cur = img.imgScale ?? 1;
    const next = clamp(cur - e.deltaY * 0.0015, 1, 4);
    const bound = Math.max(0, (next - 1) / 2);
    onChange(el.id, {
      imgScale: next,
      imgX: clamp(img.imgX ?? 0, -bound, bound),
      imgY: clamp(img.imgY ?? 0, -bound, bound),
    } as Partial<ImageElement>);
  }

  function onHandleDown(e: React.PointerEvent, corner: HandlePos) {
    onSelect(el.id, false);
    if (el.locked) return;
    const s = { x: el.x, y: el.y, w: el.w, h: el.h };
    startPointerDrag(e, (dx, dy) => {
      const fx = dx / pageW;
      const fy = dy / pageH;
      let { x, y, w, h } = s;
      if (corner.includes("e")) w = clamp(s.w + fx, 0.04, 1 - s.x);
      if (corner.includes("s")) h = clamp(s.h + fy, 0.03, 1 - s.y);
      if (corner.includes("w")) {
        const nx = clamp(s.x + fx, 0, s.x + s.w - 0.04);
        x = nx;
        w = s.w - (nx - s.x);
      }
      if (corner.includes("n")) {
        const ny = clamp(s.y + fy, 0, s.y + s.h - 0.03);
        y = ny;
        h = s.h - (ny - s.y);
      }
      // Textfelder sind per Eckgriff frei auf jede Groesse zuschneidbar -
      // auch kleiner als der Text bei der aktuellen Schriftgroesse
      // braucht. Ist die Box kleiner als der Inhalt, wird der Text dann
      // sichtbar geclippt (siehe .el-text .txt { overflow: hidden;
      // min-height: 0 } in EditorPage.css), statt die Box automatisch
      // wieder zu vergroessern.
      onChange(el.id, {
        x: snapX(x),
        y: snapY(y),
        w: snapX(w),
        h: snapY(h),
      });
    });
  }

  const handles = soloSelected && editable && !editing && !imgEditing && !el.locked && (
    <>
      {HANDLES.map((c) => (
        <div
          key={c}
          className={`handle ${c}`}
          onPointerDown={(e) => onHandleDown(e, c)}
        />
      ))}
    </>
  );

  // --- Formen/Banner (grafischer Nachbau, kein Foto) ---------------------
  if (el.kind === "shape") {
    const s = el as ShapeElement;
    return (
      <div
        className={`el el-shape ${selected ? "selected" : ""}`}
        style={{
          ...style,
          background: s.color,
          borderRadius: (s.radius ?? 0) * scale,
        }}
        onPointerDown={onBodyDown}
      >
        {handles}
      </div>
    );
  }

  // --- Image / Logo ------------------------------------------------------
  if (el.kind === "image" || el.kind === "logo") {
    const isLogo = el.kind === "logo";
    const img = el as ImageElement;
    const src = (el as ImageElement | LogoElement).src;
    const empty = !src;
    const imgScale = img.imgScale ?? 1;
    const imgX = img.imgX ?? 0;
    const imgY = img.imgY ?? 0;
    return (
      <div
        className={`el el-image ${empty ? "empty" : ""} ${
          dropOver ? "drop-over" : ""
        } ${selected ? "selected" : ""} ${imgEditing ? "img-editing" : ""}`}
        style={{
          ...style,
          background: isLogo ? "transparent" : undefined,
          cursor: imgEditing ? "grab" : undefined,
        }}
        onPointerDown={onBodyDown}
        onWheel={onImageWheel}
        onDoubleClick={() =>
          editable && !isLogo && !empty && !el.locked && onStartEdit(el.id)
        }
        onDragOver={(e) => {
          if (!editable) return;
          e.preventDefault();
          e.stopPropagation();
          setDropOver(true);
        }}
        onDragLeave={() => setDropOver(false)}
        onDrop={(e) => {
          if (!editable) return;
          e.preventDefault();
          e.stopPropagation();
          setDropOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onDropFile(el.id, f);
        }}
      >
        <div className="el-image-clip">
          {empty ? (
            <div className="ph">
              <IconImage size={22} />
              <div>Bild hierher ziehen</div>
            </div>
          ) : (
            <img
              src={src}
              alt=""
              draggable={false}
              style={{
                objectFit: isLogo ? "contain" : img.fit,
                transform: isLogo
                  ? undefined
                  : `translate(${imgX * 100}%, ${imgY * 100}%) scale(${imgScale})`,
                // Weiss-invertiertes Logo liegt ohne Hintergrundflaeche direkt
                // auf dem Titelfoto - ohne Schlagschatten auf hellen
                // Fotobereichen sonst unsichtbar (analog exposeMark textShadow).
                filter: isLogo ? "drop-shadow(0 1px 3px rgba(0,0,0,0.55))" : undefined,
              }}
            />
          )}
          {analyzing && <div className="analyzing">KI analysiert Bild …</div>}
          {imgEditing && (
            <div className="img-edit-hint">Ziehen zum Verschieben · Scrollen zum Zoomen</div>
          )}
        </div>
        {handles}
      </div>
    );
  }

  // --- Text / Heading ----------------------------------------------------
  const t = el as TextElement;
  const isEmpty = !t.text && !editing;
  const justify =
    t.align === "center" ? "center" : t.align === "right" ? "flex-end" : "flex-start";

  return (
    <div
      className={`el el-text ${isEmpty ? "empty" : ""} ${selected ? "selected" : ""}`}
      style={{
        ...style,
        background: t.background,
        color: t.color,
        textShadow: t.textShadow
          ? "0 1px 4px rgba(0,0,0,0.65), 0 0 16px rgba(0,0,0,0.4)"
          : undefined,
        justifyContent: justify,
        borderRadius: t.background.startsWith("rgba(0,0,0,0") ? 0 : 6,
        cursor: editing ? "text" : "move",
      }}
      onPointerDown={onBodyDown}
      onDoubleClick={() => editable && onStartEdit(el.id)}
    >
      {editing ? (
        <div
          ref={editRef}
          className="txt"
          contentEditable
          suppressContentEditableWarning
          style={{
            fontSize: t.fontSize * scale,
            fontWeight: t.fontWeight,
            fontFamily: t.fontFamily,
            textAlign: t.align,
            lineHeight: 1.35,
          }}
          onBlur={() => onCommitText(el.id, editRef.current?.textContent ?? "")}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : isEmpty ? (
        editable && <div className="txt-ph">Text eingeben …</div>
      ) : (
        <div
          className="txt"
          style={{
            fontSize: t.fontSize * scale,
            fontWeight: t.fontWeight,
            fontFamily: t.fontFamily,
            textAlign: t.align,
            lineHeight: 1.35,
          }}
        >
          {t.text}
        </div>
      )}
      {handles}
    </div>
  );
}

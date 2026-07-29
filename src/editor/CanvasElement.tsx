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
import { REF_H, REF_W } from "./constants";

// Unsichtbares Ausrichtungsraster: Verschieben/Skalieren rastet auf ein
// 8px-Raster (bezogen auf die Referenzseitengroesse REF_W/REF_H) ein - ohne
// sichtbare Rasterlinien, aber so laesst sich z.B. dieselbe Position/Breite
// bei zwei verschiedenen Elementen leicht wieder treffen.
const GRID_PX = 8;
function snapX(fracX: number): number {
  const step = GRID_PX / REF_W;
  return Math.round(fracX / step) * step;
}
function snapY(fracY: number): number {
  const step = GRID_PX / REF_H;
  return Math.round(fracY / step) * step;
}

interface Props {
  el: PageElement;
  scale: number;
  pageW: number;
  pageH: number;
  selected: boolean;
  editable: boolean;
  analyzing: boolean;
  editingId: string | null;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<PageElement>) => void;
  onStartEdit: (id: string) => void;
  onCommitText: (id: string, text: string) => void;
  onDropFile: (id: string, file: File) => void;
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
    editable,
    analyzing,
    editingId,
    onSelect,
    onChange,
    onStartEdit,
    onCommitText,
    onDropFile,
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
    onSelect(el.id);
    if (imgEditing) {
      onImagePanDown(e);
      return;
    }
    if (editing || el.locked) return;
    const s = { x: el.x, y: el.y, w: el.w, h: el.h };
    startPointerDrag(e, (dx, dy) => {
      onChange(el.id, {
        x: snapX(clamp(s.x + dx / pageW, 0, 1 - s.w)),
        y: snapY(clamp(s.y + dy / pageH, 0, 1 - s.h)),
      });
    });
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
    onSelect(el.id);
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

  const handles = selected && editable && !editing && !imgEditing && !el.locked && (
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

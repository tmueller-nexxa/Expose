import { useEffect, useRef, useState } from "react";
import type {
  ImageElement,
  LogoElement,
  PageElement,
  TextElement,
} from "../lib/types";
import { clamp } from "../lib/util";
import { startPointerDrag } from "./pointer";
import { IconImage } from "../components/Icons";

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
    if (editing || el.locked) return;
    const s = { x: el.x, y: el.y, w: el.w, h: el.h };
    startPointerDrag(e, (dx, dy) => {
      onChange(el.id, {
        x: clamp(s.x + dx / pageW, 0, 1 - s.w),
        y: clamp(s.y + dy / pageH, 0, 1 - s.h),
      });
    });
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
      onChange(el.id, { x, y, w, h });
    });
  }

  const handles = selected && editable && !editing && !el.locked && (
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

  // --- Image / Logo ------------------------------------------------------
  if (el.kind === "image" || el.kind === "logo") {
    const isLogo = el.kind === "logo";
    const src = (el as ImageElement | LogoElement).src;
    const empty = !src;
    return (
      <div
        className={`el el-image ${empty ? "empty" : ""} ${
          dropOver ? "drop-over" : ""
        } ${selected ? "selected" : ""}`}
        style={{
          ...style,
          background: isLogo ? "transparent" : undefined,
        }}
        onPointerDown={onBodyDown}
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
              style={{ objectFit: isLogo ? "contain" : (el as ImageElement).fit }}
            />
          )}
          {analyzing && <div className="analyzing">KI analysiert Bild …</div>}
        </div>
        {handles}
      </div>
    );
  }

  // --- Text / Heading ----------------------------------------------------
  const t = el as TextElement;
  const isEmpty = !t.text && !editing;
  const pad = t.text || editing ? Math.max(3, t.fontSize * scale * 0.35) : 0;
  const justify =
    t.align === "center" ? "center" : t.align === "right" ? "flex-end" : "flex-start";

  return (
    <div
      className={`el el-text ${isEmpty ? "empty" : ""} ${selected ? "selected" : ""}`}
      style={{
        ...style,
        background: t.background,
        color: t.color,
        justifyContent: justify,
        padding: `${pad}px ${pad * 1.2}px`,
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

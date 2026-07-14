import { useRef, useState } from "react";
import type { Page, PageElement } from "../lib/types";
import { PAGE_RATIO, REF_W } from "./constants";
import { CanvasElement } from "./CanvasElement";

interface Props {
  page: Page;
  width: number;
  editable: boolean;
  selectedId: string | null;
  editingId: string | null;
  analyzingIds: Set<string>;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<PageElement>) => void;
  onStartEdit: (id: string) => void;
  onCommitText: (id: string, text: string) => void;
  onDropFileToElement: (id: string, file: File) => void;
  onDropFileToCanvas: (xFrac: number, yFrac: number, file: File) => void;
}

export function PageCanvas(props: Props) {
  const { page, width, editable } = props;
  const height = width * PAGE_RATIO;
  const scale = width / REF_W;
  const ref = useRef<HTMLDivElement>(null);
  const [dropOver, setDropOver] = useState(false);

  const sorted = [...page.elements].sort((a, b) => a.z - b.z);

  return (
    <div
      ref={ref}
      className="page-canvas"
      style={{ width, height, background: page.background }}
      onPointerDown={() => editable && props.onSelect(null)}
      onDragOver={(e) => {
        if (!editable) return;
        e.preventDefault();
        setDropOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropOver(false);
      }}
      onDrop={(e) => {
        if (!editable) return;
        e.preventDefault();
        setDropOver(false);
        const f = e.dataTransfer.files?.[0];
        if (!f || !ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const xFrac = (e.clientX - rect.left) / rect.width;
        const yFrac = (e.clientY - rect.top) / rect.height;
        props.onDropFileToCanvas(xFrac, yFrac, f);
      }}
    >
      {sorted.map((el) => (
        <CanvasElement
          key={el.id}
          el={el}
          scale={scale}
          pageW={width}
          pageH={height}
          editable={editable}
          selected={props.selectedId === el.id}
          analyzing={props.analyzingIds.has(el.id)}
          editingId={props.editingId}
          onSelect={props.onSelect}
          onChange={props.onChange}
          onStartEdit={props.onStartEdit}
          onCommitText={props.onCommitText}
          onDropFile={props.onDropFileToElement}
        />
      ))}
      {dropOver && <div className="drop-highlight">Bild ablegen</div>}
    </div>
  );
}

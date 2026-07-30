import { useRef, useState } from "react";
import type { Page, PageElement } from "../lib/types";
import { PAGE_RATIO, REF_W } from "./constants";
import { CanvasElement } from "./CanvasElement";
import { clamp } from "../lib/util";
import { CENTER_SNAP_FRAC, snapX, snapY } from "./snap";

interface Props {
  page: Page;
  width: number;
  editable: boolean;
  selectedIds: Set<string>;
  editingId: string | null;
  analyzingIds: Set<string>;
  // additive = Strg/Cmd war gedrueckt (Auswahl hinzufuegen/entfernen statt ersetzen).
  onSelect: (id: string | null, additive: boolean) => void;
  // Ergebnis eines Auswahlrahmens (Marquee) - ersetzt die Auswahl komplett.
  onSelectMany: (ids: string[]) => void;
  onChange: (id: string, patch: Partial<PageElement>) => void;
  onChangeMultiple: (patches: { id: string; patch: Partial<PageElement> }[]) => void;
  onStartEdit: (id: string) => void;
  onCommitText: (id: string, text: string) => void;
  onDropFileToElement: (id: string, file: File) => void;
  onDropFileToCanvas: (xFrac: number, yFrac: number, file: File) => void;
}

// Ab dieser Ziehdistanz (Px) gilt ein Pointerdown auf der leeren Flaeche als
// Auswahlrahmen (Marquee) statt als einfacher Klick zum Abwaehlen.
const DRAG_THRESHOLD_PX = 4;

export function PageCanvas(props: Props) {
  const { page, width, editable } = props;
  const height = width * PAGE_RATIO;
  const scale = width / REF_W;
  const ref = useRef<HTMLDivElement>(null);
  const [dropOver, setDropOver] = useState(false);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );
  const [centerGuide, setCenterGuide] = useState(false);

  const sorted = [...page.elements].sort((a, b) => a.z - b.z);

  // Ueberlappende Objekte per Alt+Klick durchwaehlen: normale Klicks waehlen
  // immer nur das OBERSTE Element an dieser Stelle (so funktioniert das DOM-
  // Stacking automatisch) - liegt z.B. ein transparentes Textfeld ueber einem
  // Foto, ist das Foto darunter sonst nie per Klick erreichbar (und damit
  // auch seine Ebene nie ueber die Werkzeugleiste aenderbar). Mit gedrueckter
  // Alt-Taste wird bei jedem weiteren Klick auf dieselbe Stelle stattdessen
  // das naechst-tiefere Element ausgewaehlt (zyklisch).
  function handleCanvasPointerDownCapture(e: React.PointerEvent) {
    if (!editable || !e.altKey || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const xFrac = (e.clientX - rect.left) / rect.width;
    const yFrac = (e.clientY - rect.top) / rect.height;
    const hits = page.elements
      .filter(
        (el) =>
          xFrac >= el.x && xFrac <= el.x + el.w && yFrac >= el.y && yFrac <= el.y + el.h,
      )
      .sort((a, b) => b.z - a.z);
    if (hits.length < 2) return;
    const curIdx = hits.findIndex((el) => props.selectedIds.has(el.id));
    const next = hits[(curIdx + 1) % hits.length];
    e.preventDefault();
    e.stopPropagation();
    props.onSelect(next.id, false);
  }

  // Ziehen mit gedrueckter Maustaste ueber der LEEREN Flaeche: zieht ein
  // Auswahlrahmen (Marquee), der beim Loslassen alle darin liegenden
  // Elemente auswaehlt. Ohne Ziehbewegung (reiner Klick) wird stattdessen
  // wie bisher die Auswahl aufgehoben.
  function handleCanvasPointerDown(e: React.PointerEvent) {
    if (!editable || e.target !== e.currentTarget || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    setMarquee({ x0: startX - rect.left, y0: startY - rect.top, x1: startX - rect.left, y1: startY - rect.top });

    function onMove(ev: PointerEvent) {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > DRAG_THRESHOLD_PX) moved = true;
      if (moved) {
        setMarquee({ x0: startX - rect.left, y0: startY - rect.top, x1: ev.clientX - rect.left, y1: ev.clientY - rect.top });
      }
    }
    function onUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) {
        const fx0 = Math.min(startX, ev.clientX) - rect.left;
        const fx1 = Math.max(startX, ev.clientX) - rect.left;
        const fy0 = Math.min(startY, ev.clientY) - rect.top;
        const fy1 = Math.max(startY, ev.clientY) - rect.top;
        const nx0 = fx0 / rect.width;
        const nx1 = fx1 / rect.width;
        const ny0 = fy0 / rect.height;
        const ny1 = fy1 / rect.height;
        const hitIds = page.elements
          .filter((el) => el.x < nx1 && el.x + el.w > nx0 && el.y < ny1 && el.y + el.h > ny0)
          .map((el) => el.id);
        props.onSelectMany(hitIds);
      } else {
        props.onSelect(null, false);
      }
      setMarquee(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Startet einen gemeinsamen Verschiebe-Vorgang fuer die GESAMTE aktuelle
  // Mehrfachauswahl: erfasst einmalig die Ausgangspositionen aller
  // ausgewaehlten Elemente, liefert eine Update-Funktion, die pro Pointer-
  // Tick mit der kumulierten Verschiebung (Pixel, relativ zum Start)
  // aufgerufen wird. Der Zentrier-Snap greift dabei an der horizontalen
  // Mitte des "Anker"-Elements (das tatsaechlich gegriffene) - die anderen
  // Elemente der Gruppe behalten ihren relativen Abstand exakt bei.
  function beginGroupDrag(anchorId: string): (dxPx: number, dyPx: number) => boolean {
    const ids = props.selectedIds;
    const originals = page.elements
      .filter((el) => ids.has(el.id))
      .map((el) => ({ id: el.id, x: el.x, y: el.y, w: el.w, h: el.h }));
    const anchor = originals.find((o) => o.id === anchorId) ?? originals[0];
    const minX = Math.min(...originals.map((o) => o.x));
    const minY = Math.min(...originals.map((o) => o.y));
    const maxX = Math.max(...originals.map((o) => o.x + o.w));
    const maxY = Math.max(...originals.map((o) => o.y + o.h));

    return (dxPx: number, dyPx: number) => {
      let dxFrac = clamp(dxPx / width, -minX, 1 - maxX);
      const dyFrac = clamp(dyPx / height, -minY, 1 - maxY);

      let centered = false;
      if (anchor) {
        const anchorCenter = anchor.x + dxFrac + anchor.w / 2;
        if (Math.abs(anchorCenter - 0.5) <= CENTER_SNAP_FRAC) {
          dxFrac = 0.5 - anchor.w / 2 - anchor.x;
          centered = true;
        }
      }
      // Raster-Snap anhand des Anker-Elements, damit die Gruppe als Ganzes
      // im Raster bleibt statt jedes Element einzeln (und damit potenziell
      // unterschiedlich) zu runden.
      const snappedAnchorX = anchor ? (centered ? anchor.x + dxFrac : snapX(anchor.x + dxFrac)) : dxFrac;
      const snappedAnchorY = anchor ? snapY(anchor.y + dyFrac) : dyFrac;
      const correctedDx = anchor ? snappedAnchorX - anchor.x : dxFrac;
      const correctedDy = anchor ? snappedAnchorY - anchor.y : dyFrac;

      props.onChangeMultiple(
        originals.map((o) => ({ id: o.id, patch: { x: o.x + correctedDx, y: o.y + correctedDy } })),
      );
      return centered;
    };
  }

  return (
    <div
      ref={ref}
      className="page-canvas"
      style={{ width, height, background: page.background }}
      onPointerDownCapture={handleCanvasPointerDownCapture}
      onPointerDown={handleCanvasPointerDown}
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
          selected={props.selectedIds.has(el.id)}
          soloSelected={props.selectedIds.size === 1 && props.selectedIds.has(el.id)}
          selectionCount={props.selectedIds.size}
          analyzing={props.analyzingIds.has(el.id)}
          editingId={props.editingId}
          onSelect={props.onSelect}
          onChange={props.onChange}
          onStartEdit={props.onStartEdit}
          onCommitText={props.onCommitText}
          onDropFile={props.onDropFileToElement}
          onBeginGroupDrag={beginGroupDrag}
          onCenterGuide={setCenterGuide}
        />
      ))}
      {dropOver && <div className="drop-highlight">Bild ablegen</div>}
      {marquee && (
        <div
          className="marquee-select"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}
      {centerGuide && <div className="center-guide-v" />}
    </div>
  );
}

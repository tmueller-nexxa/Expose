import { REF_H, REF_W } from "./constants";

// Unsichtbares Ausrichtungsraster: Verschieben/Skalieren rastet auf ein
// 8px-Raster (bezogen auf die Referenzseitengroesse REF_W/REF_H) ein - ohne
// sichtbare Rasterlinien, aber so laesst sich z.B. dieselbe Position/Breite
// bei zwei verschiedenen Elementen leicht wieder treffen. Gemeinsam genutzt
// von CanvasElement.tsx (Einzel-Drag) und PageCanvas.tsx (Gruppen-Drag).
const GRID_PX = 8;
export function snapX(fracX: number): number {
  const step = GRID_PX / REF_W;
  return Math.round(fracX / step) * step;
}
export function snapY(fracY: number): number {
  const step = GRID_PX / REF_H;
  return Math.round(fracY / step) * step;
}

// Toleranz (in Anteilen der Referenzbreite) fuer den gruenen Zentrier-
// Hilfslinien-Snap beim Verschieben: liegt die horizontale Mitte eines
// Elements innerhalb dieser Distanz von der Seitenmitte, wird beim
// Loslassen exakt zentriert und waehrenddessen die Hilfslinie eingeblendet.
export const CENTER_SNAP_FRAC = 6 / REF_W;

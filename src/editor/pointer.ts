// Kleiner Helfer fuer Maus/Touch-Ziehen ueber die gesamte Seite hinweg.

export function startPointerDrag(
  e: React.PointerEvent,
  onMove: (dx: number, dy: number) => void,
  onEnd?: () => void,
): void {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startY = e.clientY;

  function move(ev: PointerEvent) {
    onMove(ev.clientX - startX, ev.clientY - startY);
  }
  function up() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    onEnd?.();
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

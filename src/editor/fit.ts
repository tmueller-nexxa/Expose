// Ermittelt die groesstmoegliche Schriftgroesse, mit der ein Text vollstaendig
// in eine Flaeche passt (mit Wortumbruch), damit nichts uebersteht.

import { REF_H, REF_W } from "./constants";

let ctx: CanvasRenderingContext2D | null = null;

function measureCtx(): CanvasRenderingContext2D {
  if (!ctx) {
    const c = document.createElement("canvas");
    ctx = c.getContext("2d");
  }
  return ctx as CanvasRenderingContext2D;
}

function wrapLines(
  text: string,
  fontPx: number,
  weight: number,
  maxWidth: number,
): number {
  const c = measureCtx();
  c.font = `${weight} ${fontPx}px Inter, system-ui, sans-serif`;
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines += 1;
      continue;
    }
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (c.measureText(test).width > maxWidth && line) {
        lines += 1;
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines += 1;
  }
  return lines;
}

export function fitFontSize(
  text: string,
  boxW: number,
  boxH: number,
  opts: {
    min?: number;
    max?: number;
    padding?: number;
    lineHeight?: number;
    weight?: number;
  } = {},
): number {
  const min = opts.min ?? 9;
  const max = opts.max ?? 26;
  const padding = opts.padding ?? 12;
  const lineHeight = opts.lineHeight ?? 1.35;
  const weight = opts.weight ?? 400;

  const innerW = Math.max(10, boxW - padding * 2);
  const innerH = Math.max(10, boxH - padding * 2);

  for (let size = max; size >= min; size -= 1) {
    const lines = wrapLines(text, size, weight, innerW);
    if (lines * size * lineHeight <= innerH) return size;
  }
  return min;
}

// Ermittelt die noetige Boxhoehe (Seitenanteil 0..1), damit ein Textfeld bei
// gegebener Breite/Schriftgroesse den Text VOLLSTAENDIG zeigt (kein
// abgeschnittener Text durch overflow:hidden). Polsterung/Zeilenhoehe
// entsprechen exakt der Darstellung in CanvasElement.tsx, damit die
// berechnete Groesse wirklich passt.
export function fitTextBoxHeight(
  text: string,
  boxWFrac: number,
  fontSize: number,
  weight = 400,
): number {
  const boxW = boxWFrac * REF_W;
  const padV = Math.max(3, fontSize * 0.35);
  const padH = padV * 1.2;
  const innerW = Math.max(10, boxW - padH * 2);
  const lines = Math.max(1, wrapLines(text, fontSize, weight, innerW));
  const heightPx = lines * fontSize * 1.35 + padV * 2;
  return heightPx / REF_H;
}

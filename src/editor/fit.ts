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
  fontFamily = "Inter, system-ui, sans-serif",
): number {
  const c = measureCtx();
  c.font = `${weight} ${fontPx}px ${fontFamily}`;
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
    fontFamily?: string;
  } = {},
): number {
  const isScript = (opts.fontFamily ?? "").toLowerCase().includes("tangerine");
  const min = opts.min ?? 9;
  const max = opts.max ?? 26;
  // Kein innerer Rand mehr (siehe CanvasElement.tsx - Textfelder rendern
  // ohne Polsterung), darum padding hier standardmaessig 0.
  const padding = opts.padding ?? 0;
  const lineHeight = opts.lineHeight ?? (isScript ? 1.7 : 1.35);
  const weight = opts.weight ?? 400;

  const innerW = Math.max(10, boxW - padding * 2);
  const innerH = Math.max(10, boxH - padding * 2);

  for (let size = max; size >= min; size -= 1) {
    const lines = wrapLines(text, size, weight, innerW, opts.fontFamily);
    if (lines * size * lineHeight <= innerH) return size;
  }
  return min;
}

// Ermittelt die noetige Boxbreite (Seitenanteil 0..1), damit ein Textfeld
// den Text bei gegebener Schriftgroesse OHNE Zeilenumbruch zeigt (nur an
// manuellen Zeilenumbruechen "\n" getrennt) - bis zu einer maximalen Breite
// (z.B. der verfuegbare Platz bis zum Seitenrand). Wird diese ueberschritten,
// bleibt die Breite bei maxWFrac stehen; der Text bricht dann dort um (die
// noetige Hoehe dafuer liefert fitTextBoxHeight()). Genutzt, damit ein
// Textfeld bei laengerem Text zuerst BREITER statt hoeher wird.
export function fitTextBoxWidth(
  text: string,
  fontSize: number,
  maxWFrac: number,
  weight = 400,
  fontFamily?: string,
): number {
  const c = measureCtx();
  c.font = `${weight} ${fontSize}px ${fontFamily ?? "Inter, system-ui, sans-serif"}`;
  let maxLineW = 0;
  for (const paragraph of text.split("\n")) {
    const w = c.measureText(paragraph).width;
    if (w > maxLineW) maxLineW = w;
  }
  // Kein innerer Rand mehr (siehe CanvasElement.tsx) - die Box braucht nur
  // exakt die gemessene Textbreite, keine zusaetzliche Polsterung.
  const maxPx = Math.max(10, maxWFrac * REF_W);
  return Math.min(maxLineW, maxPx) / REF_W;
}

// Ermittelt die noetige Boxhoehe (Seitenanteil 0..1), damit ein Textfeld bei
// gegebener Breite/Schriftgroesse den Text VOLLSTAENDIG zeigt (kein
// abgeschnittener Text durch overflow:hidden). Kein innerer Rand mehr
// (Zeilenhoehe entspricht exakt der Darstellung in CanvasElement.tsx),
// damit die berechnete Groesse wirklich passt.
export function fitTextBoxHeight(
  text: string,
  boxWFrac: number,
  fontSize: number,
  weight = 400,
  fontFamily?: string,
): number {
  // Schwungschriften (z.B. Tangerine) haben bei gleicher px-Groesse deutlich
  // ausladendere Ober-/Unterlaengen (Schnoerkel) als normale Serifen/Grotesk-
  // schriften - eine normale Zeilenhoehe reicht da nicht, sonst ueberlappen
  // Schnoerkel den naechsten Textblock.
  const isScript = (fontFamily ?? "").toLowerCase().includes("tangerine");
  const lineHeightMul = isScript ? 1.7 : 1.35;
  const boxW = boxWFrac * REF_W;
  const innerW = Math.max(10, boxW);
  const lines = Math.max(1, wrapLines(text, fontSize, weight, innerW, fontFamily));
  const heightPx = lines * fontSize * lineHeightMul;
  return heightPx / REF_H;
}

// Ermittelt die groesstmoegliche Schriftgroesse, mit der ein Text vollstaendig
// in eine Flaeche passt (mit Wortumbruch), damit nichts uebersteht.

import { REF_H, REF_W, TEXT_LINE_HEIGHT } from "./constants";

let ctx: CanvasRenderingContext2D | null = null;

function measureCtx(): CanvasRenderingContext2D {
  if (!ctx) {
    const c = document.createElement("canvas");
    ctx = c.getContext("2d");
  }
  return ctx as CanvasRenderingContext2D;
}

function wrapParagraphLines(
  paragraph: string,
  fontPx: number,
  weight: number,
  maxWidth: number,
  fontFamily = "Inter, system-ui, sans-serif",
): string[] {
  const c = measureCtx();
  c.font = `${weight} ${fontPx}px ${fontFamily}`;
  const words = paragraph.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (c.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function wrapLines(
  text: string,
  fontPx: number,
  weight: number,
  maxWidth: number,
  fontFamily = "Inter, system-ui, sans-serif",
): number {
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    lines += wrapParagraphLines(paragraph, fontPx, weight, maxWidth, fontFamily).length;
  }
  return lines;
}

// Teilt einen (langen) Text moeglichst an Absatzgrenzen in einen Teil, der
// in maxLines Zeilen passt, und einen Rest fuer eine Folgeseite - fuer die
// Pagination langer Rechtstexte (AGB/Widerrufsbelehrung) im neuen Design,
// die nicht durch Schriftverkleinerung allein lesbar auf eine Seite passen.
export function splitTextToFitLines(
  text: string,
  fontPx: number,
  weight: number,
  maxWidth: number,
  maxLines: number,
  fontFamily?: string,
): { fits: string; rest: string } {
  const paragraphs = text.split("\n");
  let usedLines = 0;
  let cut = paragraphs.length;
  for (let i = 0; i < paragraphs.length; i++) {
    const pLines = wrapParagraphLines(paragraphs[i], fontPx, weight, maxWidth, fontFamily).length;
    if (usedLines + pLines > maxLines) {
      cut = i;
      break;
    }
    usedLines += pLines;
  }
  if (cut > 0) {
    return {
      fits: paragraphs.slice(0, cut).join("\n"),
      rest: paragraphs.slice(cut).join("\n"),
    };
  }
  // Der allererste Absatz ist bereits laenger als maxLines - auf Wortebene
  // aufteilen, statt eine leere Seite zu erzeugen.
  const c = measureCtx();
  c.font = `${weight} ${fontPx}px ${fontFamily ?? "Inter, system-ui, sans-serif"}`;
  const words = paragraphs[0].split(/\s+/).filter(Boolean);
  let line = "";
  let lines = 0;
  let wordCut = words.length;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (c.measureText(test).width > maxWidth && line) {
      lines += 1;
      line = words[i];
      if (lines >= maxLines) {
        wordCut = i;
        break;
      }
    } else {
      line = test;
    }
  }
  const fitsWords = words.slice(0, wordCut).join(" ");
  const restWords = words.slice(wordCut).join(" ");
  const restParagraphs = [restWords, ...paragraphs.slice(1)].filter((p) => p.length > 0);
  return { fits: fitsWords, rest: restParagraphs.join("\n") };
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

// Abstand der Schrift-GRUNDLINIE der ersten Zeile von der OBERKANTE eines
// Textfelds, als Anteil der Referenz-Seitenhoehe. Ein Textfeld rendert seinen
// Text immer oben beginnend (siehe CanvasElement.tsx), die Grundlinie liegt
// darin um den halben Durchschuss plus die Oberlaenge (Ascent) nach unten
// versetzt - genau dieses CSS-Modell wird hier nachgerechnet.
//
// Nutzt bewusst die ECHTEN Metriken der tatsaechlich geladenen Schrift
// (fontBoundingBoxAscent/-Descent) statt eines festen Schaetzwerts: die
// Schwungschrift (Tangerine) hat deutlich andere Ober-/Unterlaengen als die
// Grotesk-Schrift, ein pauschaler Faktor waere fuer eine der beiden immer
// falsch. Gebraucht, um ein Element an seiner Schrift-Grundlinie statt an
// seiner Boxoberkante auszurichten (z.B. die Seitenzahl, deren Abstand zur
// Seitenunterkante sich auf die Grundlinie bezieht).
export function textBaselineOffsetFrac(
  fontSize: number,
  weight = 400,
  fontFamily?: string,
): number {
  const c = measureCtx();
  c.font = `${weight} ${fontSize}px ${fontFamily ?? "Inter, system-ui, sans-serif"}`;
  const m = c.measureText("0");
  // Fallback fuer den (theoretischen) Fall fehlender Metriken: grobe
  // Standardaufteilung 80/20, damit die Rechnung nie NaN liefert.
  const ascent = m.fontBoundingBoxAscent ?? fontSize * 0.8;
  const descent = m.fontBoundingBoxDescent ?? fontSize * 0.2;
  const halfLeading = (fontSize * TEXT_LINE_HEIGHT - (ascent + descent)) / 2;
  return (halfLeading + ascent) / REF_H;
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

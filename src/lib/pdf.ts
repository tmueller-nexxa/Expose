// Rendert die erste Seite eines PDF in eine Bild-DataURL (fuer Vorschau
// und KI-Analyse). Faellt bei Fehlern still auf null zurueck.

import * as pdfjsLib from "pdfjs-dist";
// Vite loest den Worker als URL auf.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export async function pdfFirstPageToImage(
  dataUrl: string,
  maxWidth = 900,
): Promise<string | null> {
  try {
    const base64 = dataUrl.split(",")[1] ?? "";
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(maxWidth / viewport.width, 2);
    const scaled = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(scaled.width);
    canvas.height = Math.ceil(scaled.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    await page.render({ canvasContext: ctx, viewport: scaled }).promise;
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch (err) {
    console.warn("PDF-Vorschau fehlgeschlagen:", err);
    return null;
  }
}

// Rendert bis zu maxPages Seiten eines PDF in Bild-DataURLs.
// onProgress(done, total) meldet den Render-Fortschritt.
export async function pdfAllPagesToImages(
  dataUrl: string,
  maxPages = 8,
  maxWidth = 900,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const out: string[] = [];
  try {
    const base64 = dataUrl.split(",")[1] ?? "";
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const count = Math.min(pdf.numPages, maxPages);
    onProgress?.(0, count);
    for (let i = 1; i <= count; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const scale = Math.min(maxWidth / viewport.width, 2);
      const scaled = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(scaled.width);
      canvas.height = Math.ceil(scaled.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport: scaled }).promise;
      out.push(canvas.toDataURL("image/jpeg", 0.82));
      // Canvas freigeben (Speicher bei vielen Seiten).
      canvas.width = 0;
      canvas.height = 0;
      onProgress?.(i, count);
    }
  } catch (err) {
    console.warn("PDF-Seiten-Rendering fehlgeschlagen:", err);
  }
  return out;
}

export interface RenderedPage {
  image: string; // DataURL
  text: string; // extrahierter Seitentext (exakt)
  imageCount: number; // Anzahl Bild-Operatoren auf der Seite
}

// Rendert Seiten UND extrahiert Text + Bildanzahl (fuer Standardseiten-Erkennung).
export async function renderPdfPages(
  dataUrl: string,
  maxPages = 40,
  maxWidth = 1000,
  onProgress?: (done: number, total: number) => void,
): Promise<RenderedPage[]> {
  const out: RenderedPage[] = [];
  try {
    const base64 = dataUrl.split(",")[1] ?? "";
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const count = Math.min(pdf.numPages, maxPages);
    onProgress?.(0, count);
    for (let i = 1; i <= count; i++) {
      const page = await pdf.getPage(i);

      // Text extrahieren.
      let text = "";
      try {
        const tc = await page.getTextContent();
        text = tc.items
          .map((it) => ("str" in it ? (it as { str: string }).str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
      } catch {
        /* ohne Textebene -> leer */
      }

      // Bildanzahl aus der Operatorliste.
      let imageCount = 0;
      try {
        const ops = await page.getOperatorList();
        const O = pdfjsLib.OPS;
        for (const fn of ops.fnArray) {
          if (
            fn === O.paintImageXObject ||
            fn === O.paintInlineImageXObject ||
            fn === O.paintImageMaskXObject
          )
            imageCount++;
        }
      } catch {
        /* ignore */
      }

      // Rendern.
      const viewport = page.getViewport({ scale: 1 });
      const scale = Math.min(maxWidth / viewport.width, 2);
      const scaled = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(scaled.width);
      canvas.height = Math.ceil(scaled.height);
      const ctx = canvas.getContext("2d");
      let image = "";
      if (ctx) {
        await page.render({ canvasContext: ctx, viewport: scaled }).promise;
        image = canvas.toDataURL("image/jpeg", 0.82);
        canvas.width = 0;
        canvas.height = 0;
      }
      out.push({ image, text, imageCount });
      onProgress?.(i, count);
    }
  } catch (err) {
    console.warn("PDF-Seiten-Verarbeitung fehlgeschlagen:", err);
  }
  return out;
}

export async function pdfPageCount(dataUrl: string): Promise<number> {
  try {
    const base64 = dataUrl.split(",")[1] ?? "";
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    return pdf.numPages;
  } catch {
    return 0;
  }
}

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

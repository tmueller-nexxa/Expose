// Rendert die erste Seite eines PDF in eine Bild-DataURL (fuer Vorschau
// und KI-Analyse). Faellt bei Fehlern still auf null zurueck.

import * as pdfjsLib from "pdfjs-dist";
// Vite loest den Worker als URL auf.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Liest die PDF-Bytes aus einer "data:"-URI ODER (bei in die Cloud
// ausgelagerten Dateien, siehe cloud.ts/offloadBlobs) aus einer echten
// https-URL (z.B. Firebase-Storage-Downloadlink) - StoredFile.dataUrl kann
// nach einem Neuladen der Seite im Cloud-Modus beides sein.
async function toBytes(dataUrl: string): Promise<Uint8Array> {
  if (dataUrl.startsWith("data:")) {
    const base64 = dataUrl.split(",")[1] ?? "";
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  }
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error(`PDF-Download fehlgeschlagen (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function pdfFirstPageToImage(
  dataUrl: string,
  maxWidth = 900,
): Promise<string | null> {
  try {
    const bytes = await toBytes(dataUrl);
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
    const bytes = await toBytes(dataUrl);
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
  // Anzahl Vektor-Pfad-Operatoren - unterscheidet eine gezeichnete Seite
  // (Grundriss/Plan: sehr viele Pfade) von einer reinen Textseite (nur
  // vereinzelte Linien/Kaesten). Zusammen mit text/imageCount die Grundlage
  // dafuer, Datenblatt-Textseiten NICHT als Fotos zu verwenden (siehe
  // KiExposePage.tsx).
  pathCount: number;
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
    const bytes = await toBytes(dataUrl);
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const count = Math.min(pdf.numPages, maxPages);
    onProgress?.(0, count);
    for (let i = 1; i <= count; i++) {
      const page = await pdf.getPage(i);

      // Text extrahieren - zeilenweise (nicht alles zu einem Textklumpen
      // zusammengefasst), damit Absaetze/nummerierte Abschnitte (wichtig bei
      // AGB/Widerrufsbelehrung) erhalten bleiben. Ein Sprung der Y-Position
      // zwischen zwei Textfragmenten (oder pdf.js' eigenes hasEOL-Flag)
      // markiert einen Zeilenumbruch.
      let text = "";
      try {
        const tc = await page.getTextContent();
        const lines: string[] = [];
        let currentLine = "";
        let lastY: number | null = null;
        for (const raw of tc.items) {
          if (!("str" in raw)) continue;
          const it = raw as { str: string; transform?: number[]; hasEOL?: boolean };
          const y = it.transform?.[5] ?? 0;
          if (lastY !== null && Math.abs(y - lastY) > 2 && currentLine) {
            lines.push(currentLine.trim());
            currentLine = "";
          }
          if (it.str) {
            currentLine += currentLine && !currentLine.endsWith(" ") && !it.str.startsWith(" ") ? ` ${it.str}` : it.str;
          }
          lastY = y;
          if (it.hasEOL) {
            lines.push(currentLine.trim());
            currentLine = "";
            lastY = null;
          }
        }
        if (currentLine.trim()) lines.push(currentLine.trim());
        text = lines
          .filter(Boolean)
          .join("\n")
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      } catch {
        /* ohne Textebene -> leer */
      }

      // Bild- und Pfadanzahl aus der Operatorliste.
      let imageCount = 0;
      let pathCount = 0;
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
          if (fn === O.constructPath) pathCount++;
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
      out.push({ image, text, imageCount, pathCount });
      onProgress?.(i, count);
    }
  } catch (err) {
    console.warn("PDF-Seiten-Verarbeitung fehlgeschlagen:", err);
  }
  return out;
}

// Liest NUR die Textebene der ersten Seiten - ohne die Seiten zu rendern.
// Gebraucht, wenn allein der Text zaehlt (z.B. die Objektanschrift aus einem
// frisch hochgeladenen Datenblatt): das Rendern ist der mit Abstand teuerste
// Teil von renderPdfPages() und waere hier reine Wartezeit fuer nichts.
export async function extractPdfText(dataUrl: string, maxPages = 3): Promise<string> {
  const parts: string[] = [];
  try {
    const bytes = await toBytes(dataUrl);
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const count = Math.min(pdf.numPages, maxPages);
    for (let i = 1; i <= count; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const line = tc.items
        .map((raw) => ("str" in raw ? (raw as { str: string }).str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (line) parts.push(line);
    }
  } catch (err) {
    console.warn("PDF-Textextraktion fehlgeschlagen:", err);
  }
  return parts.join("\n");
}

export async function pdfPageCount(dataUrl: string): Promise<number> {
  try {
    const bytes = await toBytes(dataUrl);
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    return pdf.numPages;
  } catch {
    return 0;
  }
}

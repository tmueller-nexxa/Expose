// Entfernt (uebermalt) Bildbereiche aus einer Seiten-Rastergrafik - genutzt,
// um erkannte Fotos aus dem 1:1-Hintergrund der Standardseiten tatsaechlich
// zu ENTFERNEN (nicht nur mit einem Platzhalter zu ueberdecken).

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bild konnte nicht geladen werden."));
    img.src = src;
  });
}

// Ermittelt eine plausible Fuellfarbe fuer einen Bereich. Probiert mehrere
// Streifen in wachsendem Abstand rund um den Bereich (oben/links, nah und
// weiter weg) und verwendet nur eine Farbe, die wie ein ruhiger Seiten-
// hintergrund aussieht (hell, wenig gesaettigt). So faellt die Ermittlung
// nicht selbst auf Fotopixel herein, falls der erkannte Bereich das
// tatsaechliche Foto minimal unterschaetzt (dann waeren die direkt
// angrenzenden Pixel noch Teil des Fotos). Findet sich nichts Plausibles,
// wird schlicht Weiss verwendet - fuer Text-/Rechtsseiten der ueberwiegend
// richtige Normalfall.
function sampleFillColor(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  pw: number,
  ph: number,
  canvasW: number,
  canvasH: number,
): string {
  const sample = (
    x: number,
    y: number,
    w: number,
    h: number,
  ): [number, number, number] | null => {
    if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > canvasW || y + h > canvasH) {
      return null;
    }
    try {
      const data = ctx.getImageData(x, y, w, h).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
      if (n === 0) return null;
      return [r / n, g / n, b / n];
    } catch {
      return null;
    }
  };

  // Hell UND wenig gesaettigt = sieht nach normalem Seitenhintergrund aus,
  // nicht nach einem Foto-Ausschnitt.
  const isPlausibleBackground = ([r, g, b]: [number, number, number]) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max - min < 40 && (r + g + b) / 3 > 170;
  };

  const distances = [6, 18, 36, 60];
  for (const d of distances) {
    const above = sample(px, Math.max(0, py - d - 3), pw, 3);
    if (above && isPlausibleBackground(above)) return rgbString(above);
    const left = sample(Math.max(0, px - d - 3), py, 3, ph);
    if (left && isPlausibleBackground(left)) return rgbString(left);
  }
  return "#ffffff";
}

function rgbString([r, g, b]: [number, number, number]): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

// Malt die angegebenen Bereiche (Anteile 0..1) mit einer plausiblen
// Hintergrundfarbe zu - das Foto ist danach wirklich weg, nicht nur verdeckt.
export async function eraseRegionsFromImage(
  imageDataUrl: string,
  rects: Rect[],
): Promise<string> {
  if (rects.length === 0) return imageDataUrl;
  try {
    const img = await loadImage(imageDataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return imageDataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    for (const r of rects) {
      const px = Math.round(r.x * canvas.width);
      const py = Math.round(r.y * canvas.height);
      const pw = Math.max(1, Math.round(r.w * canvas.width));
      const ph = Math.max(1, Math.round(r.h * canvas.height));
      const fill = sampleFillColor(ctx, px, py, pw, ph, canvas.width, canvas.height);
      ctx.fillStyle = fill;
      ctx.fillRect(px, py, pw, ph);
    }

    return canvas.toDataURL("image/jpeg", 0.9);
  } catch (err) {
    console.warn("Foto-Entfernung fehlgeschlagen, Original wird beibehalten:", err);
    return imageDataUrl;
  }
}

// Verwandelt ein Logo (i.d.R. dunkle Form auf hellem/transparentem
// Hintergrund) in eine reinweisse Silhouette mit transparentem Hintergrund -
// damit es sich als Badge direkt auf einem Titelbild freistellen laesst,
// ohne eigene Hintergrundflaeche zu brauchen. Dunkle Pixel werden weiss und
// deckend, helle Pixel transparent; die urspruengliche Helligkeit steuert
// die Deckkraft, damit Kantenglaettung erhalten bleibt.
export async function invertLogoToWhite(imageDataUrl: string): Promise<string> {
  try {
    const img = await loadImage(imageDataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return imageDataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const luminance = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255; // 0 schwarz .. 1 weiss
      const inkAlpha = (1 - luminance) * (d[i + 3] / 255);
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = Math.round(inkAlpha * 255);
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL("image/png");
  } catch (err) {
    console.warn("Logo-Invertierung fehlgeschlagen, Original wird beibehalten:", err);
    return imageDataUrl;
  }
}

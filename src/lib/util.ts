// Allgemeine Hilfsfunktionen.

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(
    36,
  )}`;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// DataURL -> { mediaType, base64 } fuer die Anthropic-API. Erkennt auch
// echte https-URLs (in die Cloud ausgelagerte Dateien, siehe
// cloud.ts/offloadBlobs - StoredFile.dataUrl/ImageElement.src kann nach
// einem Neuladen der Seite im Cloud-Modus ein Firebase-Storage-Link statt
// einer "data:"-URI sein) und laedt sie bei Bedarf nach.
export async function splitDataUrl(dataUrl: string): Promise<{
  mediaType: string;
  base64: string;
}> {
  if (!dataUrl.startsWith("data:")) {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const reader = new FileReader();
      const asDataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      return splitDataUrl(asDataUrl);
    } catch {
      return { mediaType: "image/jpeg", base64: "" };
    }
  }
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) return { mediaType: "image/jpeg", base64: "" };
  return { mediaType: match[1], base64: match[2] };
}

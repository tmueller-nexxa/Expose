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

// Baut den Namen eines archivierten Exposés nach dem vereinbarten Muster:
//   Expose001-Am Waldberg3-Lüdenscheid
// Also laufende Nummer (mindestens dreistellig), Strasse MIT direkt
// angehaengter Hausnummer (das Leerzeichen davor faellt weg) und Ort, jeweils
// mit Bindestrich getrennt. Fehlt ein Teil der Adresse, entfaellt er samt
// Trennstrich, damit kein Name wie "Expose001--Lüdenscheid" entsteht.
//
// Zeichen, die in Dateinamen Aerger machen (Pfadtrenner, Doppelpunkt,
// Platzhalter), werden entfernt - der Name landet beim Export als
// Dateiname und muss darum auf allen Systemen benutzbar bleiben.
export function buildExposeName(
  exposeNo: number,
  street: string,
  city: string,
): string {
  const clean = (s: string) =>
    s
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  // "Am Waldberg 3" -> "Am Waldberg3": nur das Leerzeichen VOR der
  // abschliessenden Hausnummer entfaellt, Leerzeichen innerhalb des
  // Strassennamens bleiben erhalten.
  const compactStreet = clean(street).replace(/\s+(\d+\s*[a-zA-Z]?)$/, "$1");
  const parts = [
    `Expose${String(Math.max(0, exposeNo)).padStart(3, "0")}`,
    compactStreet,
    clean(city),
  ].filter(Boolean);
  return parts.join("-");
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

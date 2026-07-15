// Anbindung an die Anthropic Claude API (Vision + Texterzeugung).
//
// Zwei Betriebsarten:
//  - Server-Proxy (aiProxyUrl konfiguriert): Aufruf laeuft ueber eine Cloud
//    Function, die den Anthropic-Key serverseitig geheim haelt. Erfordert
//    eine angemeldete Sitzung (Firebase-ID-Token).
//  - Direkt (kein Proxy konfiguriert): Aufruf laeuft direkt aus dem Browser
//    mit dem vom Makler im Datenbereich hinterlegten API-Key (lokaler Modus).

import type {
  ApiSettings,
  ExposeType,
  LayoutBlock,
  LayoutPage,
  StyleText,
} from "./types";
import { splitDataUrl } from "./util";
import { aiProxyUrl } from "../firebase.config";
import { currentToken } from "./cloud";

const API_URL = "https://api.anthropic.com/v1/messages";

// Ist die KI grundsaetzlich aufrufbar? (Proxy konfiguriert ODER eigener Key.)
export function aiReady(api: ApiSettings): boolean {
  return Boolean(aiProxyUrl) || Boolean(api.apiKey);
}

export const MODEL_OPTIONS = [
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 (empfohlen · schnell & guenstig)" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 (hoechste Qualitaet)" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (am schnellsten)" },
];

const TYPE_LABEL: Record<ExposeType, string> = {
  einfamilienhaus: "Einfamilienhaus",
  wohnung: "Eigentumswohnung",
  mehrfamilienhaus: "Mehrfamilienhaus / Kapitalanlage",
  gewerbe: "Gewerbeimmobilie",
};

export interface AiError {
  ok: false;
  message: string;
}

export interface ImageTextResult {
  ok: true;
  headline: string;
  text: string;
  important: string;
  safeArea: { x: number; y: number; w: number; h: number };
}

interface AnthropicToolUse {
  type: string;
  name?: string;
  input?: Record<string, unknown>;
}

async function callAnthropic(
  api: ApiSettings,
  body: Record<string, unknown>,
): Promise<{ content: AnthropicToolUse[] }> {
  const useProxy = Boolean(aiProxyUrl);
  let res: Response;

  try {
    if (useProxy) {
      const tokenPromise = currentToken();
      const token = tokenPromise ? await tokenPromise : null;
      if (!token) {
        throw new AiCallError(
          "Sie sind nicht angemeldet. Bitte neu anmelden und erneut versuchen.",
        );
      }
      res = await fetch(aiProxyUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    } else {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": api.apiKey,
          "anthropic-version": "2023-06-01",
          // Erlaubt den direkten Aufruf aus dem Browser (CORS).
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });
    }
  } catch (e) {
    if (e instanceof AiCallError) throw e;
    // Netzwerk-/CORS-Fehler (fetch wirft) -> haeufig blockierte Umgebung.
    throw new Error(
      (useProxy
        ? "Die KI-Funktion (Cloud Function) konnte nicht erreicht werden. Bitte pruefen, ob sie deployt ist."
        : "Die KI-Schnittstelle konnte nicht erreicht werden. In der Online-Vorschau/im Artifact sind externe Aufrufe blockiert – bitte die App lokal (npm run dev) oder deployt mit gültigem Anthropic-Key ausführen.") +
        " Details: " +
        (e as Error).message,
    );
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      detail = j?.error?.message || detail;
    } catch {
      /* ignore */
    }
    if (res.status === 401) {
      detail = useProxy
        ? "Sitzung abgelaufen. Bitte neu anmelden."
        : "API-Key ungültig oder nicht autorisiert (401). Bitte den Anthropic-Key im Datenbereich prüfen.";
    }
    throw new Error(detail);
  }
  return res.json();
}

class AiCallError extends Error {}

function buildStyleContext(styleTexts: StyleText[]): string {
  if (styleTexts.length === 0) {
    return "Es wurden keine Stilbeispiele hinterlegt. Schreibe hochwertig, sachlich-emotional und professionell im Stil eines erfahrenen Immobilienmaklers.";
  }
  const samples = styleTexts
    .map((t) => t.content.trim())
    .filter(Boolean)
    .join("\n\n---\n\n")
    .slice(0, 6000);
  return `Uebernimm exakt den Schreibstil, Tonfall, Satzbau und Wortwahl aus den folgenden Textbeispielen des Maklers:\n\n${samples}`;
}

const TEXT_TOOL = {
  name: "expose_text",
  description:
    "Liefert einen Marketing-Text zum Bild sowie einen sicheren Bereich, in dem der Text ueber das Bild gelegt werden kann, ohne wichtige Bildinhalte zu verdecken.",
  input_schema: {
    type: "object",
    properties: {
      headline: {
        type: "string",
        description: "Sehr kurze, praegnante Ueberschrift (max. 5 Woerter).",
      },
      text: {
        type: "string",
        description:
          "2-4 Saetze Marketing-Text im Schreibstil des Maklers, passend zum Bild.",
      },
      important: {
        type: "string",
        description:
          "Kurze Beschreibung, was auf dem Bild wichtig ist und NICHT verdeckt werden darf.",
      },
      safeArea: {
        type: "object",
        description:
          "Rechteck (Anteile 0..1 relativ zu Bildbreite/-hoehe) mit ruhiger Flaeche (z.B. Himmel, Rasen, Wand), auf die der Text gelegt werden kann, ohne Wichtiges zu verdecken. Breite mind. 0.35, Hoehe mind. 0.18.",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
        },
        required: ["x", "y", "w", "h"],
      },
    },
    required: ["headline", "text", "important", "safeArea"],
  },
};

// Analysiert ein Bild und erzeugt passenden Text + sichere Textflaeche.
export async function generateImageText(
  api: ApiSettings,
  imageDataUrl: string,
  type: ExposeType,
  styleTexts: StyleText[],
): Promise<ImageTextResult | AiError> {
  const { mediaType, base64 } = splitDataUrl(imageDataUrl);
  if (!base64) return { ok: false, message: "Bild konnte nicht gelesen werden." };
  if (!aiReady(api)) return { ok: false, message: "Kein API-Key hinterlegt." };

  const system = `Du bist ein erfahrener Immobilien-Texter und erstellst Exposé-Texte fuer ein ${TYPE_LABEL[type]}. ${buildStyleContext(
    styleTexts,
  )}\n\nAntworte ausschliesslich ueber das Werkzeug "expose_text".`;

  try {
    const data = await callAnthropic(api, {
      model: api.model,
      max_tokens: 700,
      system,
      tools: [TEXT_TOOL],
      tool_choice: { type: "tool", name: "expose_text" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: "Analysiere dieses Immobilienbild. Erzeuge einen passenden Exposé-Text im vorgegebenen Schreibstil und bestimme eine ruhige Flaeche (safeArea), auf der der Text platziert werden kann, ohne wichtige Bildinhalte (Gebaeude, Gesichter, markante Details) zu verdecken.",
            },
          ],
        },
      ],
    });

    const tool = data.content.find((c) => c.type === "tool_use");
    const input = tool?.input as Record<string, unknown> | undefined;
    if (!input) return { ok: false, message: "Keine Antwort von der KI erhalten." };

    const sa = (input.safeArea as ImageTextResult["safeArea"]) ?? {
      x: 0.08,
      y: 0.62,
      w: 0.6,
      h: 0.28,
    };
    return {
      ok: true,
      headline: String(input.headline ?? ""),
      text: String(input.text ?? ""),
      important: String(input.important ?? ""),
      safeArea: {
        x: clamp01(sa.x),
        y: clamp01(sa.y),
        w: clamp01(sa.w, 0.2),
        h: clamp01(sa.h, 0.12),
      },
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

// --- Layout-Analyse: Seitenstruktur aus Beispiel-Exposés ableiten -------

export interface LayoutResult {
  ok: true;
  pages: LayoutPage[];
}

const LAYOUT_TOOL = {
  name: "expose_layout",
  description:
    "Beschreibt den strukturellen Aufbau eines Exposés Seite fuer Seite als leere Vorlage (Platzhalter), damit dieser Aufbau nachgebaut werden kann.",
  input_schema: {
    type: "object",
    properties: {
      pages: {
        type: "array",
        description: "Seiten in Reihenfolge, wie im Beispiel.",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description:
                "Abschnittstitel der Seite (z.B. Titelseite, Objektbeschreibung, Lage, Ausstattung, Grundriss, Kontakt).",
            },
            blocks: {
              type: "array",
              description: "Elemente auf der Seite mit Position (Anteile 0..1).",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: ["image", "heading", "text", "logo"],
                    description:
                      "image=Bildflaeche, heading=Ueberschrift, text=Textblock, logo=Logo-Bereich.",
                  },
                  x: { type: "number" },
                  y: { type: "number" },
                  w: { type: "number" },
                  h: { type: "number" },
                  text: {
                    type: "string",
                    description:
                      "Nur bei heading/text: GENERISCHER Platzhaltertext (z.B. 'Objektbeschreibung'), KEINE echten Objektdaten aus dem Beispiel.",
                  },
                  align: {
                    type: "string",
                    enum: ["left", "center", "right"],
                  },
                },
                required: ["type", "x", "y", "w", "h"],
              },
            },
          },
          required: ["title", "blocks"],
        },
      },
    },
    required: ["pages"],
  },
};

// Analysiert einen kleinen Block von Seitenbildern (max. ~4) in EINER Anfrage.
async function analyzeLayoutChunk(
  api: ApiSettings,
  chunk: string[],
  type: ExposeType,
): Promise<LayoutPage[] | AiError> {
  const imageBlocks = chunk.map((dataUrl) => {
    const { mediaType, base64 } = splitDataUrl(dataUrl);
    return {
      type: "image" as const,
      source: { type: "base64" as const, media_type: mediaType, data: base64 },
    };
  });

  const system = `Du bist Experte fuer Layout-Analyse von Immobilien-Exposés (${TYPE_LABEL[type]}). Analysiere die gezeigten Beispielseiten und beschreibe den STRUKTURELLEN Aufbau als leere Vorlage. Wichtig: Uebernimm Anordnung, Anzahl und Position der Bild-, Text- und Ueberschriften-Bereiche sowie die Logo-Position moeglichst exakt. Bei Foto-Collagen: jedes Foto als eigenen image-Block. Verwende fuer Ueberschriften generische Abschnittstitel, NICHT die konkreten Objektdaten. Koordinaten als Anteile 0..1. Gib das Ergebnis ausschliesslich ueber das Werkzeug "expose_layout" zurueck.`;

  const data = await callAnthropic(api, {
    model: api.model,
    // Grosszuegiges Ausgabe-Budget, damit die Struktur nicht abgeschnitten wird.
    max_tokens: 4096,
    system,
    tools: [LAYOUT_TOOL],
    tool_choice: { type: "tool", name: "expose_layout" },
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: `Hier sind ${imageBlocks.length} Seite(n) eines Beispiel-Exposés in Reihenfolge. Erstelle daraus die leere Seitenstruktur (Platzhalter), eine Seite pro Bild, mit Positionen als Anteile 0..1.`,
          },
        ],
      },
    ],
  });

  const tool = data.content.find((c) => c.type === "tool_use");
  const input = tool?.input as { pages?: LayoutPage[] } | undefined;
  if (!input?.pages || input.pages.length === 0) {
    return { ok: false, message: "Die KI konnte keine Struktur ableiten." };
  }

  // Prozent-/Pixelwerte auf 0..1 normalisieren.
  let maxCoord = 0;
  for (const pg of input.pages)
    for (const b of pg.blocks ?? [])
      for (const v of [b.x, b.y, b.w, b.h]) {
        const n = Number(v);
        if (Number.isFinite(n)) maxCoord = Math.max(maxCoord, n);
      }
  const scale = maxCoord > 1.5 ? (maxCoord <= 100 ? 1 / 100 : 1 / maxCoord) : 1;
  const s = (v: unknown) => Number(v) * scale;

  const ALIGNS = new Set(["left", "center", "right"]);

  return input.pages.map((pg) => ({
    title: String(pg.title ?? "Seite").slice(0, 60),
    blocks: (pg.blocks ?? [])
      .filter((b) => b && b.type)
      .slice(0, 30)
      .map((b) => {
        // Nur tatsaechlich vorhandene optionale Felder setzen - niemals
        // "undefined" (Firestore lehnt Feldwerte mit undefined ab).
        const block: LayoutBlock = {
          type: b.type,
          x: clamp01(s(b.x)),
          y: clamp01(s(b.y)),
          w: clamp01(s(b.w), 0.02),
          h: clamp01(s(b.h), 0.01),
        };
        if (b.text) block.text = String(b.text).slice(0, 200);
        if (b.align && ALIGNS.has(b.align)) block.align = b.align;
        return block;
      }),
  }));
}

// Analysiert das Beispiel-Exposé blockweise und fuehrt die Seiten zusammen.
// Blockweise Verarbeitung verhindert, dass die Antwort bei vielen/dichten
// Seiten das Ausgabe-Limit sprengt.
export const MAX_ANALYZE_PAGES = 40;

export async function analyzeExampleLayout(
  api: ApiSettings,
  pageImages: string[],
  type: ExposeType,
  onProgress?: (pagesDone: number, pagesTotal: number) => void,
): Promise<LayoutResult | AiError> {
  if (!aiReady(api)) return { ok: false, message: "Kein API-Key hinterlegt." };
  if (pageImages.length === 0)
    return { ok: false, message: "Keine Beispielseiten zum Analysieren gefunden." };

  const imgs = pageImages.slice(0, MAX_ANALYZE_PAGES);
  const total = imgs.length;
  const BATCH = 4;
  const allPages: LayoutPage[] = [];
  const failedBatches: string[] = [];
  let done = 0;
  onProgress?.(0, total);

  for (let start = 0; start < imgs.length; start += BATCH) {
    const chunk = imgs.slice(start, start + BATCH);
    // Bis zu 3 Versuche pro Block -> robust gegen kurze Aussetzer.
    let ok = false;
    let err = "";
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        const res = await analyzeLayoutChunk(api, chunk, type);
        if (Array.isArray(res)) {
          allPages.push(...res);
          ok = true;
        } else {
          err = res.message;
        }
      } catch (e) {
        err = (e as Error).message;
      }
      if (!ok && attempt < 3) await sleep(800 * attempt);
    }
    if (!ok) failedBatches.push(err || "unbekannt");
    done += chunk.length;
    onProgress?.(done, total);
  }

  if (allPages.length === 0) {
    return {
      ok: false,
      message:
        failedBatches[0] ||
        "Die KI konnte keine Struktur ableiten. Tipp: Bei sehr umfangreichen/bildlastigen PDFs am besten nur wenige repraesentative Seiten als Bilder (JPG/PNG) hochladen oder das Modell Claude Opus 4.8 waehlen.",
    };
  }
  return { ok: true, pages: allPages };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Fotobereiche auf einer Standardseite erkennen (fuer Platzhalter) -----

const PHOTO_TOOL = {
  name: "photo_regions",
  description:
    "Liefert die Bereiche echter, austauschbarer Objekt-/Marketingfotos auf einer Exposé-Seite.",
  input_schema: {
    type: "object",
    properties: {
      photos: {
        type: "array",
        description:
          "Rechtecke echter Fotos (Anteile 0..1). NUR echte Fotografien - KEINE Logos, Icons, Zierlinien, Kopf-/Fusszeilen, Farbflaechen oder Text.",
        items: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            w: { type: "number" },
            h: { type: "number" },
          },
          required: ["x", "y", "w", "h"],
        },
      },
    },
    required: ["photos"],
  },
};

export async function analyzeBoilerplatePhotos(
  api: ApiSettings,
  imageDataUrl: string,
): Promise<{ ok: true; rects: { x: number; y: number; w: number; h: number }[] } | AiError> {
  const { mediaType, base64 } = splitDataUrl(imageDataUrl);
  if (!base64) return { ok: false, message: "Seitenbild konnte nicht gelesen werden." };
  if (!aiReady(api)) return { ok: false, message: "Kein API-Key hinterlegt." };

  try {
    const data = await callAnthropic(api, {
      model: api.model,
      max_tokens: 600,
      system:
        "Du erkennst auf einer Immobilien-Exposé-Seite ausschliesslich echte, austauschbare Fotografien (z.B. Fotos von Raeumen, Gebaeuden, Personen, Landschaften). " +
        "KEINE Fotos sind: Logos, Icons, Zierlinien, Kopf-/Fusszeilen, Text, sowie GROSSFLAECHIGE Hintergrund-/Dekor-Elemente wie farbige oder graue Balken, Seitenleisten, Verlaeufe oder Rahmen - auch wenn diese wie ein Bild aussehen. " +
        "Ein echtes Foto ist in der Regel eine klar begrenzte, in sich geschlossene Aufnahme, NIEMALS ein Element, das ueber die gesamte Seitenhoehe oder den gesamten Seitenrand laeuft. " +
        "Koordinaten sind Anteile 0..1 der Seitenbreite/-hoehe, Ursprung oben links; x+w darf 1 nicht ueberschreiten, y+h darf 1 nicht ueberschreiten. " +
        "Bei Unsicherheit lieber gar kein Rechteck zurueckgeben als ein falsches. Antworte nur ueber das Werkzeug photo_regions.",
      tools: [PHOTO_TOOL],
      tool_choice: { type: "tool", name: "photo_regions" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: "Markiere die Bereiche echter Fotos auf dieser Seite (Anteile 0..1). Wenn keine echten Fotos vorhanden sind, gib eine leere Liste zurueck.",
            },
          ],
        },
      ],
    });
    const tool = data.content.find((c) => c.type === "tool_use");
    const input = tool?.input as
      | { photos?: { x: number; y: number; w: number; h: number }[] }
      | undefined;
    const raw = input?.photos ?? [];
    let maxCoord = 0;
    for (const r of raw)
      for (const v of [r.x, r.y, r.w, r.h]) {
        const n = Number(v);
        if (Number.isFinite(n)) maxCoord = Math.max(maxCoord, n);
      }
    const scale = maxCoord > 1.5 ? (maxCoord <= 100 ? 1 / 100 : 1 / maxCoord) : 1;
    const rects = raw
      .map((r) => {
        const x = clamp01(Number(r.x) * scale);
        const y = clamp01(Number(r.y) * scale);
        // w/h zusaetzlich so begrenzen, dass das Rechteck nie ueber den
        // rechten/unteren Seitenrand hinausragt (verhindert "spilling over").
        const w = clamp01(Math.min(Number(r.w) * scale, 1 - x), 0.03);
        const h = clamp01(Math.min(Number(r.h) * scale, 1 - y), 0.03);
        return { x, y, w, h };
      })
      // Nur nennenswert grosse, aber plausible Fotos: kleine Treffer sind
      // wohl Logos/Icons, sehr grossflaechige (fast volle Seitenhoehe/-breite
      // UND deutliche Ausdehnung) sind typischerweise faelschlich erkannte
      // Hintergrund-/Dekor-Panels, keine echten Fotos.
      .filter(
        (r) =>
          r.w >= 0.12 &&
          r.h >= 0.08 &&
          !(r.h > 0.85 && r.w > 0.3) &&
          !(r.w > 0.85 && r.h > 0.3) &&
          r.w * r.h <= 0.55,
      );
    return { ok: true, rects };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

// Kurzer Verbindungstest fuer den Keys-Bereich.
export async function testApiKey(api: ApiSettings): Promise<AiError | { ok: true }> {
  if (!aiReady(api))
    return {
      ok: false,
      message: aiProxyUrl
        ? "Bitte zuerst anmelden."
        : "Bitte zuerst einen API-Key eingeben.",
    };
  try {
    await callAnthropic(api, {
      model: api.model,
      max_tokens: 16,
      messages: [{ role: "user", content: "Antworte nur mit: OK" }],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

function clamp01(v: unknown, min = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(1, Math.max(min, n));
}

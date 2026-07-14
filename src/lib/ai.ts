// Anbindung an die Anthropic Claude API (Vision + Texterzeugung).
// Laeuft direkt im Browser mit dem vom Makler hinterlegten API-Key.

import type {
  ApiSettings,
  ExposeType,
  LayoutPage,
  StyleText,
} from "./types";
import { splitDataUrl } from "./util";

const API_URL = "https://api.anthropic.com/v1/messages";

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
  const res = await fetch(API_URL, {
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

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      detail = j?.error?.message || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

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
  if (!api.apiKey) return { ok: false, message: "Kein API-Key hinterlegt." };

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

// Analysiert die Seitenbilder eines Beispiel-Exposés und liefert die Struktur.
export async function analyzeExampleLayout(
  api: ApiSettings,
  pageImages: string[],
  type: ExposeType,
): Promise<LayoutResult | AiError> {
  if (!api.apiKey) return { ok: false, message: "Kein API-Key hinterlegt." };
  if (pageImages.length === 0)
    return { ok: false, message: "Keine Beispielseiten zum Analysieren gefunden." };

  const imageBlocks = pageImages.slice(0, 8).map((dataUrl) => {
    const { mediaType, base64 } = splitDataUrl(dataUrl);
    return {
      type: "image" as const,
      source: { type: "base64" as const, media_type: mediaType, data: base64 },
    };
  });

  const system = `Du bist Experte fuer Layout-Analyse von Immobilien-Exposés (${TYPE_LABEL[type]}). Analysiere die gezeigten Beispielseiten und beschreibe den STRUKTURELLEN Aufbau als leere Vorlage. Wichtig: Uebernimm Anordnung, Anzahl und Position der Bild-, Text- und Ueberschriften-Bereiche sowie die Logo-Position moeglichst exakt. Verwende fuer Ueberschriften generische Abschnittstitel, NICHT die konkreten Objektdaten. Gib das Ergebnis ausschliesslich ueber das Werkzeug "expose_layout" zurueck.`;

  try {
    const data = await callAnthropic(api, {
      model: api.model,
      max_tokens: 3000,
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
              text: `Hier sind ${imageBlocks.length} Seite(n) eines Beispiel-Exposés in Reihenfolge. Erstelle daraus die leere Seitenstruktur (Platzhalter) mit Positionen als Anteile 0..1.`,
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
    // Normalisieren / begrenzen.
    const pages: LayoutPage[] = input.pages.slice(0, 12).map((pg) => ({
      title: String(pg.title ?? "Seite").slice(0, 60),
      blocks: (pg.blocks ?? [])
        .filter((b) => b && b.type)
        .slice(0, 24)
        .map((b) => ({
          type: b.type,
          x: clamp01(b.x),
          y: clamp01(b.y),
          w: clamp01(b.w, 0.02),
          h: clamp01(b.h, 0.01),
          text: b.text ? String(b.text).slice(0, 200) : undefined,
          align: b.align,
        })),
    }));
    return { ok: true, pages };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

// Kurzer Verbindungstest fuer den Keys-Bereich.
export async function testApiKey(api: ApiSettings): Promise<AiError | { ok: true }> {
  if (!api.apiKey) return { ok: false, message: "Bitte zuerst einen API-Key eingeben." };
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

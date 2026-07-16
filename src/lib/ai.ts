// Anbindung an die Anthropic Claude API (Vision + Texterzeugung).
//
// Zwei Betriebsarten:
//  - Server-Proxy (aiProxyUrl konfiguriert): Aufruf laeuft ueber eine Cloud
//    Function, die den Anthropic-Key serverseitig geheim haelt. Erfordert
//    eine angemeldete Sitzung (Firebase-ID-Token).
//  - Direkt (kein Proxy konfiguriert): Aufruf laeuft direkt aus dem Browser
//    mit dem vom Makler im Datenbereich hinterlegten API-Key (lokaler Modus).

import type { ApiSettings, ExposeType, Rect, StyleText } from "./types";
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

// --- Regionserkennung: Foto- (und bei Inhaltsseiten Text-)bereiche ------
//
// Jede Seite eines Beispiel-Exposés wird 1:1 als Bild uebernommen. Die KI
// erkennt darauf lediglich Rechtecke: echte Fotos (auf ALLEN Seiten) sowie,
// bei Inhaltsseiten, zusaetzlich alle Textbereiche (die entfernt werden,
// da sie objektspezifisch sind). Design, Icons, Farben, Rahmen bleiben
// unangetastet, da nur die erkannten Rechtecke aus dem Bild entfernt werden.

interface RegionSet {
  photos: Rect[];
  texts: Rect[];
}

const REGION_TOOL = {
  name: "page_regions",
  description:
    "Liefert pro Seite die Bereiche echter Fotos sowie (falls angefordert) aller Textstellen.",
  input_schema: {
    type: "object",
    properties: {
      pages: {
        type: "array",
        description: "Ergebnis in EXAKT der Reihenfolge der uebergebenen Seitenbilder, eines pro Bild.",
        items: {
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
            texts: {
              type: "array",
              description:
                "Nur falls angefordert: Rechtecke ALLER Textstellen (Ueberschriften, Absaetze, Labels, Zahlen, Aufzaehlungen) - unabhaengig davon, ob der Text objektspezifisch oder statisch wirkt.",
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
      },
    },
    required: ["pages"],
  },
};

function normalizeRects(raw: { x: unknown; y: unknown; w: unknown; h: unknown }[]): Rect[] {
  let maxCoord = 0;
  for (const r of raw)
    for (const v of [r.x, r.y, r.w, r.h]) {
      const n = Number(v);
      if (Number.isFinite(n)) maxCoord = Math.max(maxCoord, n);
    }
  const scale = maxCoord > 1.5 ? (maxCoord <= 100 ? 1 / 100 : 1 / maxCoord) : 1;
  // Kleiner Sicherheitsrand: schaetzt die KI die Grenzen minimal zu knapp,
  // bliebe sonst ein Rand des Originals hinter dem Platzhalter sichtbar.
  const MARGIN = 0.02;
  return raw.map((r) => {
    const x = clamp01(Number(r.x) * scale - MARGIN);
    const y = clamp01(Number(r.y) * scale - MARGIN);
    const w = clamp01(Math.min(Number(r.w) * scale + MARGIN * 2, 1 - x), 0.02);
    const h = clamp01(Math.min(Number(r.h) * scale + MARGIN * 2, 1 - y), 0.01);
    return { x, y, w, h };
  });
}

// Analysiert einen kleinen Block von Seitenbildern (max. ~4) in EINER Anfrage.
async function analyzeRegionsChunk(
  api: ApiSettings,
  chunk: string[],
  includeText: boolean,
): Promise<RegionSet[] | AiError> {
  const imageBlocks = chunk.map((dataUrl) => {
    const { mediaType, base64 } = splitDataUrl(dataUrl);
    return {
      type: "image" as const,
      source: { type: "base64" as const, media_type: mediaType, data: base64 },
    };
  });

  const textInstruction = includeText
    ? "Markiere ZUSAETZLICH ALLE Textstellen auf jeder Seite als Rechtecke in \"texts\" - jede Ueberschrift, jeden Absatz, jedes Label, jede Zahl/Aufzaehlung. Erfasse wirklich saemtlichen sichtbaren Text, unabhaengig davon, ob er wie ein fester Vorlagentext oder wie objektspezifischer Inhalt wirkt. Icons, Logos, Rahmen, Farbflaechen und Fotos sind KEIN Text."
    : "Gib \"texts\" als leeres Array zurueck (auf dieser Seite bleibt aller Text erhalten).";

  const system =
    "Du erkennst auf Immobilien-Exposé-Seiten praezise Bildbereiche. " +
    "Fotos: ausschliesslich echte, austauschbare Fotografien (Raeume, Gebaeude, Personen, Landschaften). " +
    "KEINE Fotos sind: Logos, Icons, Zierlinien, Kopf-/Fusszeilen, Text, sowie grossflaechige Hintergrund-/Dekor-Elemente wie farbige oder graue Balken, Seitenleisten, Verlaeufe oder Rahmen - auch wenn diese wie ein Bild aussehen. " +
    "Ein echtes Foto ist eine klar begrenzte, in sich geschlossene Aufnahme, niemals ein Element, das ueber die gesamte Seitenhoehe oder den gesamten Seitenrand laeuft. " +
    textInstruction +
    " Koordinaten sind Anteile 0..1 der Seitenbreite/-hoehe, Ursprung oben links; x+w darf 1 nicht ueberschreiten, y+h darf 1 nicht ueberschreiten. " +
    "Antworte ausschliesslich ueber das Werkzeug \"page_regions\" mit GENAU einem Eintrag pro uebergebenem Seitenbild, in derselben Reihenfolge.";

  const data = await callAnthropic(api, {
    model: api.model,
    max_tokens: 2048,
    system,
    tools: [REGION_TOOL],
    tool_choice: { type: "tool", name: "page_regions" },
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: `Hier sind ${imageBlocks.length} Seite(n) eines Beispiel-Exposés in Reihenfolge. Erkenne pro Seite die Fotobereiche${includeText ? " und alle Textbereiche" : ""}.`,
          },
        ],
      },
    ],
  });

  const tool = data.content.find((c) => c.type === "tool_use");
  const input = tool?.input as { pages?: { photos?: Rect[]; texts?: Rect[] }[] } | undefined;
  if (!input?.pages) {
    return { ok: false, message: "Die KI konnte keine Bereiche erkennen." };
  }

  // Defensiv auf die Chunk-Laenge ausrichten (padden/kuerzen), damit die
  // Positionszuordnung zu den Originalseiten nicht verrutscht.
  const pages = input.pages.slice(0, chunk.length);
  while (pages.length < chunk.length) pages.push({ photos: [], texts: [] });

  return pages.map((pg) => ({
    photos: normalizeRects((pg.photos ?? []).filter((r) => r)).filter(
      (r) => r.w >= 0.12 && r.h >= 0.08 && !(r.h > 0.97 && r.w > 0.97),
    ),
    texts: includeText ? normalizeRects((pg.texts ?? []).filter((r) => r)) : [],
  }));
}

// Analysiert alle Seitenbilder blockweise und fuehrt die Ergebnisse
// zusammen. Blockweise Verarbeitung + Retries verhindert, dass die Antwort
// bei vielen Seiten das Ausgabe-Limit sprengt oder ein Ausreisser die ganze
// Analyse abbricht; bei endgueltigem Fehlschlag wird pro Seite ein leeres
// Ergebnis eingetragen, damit die Seitenreihenfolge erhalten bleibt.
export const MAX_ANALYZE_PAGES = 40;

export async function analyzePagesRegions(
  api: ApiSettings,
  pageImages: string[],
  includeText: boolean,
  onProgress?: (pagesDone: number, pagesTotal: number) => void,
): Promise<{ ok: true; pages: RegionSet[] } | AiError> {
  if (!aiReady(api)) return { ok: false, message: "Kein API-Key hinterlegt." };
  if (pageImages.length === 0)
    return { ok: false, message: "Keine Seiten zum Analysieren gefunden." };

  const imgs = pageImages.slice(0, MAX_ANALYZE_PAGES);
  const total = imgs.length;
  const BATCH = 4;
  const allPages: RegionSet[] = [];
  let firstError = "";
  let done = 0;
  onProgress?.(0, total);

  for (let start = 0; start < imgs.length; start += BATCH) {
    const chunk = imgs.slice(start, start + BATCH);
    let result: RegionSet[] | null = null;
    let err = "";
    for (let attempt = 1; attempt <= 3 && !result; attempt++) {
      try {
        const res = await analyzeRegionsChunk(api, chunk, includeText);
        if (Array.isArray(res)) {
          result = res;
        } else {
          err = res.message;
        }
      } catch (e) {
        err = (e as Error).message;
      }
      if (!result && attempt < 3) await sleep(800 * attempt);
    }
    if (result) {
      allPages.push(...result);
    } else {
      firstError = firstError || err || "unbekannt";
      // Leere Ergebnisse eintragen, damit die Positionszuordnung zu den
      // Originalseiten erhalten bleibt (keine Seite wird uebersprungen).
      for (let i = 0; i < chunk.length; i++) allPages.push({ photos: [], texts: [] });
    }
    done += chunk.length;
    onProgress?.(done, total);
  }

  if (allPages.every((p) => p.photos.length === 0 && p.texts.length === 0) && firstError) {
    return { ok: false, message: firstError };
  }
  return { ok: true, pages: allPages };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

// Anbindung an die Anthropic Claude API (Vision + Texterzeugung).
//
// Zwei Betriebsarten:
//  - Server-Proxy (aiProxyUrl konfiguriert): Aufruf laeuft ueber eine Cloud
//    Function, die den Anthropic-Key serverseitig geheim haelt. Erfordert
//    eine angemeldete Sitzung (Firebase-ID-Token).
//  - Direkt (kein Proxy konfiguriert): Aufruf laeuft direkt aus dem Browser
//    mit dem vom Makler im Datenbereich hinterlegten API-Key (lokaler Modus).

import type { ApiSettings, ExposeType, Rect, StyleText } from "./types";
import { clamp, splitDataUrl } from "./util";
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

// --- Fotobereiche auf Standardseiten erkennen (fuer Platzhalter) --------
//
// Standardseiten (Impressum/AGB/Widerruf/Kontakt) werden 1:1 als Bild
// uebernommen - hier zaehlt der wortgetreue Text mehr als freie
// Bearbeitbarkeit. Die KI erkennt darauf nur echte Fotobereiche, die aus
// dem Bild entfernt und durch Platzhalter ersetzt werden.

const PHOTO_TOOL = {
  name: "page_photos",
  description: "Liefert pro Seite die Bereiche echter Fotos.",
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
async function analyzePhotosChunk(
  api: ApiSettings,
  chunk: string[],
): Promise<Rect[][] | AiError> {
  const imageBlocks = chunk.map((dataUrl) => {
    const { mediaType, base64 } = splitDataUrl(dataUrl);
    return {
      type: "image" as const,
      source: { type: "base64" as const, media_type: mediaType, data: base64 },
    };
  });

  const system =
    "Du erkennst auf Immobilien-Exposé-Seiten ausschliesslich echte, austauschbare Fotografien (Raeume, Gebaeude, Personen, Landschaften). " +
    "KEINE Fotos sind: Logos, Icons, Zierlinien, Kopf-/Fusszeilen, Text, sowie grossflaechige Hintergrund-/Dekor-Elemente wie farbige oder graue Balken, Seitenleisten, Verlaeufe oder Rahmen - auch wenn diese wie ein Bild aussehen. " +
    "Ein echtes Foto ist eine klar begrenzte, in sich geschlossene Aufnahme, niemals ein Element, das ueber die gesamte Seitenhoehe oder den gesamten Seitenrand laeuft. " +
    "Koordinaten sind Anteile 0..1 der Seitenbreite/-hoehe, Ursprung oben links; x+w darf 1 nicht ueberschreiten, y+h darf 1 nicht ueberschreiten. " +
    "Antworte ausschliesslich ueber das Werkzeug \"page_photos\" mit GENAU einem Eintrag pro uebergebenem Seitenbild, in derselben Reihenfolge.";

  const data = await callAnthropic(api, {
    model: api.model,
    max_tokens: 1024,
    system,
    tools: [PHOTO_TOOL],
    tool_choice: { type: "tool", name: "page_photos" },
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: `Hier sind ${imageBlocks.length} Seite(n) eines Beispiel-Exposés in Reihenfolge. Erkenne pro Seite die Fotobereiche.`,
          },
        ],
      },
    ],
  });

  const tool = data.content.find((c) => c.type === "tool_use");
  const input = tool?.input as { pages?: { photos?: Rect[] }[] } | undefined;
  if (!input?.pages) {
    return { ok: false, message: "Die KI konnte keine Fotobereiche erkennen." };
  }

  // Defensiv auf die Chunk-Laenge ausrichten (padden/kuerzen), damit die
  // Positionszuordnung zu den Originalseiten nicht verrutscht.
  const pages = input.pages.slice(0, chunk.length);
  while (pages.length < chunk.length) pages.push({ photos: [] });

  return pages.map((pg) =>
    normalizeRects((pg.photos ?? []).filter((r) => r)).filter(
      (r) => r.w >= 0.12 && r.h >= 0.08 && !(r.h > 0.97 && r.w > 0.97),
    ),
  );
}

// Analysiert alle Seitenbilder blockweise und fuehrt die Ergebnisse
// zusammen. Blockweise Verarbeitung + Retries verhindert, dass die Antwort
// bei vielen Seiten das Ausgabe-Limit sprengt oder ein Ausreisser die ganze
// Analyse abbricht; bei endgueltigem Fehlschlag wird pro Seite ein leeres
// Ergebnis eingetragen, damit die Seitenreihenfolge erhalten bleibt.
export const MAX_ANALYZE_PAGES = 40;

export async function analyzePagesPhotos(
  api: ApiSettings,
  pageImages: string[],
  onProgress?: (pagesDone: number, pagesTotal: number) => void,
): Promise<{ ok: true; pages: Rect[][] } | AiError> {
  if (!aiReady(api)) return { ok: false, message: "Kein API-Key hinterlegt." };
  if (pageImages.length === 0)
    return { ok: false, message: "Keine Seiten zum Analysieren gefunden." };

  const imgs = pageImages.slice(0, MAX_ANALYZE_PAGES);
  const total = imgs.length;
  const BATCH = 4;
  const allPages: Rect[][] = [];
  let firstError = "";
  let done = 0;
  onProgress?.(0, total);

  for (let start = 0; start < imgs.length; start += BATCH) {
    const chunk = imgs.slice(start, start + BATCH);
    let result: Rect[][] | null = null;
    let err = "";
    for (let attempt = 1; attempt <= 3 && !result; attempt++) {
      try {
        const res = await analyzePhotosChunk(api, chunk);
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
      for (let i = 0; i < chunk.length; i++) allPages.push([]);
    }
    done += chunk.length;
    onProgress?.(done, total);
  }

  if (allPages.every((p) => p.length === 0) && firstError) {
    return { ok: false, message: firstError };
  }
  return { ok: true, pages: allPages };
}

// --- Grafik-Nachbau von Inhaltsseiten (Titelseite, Objektbeschreibung, ...)
//
// KEIN eingebettetes Bild: die KI beschreibt den grafischen Aufbau der
// Seite als Vektor-Elemente (Formen/Banner in Originalfarbe, Text in
// Originalgroesse/-farbe/-ausrichtung OHNE Originalinhalt, Bildflaechen als
// leere Platzhalter). Damit bleibt das Design exakt erhalten, ohne ein
// Originalfoto zu uebernehmen oder eine Freistellung zu benoetigen.

export interface DesignBlock {
  type: "shape" | "heading" | "text" | "image" | "logo";
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  fontSize?: number;
  fontWeight?: number;
  align?: "left" | "center" | "right";
  radius?: number;
}

export interface DesignPageResult {
  title: string;
  background: string;
  blocks: DesignBlock[];
}

const DESIGN_TOOL = {
  name: "page_design",
  description:
    "Beschreibt den grafischen Aufbau einer Exposé-Seite als Vektor-Elemente, damit die Seite 1:1 in Farbe/Position/Groesse nachgebaut werden kann - OHNE eingebettete Fotos.",
  input_schema: {
    type: "object",
    properties: {
      pages: {
        type: "array",
        description: "Ergebnis in EXAKT der Reihenfolge der uebergebenen Seitenbilder, eines pro Bild.",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Kurzer Abschnittstitel der Seite (z.B. Titelseite, Objektbeschreibung, Lage, Ausstattung, Kontakt).",
            },
            background: {
              type: "string",
              description: "Seiten-Hintergrundfarbe als Hex-Code (z.B. #ffffff), aus dem Originalbild abgelesen.",
            },
            blocks: {
              type: "array",
              description: "ALLE grafischen Elemente der Seite in Originalposition/-groesse.",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: ["shape", "heading", "text", "image", "logo"],
                    description:
                      "shape=farbige Dekorflaeche/Banner/Balken, heading=grosse Ueberschrift, text=Fliesstext/Label, image=Fotoflaeche (bleibt leer), logo=Logo-Position.",
                  },
                  x: { type: "number" },
                  y: { type: "number" },
                  w: { type: "number" },
                  h: { type: "number" },
                  color: {
                    type: "string",
                    description: "Aus dem Bild abgelesene Farbe als Hex-Code - bei shape die Fuellfarbe, bei heading/text die Schriftfarbe.",
                  },
                  fontSize: {
                    type: "number",
                    description: "Nur heading/text: Schriftgroesse in px bei 794px Referenz-Seitenbreite (grobe Einschaetzung anhand der sichtbaren Zeichenhoehe).",
                  },
                  fontWeight: {
                    type: "number",
                    description: "Nur heading/text: Schriftstaerke 400 (normal), 600 (halbfett) oder 800 (fett/Headline).",
                  },
                  align: { type: "string", enum: ["left", "center", "right"] },
                  radius: {
                    type: "number",
                    description: "Nur shape: Eckenradius in px bei 794px Referenzbreite (0 fuer eckig).",
                  },
                },
                required: ["type", "x", "y", "w", "h"],
              },
            },
          },
          required: ["title", "background", "blocks"],
        },
      },
    },
    required: ["pages"],
  },
};

// Analysiert einen kleinen Block von Seitenbildern (max. ~4) in EINER Anfrage.
async function analyzeDesignChunk(
  api: ApiSettings,
  chunk: string[],
): Promise<DesignPageResult[] | AiError> {
  const imageBlocks = chunk.map((dataUrl) => {
    const { mediaType, base64 } = splitDataUrl(dataUrl);
    return {
      type: "image" as const,
      source: { type: "base64" as const, media_type: mediaType, data: base64 },
    };
  });

  const system =
    "Du bist Experte fuer die pixelgenaue Grafik-Analyse von Immobilien-Exposé-Seiten. " +
    "Zerlege jede gezeigte Seite VOLLSTAENDIG in ihre grafischen Elemente, damit sie als Vektor-Grafik 1:1 nachgebaut werden kann - OHNE ein Foto der Seite einzubetten. " +
    "Erfasse JEDES Dekorelement (farbige Banner, Balken, Kacheln, Trennlinien, Kopf-/Fusszeilen-Flaechen) als eigenen \"shape\"-Block mit der TATSAECHLICHEN, aus dem Bild abgelesenen Farbe (Hex-Code) und Position/Groesse. " +
    "Erfasse JEDE Ueberschrift/jedes Label als \"heading\" oder \"text\"-Block mit der TATSAECHLICHEN Position/Groesse/Schriftfarbe/Schriftstaerke aus dem Original - aber OHNE den Original-Textinhalt zu uebernehmen (der Inhalt ist objektspezifisch und wird spaeter frei eingegeben). " +
    "Erfasse jede Fotoflaeche als \"image\"-Block (nur Position/Groesse, bleibt leer - KEIN Foto wird uebernommen). " +
    "Erfasse eine erkennbare Logo-Position als \"logo\"-Block. " +
    "Farben IMMER als Hex-Code exakt aus dem Bild ablesen, nicht schaetzen oder durch generische Farben ersetzen. " +
    "Koordinaten sind Anteile 0..1 der Seitenbreite/-hoehe, Ursprung oben links; x+w darf 1 nicht ueberschreiten, y+h darf 1 nicht ueberschreiten. " +
    "Antworte ausschliesslich ueber das Werkzeug \"page_design\" mit GENAU einem Eintrag pro uebergebenem Seitenbild, in derselben Reihenfolge.";

  const data = await callAnthropic(api, {
    model: api.model,
    max_tokens: 4096,
    system,
    tools: [DESIGN_TOOL],
    tool_choice: { type: "tool", name: "page_design" },
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: `Hier sind ${imageBlocks.length} Seite(n) eines Beispiel-Exposés in Reihenfolge. Zerlege jede Seite vollstaendig in ihre grafischen Elemente (Formen/Banner in Originalfarbe, Text-Positionen/-Stile ohne Originalinhalt, Fotoflaechen leer, Logo-Position).`,
          },
        ],
      },
    ],
  });

  const tool = data.content.find((c) => c.type === "tool_use");
  const input = tool?.input as { pages?: DesignPageResult[] } | undefined;
  if (!input?.pages) {
    return { ok: false, message: "Die KI konnte das Design nicht analysieren." };
  }

  const pages = input.pages.slice(0, chunk.length);
  while (pages.length < chunk.length) pages.push({ title: "Seite", background: "#ffffff", blocks: [] });

  // Prozent-/Pixelwerte auf 0..1 normalisieren (Fallback, falls die KI
  // versehentlich Prozent- oder Pixelwerte statt Anteile liefert).
  let maxCoord = 0;
  for (const pg of pages)
    for (const b of pg.blocks ?? [])
      for (const v of [b.x, b.y, b.w, b.h]) {
        const n = Number(v);
        if (Number.isFinite(n)) maxCoord = Math.max(maxCoord, n);
      }
  const scale = maxCoord > 1.5 ? (maxCoord <= 100 ? 1 / 100 : 1 / maxCoord) : 1;
  const s = (v: unknown) => Number(v) * scale;
  const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
  const TYPES = new Set(["shape", "heading", "text", "image", "logo"]);
  const ALIGNS = new Set(["left", "center", "right"]);

  return pages.map((pg) => ({
    title: String(pg.title ?? "Seite").slice(0, 60),
    background: HEX.test(String(pg.background ?? "")) ? String(pg.background) : "#ffffff",
    blocks: (pg.blocks ?? [])
      .filter((b) => b && TYPES.has(b.type))
      .slice(0, 40)
      .map((b) => {
        const block: DesignBlock = {
          type: b.type,
          x: clamp01(s(b.x)),
          y: clamp01(s(b.y)),
          w: clamp01(s(b.w), 0.01),
          h: clamp01(s(b.h), 0.01),
        };
        if (b.color && HEX.test(String(b.color))) block.color = String(b.color);
        if (Number.isFinite(Number(b.fontSize))) block.fontSize = clamp(Number(b.fontSize), 9, 72);
        if (Number.isFinite(Number(b.fontWeight))) block.fontWeight = clamp(Number(b.fontWeight), 300, 900);
        if (b.align && ALIGNS.has(b.align)) block.align = b.align;
        if (Number.isFinite(Number(b.radius))) block.radius = Number(b.radius);
        return block;
      }),
  }));
}

// Analysiert alle Seitenbilder blockweise und fuehrt die Ergebnisse
// zusammen (gleiches Batch-/Retry-Muster wie die Fotoerkennung).
export async function analyzePagesDesign(
  api: ApiSettings,
  pageImages: string[],
  onProgress?: (pagesDone: number, pagesTotal: number) => void,
): Promise<{ ok: true; pages: DesignPageResult[] } | AiError> {
  if (!aiReady(api)) return { ok: false, message: "Kein API-Key hinterlegt." };
  if (pageImages.length === 0)
    return { ok: false, message: "Keine Seiten zum Analysieren gefunden." };

  const imgs = pageImages.slice(0, MAX_ANALYZE_PAGES);
  const total = imgs.length;
  const BATCH = 3;
  const allPages: DesignPageResult[] = [];
  let firstError = "";
  let done = 0;
  onProgress?.(0, total);

  for (let start = 0; start < imgs.length; start += BATCH) {
    const chunk = imgs.slice(start, start + BATCH);
    let result: DesignPageResult[] | null = null;
    let err = "";
    for (let attempt = 1; attempt <= 3 && !result; attempt++) {
      try {
        const res = await analyzeDesignChunk(api, chunk);
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
      for (let i = 0; i < chunk.length; i++)
        allPages.push({ title: "Seite", background: "#ffffff", blocks: [] });
    }
    done += chunk.length;
    onProgress?.(done, total);
  }

  if (allPages.every((p) => p.blocks.length === 0) && firstError) {
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

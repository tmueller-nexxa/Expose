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
  ExposeSection,
  ExposeSectionKind,
  ExposeType,
  Rect,
  StyleText,
} from "./types";
import { clamp, splitDataUrl } from "./util";
import { aiProxyUrl } from "../firebase.config";
import { currentToken } from "./cloud";

const API_URL = "https://api.anthropic.com/v1/messages";

// Ist die KI grundsaetzlich aufrufbar? (Proxy konfiguriert ODER eigener Key.)
export function aiReady(api: ApiSettings): boolean {
  return Boolean(aiProxyUrl) || Boolean(api.apiKey);
}

type ImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
};

// Baut Bild-Bloecke fuer die Anthropic-API und filtert dabei Bilder heraus,
// die nicht gelesen werden konnten (z.B. eine im Cloud-Modus ausgelagerte
// Storage-URL ohne CORS-Freigabe fuer diese Domain - <img>-Tags zeigen das
// Bild dann zwar an, aber fetch() scheitert). Ohne diesen Filter wuerde ein
// Bild mit leeren Bilddaten von der API mit einem harten 400-Fehler
// ("image cannot be empty") abgelehnt. validIndices haelt fest, an welcher
// Original-Position jeder Block stand, damit Aufrufer Ergebnisse wieder an
// der richtigen Stelle einsortieren koennen.
async function buildImageBlocks(
  dataUrls: string[],
): Promise<{ blocks: ImageBlock[]; validIndices: number[]; skipped: number }> {
  const parts = await Promise.all(dataUrls.map((d) => splitDataUrl(d)));
  const blocks: ImageBlock[] = [];
  const validIndices: number[] = [];
  parts.forEach(({ mediaType, base64 }, i) => {
    if (!base64) return;
    blocks.push({ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } });
    validIndices.push(i);
  });
  return { blocks, validIndices, skipped: dataUrls.length - blocks.length };
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

// Typspezifisches Wortfeld-Register, passend zum jeweiligen Zielpublikum -
// unabhaengig davon, ob eigene Stilbeispiele hinterlegt sind (die eigentliche
// Wortwahl/Satzmelodie kommt dann aus den Stilbeispielen, aber das Register
// hilft trotzdem, inhaltlich die richtigen Schwerpunkte zu setzen).
const TYPE_STYLE_HINT: Record<ExposeType, string> = {
  gewerbe:
    "Betone Investment-Aspekte: Kapitalanlage, Rendite, Mieteinnahmen, kalkulierbare/stabile Einnahmen, Cashflow, Vermoegensaufbau, Risikostreuung, Nutzungsvielfalt.",
  mehrfamilienhaus:
    "Betone Investment-Aspekte: Kapitalanlage, Rendite, Mieteinnahmen, kalkulierbare/stabile Einnahmen, Cashflow, Vermoegensaufbau, Risikostreuung, voll vermietete/wenig Leerstand.",
  einfamilienhaus:
    "Betone emotionale \"Zuhause\"-Sprache fuer Eigennutzer: Charakter, Atmosphaere, Alltagstauglichkeit, Familie, Ruhe, langfristige Perspektive.",
  wohnung:
    "Betone modernen Wohnkomfort fuer Eigennutzer/junge Familien/Paare: Sanierungs-/Ausstattungsdetails, Helligkeit, Grundriss, Wohngefuehl.",
};

// Distillierte Stilregeln aus echten Makler-Exposé-Texten (als robuster
// Standard-Fallback, falls der Nutzer keine eigenen Stilbeispiele hinterlegt
// hat) - siehe Konversation fuer die analysierten Originaltexte.
const DEFAULT_STYLE_GUIDE =
  "Schreibe professionell, sachlich-warm und selbstbewusst, aber OHNE reisserische Superlative (kein \"traumhaft\", \"einzigartig\", \"atemberaubend\"). " +
  "Nutze Merkmal-plus-Nutzen-Saetze (\"X bietet/schafft/verbindet/sorgt fuer Y\"). " +
  "Ueberschriften gerne mit Doppelpunkt oder Gedankenstrich aufgebaut (\"Kurzes Merkmal: erweiternder Nebensatz\" bzw. \"Merkmal – Nutzen\"). " +
  "Setze gelegentlich die Aufzaehlungs-Konstruktion \"Ob A, B oder C – ...\" ein, wenn mehrere Nutzungen/Zielgruppen passen. " +
  "Baue konkrete Zahlen (Quadratmeter, Miete, Baujahr) natuerlich in Fliesstext-Saetze ein, nicht als Stichpunktliste. " +
  "Schliesse Abschnitte gelegentlich mit einem kurzen, pointierten Satz ab.";

// Struktur-Vorgabe speziell fuer Lage-Abschnitte (kind "lage") - unabhaengig
// von Stilbeispielen, weil sie den inhaltlichen AUFBAU betrifft, nicht die
// Wortwahl.
const LAGE_STRUCTURE_HINT =
  "Fuer Abschnitte der Art \"lage\": beginne mit der konkreten Lagebeschreibung (Adresse/Stadtteil-Charakter), danach der Charakter der Nachbarschaft/Umgebung, danach erreichbare Einrichtungen (Einkaufen, Schulen, Kindergaerten, Aerzte), danach die Verkehrsanbindung/OePNV, und schliesse mit einem Satz, der die Lage mit einem konkreten Nutzen fuer die Zielgruppe verbindet.";

function buildStyleContext(styleTexts: StyleText[], type: ExposeType): string {
  const typeHint = TYPE_STYLE_HINT[type];
  if (styleTexts.length === 0) {
    return `${DEFAULT_STYLE_GUIDE} ${typeHint} ${LAGE_STRUCTURE_HINT}`;
  }
  const samples = styleTexts
    .map((t) => t.content.trim())
    .filter(Boolean)
    .join("\n\n---\n\n")
    .slice(0, 6000);
  return (
    `Uebernimm exakt den Schreibstil, Tonfall, Satzbau und Wortwahl aus den folgenden Textbeispielen des Maklers (vermeide dabei trotzdem reisserische Superlative, falls die Beispiele das nicht vorgeben):\n\n${samples}\n\n` +
    `${typeHint} ${LAGE_STRUCTURE_HINT}`
  );
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
  const { mediaType, base64 } = await splitDataUrl(imageDataUrl);
  if (!base64) return { ok: false, message: "Bild konnte nicht gelesen werden." };
  if (!aiReady(api)) return { ok: false, message: "Kein API-Key hinterlegt." };

  const system = `Du bist ein erfahrener Immobilien-Texter und erstellst Exposé-Texte fuer ein ${TYPE_LABEL[type]}. ${buildStyleContext(
    styleTexts,
    type,
  )}\n\nSchreibe in korrektem Deutsch mit echten Umlauten und Eszett (ä, ö, ü, Ä, Ö, Ü, ß) - NIEMALS als ae/oe/ue/ss transliterieren. Antworte ausschliesslich ueber das Werkzeug "expose_text".`;

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
  const { blocks: imageBlocks, validIndices } = await buildImageBlocks(chunk);
  if (imageBlocks.length === 0) return chunk.map(() => []);

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

  // Defensiv auf die Anzahl gesendeter Bilder ausrichten (padden/kuerzen),
  // damit die Positionszuordnung nicht verrutscht.
  const pages = input.pages.slice(0, imageBlocks.length);
  while (pages.length < imageBlocks.length) pages.push({ photos: [] });
  const normalized = pages.map((pg) =>
    normalizeRects((pg.photos ?? []).filter((r) => r)).filter(
      (r) => r.w >= 0.12 && r.h >= 0.08 && !(r.h > 0.97 && r.w > 0.97),
    ),
  );

  // Auf die volle, urspruengliche Chunk-Laenge zurueckstreuen (uebersprungene
  // Bilder erhalten ein leeres Ergebnis statt die Reihenfolge zu verschieben).
  const result: Rect[][] = chunk.map(() => []);
  validIndices.forEach((origIdx, i) => {
    result[origIdx] = normalized[i];
  });
  return result;
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
  // Nur gesetzt, wenn der Text auf einer farbigen Formflaeche (Banner/
  // Kachel) liegt - dann 1:1 wortgetreu wie im Original (statisches
  // Rubriken-/Abschnittslabel, keine Objektdaten). Sonst leer, da der Inhalt
  // objektspezifisch ist und frei eingegeben wird.
  text?: string;
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
                  text: {
                    type: "string",
                    description:
                      "NUR bei heading/text, wenn der Text auf einer farbigen Formflaeche (shape/Banner/Kachel) liegt: der exakte Originaltext 1:1 (Buchstabe fuer Buchstabe, z.B. ein Rubriken-/Abschnittslabel wie 'EINFAMILIENHAUS' oder 'OBJEKTBESCHREIBUNG'). Liegt der Text NICHT auf einer Formflaeche (freier Fliesstext/Absatz ueber Hintergrund oder Foto), Feld weglassen - dieser Inhalt ist objektspezifisch und wird spaeter frei eingegeben.",
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
  const { blocks: imageBlocks, validIndices } = await buildImageBlocks(chunk);
  if (imageBlocks.length === 0)
    return chunk.map(() => ({ title: "Seite", background: "#ffffff", blocks: [] }));

  const system =
    "Du bist Experte fuer die pixelgenaue Grafik-Analyse von Immobilien-Exposé-Seiten. " +
    "Zerlege jede gezeigte Seite VOLLSTAENDIG in ihre grafischen Elemente, damit sie als Vektor-Grafik 1:1 nachgebaut werden kann - OHNE ein Foto der Seite einzubetten. " +
    "Erfasse JEDES Dekorelement (farbige Banner, Balken, Kacheln, Trennlinien, Kopf-/Fusszeilen-Flaechen) als eigenen \"shape\"-Block mit der TATSAECHLICHEN, aus dem Bild abgelesenen Farbe (Hex-Code) und Position/Groesse. " +
    "Erfasse JEDE Ueberschrift/jedes Label als \"heading\" oder \"text\"-Block mit der TATSAECHLICHEN Position/Groesse/Schriftfarbe/Schriftstaerke aus dem Original. " +
    "Textinhalt (Feld \"text\"): NUR uebernehmen, wenn der Text auf einer farbigen Formflaeche (shape/Banner/Kachel) liegt - das sind meist statische Rubriken-/Abschnittslabels (z.B. Objekttyp, Seitentitel) und werden 1:1 wortgetreu transkribiert. Liegt der Text dagegen frei ueber Hintergrund/Foto (Fliesstext, Absaetze, Adress-/Objektdaten), das Feld \"text\" WEGLASSEN - dieser Inhalt ist objektspezifisch und wird spaeter frei eingegeben. " +
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
            text: `Hier sind ${imageBlocks.length} Seite(n) eines Beispiel-Exposés in Reihenfolge. Zerlege jede Seite vollstaendig in ihre grafischen Elemente (Formen/Banner in Originalfarbe, Text-Positionen/-Stile mit Originalinhalt NUR bei Text auf Formflaechen, Fotoflaechen leer, Logo-Position).`,
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

  const pages = input.pages.slice(0, imageBlocks.length);
  while (pages.length < imageBlocks.length) pages.push({ title: "Seite", background: "#ffffff", blocks: [] });

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

  const mapped = pages.map((pg) => ({
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
        if ((b.type === "heading" || b.type === "text") && b.text && String(b.text).trim())
          block.text = String(b.text).trim().slice(0, 200);
        return block;
      }),
  }));

  const result: DesignPageResult[] = chunk.map(() => ({ title: "Seite", background: "#ffffff", blocks: [] }));
  validIndices.forEach((origIdx, i) => {
    result[origIdx] = mapped[i];
  });
  return result;
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

// --- "KI Exposé": Seitenaufbau aus Beispielen ableiten -------------------
//
// Anders als die Vektor-Grafik-Nachbildung (oben) wird hier NUR der grobe,
// wiederkehrende Seitenaufbau beschrieben (Reihenfolge/Zweck der Inhalts-
// seiten) - keine Farben, Texte oder Positionen. Das grafische Design von
// "KI Exposé" ist ein fest hinterlegtes Luxus-Design (luxuryTemplate.ts),
// unabhaengig von den Beispielen.

const SECTION_KINDS = [
  "titel",
  "objektbeschreibung",
  "lage",
  "ausstattung",
  "grundriss",
  "galerie",
  "kontakt",
  "sonstiges",
] as const;
const SECTION_KIND_SET = new Set<string>(SECTION_KINDS);

const MAX_STRUCTURE_SECTIONS = 10;

const STRUCTURE_TOOL = {
  name: "expose_structure",
  description:
    "Beschreibt NUR den groben, wiederkehrenden Seitenaufbau eines Immobilien-Exposés (Reihenfolge und Zweck der Inhaltsseiten) - keine Farben, Texte oder Positionen. Maximal " +
    MAX_STRUCTURE_SECTIONS +
    " zusammengefasste Abschnitte, NICHT eine Seite = ein Abschnitt.",
  input_schema: {
    type: "object",
    properties: {
      sections: {
        type: "array",
        description: `Höchstens ${MAX_STRUCTURE_SECTIONS} Abschnitte in der Reihenfolge, wie sie im Beispiel vorkommen - mehrere gleichartige Seiten (z.B. mehrere Zimmerfotos) zaehlen als EIN Abschnitt.`,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: [...SECTION_KINDS] },
            title: {
              type: "string",
              description: "Anzeigename des Abschnitts, z.B. \"Lage & Umgebung\".",
            },
            photoCount: {
              type: "number",
              description: "Typische Anzahl Fotos auf dieser Seite im Beispiel.",
            },
          },
          required: ["kind", "title"],
        },
      },
    },
    required: ["sections"],
  },
};

export async function analyzeExposeStructure(
  api: ApiSettings,
  pageImages: string[],
  type: ExposeType,
): Promise<{ ok: true; sections: ExposeSection[] } | AiError> {
  if (!aiReady(api)) return { ok: false, message: "Kein API-Key hinterlegt." };
  if (pageImages.length === 0)
    return { ok: false, message: "Keine Inhaltsseiten im Beispiel gefunden." };

  const imgs = pageImages.slice(0, 20);
  const { blocks: imageBlocks } = await buildImageBlocks(imgs);
  if (imageBlocks.length === 0)
    return {
      ok: false,
      message:
        "Die Beispiel-Seiten konnten nicht gelesen werden (Bilddaten sind leer). Bitte Beispiel-Datei im Datenbereich erneut hochladen.",
    };

  const system =
    `Du analysierst den Seitenaufbau von Immobilien-Exposés (${TYPE_LABEL[type]}). ` +
    "Beschreibe NUR die grobe, wiederkehrende Struktur: welche Arten von Inhaltsseiten kommen in welcher Reihenfolge vor (z.B. Titelseite, Objektbeschreibung, Lage, Ausstattung, Grundriss, Galerie, Kontakt)? " +
    "Ignoriere Farben, Schriften, genaue Texte und Positionen komplett - es geht nur um Reihenfolge und Zweck der Seiten. " +
    `WICHTIG: Liefere HÖCHSTENS ${MAX_STRUCTURE_SECTIONS} Abschnitte, auch wenn das Beispiel mehr Seiten hat - fasse konsequent zusammen (z.B. ALLE Zimmer-/Raumfotos zu EINEM Abschnitt "Objektbeschreibung"/"Innenräume", ALLE Außenaufnahmen zu EINEM Abschnitt "Außenansicht"/"Lage", ALLE Grundriss-Seiten zu EINEM Abschnitt "Grundriss"). Eine Seite = ein Abschnitt ist FALSCH, wenn mehrere Seiten denselben Zweck haben. ` +
    "Verwende in den Abschnittstiteln echte deutsche Umlaute und Eszett (ä, ö, ü, Ä, Ö, Ü, ß) - NIEMALS als ae/oe/ue/ss transliterieren. " +
    "Antworte ausschliesslich ueber das Werkzeug \"expose_structure\".";

  try {
    const data = await callAnthropic(api, {
      model: api.model,
      max_tokens: 1500,
      system,
      tools: [STRUCTURE_TOOL],
      tool_choice: { type: "tool", name: "expose_structure" },
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            {
              type: "text",
              text: `Hier sind ${imageBlocks.length} Inhaltsseite(n) eines Beispiel-Exposés. Beschreibe den groben Seitenaufbau.`,
            },
          ],
        },
      ],
    });

    const tool = data.content.find((c) => c.type === "tool_use");
    const input = tool?.input as
      | { sections?: { kind?: string; title?: string; photoCount?: number }[] }
      | undefined;
    const raw = input?.sections ?? [];
    if (raw.length === 0)
      return { ok: false, message: "Die KI konnte keinen Seitenaufbau ableiten." };

    const sections: ExposeSection[] = raw.slice(0, MAX_STRUCTURE_SECTIONS).map((s) => ({
      kind: (SECTION_KIND_SET.has(String(s.kind)) ? s.kind : "sonstiges") as ExposeSectionKind,
      title: String(s.title ?? "Abschnitt").slice(0, 60),
      photoCount: clamp(Math.round(Number(s.photoCount) || 1), 0, 6),
    }));
    return { ok: true, sections };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

// --- "KI Exposé": Fotos den Seitenabschnitten zuordnen --------------------
//
// Zuordnung erfolgt per Index in die KONKRETE Abschnittsliste (Titel, nicht
// nur grobe Art/"kind") - mehrere Abschnitte koennen dieselbe Art haben
// (z.B. "Küche" und "Bad" sind beides "ausstattung"), muessen aber jeweils
// ihre EIGENEN, inhaltlich passenden Fotos bekommen statt sich einen
// gemeinsamen Topf nach Art zu teilen.

export interface PhotoAssignment {
  sectionIndex: number; // Index in die uebergebene sections-Liste, -1 = kein guter Treffer.
  caption: string;
}

function buildPhotoSectionTool(sectionCount: number) {
  return {
    name: "photo_sections",
    description:
      "Ordnet jedes Foto per Index dem inhaltlich am besten passenden Abschnitt zu und beschreibt kurz, was zu sehen ist.",
    input_schema: {
      type: "object",
      properties: {
        photos: {
          type: "array",
          description: "Ergebnis in EXAKT der Reihenfolge der uebergebenen Fotos, eines pro Bild.",
          items: {
            type: "object",
            properties: {
              sectionIndex: {
                type: "integer",
                minimum: -1,
                maximum: Math.max(0, sectionCount - 1),
                description:
                  "0-basierter Index des am besten passenden Abschnitts aus der uebergebenen Liste, oder -1 falls kein Abschnitt inhaltlich passt.",
              },
              caption: {
                type: "string",
                description: "Sachliche Kurzbeschreibung des Fotoinhalts (max. 12 Woerter), z.B. Raumart/Ansicht.",
              },
            },
            required: ["sectionIndex", "caption"],
          },
        },
      },
      required: ["photos"],
    },
  };
}

async function analyzePhotoSectionsChunk(
  api: ApiSettings,
  chunk: string[],
  sections: ExposeSection[],
): Promise<PhotoAssignment[] | AiError> {
  const { blocks: imageBlocks, validIndices } = await buildImageBlocks(chunk);
  if (imageBlocks.length === 0) return chunk.map(() => ({ sectionIndex: -1, caption: "" }));

  const sectionsDesc = sections.map((s, i) => `${i}. "${s.title}" (${s.kind})`).join("\n");
  const system =
    "Du ordnest Immobilienfotos den konkreten Abschnitten eines Exposés zu. " +
    `Folgende Abschnitte stehen zur Auswahl (Index. "Titel" (Art)):\n${sectionsDesc}\n\n` +
    "Waehle pro Foto den inhaltlich am besten passenden Abschnitt anhand von TITEL UND Art - mehrere Abschnitte koennen dieselbe Art haben (z.B. \"Küche\" und \"Bad\" sind beide \"ausstattung\"), dann entscheidet allein der Titel, welcher Abschnitt inhaltlich zum Fotoinhalt passt (ein Badezimmerfoto gehoert zum Abschnitt \"Bad\", NICHT zu \"Küche\", auch wenn beide dieselbe Art haben). " +
    "WICHTIG: Ein Abschnitt der Art \"titel\" ist die Titelseite und braucht ein repraesentatives Aussen-/Uebersichtsfoto (Fassade, Luftaufnahme, Gesamtansicht des Gebaeudes von aussen) - ist unter den hier gezeigten Fotos ein geeignetes Aussen-/Uebersichtsfoto, ordne es bevorzugt dem \"titel\"-Abschnitt zu, auch wenn dessen Abschnittstitel das nicht woertlich sagt (z.B. eine kreative Ueberschrift wie \"Ihr neues Zuhause\"). " +
    "Gibt es keinen inhaltlich passenden Abschnitt, antworte mit sectionIndex -1. " +
    "Beschreibe jedes Foto kurz und sachlich (Raumart/Ansicht), keine Bewertung. " +
    "Antworte ausschliesslich ueber das Werkzeug \"photo_sections\" mit GENAU einem Eintrag pro uebergebenem Foto, in derselben Reihenfolge.";

  const data = await callAnthropic(api, {
    model: api.model,
    max_tokens: 1500,
    system,
    tools: [buildPhotoSectionTool(sections.length)],
    tool_choice: { type: "tool", name: "photo_sections" },
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: `Hier sind ${imageBlocks.length} Foto(s). Ordne jedes Foto einem Abschnitt zu.`,
          },
        ],
      },
    ],
  });

  const tool = data.content.find((c) => c.type === "tool_use");
  const input = tool?.input as { photos?: { sectionIndex?: number; caption?: string }[] } | undefined;
  if (!input?.photos) return { ok: false, message: "Die KI konnte die Fotos nicht zuordnen." };

  const photos = input.photos.slice(0, imageBlocks.length);
  while (photos.length < imageBlocks.length) photos.push({ sectionIndex: -1, caption: "" });
  const mapped = photos.map((p) => {
    const idx = Math.round(Number(p.sectionIndex));
    return {
      sectionIndex: Number.isFinite(idx) && idx >= 0 && idx < sections.length ? idx : -1,
      caption: String(p.caption ?? "").slice(0, 140),
    };
  });

  const result: PhotoAssignment[] = chunk.map(() => ({ sectionIndex: -1, caption: "" }));
  validIndices.forEach((origIdx, i) => {
    result[origIdx] = mapped[i];
  });
  return result;
}

export async function analyzePhotoSections(
  api: ApiSettings,
  photos: string[],
  sections: ExposeSection[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: true; photos: PhotoAssignment[] } | AiError> {
  if (!aiReady(api)) return { ok: false, message: "Kein API-Key hinterlegt." };
  if (photos.length === 0) return { ok: false, message: "Keine Fotos zum Zuordnen gefunden." };

  const imgs = photos.slice(0, 60);
  const total = imgs.length;
  const BATCH = 4;
  const allPhotos: PhotoAssignment[] = [];
  let firstError = "";
  let done = 0;
  onProgress?.(0, total);

  for (let start = 0; start < imgs.length; start += BATCH) {
    const chunk = imgs.slice(start, start + BATCH);
    let result: PhotoAssignment[] | null = null;
    let err = "";
    for (let attempt = 1; attempt <= 3 && !result; attempt++) {
      try {
        const res = await analyzePhotoSectionsChunk(api, chunk, sections);
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
      allPhotos.push(...result);
    } else {
      firstError = firstError || err || "unbekannt";
      for (let i = 0; i < chunk.length; i++) allPhotos.push({ sectionIndex: -1, caption: "" });
    }
    done += chunk.length;
    onProgress?.(done, total);
  }

  if (allPhotos.every((p) => !p.caption) && firstError) {
    return { ok: false, message: firstError };
  }
  return { ok: true, photos: allPhotos };
}

// --- "KI Exposé": Abschnittstexte schreiben --------------------------------

export interface SectionText {
  headline: string;
  text: string;
}

const SECTION_TEXT_TOOL = {
  name: "expose_section_texts",
  description: "Schreibt fuer jeden Expose-Abschnitt eine Ueberschrift und einen Marketingtext.",
  input_schema: {
    type: "object",
    properties: {
      sections: {
        type: "array",
        description: "Ein Eintrag pro vorgegebenem Abschnitt, in derselben Reihenfolge.",
        items: {
          type: "object",
          properties: {
            headline: { type: "string", description: "Kurze, praegnante Abschnittsueberschrift." },
            text: {
              type: "string",
              description: "2-5 Saetze Marketingtext im vorgegebenen Schreibstil, basierend auf den beschriebenen Fotos und Objektdaten.",
            },
          },
          required: ["headline", "text"],
        },
      },
    },
    required: ["sections"],
  },
};

// Schreibt Texte fuer einen kleinen Block von Abschnitten (max. ~5) in EINER
// Anfrage. Blockweise Verarbeitung verhindert, dass bei vielen Abschnitten
// (z.B. 15-20 bei einem umfangreichen Beispiel) das Ausgabe-Limit (max_tokens)
// gesprengt wird und dadurch GAR KEIN Text mehr zurueckkommt.
async function writeSectionTextsChunk(
  api: ApiSettings,
  type: ExposeType,
  chunk: ExposeSection[],
  chunkPhotoDescriptions: string[][],
  datasheetText: string,
  styleTexts: StyleText[],
): Promise<SectionText[] | AiError> {
  const sectionsDesc = chunk
    .map((s, i) => {
      const photos = chunkPhotoDescriptions[i]?.filter(Boolean) ?? [];
      return `${i + 1}. "${s.title}" (${s.kind}): Fotos zeigen: ${
        photos.length > 0 ? photos.join("; ") : "keine zugeordneten Fotos"
      }`;
    })
    .join("\n");

  const system =
    `Du bist ein erfahrener Immobilien-Texter fuer ein ${TYPE_LABEL[type]}. ${buildStyleContext(styleTexts, type)}\n\n` +
    "Schreibe fuer jeden vorgegebenen Abschnitt eine Ueberschrift und einen Marketingtext, basierend auf den beschriebenen Fotos dieses Abschnitts und (falls vorhanden) den folgenden Objektdaten aus hochgeladenen Datenblaettern:\n\n" +
    `${datasheetText.trim().slice(0, 6000) || "(keine Datenblaetter hochgeladen)"}\n\n` +
    "Erfinde KEINE konkreten Zahlen (Preis, Quadratmeter, Zimmeranzahl, Baujahr usw.), die nicht in den Objektdaten oder Fotobeschreibungen stehen - schreibe in diesem Fall allgemeiner. " +
    "Schreibe in korrektem Deutsch mit echten Umlauten und Eszett (ä, ö, ü, Ä, Ö, Ü, ß) - NIEMALS als ae/oe/ue/ss transliterieren (also \"für\" statt \"fuer\", \"großzügig\" statt \"grosszuegig\"). " +
    "Antworte ausschliesslich ueber das Werkzeug \"expose_section_texts\" mit GENAU einem Eintrag pro Abschnitt, in der vorgegebenen Reihenfolge.";

  const data = await callAnthropic(api, {
    model: api.model,
    max_tokens: 2000,
    system,
    tools: [SECTION_TEXT_TOOL],
    tool_choice: { type: "tool", name: "expose_section_texts" },
    messages: [{ role: "user", content: `Abschnitte:\n${sectionsDesc}` }],
  });

  const tool = data.content.find((c) => c.type === "tool_use");
  const input = tool?.input as { sections?: { headline?: string; text?: string }[] } | undefined;
  if (!input?.sections) return { ok: false, message: "Die KI konnte keine Texte erzeugen." };

  const texts = input.sections.slice(0, chunk.length);
  while (texts.length < chunk.length) texts.push({ headline: "", text: "" });
  return texts.map((t) => ({
    headline: String(t.headline ?? "").trim(),
    text: String(t.text ?? "").trim(),
  }));
}

export async function writeExposeSectionTexts(
  api: ApiSettings,
  type: ExposeType,
  sections: ExposeSection[],
  photoDescriptionsBySection: string[][],
  datasheetText: string,
  styleTexts: StyleText[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: true; texts: SectionText[] } | AiError> {
  if (!aiReady(api)) return { ok: false, message: "Kein API-Key hinterlegt." };
  if (sections.length === 0) return { ok: false, message: "Kein Seitenaufbau vorhanden." };

  const total = sections.length;
  const BATCH = 5;
  const allTexts: SectionText[] = [];
  let firstError = "";
  let done = 0;
  onProgress?.(0, total);

  for (let start = 0; start < sections.length; start += BATCH) {
    const chunk = sections.slice(start, start + BATCH);
    const chunkPhotos = photoDescriptionsBySection.slice(start, start + BATCH);
    let result: SectionText[] | null = null;
    let err = "";
    for (let attempt = 1; attempt <= 3 && !result; attempt++) {
      try {
        const res = await writeSectionTextsChunk(api, type, chunk, chunkPhotos, datasheetText, styleTexts);
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
      allTexts.push(...result);
    } else {
      firstError = firstError || err || "unbekannt";
      for (const s of chunk) allTexts.push({ headline: s.title, text: "" });
    }
    done += chunk.length;
    onProgress?.(done, total);
  }

  if (allTexts.every((t) => !t.text) && firstError) {
    return { ok: false, message: firstError };
  }
  return { ok: true, texts: allTexts };
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

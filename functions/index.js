// Cloud Function: Proxy fuer die Anthropic-API.
//
// Haelt den Anthropic-API-Key serverseitig geheim (nie im Browser). Nur
// angemeldete Nutzer (gueltiges Firebase-ID-Token) duerfen aufrufen. Der
// Request-Body wird 1:1 an die Anthropic Messages API weitergereicht - die
// eigentliche Prompt-/Tool-Logik bleibt im Frontend (src/lib/ai.ts).
//
// Deployment (Node 20, Firebase Functions v2):
//   firebase functions:secrets:set ANTHROPIC_API_KEY
//   firebase deploy --only functions
//
// Hinweis: Ausgehende Netzwerkaufrufe aus Cloud Functions benoetigen den
// kostenpflichtigen "Blaze"-Plan (hat einen grosszuegigen kostenlosen
// Kontingentanteil; ohne nennenswerte Nutzung faellt in der Regel nichts an).

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Schutz gegen Kostenmissbrauch durch ein kompromittiertes Konto.
const MAX_TOKENS_CAP = 4096;
const ALLOWED_MODELS = new Set([
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-haiku-4-5-20251001",
]);

function setCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

exports.anthropicProxy = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true, region: "us-central1" },
  async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: { message: "Method not allowed" } });
      return;
    }

    // Firebase-ID-Token pruefen -> nur angemeldete Nutzer duerfen die KI aufrufen.
    const authHeader = req.get("Authorization") || "";
    const match = /^Bearer (.+)$/.exec(authHeader);
    if (!match) {
      res.status(401).json({ error: { message: "Nicht angemeldet." } });
      return;
    }
    try {
      await admin.auth().verifyIdToken(match[1]);
    } catch (err) {
      logger.warn("Ungueltiges ID-Token", err);
      res.status(401).json({ error: { message: "Sitzung abgelaufen. Bitte neu anmelden." } });
      return;
    }

    const body = req.body || {};
    if (!ALLOWED_MODELS.has(body.model)) {
      res.status(400).json({ error: { message: "Ungueltiges Modell." } });
      return;
    }
    const safeBody = {
      ...body,
      max_tokens: Math.min(Number(body.max_tokens) || 1024, MAX_TOKENS_CAP),
    };

    try {
      const upstream = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY.value(),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(safeBody),
      });
      const text = await upstream.text();
      res.status(upstream.status).set("content-type", "application/json").send(text);
    } catch (err) {
      logger.error("Anthropic-Proxy-Fehler", err);
      res.status(502).json({ error: { message: "KI-Dienst nicht erreichbar." } });
    }
  },
);

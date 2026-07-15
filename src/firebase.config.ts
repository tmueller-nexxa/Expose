// ===========================================================================
//  FIREBASE-KONFIGURATION
// ===========================================================================
// Hier deine Firebase-Web-Konfiguration eintragen (aus der Firebase-Konsole:
// Projekt-Einstellungen -> Allgemein -> Meine Apps -> Web-App -> SDK-Konfig).
//
// Solange die Felder LEER sind, laeuft die App im lokalen Demo-Modus
// (Speicherung nur im Browser). Sobald gueltige Werte eingetragen sind,
// schaltet die App automatisch auf echte Konten + Cloud-Speicherung um.
//
// Hinweis: Diese Web-Konfiguration ist NICHT geheim (sie ist oeffentlich
// vorgesehen). Die Sicherheit kommt aus Firebase-Auth + den Sicherheitsregeln.
// ===========================================================================

const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? "",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? "",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: env.VITE_FIREBASE_APP_ID ?? "",
};

// Optional: URL der Cloud Function, die KI-Aufrufe serverseitig ausfuehrt
// (haelt den Anthropic-Key geheim). Leer -> KI laeuft direkt aus dem Browser.
export const aiProxyUrl = env.VITE_AI_PROXY_URL ?? "";

export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

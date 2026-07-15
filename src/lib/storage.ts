// Kleiner, abhaengigkeitsfreier IndexedDB-Key-Value-Speicher.
// Bilder/PDFs/Logo koennen gross sein -> localStorage (5 MB) reicht nicht.

import type { AppData, ExposeProject, ExposeType } from "./types";

const DB_NAME = "expose-ki";
const DB_VERSION = 1;
const STORE = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;
// Fallback fuer Umgebungen ohne IndexedDB (z.B. Sandbox-/Vorschau-Frames).
const memStore = new Map<string, unknown>();
let useMemory = typeof indexedDB === "undefined";

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  if (useMemory) return memStore.get(key) as T | undefined;
  try {
    const db = await openDb();
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    useMemory = true;
    return memStore.get(key) as T | undefined;
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  if (useMemory) {
    memStore.set(key, value);
    return;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    useMemory = true;
    memStore.set(key, value);
  }
}

// --- Konkrete Speicher-Helfer -------------------------------------------

const DATA_KEY = "app-data";
const AUTH_KEY = "expose-ki-auth"; // Auth-Flag ist unkritisch -> localStorage

export function emptyAppData(): AppData {
  return {
    examples: {
      einfamilienhaus: [],
      wohnung: [],
      mehrfamilienhaus: [],
      gewerbe: [],
    },
    styleTexts: [],
    logo: null,
    cover: null,
    api: {
      provider: "anthropic",
      apiKey: "",
      model: "claude-sonnet-5",
    },
    layouts: {
      einfamilienhaus: null,
      wohnung: null,
      mehrfamilienhaus: null,
      gewerbe: null,
    },
    boilerplate: null,
  };
}

export async function loadAppData(): Promise<AppData> {
  const stored = await idbGet<AppData>(DATA_KEY);
  if (!stored) return emptyAppData();
  // Robust gegen Schema-Erweiterungen.
  const base = emptyAppData();
  return {
    ...base,
    ...stored,
    examples: { ...base.examples, ...stored.examples },
    api: { ...base.api, ...stored.api },
    layouts: { ...base.layouts, ...stored.layouts },
  };
}

export async function saveAppData(data: AppData): Promise<void> {
  await idbSet(DATA_KEY, data);
}

function projectKey(type: ExposeType) {
  return `project:${type}`;
}

export async function loadProject(
  type: ExposeType,
): Promise<ExposeProject | undefined> {
  return idbGet<ExposeProject>(projectKey(type));
}

export async function saveProject(project: ExposeProject): Promise<void> {
  await idbSet(projectKey(project.type), project);
}

// --- Auth (einfaches Demo-Login) ----------------------------------------

export function isLoggedIn(): boolean {
  return localStorage.getItem(AUTH_KEY) === "1";
}

export function setLoggedIn(v: boolean): void {
  if (v) localStorage.setItem(AUTH_KEY, "1");
  else localStorage.removeItem(AUTH_KEY);
}

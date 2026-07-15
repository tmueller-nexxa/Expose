// Speicherschicht der App. Lokal: IndexedDB-Key-Value-Store (Demo-Modus ohne
// Backend). Sobald Firebase konfiguriert ist (siehe firebase.config.ts) und
// ein Nutzer angemeldet ist, laufen Laden/Speichern stattdessen ueber
// Firestore + Storage (siehe cloud.ts) - fuer alle Aufrufer transparent.

import type { AppData, ExposeProject, ExposeType } from "./types";
import {
  cloudEnabled,
  cloudLoadAppData,
  cloudLoadProject,
  cloudSaveAppData,
  cloudSaveProject,
  mapFirestoreError,
  resetUploadCache,
} from "./cloud";

// Wird von AppContext gesetzt, damit fehlgeschlagene Cloud-Speicherversuche
// (z.B. fehlende Sicherheitsregeln) sichtbar gemacht werden koennen, statt
// lautlos zu verschwinden.
let onCloudError: ((msg: string) => void) | null = null;
export function setCloudErrorHandler(fn: ((msg: string) => void) | null): void {
  onCloudError = fn;
}

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

// --- Cloud-Nutzer (wird von AppContext beim An-/Abmelden gesetzt) -------

let cloudUid: string | null = null;

export function setCloudUser(uid: string | null): void {
  cloudUid = uid;
  resetUploadCache(uid);
}

function useCloud(): string | null {
  return cloudEnabled() && cloudUid ? cloudUid : null;
}

// Cloud-Schreibvorgaenge buendeln (z.B. beim Ziehen von Elementen wuerden
// sonst hunderte Firestore-Schreibvorgaenge pro Sekunde ausgeloest).
const CLOUD_DEBOUNCE_MS = 900;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function debounced(key: string, fn: () => void): void {
  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);
  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key);
      fn();
    }, CLOUD_DEBOUNCE_MS),
  );
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

function mergeAppData(stored: AppData): AppData {
  const base = emptyAppData();
  return {
    ...base,
    ...stored,
    examples: { ...base.examples, ...stored.examples },
    api: { ...base.api, ...stored.api },
    layouts: { ...base.layouts, ...stored.layouts },
  };
}

export async function loadAppData(): Promise<AppData> {
  const uid = useCloud();
  if (uid) {
    const cloud = await cloudLoadAppData(uid);
    return cloud ? mergeAppData(cloud) : emptyAppData();
  }
  const stored = await idbGet<AppData>(DATA_KEY);
  return stored ? mergeAppData(stored) : emptyAppData();
}

export function saveAppData(data: AppData): void {
  const uid = useCloud();
  if (uid) {
    debounced(`appdata:${uid}`, () => {
      cloudSaveAppData(uid, data).catch((e) => {
        console.error("Cloud-Speichern (appData) fehlgeschlagen:", e);
        onCloudError?.(mapFirestoreError(e));
      });
    });
    return;
  }
  void idbSet(DATA_KEY, data);
}

function projectKey(type: ExposeType) {
  return `project:${type}`;
}

export async function loadProject(
  type: ExposeType,
): Promise<ExposeProject | undefined> {
  const uid = useCloud();
  if (uid) {
    try {
      const cloud = await cloudLoadProject(uid, type);
      return cloud ?? undefined;
    } catch (e) {
      console.error("Cloud-Laden (project) fehlgeschlagen:", e);
      onCloudError?.(mapFirestoreError(e));
      return undefined;
    }
  }
  return idbGet<ExposeProject>(projectKey(type));
}

export function saveProject(project: ExposeProject): void {
  const uid = useCloud();
  if (uid) {
    debounced(`project:${uid}:${project.type}`, () => {
      cloudSaveProject(uid, project).catch((e) => {
        console.error("Cloud-Speichern (project) fehlgeschlagen:", e);
        onCloudError?.(mapFirestoreError(e));
      });
    });
    return;
  }
  void idbSet(projectKey(project.type), project);
}

// --- Auth (einfaches Demo-Login) ----------------------------------------

export function isLoggedIn(): boolean {
  return localStorage.getItem(AUTH_KEY) === "1";
}

export function setLoggedIn(v: boolean): void {
  if (v) localStorage.setItem(AUTH_KEY, "1");
  else localStorage.removeItem(AUTH_KEY);
}

// Speicherschicht der App. Lokal: IndexedDB-Key-Value-Store (Demo-Modus ohne
// Backend). Sobald Firebase konfiguriert ist (siehe firebase.config.ts) und
// ein Nutzer angemeldet ist, laufen Laden/Speichern stattdessen ueber
// Firestore + Storage (siehe cloud.ts) - fuer alle Aufrufer transparent.

import type {
  AppData,
  ExposeEntry,
  ExposeProject,
  ExposeType,
  ImageElement,
} from "./types";
import { makeThumbnail } from "./imageEdit";
import {
  cloudDeleteExpose,
  cloudEnabled,
  cloudLoadAppData,
  cloudLoadExpose,
  cloudLoadExposeIndex,
  cloudLoadProject,
  cloudSaveAppData,
  cloudSaveExpose,
  cloudSaveExposeIndex,
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

async function idbDelete(key: string): Promise<void> {
  if (useMemory) {
    memStore.delete(key);
    return;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    useMemory = true;
    memStore.delete(key);
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
    website: "",
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
    kiExposeFiles: {
      einfamilienhaus: [],
      wohnung: [],
      mehrfamilienhaus: [],
      gewerbe: [],
    },
    kiExposeStructure: {
      einfamilienhaus: null,
      wohnung: null,
      mehrfamilienhaus: null,
      gewerbe: null,
    },
    kiExposeStructurePrevious: {
      einfamilienhaus: null,
      wohnung: null,
      mehrfamilienhaus: null,
      gewerbe: null,
    },
    kiExposeAddress: {
      einfamilienhaus: { street: "", city: "" },
      wohnung: { street: "", city: "" },
      mehrfamilienhaus: { street: "", city: "" },
      gewerbe: { street: "", city: "" },
    },
    exposeCounter: 0,
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
    kiExposeFiles: { ...base.kiExposeFiles, ...stored.kiExposeFiles },
    kiExposeStructure: { ...base.kiExposeStructure, ...stored.kiExposeStructure },
    kiExposeStructurePrevious: {
      ...base.kiExposeStructurePrevious,
      ...stored.kiExposeStructurePrevious,
    },
    kiExposeAddress: { ...base.kiExposeAddress, ...stored.kiExposeAddress },
    website: stored.website ?? base.website,
    // Aeltere Datenstaende kennen den Zaehler noch nicht - dann bei 0 starten.
    exposeCounter: stored.exposeCounter ?? base.exposeCounter,
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
  // Bearbeitungsstand eines archivierten Exposés immer mit ins Archiv
  // zurueckschreiben - sonst zeigte "Meine Exposés" dauerhaft den Stand von
  // der Generierung, waehrend im Editor laengst weitergearbeitet wurde.
  if (project.exposeNo !== undefined) void saveExpose(project);
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

// Speichert sofort, ohne das Debounce fuer laufende Interaktions-Edits
// (Ziehen/Skalieren) abzuwarten, und wird erst nach dem tatsaechlichen
// Schreiben aufgeloest. Noetig, wenn direkt danach mit loadProject() wieder
// gelesen wird (z.B. Weiterleitung in den Editor nach der KI-Generierung) -
// sonst kann ein anstehender, noch nicht ausgefuehrter Debounce-Save durch
// den naechsten saveProject()-Aufruf mit demselben Debounce-Schluessel
// ueberschrieben/verworfen werden, bevor er je an Firestore gesendet wurde.
export async function saveProjectNow(project: ExposeProject): Promise<void> {
  if (project.exposeNo !== undefined) await saveExpose(project);
  const uid = useCloud();
  if (uid) {
    const key = `project:${uid}:${project.type}`;
    const pending = debounceTimers.get(key);
    if (pending) {
      clearTimeout(pending);
      debounceTimers.delete(key);
    }
    try {
      await cloudSaveProject(uid, project);
    } catch (e) {
      console.error("Cloud-Speichern (project) fehlgeschlagen:", e);
      onCloudError?.(mapFirestoreError(e));
      throw e;
    }
    return;
  }
  await idbSet(projectKey(project.type), project);
}

// --- Exposé-Archiv -------------------------------------------------------
//
// Zweischichtig: ein schlanker KATALOG mit den Kopfdaten aller Exposés
// (Nummer, Name, Adresse, Vorschaubild) und daneben jedes Exposé einzeln
// unter seiner id. Die Uebersichtsseite braucht so nur den Katalog zu laden -
// ein fertiges Exposé bringt schnell zweistellige Megabyte an Bilddaten mit,
// die beim blossen Durchsehen der Liste niemand braucht.

const EXPOSE_INDEX_KEY = "expose-index";

function exposeKey(id: string): string {
  return `expose:${id}`;
}

export async function listExposes(): Promise<ExposeEntry[]> {
  const uid = useCloud();
  let entries: ExposeEntry[];
  if (uid) {
    try {
      entries = await cloudLoadExposeIndex(uid);
    } catch (e) {
      console.error("Cloud-Laden (Exposé-Katalog) fehlgeschlagen:", e);
      onCloudError?.(mapFirestoreError(e));
      return [];
    }
  } else {
    entries = (await idbGet<ExposeEntry[]>(EXPOSE_INDEX_KEY)) ?? [];
  }
  // Neueste zuerst - so steht das gerade generierte Exposé immer oben.
  return [...entries].sort((a, b) => b.exposeNo - a.exposeNo);
}

async function writeExposeIndex(entries: ExposeEntry[]): Promise<void> {
  const uid = useCloud();
  if (uid) {
    try {
      await cloudSaveExposeIndex(uid, entries);
    } catch (e) {
      console.error("Cloud-Speichern (Exposé-Katalog) fehlgeschlagen:", e);
      onCloudError?.(mapFirestoreError(e));
    }
    return;
  }
  await idbSet(EXPOSE_INDEX_KEY, entries);
}

export async function loadExpose(id: string): Promise<ExposeProject | undefined> {
  const uid = useCloud();
  if (uid) {
    try {
      return (await cloudLoadExpose(uid, id)) ?? undefined;
    } catch (e) {
      console.error("Cloud-Laden (Exposé) fehlgeschlagen:", e);
      onCloudError?.(mapFirestoreError(e));
      return undefined;
    }
  }
  return idbGet<ExposeProject>(exposeKey(id));
}

// Erstes Foto der ersten Seite als Vorschaubild - das ist bei jedem
// generierten Exposé das Titelfoto.
async function buildThumbnail(project: ExposeProject): Promise<string | undefined> {
  // Bewusst NUR die erste Seite betrachten: ein Exposé ohne Titelfoto
  // bekommt lieber gar keine Vorschau als das Foto irgendeiner spaeteren
  // Innenraumseite, das nichts wiedererkennbar macht.
  const first = project.pages[0];
  const photo = first?.elements.find(
    (el): el is ImageElement => el.kind === "image" && Boolean(el.src),
  );
  if (!photo) return undefined;
  const thumb = await makeThumbnail(photo.src);
  return thumb || undefined;
}

// Legt ein Exposé im Archiv ab bzw. aktualisiert es. Der Katalogeintrag
// wird dabei aus dem Projekt abgeleitet; ein bereits vorhandener Eintrag
// behaelt sein Erstellungsdatum und - solange sich das Titelfoto nicht
// geaendert hat - sein Vorschaubild.
export async function saveExpose(project: ExposeProject): Promise<void> {
  if (project.exposeNo === undefined) return;
  const uid = useCloud();

  if (uid) {
    try {
      await cloudSaveExpose(uid, project);
    } catch (e) {
      console.error("Cloud-Speichern (Exposé) fehlgeschlagen:", e);
      onCloudError?.(mapFirestoreError(e));
    }
  } else {
    await idbSet(exposeKey(project.id), project);
  }

  const entries = uid
    ? await cloudLoadExposeIndex(uid).catch(() => [] as ExposeEntry[])
    : (await idbGet<ExposeEntry[]>(EXPOSE_INDEX_KEY)) ?? [];
  const existing = entries.find((e) => e.id === project.id);
  const entry: ExposeEntry = {
    id: project.id,
    exposeNo: project.exposeNo,
    name: project.name ?? project.title,
    type: project.type,
    address: project.address ?? { street: "", city: "" },
    pageCount: project.pages.length,
    createdAt: existing?.createdAt ?? project.createdAt ?? Date.now(),
    updatedAt: project.updatedAt,
    // Vorschaubild nur EINMAL beim Anlegen berechnen: saveExpose() laeuft
    // auch bei jeder Editor-Aenderung mit, und das Verkleinern ueber ein
    // Canvas bei jedem Zug am Bildrahmen waere reine Verschwendung.
    thumbnail: existing?.thumbnail ?? (await buildThumbnail(project)),
  };
  const next = existing
    ? entries.map((e) => (e.id === entry.id ? entry : e))
    : [...entries, entry];
  await writeExposeIndex(next);
}

// Entfernt ein Exposé samt Katalogeintrag. Die vergebene Nummer bleibt
// verbraucht (siehe AppData.exposeCounter) - sie wird nicht neu vergeben.
export async function deleteExpose(id: string): Promise<void> {
  const uid = useCloud();
  if (uid) {
    try {
      await cloudDeleteExpose(uid, id);
    } catch (e) {
      console.error("Cloud-Löschen (Exposé) fehlgeschlagen:", e);
      onCloudError?.(mapFirestoreError(e));
    }
  } else {
    await idbDelete(exposeKey(id));
  }
  const entries = await listExposes();
  await writeExposeIndex(entries.filter((e) => e.id !== id));
}

// Benennt ein archiviertes Exposé um (Katalog UND gespeichertes Exposé,
// damit der Name beim erneuten Oeffnen nicht wieder zurueckspringt).
export async function renameExpose(id: string, name: string): Promise<void> {
  const entries = await listExposes();
  await writeExposeIndex(entries.map((e) => (e.id === id ? { ...e, name } : e)));
  const project = await loadExpose(id);
  if (!project) return;
  const updated = { ...project, name };
  const uid = useCloud();
  if (uid) {
    try {
      await cloudSaveExpose(uid, updated);
    } catch (e) {
      console.error("Cloud-Speichern (Exposé) fehlgeschlagen:", e);
      onCloudError?.(mapFirestoreError(e));
    }
  } else {
    await idbSet(exposeKey(id), updated);
  }
  // Falls dasselbe Exposé gerade im Editor offen ist (Projekt-Ablage seines
  // Typs), auch dort den Namen nachziehen.
  const open = await loadProject(project.type);
  if (open?.id === id) await saveProjectNow({ ...open, name });
}

// --- Auth (einfaches Demo-Login) ----------------------------------------

export function isLoggedIn(): boolean {
  return localStorage.getItem(AUTH_KEY) === "1";
}

export function setLoggedIn(v: boolean): void {
  if (v) localStorage.setItem(AUTH_KEY, "1");
  else localStorage.removeItem(AUTH_KEY);
}

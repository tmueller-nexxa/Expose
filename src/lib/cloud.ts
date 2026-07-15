// Firebase-Anbindung: Auth, Firestore (strukturierte Daten) und Storage
// (grosse Dateien/Bilder). Wird nur aktiv, wenn firebase.config gefuellt ist.

import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import {
  doc,
  getDoc,
  getFirestore,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadString,
  type FirebaseStorage,
} from "firebase/storage";
import { firebaseConfig, isFirebaseConfigured } from "../firebase.config";
import type { AppData, ExposeProject, ExposeType } from "./types";

let app: FirebaseApp | null = null;
let authInst: Auth | null = null;
let dbInst: Firestore | null = null;
let storageInst: FirebaseStorage | null = null;

export function cloudEnabled(): boolean {
  return isFirebaseConfigured();
}

function ensureInit() {
  if (app) return;
  app = initializeApp(firebaseConfig);
  authInst = getAuth(app);
  dbInst = getFirestore(app);
  storageInst = getStorage(app);
}

function auth(): Auth {
  ensureInit();
  return authInst as Auth;
}
function db(): Firestore {
  ensureInit();
  return dbInst as Firestore;
}
function storage(): FirebaseStorage {
  ensureInit();
  return storageInst as FirebaseStorage;
}

// --- Auth ---------------------------------------------------------------

export interface AuthUser {
  uid: string;
  email: string | null;
}

function toUser(u: User | null): AuthUser | null {
  return u ? { uid: u.uid, email: u.email } : null;
}

export function onAuthChanged(cb: (u: AuthUser | null) => void): () => void {
  return onAuthStateChanged(auth(), (u) => cb(toUser(u)));
}

export async function authRegister(email: string, password: string) {
  await createUserWithEmailAndPassword(auth(), email, password);
}
export async function authLogin(email: string, password: string) {
  await signInWithEmailAndPassword(auth(), email, password);
}
export async function authLogout() {
  await signOut(auth());
}
export async function authReset(email: string) {
  await sendPasswordResetEmail(auth(), email);
}
export function currentUid(): string | null {
  return auth().currentUser?.uid ?? null;
}
export function currentToken(): Promise<string> | null {
  const u = auth().currentUser;
  return u ? u.getIdToken() : null;
}

// Firebase-Fehlercodes in verstaendliche Meldungen uebersetzen.
export function mapAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/invalid-email":
      return "Die E-Mail-Adresse ist ungültig.";
    case "auth/email-already-in-use":
      return "Für diese E-Mail existiert bereits ein Konto.";
    case "auth/weak-password":
      return "Das Passwort ist zu schwach (mind. 6 Zeichen).";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "E-Mail oder Passwort ist falsch.";
    case "auth/too-many-requests":
      return "Zu viele Versuche. Bitte später erneut versuchen.";
    case "auth/network-request-failed":
      return "Keine Verbindung zum Server. Internet/Firebase-Konfiguration prüfen.";
    default:
      return (e as Error)?.message ?? "Unbekannter Fehler.";
  }
}

// Firestore-/Storage-Fehlercodes in verstaendliche Meldungen uebersetzen.
export function mapFirestoreError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  switch (code) {
    case "permission-denied":
    case "storage/unauthorized":
      return "Zugriff verweigert – Sicherheitsregeln sind noch nicht eingerichtet";
    case "unavailable":
      return "Server nicht erreichbar";
    case "unauthenticated":
      return "Nicht angemeldet";
    default:
      return (e as Error)?.message ?? "Unbekannter Fehler";
  }
}

// --- Blobs (DataURLs) nach Storage auslagern -----------------------------

// Verhindert wiederholtes Hochladen desselben Bildes bei jedem Speichern
// (die App haelt Bilder lokal weiterhin als DataURL, nicht als Storage-URL).
let uploadCacheUid: string | null = null;
const uploadCache = new Map<string, string>();

export function resetUploadCache(uid: string | null): void {
  if (uploadCacheUid !== uid) {
    uploadCache.clear();
    uploadCacheUid = uid;
  }
}

async function uploadDataUrl(uid: string, dataUrl: string): Promise<string> {
  const cached = uploadCache.get(dataUrl);
  if (cached) return cached;
  const r = ref(storage(), `users/${uid}/${crypto.randomUUID()}`);
  await uploadString(r, dataUrl, "data_url");
  const url = await getDownloadURL(r);
  uploadCache.set(dataUrl, url);
  return url;
}

// Ersetzt rekursiv alle "data:"-Strings durch hochgeladene Storage-URLs.
// Der Klon laeuft ueber JSON (statt structuredClone), das entfernt dabei
// nebenbei alle "undefined"-Feldwerte - Firestore lehnt setDoc() sonst mit
// "Unsupported field value: undefined" ab, egal an welcher Stelle im
// Objektgraphen ein optionales Feld einmal auf undefined statt ausgelassen
// gesetzt wird.
async function offloadBlobs<T>(uid: string, obj: T): Promise<T> {
  const clone: unknown = JSON.parse(JSON.stringify(obj));
  const walk = async (node: unknown): Promise<void> => {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const v = node[i];
        if (typeof v === "string" && v.startsWith("data:")) {
          node[i] = await uploadDataUrl(uid, v);
        } else if (v && typeof v === "object") {
          await walk(v);
        }
      }
    } else if (node && typeof node === "object") {
      const rec = node as Record<string, unknown>;
      for (const k of Object.keys(rec)) {
        const v = rec[k];
        if (typeof v === "string" && v.startsWith("data:")) {
          rec[k] = await uploadDataUrl(uid, v);
        } else if (v && typeof v === "object") {
          await walk(v);
        }
      }
    }
  };
  await walk(clone);
  return clone as T;
}

// --- Firestore-Daten -----------------------------------------------------

export async function cloudLoadAppData(uid: string): Promise<AppData | null> {
  const snap = await getDoc(doc(db(), "users", uid, "state", "appData"));
  return snap.exists() ? (snap.data() as AppData) : null;
}

export async function cloudSaveAppData(uid: string, data: AppData): Promise<AppData> {
  const offloaded = await offloadBlobs(uid, data);
  await setDoc(doc(db(), "users", uid, "state", "appData"), offloaded);
  return offloaded;
}

export async function cloudLoadProject(
  uid: string,
  type: ExposeType,
): Promise<ExposeProject | null> {
  const snap = await getDoc(doc(db(), "users", uid, "state", `project_${type}`));
  return snap.exists() ? (snap.data() as ExposeProject) : null;
}

export async function cloudSaveProject(
  uid: string,
  project: ExposeProject,
): Promise<ExposeProject> {
  const offloaded = await offloadBlobs(uid, project);
  await setDoc(doc(db(), "users", uid, "state", `project_${project.type}`), offloaded);
  return offloaded;
}

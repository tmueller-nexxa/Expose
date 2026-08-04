// Uebersicht aller gespeicherten Exposés ("Meine Exposés").
//
// Zeigt den Katalog aus dem Archiv (siehe storage.ts) - also nur die
// Kopfdaten samt kleinem Vorschaubild, nicht die vollstaendigen Seiten. Erst
// beim Oeffnen wird das gewaehlte Exposé geladen und in die Projekt-Ablage
// seines Objekttyps geschrieben, denn genau von dort holt sich der Editor
// sein Projekt (Route /editor/:type).

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { IconImage, IconTrash } from "../components/Icons";
import {
  deleteExpose,
  listExposes,
  loadExpose,
  renameExpose,
  saveProjectNow,
} from "../lib/storage";
import { EXPOSE_TYPES, type ExposeEntry, type ExposeType } from "../lib/types";
import "./DataPage.css";
import "./ExposesPage.css";

const TYPE_LABEL: Record<ExposeType, string> = {
  einfamilienhaus: "Einfamilienhaus",
  wohnung: "Eigentumswohnung",
  mehrfamilienhaus: "Mehrfamilienhaus",
  gewerbe: "Gewerbeimmobilie",
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ExposesPage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<ExposeEntry[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setEntries(await listExposes());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function open(entry: ExposeEntry) {
    setError(null);
    setBusyId(entry.id);
    try {
      const project = await loadExpose(entry.id);
      if (!project) {
        setError("Dieses Exposé konnte nicht geladen werden.");
        return;
      }
      // Der Editor arbeitet auf der Projekt-Ablage des Objekttyps - das
      // gewaehlte Exposé wird darum dorthin uebernommen und danach geoeffnet.
      await saveProjectNow(project);
      navigate(`/editor/${project.type}`);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(entry: ExposeEntry) {
    if (!window.confirm(`„${entry.name}" wirklich löschen?`)) return;
    setBusyId(entry.id);
    try {
      await deleteExpose(entry.id);
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function commitRename(entry: ExposeEntry) {
    const name = renameValue.trim();
    setRenameId(null);
    if (!name || name === entry.name) return;
    setBusyId(entry.id);
    try {
      await renameExpose(entry.id, name);
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="app-shell">
      <TopBar />
      <div className="page-wrap">
        <div className="data-head">
          <h1>Meine Exposés</h1>
          <p>
            Alle generierten Exposés – automatisch beim Erstellen gespeichert und hier jederzeit
            wieder zu öffnen. Die Exposé-Nummer wird fortlaufend vergeben und bleibt dauerhaft
            eindeutig.
          </p>
        </div>

        {error && <div className="key-status err">{error}</div>}

        {entries === null ? (
          <div className="hint">Wird geladen …</div>
        ) : entries.length === 0 ? (
          <section className="card data-section">
            <p className="section-desc">
              Noch keine gespeicherten Exposés. Sobald Sie unter „KI Exposé" ein Exposé
              generieren, erscheint es automatisch hier.
            </p>
            <button className="btn btn-outline" onClick={() => navigate("/ki-expose")}>
              Zum KI Exposé
            </button>
          </section>
        ) : (
          <div className="expose-grid">
            {entries.map((e) => (
              <article className="expose-card" key={e.id}>
                <button
                  className="expose-thumb"
                  onClick={() => open(e)}
                  title="Im Editor öffnen"
                  disabled={busyId === e.id}
                >
                  {e.thumbnail ? (
                    <img src={e.thumbnail} alt="" />
                  ) : (
                    <IconImage size={28} />
                  )}
                </button>
                <div className="expose-body">
                  {renameId === e.id ? (
                    <input
                      className="expose-rename"
                      autoFocus
                      value={renameValue}
                      onChange={(ev) => setRenameValue(ev.target.value)}
                      onBlur={() => commitRename(e)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") void commitRename(e);
                        if (ev.key === "Escape") setRenameId(null);
                      }}
                    />
                  ) : (
                    <h2 title={e.name}>{e.name}</h2>
                  )}
                  <div className="expose-meta">
                    {TYPE_LABEL[e.type] ??
                      EXPOSE_TYPES.find((t) => t.id === e.type)?.label ??
                      e.type}{" "}
                    · {e.pageCount} Seiten
                  </div>
                  <div className="expose-meta">Zuletzt geändert: {formatDate(e.updatedAt)}</div>
                  <div className="expose-actions">
                    <button
                      className="btn btn-outline"
                      onClick={() => open(e)}
                      disabled={busyId === e.id}
                    >
                      {busyId === e.id ? "…" : "Öffnen"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        setRenameId(e.id);
                        setRenameValue(e.name);
                      }}
                    >
                      Umbenennen
                    </button>
                    <button
                      className="btn btn-ghost expose-del"
                      onClick={() => remove(e)}
                      disabled={busyId === e.id}
                      title="Löschen"
                    >
                      <IconTrash size={15} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

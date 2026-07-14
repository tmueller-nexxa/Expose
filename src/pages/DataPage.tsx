import { useEffect, useState } from "react";
import { TopBar } from "../components/TopBar";
import { Dropzone } from "../components/Dropzone";
import { useApp } from "../context/AppContext";
import {
  EXPOSE_TYPES,
  type ExposeType,
  type StoredFile,
  type StyleText,
} from "../lib/types";
import { analyzeExampleLayout, MODEL_OPTIONS, testApiKey } from "../lib/ai";
import { fileToDataUrl, fileToText, formatBytes, uid } from "../lib/util";
import { pdfAllPagesToImages, pdfFirstPageToImage } from "../lib/pdf";
import {
  IconCheck,
  IconData,
  IconImage,
  IconKey,
  IconText,
  IconTrash,
} from "../components/Icons";
import "./DataPage.css";

export function DataPage() {
  const { data, updateData } = useApp();
  const [activeType, setActiveType] = useState<ExposeType>("einfamilienhaus");
  const [pasteText, setPasteText] = useState("");
  const [keyDraft, setKeyDraft] = useState(data.api.apiKey);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: boolean; msg: string } | null
  >(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState<
    { ok: boolean; msg: string } | null
  >(null);

  // --- Beispiele ---------------------------------------------------------
  async function addExamples(files: File[]) {
    const stored: StoredFile[] = [];
    for (const f of files) {
      stored.push({
        id: uid("file"),
        name: f.name,
        mime: f.type || "application/octet-stream",
        size: f.size,
        dataUrl: await fileToDataUrl(f),
        addedAt: Date.now(),
      });
    }
    updateData((prev) => ({
      ...prev,
      examples: {
        ...prev.examples,
        [activeType]: [...prev.examples[activeType], ...stored],
      },
    }));
  }

  function removeExample(id: string) {
    updateData((prev) => ({
      ...prev,
      examples: {
        ...prev.examples,
        [activeType]: prev.examples[activeType].filter((e) => e.id !== id),
      },
    }));
  }

  // Beispielseiten als Bilder gewinnen (PDF rendern / Bilder direkt).
  async function collectPageImages(files: StoredFile[]): Promise<{
    images: string[];
    source: string;
  }> {
    const pdf = files.find((f) => f.mime === "application/pdf");
    if (pdf) {
      const imgs = await pdfAllPagesToImages(pdf.dataUrl, 10);
      return { images: imgs, source: pdf.name };
    }
    const imgFiles = files.filter((f) => f.mime.startsWith("image/"));
    return {
      images: imgFiles.slice(0, 10).map((f) => f.dataUrl),
      source: imgFiles[0]?.name ?? "Bilder",
    };
  }

  // KI leitet aus den Beispielen die Seitenstruktur ab und speichert sie.
  async function runLayoutAnalysis() {
    setAnalyzeMsg(null);
    const files = data.examples[activeType];
    if (files.length === 0) {
      setAnalyzeMsg({ ok: false, msg: "Bitte zuerst ein Beispiel hochladen." });
      return;
    }
    if (!data.api.apiKey) {
      setAnalyzeMsg({ ok: false, msg: "Bitte zuerst einen API-Key eintragen." });
      return;
    }
    setAnalyzing(true);
    try {
      const { images, source } = await collectPageImages(files);
      if (images.length === 0) {
        setAnalyzeMsg({
          ok: false,
          msg: "Aus dem Beispiel konnten keine Seiten gelesen werden.",
        });
        return;
      }
      const res = await analyzeExampleLayout(data.api, images, activeType);
      if (!res.ok) {
        setAnalyzeMsg({ ok: false, msg: res.message });
        return;
      }
      updateData((prev) => ({
        ...prev,
        layouts: {
          ...prev.layouts,
          [activeType]: {
            pages: res.pages,
            source,
            pageCount: res.pages.length,
            createdAt: Date.now(),
          },
        },
      }));
      setAnalyzeMsg({
        ok: true,
        msg: `Aufbau übernommen: ${res.pages.length} Seite(n) aus „${source}".`,
      });
    } catch (err) {
      setAnalyzeMsg({ ok: false, msg: (err as Error).message });
    } finally {
      setAnalyzing(false);
    }
  }

  function clearLayout() {
    updateData((prev) => ({
      ...prev,
      layouts: { ...prev.layouts, [activeType]: null },
    }));
    setAnalyzeMsg(null);
  }

  // --- Stiltexte ---------------------------------------------------------
  async function addStyleFiles(files: File[]) {
    const items: StyleText[] = [];
    for (const f of files) {
      items.push({
        id: uid("style"),
        name: f.name,
        content: await fileToText(f),
        addedAt: Date.now(),
      });
    }
    updateData((prev) => ({ ...prev, styleTexts: [...prev.styleTexts, ...items] }));
  }

  function addPastedText() {
    if (!pasteText.trim()) return;
    const item: StyleText = {
      id: uid("style"),
      name: `Eingefügter Text (${new Date().toLocaleDateString("de-DE")})`,
      content: pasteText.trim(),
      addedAt: Date.now(),
    };
    updateData((prev) => ({ ...prev, styleTexts: [...prev.styleTexts, item] }));
    setPasteText("");
  }

  function removeStyle(id: string) {
    updateData((prev) => ({
      ...prev,
      styleTexts: prev.styleTexts.filter((s) => s.id !== id),
    }));
  }

  // --- Logo --------------------------------------------------------------
  async function setLogo(files: File[]) {
    const f = files[0];
    if (!f) return;
    const logo: StoredFile = {
      id: uid("logo"),
      name: f.name,
      mime: f.type,
      size: f.size,
      dataUrl: await fileToDataUrl(f),
      addedAt: Date.now(),
    };
    updateData((prev) => ({ ...prev, logo }));
  }

  // --- API ---------------------------------------------------------------
  function saveKey(patch: Partial<typeof data.api>) {
    updateData((prev) => ({ ...prev, api: { ...prev.api, ...patch } }));
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    const res = await testApiKey({ ...data.api, apiKey: keyDraft });
    setTesting(false);
    setTestResult(
      res.ok
        ? { ok: true, msg: "Verbindung erfolgreich – der Key funktioniert." }
        : { ok: false, msg: res.message },
    );
  }

  const examples = data.examples[activeType];
  const activeLayout = data.layouts[activeType];

  return (
    <div className="app-shell">
      <TopBar />
      <div className="page-wrap">
        <div className="data-head">
          <h1>Datenbereich</h1>
          <p>
            Hinterlegen Sie Ihre Vorlagen. Die KI übernimmt Aufbau, Schreibstil
            und Ihr Logo für jedes neue Exposé.
          </p>
        </div>

        {/* 1 · Beispiele */}
        <section className="card data-section">
          <div className="section-head">
            <span className="s-icon">
              <IconData size={20} />
            </span>
            <div>
              <div className="num">SCHRITT 1</div>
              <h2>Beispiel-Exposés</h2>
            </div>
          </div>
          <p className="section-desc">
            Laden Sie fertige Exposés (PDF oder Bilder) hoch. Ihr Aufbau wird als
            Vorlage für den jeweiligen Typ übernommen.
          </p>

          <div className="type-tabs">
            {EXPOSE_TYPES.map((t) => (
              <button
                key={t.id}
                className={`type-tab ${activeType === t.id ? "active" : ""}`}
                onClick={() => setActiveType(t.id)}
              >
                {t.label}
                {data.examples[t.id].length > 0 && ` (${data.examples[t.id].length})`}
              </button>
            ))}
          </div>

          <div style={{ marginLeft: 0 }}>
            <Dropzone
              accept="application/pdf,image/*"
              onFiles={addExamples}
              title={`Beispiel für „${EXPOSE_TYPES.find((t) => t.id === activeType)?.label}" hochladen`}
              hint="PDF oder Bilder · per Klick oder Drag & Drop"
            />
          </div>

          {examples.length > 0 && (
            <div className="file-grid">
              {examples.map((f) => (
                <div className="file-card" key={f.id}>
                  <button
                    className="del"
                    onClick={() => removeExample(f.id)}
                    title="Entfernen"
                  >
                    <IconTrash size={14} />
                  </button>
                  <FileThumb file={f} />
                  <div className="meta">
                    <div className="fname">{f.name}</div>
                    <div className="fsize">{formatBytes(f.size)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="layout-panel">
            <div className="layout-panel-head">
              <div>
                <div className="lp-title">Seitenstruktur übernehmen</div>
                <div className="lp-desc">
                  Die KI liest das Beispiel ein und baut den Aufbau (Seiten,
                  Bild- und Textbereiche, Logo-Position) als Blanko-Vorlage nach.
                </div>
              </div>
              <button
                className="btn btn-primary"
                onClick={runLayoutAnalysis}
                disabled={
                  analyzing || examples.length === 0 || !data.api.apiKey
                }
              >
                {analyzing ? "KI analysiert …" : "Aufbau aus Beispielen übernehmen"}
              </button>
            </div>

            {activeLayout && (
              <div className="lp-current">
                <span className="badge badge-ok">
                  <IconCheck size={13} /> Aufbau aktiv
                </span>
                <span className="lp-current-text">
                  {activeLayout.pageCount} Seite(n) · Quelle: „{activeLayout.source}"
                </span>
                <button className="btn btn-danger" onClick={clearLayout}>
                  Struktur entfernen
                </button>
              </div>
            )}

            {analyzeMsg && (
              <div className={`key-status ${analyzeMsg.ok ? "ok" : "err"}`}>
                {analyzeMsg.ok && <IconCheck size={16} />}
                {analyzeMsg.msg}
              </div>
            )}
            {examples.length === 0 && (
              <div className="hint" style={{ marginTop: 8 }}>
                Zuerst ein Beispiel-Exposé hochladen, dann den Aufbau übernehmen.
              </div>
            )}
          </div>
        </section>

        {/* 2 · Stiltexte */}
        <section className="card data-section">
          <div className="section-head">
            <span className="s-icon">
              <IconText size={20} />
            </span>
            <div>
              <div className="num">SCHRITT 2</div>
              <h2>Schreibstil-Texte</h2>
            </div>
          </div>
          <p className="section-desc">
            Laden Sie eigene Texte hoch oder fügen Sie sie ein. Die KI schreibt
            neue Exposé-Texte in genau diesem Stil.
          </p>

          <Dropzone
            accept=".txt,.md,text/plain"
            onFiles={addStyleFiles}
            title="Textdateien hochladen (.txt, .md)"
            hint="oder Text unten direkt einfügen"
          />

          <div className="paste-area" style={{ marginLeft: 0 }}>
            <textarea
              className="textarea"
              placeholder="Beispieltext des Maklers hier einfügen …"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <button
              className="btn btn-primary"
              onClick={addPastedText}
              disabled={!pasteText.trim()}
            >
              Hinzufügen
            </button>
          </div>

          {data.styleTexts.length > 0 && (
            <div className="style-list">
              {data.styleTexts.map((s) => (
                <div className="style-item" key={s.id}>
                  <div className="st-head">
                    <span className="st-name">{s.name}</span>
                    <button
                      className="btn btn-danger"
                      onClick={() => removeStyle(s.id)}
                      style={{ padding: "4px 8px" }}
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                  <div className="st-text">{s.content.slice(0, 260)}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 3 · Logo & 4 · API */}
        <div className="two-col">
          <section className="card data-section" style={{ marginBottom: 0 }}>
            <div className="section-head">
              <span className="s-icon">
                <IconImage size={20} />
              </span>
              <div>
                <div className="num">SCHRITT 3</div>
                <h2>Logo</h2>
              </div>
            </div>
            <p className="section-desc" style={{ marginLeft: 0 }}>
              Wird automatisch auf jeder Exposé-Seite platziert.
            </p>
            <Dropzone
              accept="image/*"
              multiple={false}
              onFiles={setLogo}
              title="Logo hochladen"
              hint="PNG mit transparentem Hintergrund empfohlen"
              compact
            />
            {data.logo && (
              <div className="logo-preview">
                <div className="logo-box">
                  <img src={data.logo.dataUrl} alt="Logo" />
                </div>
                <button
                  className="btn btn-danger"
                  onClick={() => updateData((p) => ({ ...p, logo: null }))}
                >
                  <IconTrash size={16} /> Entfernen
                </button>
              </div>
            )}
          </section>

          <section className="card data-section" style={{ marginBottom: 0 }}>
            <div className="section-head">
              <span className="s-icon">
                <IconKey size={20} />
              </span>
              <div>
                <div className="num">SCHRITT 4</div>
                <h2>API-Schlüssel</h2>
              </div>
            </div>
            <p className="section-desc" style={{ marginLeft: 0 }}>
              Ihr Anthropic-Key für die KI-Textgenerierung. Bleibt lokal in
              Ihrem Browser.
            </p>

            <div className="field">
              <label htmlFor="model">KI-Modell</label>
              <select
                id="model"
                className="select"
                value={data.api.model}
                onChange={(e) => saveKey({ model: e.target.value })}
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="apikey">Anthropic API-Key</label>
              <input
                id="apikey"
                className="input"
                type="password"
                placeholder="sk-ant-…"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                onBlur={() => saveKey({ apiKey: keyDraft })}
              />
            </div>

            <div className="row">
              <button
                className="btn btn-outline"
                onClick={runTest}
                disabled={testing || !keyDraft.trim()}
              >
                {testing ? "Teste …" : "Verbindung testen"}
              </button>
              {data.api.apiKey && <span className="badge badge-ok">Key gespeichert</span>}
            </div>

            {testResult && (
              <div className={`key-status ${testResult.ok ? "ok" : "err"}`}>
                {testResult.ok && <IconCheck size={16} />}
                {testResult.msg}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// Zeigt eine Vorschau: Bild direkt, PDF gerendert, sonst Icon.
function FileThumb({ file }: { file: StoredFile }) {
  const [preview, setPreview] = useState<string | null>(
    file.mime.startsWith("image/") ? file.dataUrl : null,
  );
  const [loading, setLoading] = useState(file.mime === "application/pdf");

  useEffect(() => {
    let alive = true;
    if (file.mime === "application/pdf") {
      pdfFirstPageToImage(file.dataUrl).then((img) => {
        if (!alive) return;
        setPreview(img);
        setLoading(false);
      });
    }
    return () => {
      alive = false;
    };
  }, [file]);

  return (
    <div className="thumb">
      {preview ? (
        <img src={preview} alt={file.name} />
      ) : loading ? (
        <span style={{ fontSize: 12 }}>Vorschau …</span>
      ) : (
        <IconImage size={26} />
      )}
    </div>
  );
}

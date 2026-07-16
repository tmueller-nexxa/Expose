import { useEffect, useState } from "react";
import { TopBar } from "../components/TopBar";
import { Dropzone } from "../components/Dropzone";
import { useApp } from "../context/AppContext";
import {
  EXPOSE_TYPES,
  type BoilerplatePage,
  type DesignPage,
  type ExposeType,
  type PageElement,
  type StoredFile,
  type StyleText,
} from "../lib/types";
import {
  aiReady,
  analyzePagesDesign,
  analyzePagesPhotos,
  MAX_ANALYZE_PAGES,
  MODEL_OPTIONS,
  testApiKey,
} from "../lib/ai";
import { aiProxyUrl } from "../firebase.config";
import { BOILERPLATE_TITLES, detectBoilerplate } from "../lib/boilerplate";
import { eraseRegionsFromImage } from "../lib/imageEdit";
import { fileToDataUrl, fileToText, formatBytes, uid } from "../lib/util";
import { pdfFirstPageToImage, renderPdfPages, type RenderedPage } from "../lib/pdf";
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
  const [progress, setProgress] = useState<{
    phase: "render" | "analyze" | "boiler";
    done: number;
    total: number;
  } | null>(null);

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

  // Beispielseiten mit Bild + Text + Bildanzahl gewinnen (PDF / Bilder).
  async function collectPages(files: StoredFile[]): Promise<{
    pages: RenderedPage[];
    source: string;
  }> {
    const pdf = files.find((f) => f.mime === "application/pdf");
    if (pdf) {
      const pages = await renderPdfPages(
        pdf.dataUrl,
        MAX_ANALYZE_PAGES,
        1000,
        (done, total) => setProgress({ phase: "render", done, total }),
      );
      return { pages, source: pdf.name };
    }
    const imgFiles = files.filter((f) => f.mime.startsWith("image/"));
    return {
      pages: imgFiles
        .slice(0, MAX_ANALYZE_PAGES)
        .map((f) => ({ image: f.dataUrl, text: "", imageCount: 0 })),
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
    if (!aiReady(data.api)) {
      setAnalyzeMsg({
        ok: false,
        msg: aiProxyUrl
          ? "Bitte zuerst anmelden."
          : "Bitte zuerst einen API-Key eintragen.",
      });
      return;
    }
    setAnalyzing(true);
    setProgress({ phase: "render", done: 0, total: 0 });
    try {
      const { pages, source } = await collectPages(files);
      if (pages.length === 0) {
        setAnalyzeMsg({
          ok: false,
          msg: "Aus dem Beispiel konnten keine Seiten gelesen werden. Falls es ein PDF ist: bitte die Seiten als Bilder (JPG/PNG) hochladen.",
        });
        return;
      }

      // Standardseiten (Impressum/AGB/Widerruf/Kontakt) erkennen und abtrennen.
      // Standardseiten werden 1:1 als Bild uebernommen (wortgetreuer,
      // rechtssicherer Text bleibt erhalten, nur Fotos werden zu
      // Platzhaltern). Inhaltsseiten bekommen KEIN eingebettetes Bild,
      // sondern werden als editierbare Vektor-Grafik nachgebaut (Formen/
      // Banner in Originalfarbe, Text-Stile ohne Originalinhalt, leere
      // Fotoflaechen).
      const kinds = detectBoilerplate(
        pages.map((p) => ({ text: p.text, imageCount: p.imageCount })),
      );
      const boilerPages: BoilerplatePage[] = [];
      const contentPages: { order: number; image: string }[] = [];
      pages.forEach((p, i) => {
        const kind = kinds[i];
        if (kind) {
          boilerPages.push({
            id: uid("bp"),
            kind,
            title: BOILERPLATE_TITLES[kind],
            image: p.image,
            order: i,
          });
        } else if (p.image) {
          contentPages.push({ order: i, image: p.image });
        }
      });

      // Inhaltsseiten: KEIN Bild uebernehmen - stattdessen den grafischen
      // Aufbau (Formen/Banner in Originalfarbe, Text-Positionen/-Stile,
      // Fotoflaechen leer) als editierbare Elemente nachbauen. Text auf
      // einer farbigen Formflaeche (Banner/Kachel) ist meist ein statisches
      // Rubriken-/Abschnittslabel und wird 1:1 uebernommen; freier Fliesstext
      // bleibt leer, da er objektspezifisch ist.
      const capturedContent: DesignPage[] = [];
      if (contentPages.length > 0) {
        setProgress({ phase: "analyze", done: 0, total: contentPages.length });
        const res = await analyzePagesDesign(
          data.api,
          contentPages.map((p) => p.image),
          (done, total) => setProgress({ phase: "analyze", done, total }),
        );
        if (!res.ok) {
          setAnalyzeMsg({ ok: false, msg: res.message });
          return;
        }
        for (let i = 0; i < contentPages.length; i++) {
          const cp = contentPages[i];
          const design = res.pages[i] ?? { title: `Seite ${i + 1}`, background: "#ffffff", blocks: [] };
          const shapes = design.blocks.filter((b) => b.type === "shape");
          let z = 1;
          const elements: PageElement[] = design.blocks.map((b) => {
            if (b.type === "shape") {
              return {
                id: uid("el"),
                kind: "shape",
                x: b.x,
                y: b.y,
                w: b.w,
                h: b.h,
                z: z++,
                color: b.color ?? "#e5e7eb",
                radius: b.radius,
              };
            }
            if (b.type === "image") {
              return {
                id: uid("el"),
                kind: "image",
                x: b.x,
                y: b.y,
                w: b.w,
                h: b.h,
                z: z++,
                src: "",
                fit: "cover",
              };
            }
            if (b.type === "logo") {
              return {
                id: uid("el"),
                kind: "logo",
                x: b.x,
                y: b.y,
                w: b.w,
                h: b.h,
                z: 999,
                src: "",
              };
            }
            // Sicherheitsnetz: der Originaltext wird nur uebernommen, wenn
            // der Textblock auch geometrisch auf einer Formflaeche liegt -
            // unabhaengig davon, was die KI im "text"-Feld geliefert hat.
            const cx = b.x + b.w / 2;
            const cy = b.y + b.h / 2;
            const onShape = shapes.some(
              (s) => cx >= s.x && cx <= s.x + s.w && cy >= s.y && cy <= s.y + s.h,
            );
            return {
              id: uid("el"),
              kind: b.type === "heading" ? "heading" : "text",
              x: b.x,
              y: b.y,
              w: b.w,
              h: b.h,
              z: z++,
              text: onShape ? (b.text ?? "") : "",
              fontSize: b.fontSize ?? (b.type === "heading" ? 26 : 15),
              align: b.align ?? "left",
              color: b.color ?? "#1f2d3d",
              background: "rgba(0,0,0,0)",
              fontWeight: b.fontWeight ?? (b.type === "heading" ? 700 : 400),
            };
          });
          capturedContent.push({
            id: uid("cp"),
            title: design.title || `Seite ${i + 1}`,
            order: cp.order,
            background: design.background,
            elements,
          });
        }
        updateData((prev) => ({
          ...prev,
          layouts: {
            ...prev.layouts,
            [activeType]: {
              pages: capturedContent,
              source,
              pageCount: capturedContent.length,
              createdAt: Date.now(),
            },
          },
        }));
      }

      // Standardseiten: nur Fotos erkennen (Impressum/AGB/Widerruf), aus dem
      // Bild entfernen und durch Platzhalter ersetzen. Kontakt behaelt sein
      // Foto (Makler-Portrait) unangetastet. Text bleibt auf allen
      // Standardseiten vollstaendig erhalten.
      const needPhotos = boilerPages.filter((b) => b.kind !== "kontakt");
      if (needPhotos.length > 0) {
        setProgress({ phase: "boiler", done: 0, total: needPhotos.length });
        const res = await analyzePagesPhotos(
          data.api,
          needPhotos.map((b) => pages[b.order]?.image ?? b.image),
        );
        if (res.ok) {
          for (let i = 0; i < needPhotos.length; i++) {
            const b = needPhotos[i];
            const src = pages[b.order]?.image ?? b.image;
            const rects = res.pages[i] ?? [];
            if (rects.length > 0) {
              b.photoSlots = rects;
              b.image = await eraseRegionsFromImage(src, rects);
            }
            setProgress({ phase: "boiler", done: i + 1, total: needPhotos.length });
          }
        }
      }

      // Standardseiten global speichern (gelten fuer alle Expose-Typen).
      if (boilerPages.length > 0) {
        updateData((prev) => ({
          ...prev,
          boilerplate: { pages: boilerPages, source, createdAt: Date.now() },
        }));
      }

      const parts: string[] = [];
      if (capturedContent.length > 0) parts.push(`${capturedContent.length} Inhaltsseite(n) 1:1 übernommen`);
      if (boilerPages.length > 0) {
        const names = [...new Set(boilerPages.map((b) => BOILERPLATE_TITLES[b.kind]))];
        parts.push(`${boilerPages.length} Standardseite(n) 1:1 übernommen (${names.join(", ")})`);
      }
      setAnalyzeMsg({
        ok: true,
        msg:
          parts.length > 0
            ? `Übernommen aus „${source}": ${parts.join(" · ")}.`
            : "Es konnte keine Struktur abgeleitet werden.",
      });
    } catch (err) {
      setAnalyzeMsg({ ok: false, msg: (err as Error).message });
    } finally {
      setAnalyzing(false);
      setProgress(null);
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

  async function setCover(files: File[]) {
    const f = files[0];
    if (!f) return;
    const cover: StoredFile = {
      id: uid("cover"),
      name: f.name,
      mime: f.type,
      size: f.size,
      dataUrl: await fileToDataUrl(f),
      addedAt: Date.now(),
    };
    updateData((prev) => ({ ...prev, cover }));
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
                  Inhaltsseiten (Titelseite, Objektbeschreibung, Lage, …)
                  werden als <b>editierbare Grafik 1:1 nachgebaut</b> – Formen/
                  Banner in Originalfarbe, Bildflächen als leere Platzhalter
                  (kein Originalfoto wird übernommen). Text auf farbigen
                  Bannern/Kacheln (z. B. Rubriken-Label) wird <b>1:1
                  übernommen</b>, freier Fließtext bleibt leer und wird pro
                  Objekt neu eingegeben. Standardseiten (Impressum, AGB,
                  Widerruf, Kontakt) bleiben <b>1:1 als Bildkopie</b> mit
                  vollständigem, wortgetreuem Text – nur Fotos werden durch
                  Platzhalter ersetzt (Kontakt behält sein Foto). Gilt für
                  alle Exposé-Typen.
                </div>
              </div>
              <button
                className="btn btn-primary"
                onClick={runLayoutAnalysis}
                disabled={
                  analyzing || examples.length === 0 || !aiReady(data.api)
                }
              >
                {analyzing ? "KI analysiert …" : "Aufbau aus Beispielen übernehmen"}
              </button>
            </div>

            {progress && (
              <div className="lp-progress">
                <div className="lp-progress-label">
                  {progress.phase === "render"
                    ? `Seiten werden gelesen … ${progress.done}/${progress.total || "…"}`
                    : progress.phase === "boiler"
                      ? `Standardseiten aufbereiten … ${progress.done}/${progress.total}`
                      : `Grafik wird nachgebaut … ${progress.done}/${progress.total} Seiten`}
                </div>
                <div className="lp-progress-bar">
                  <div
                    style={{
                      width: `${
                        progress.total
                          ? Math.round((progress.done / progress.total) * 100)
                          : 5
                      }%`,
                    }}
                  />
                </div>
                <div className="hint" style={{ marginTop: 6 }}>
                  Das kann bei großen Exposés ein bis zwei Minuten dauern – bitte
                  das Fenster geöffnet lassen.
                </div>
              </div>
            )}

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

            {data.boilerplate && data.boilerplate.pages.length > 0 && (
              <div className="lp-current">
                <span className="badge badge-ok">
                  <IconCheck size={13} /> Standardseiten (alle Typen)
                </span>
                <span className="lp-current-text">
                  {data.boilerplate.pages.length} Seite(n) 1:1:{" "}
                  {[...new Set(data.boilerplate.pages.map((b) => BOILERPLATE_TITLES[b.kind]))].join(", ")}
                </span>
                <button
                  className="btn btn-danger"
                  onClick={() => updateData((p) => ({ ...p, boilerplate: null }))}
                >
                  Entfernen
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

            <div className="divider" />
            <h3 style={{ fontSize: 15, marginBottom: 4 }}>Titelbild (Objektfoto)</h3>
            <p className="section-desc" style={{ marginLeft: 0 }}>
              Ihr echtes Foto für den Hero auf Login- und Startseite.
            </p>
            <Dropzone
              accept="image/*"
              multiple={false}
              onFiles={setCover}
              title="Titelbild hochladen"
              hint="Querformat empfohlen (z. B. 1600×900)"
              compact
            />
            {data.cover && (
              <div className="cover-preview">
                <img src={data.cover.dataUrl} alt="Titelbild" />
                <button
                  className="btn btn-danger"
                  onClick={() => updateData((p) => ({ ...p, cover: null }))}
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
            {aiProxyUrl ? (
              <p className="section-desc" style={{ marginLeft: 0 }}>
                <span className="badge badge-ok" style={{ marginRight: 8 }}>
                  <IconCheck size={13} /> Server-Proxy aktiv
                </span>
                Die KI-Aufrufe laufen sicher über Ihr Konto – ein eigener
                API-Key ist nicht nötig.
              </p>
            ) : (
              <p className="section-desc" style={{ marginLeft: 0 }}>
                Ihr Anthropic-Key für die KI-Textgenerierung. Bleibt lokal in
                Ihrem Browser.
              </p>
            )}

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
              <label htmlFor="apikey">
                Anthropic API-Key
                {aiProxyUrl && (
                  <span className="soft" style={{ fontWeight: 400 }}>
                    {" "}
                    (optional – nur als Ersatz für den Server-Proxy)
                  </span>
                )}
              </label>
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
                disabled={testing || (!keyDraft.trim() && !aiProxyUrl)}
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

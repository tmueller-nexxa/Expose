import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Kennung des gebauten Standes, sichtbar oben rechts in der Anwendung.
// Damit laesst sich in einer Sekunde feststellen, ob der Browser wirklich die
// neueste Fassung geladen hat oder noch eine aus dem Zwischenspeicher - ohne
// diese Anzeige bleibt bei jeder Rueckmeldung offen, welcher Stand gemeint war.
function buildId(): string {
  const sha =
    process.env.GITHUB_SHA?.slice(0, 7) ??
    (() => {
      try {
        return execSync("git rev-parse --short HEAD").toString().trim();
      } catch {
        return "dev";
      }
    })();
  const date = new Date().toISOString().slice(0, 16).replace("T", " ");
  return `${sha} · ${date}`;
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 1500,
  },
});

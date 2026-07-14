// Build-Variante, die die komplette App in eine einzige, in sich
// geschlossene index.html buendelt (JS + CSS + Assets inline).
// Verwendung: vite build --config vite.config.singlefile.ts
// Ergebnis: dist-single/index.html – ideal fuer Vorschau/Artifact.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    target: "es2020",
    outDir: "dist-single",
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 5000,
  },
});

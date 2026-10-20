import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { SITE_BASE } from "./src/lib/siteBase.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Dev only: serves edition artifacts at `<SITE_BASE>editions/` from the local kitchen
 * (`data/editions`, written by `npm run edition`), falling back to the tracked samples in
 * `fixtures/editions`. That is all the old local API server did; no key or database needed.
 */
function editionsDevServer(): Plugin {
  const prefix = `${SITE_BASE.replace(/\/$/, "")}/editions/`;
  const roots = [path.join(repoRoot, "data", "editions"), path.join(repoRoot, "fixtures", "editions")];
  const types: Record<string, string> = {
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".png": "image/png",
    ".mp3": "audio/mpeg",
  };

  return {
    name: "pulso-editions-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith(prefix)) return next();
        const relative = decodeURIComponent(url.pathname.slice(prefix.length));
        for (const root of roots) {
          const file = path.resolve(root, relative);
          if (!file.startsWith(root + path.sep)) break;
          if (existsSync(file) && statSync(file).isFile()) {
            res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
            res.setHeader("Cache-Control", "no-store");
            createReadStream(file).pipe(res);
            return;
          }
        }
        res.statusCode = 404;
        res.end("not found");
      });
    },
  };
}

export default defineConfig({
  base: SITE_BASE,
  plugins: [react(), editionsDevServer()],
  build: {
    /**
     * Emitted so `scripts/bundle-budget.mjs` can resolve the weekly page's bundle from the entry's
     * STATIC import graph instead of guessing by filename. `scripts/build-site.mjs` leaves the
     * manifest out of the published site.
     */
    manifest: true,
  },
  server: {
    port: 4311,
    host: true,
    open: SITE_BASE,
  },
  preview: {
    port: 4311,
    host: true,
  },
});

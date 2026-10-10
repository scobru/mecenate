import { defineConfig } from "vite";

// base "./": Freenet serves the app from a sandboxed iframe under a contract path.
// bridge.html is the wallet bridge hosted on GitHub Pages (see README), built from the same sources.
export default defineConfig({ base: "./", build: { target: "es2022", assetsInlineLimit: 0, rollupOptions: { input: ["index.html", "bridge.html"] } } });

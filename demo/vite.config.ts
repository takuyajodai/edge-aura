import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The demo imports the package by its published names ("edge-aura",
// "edge-aura/react") but resolves them straight to src/ so it always runs
// against the working tree.
export default defineConfig({
  plugins: [react()],
  // The dev-only QA probes in src (window.__auraEngine, __kindleState) are
  // gated by `typeof process !== "undefined" && ... NODE_ENV !== "production"`.
  // Vite replaces only the textual `process.env.NODE_ENV` and never defines a
  // global `process`, so without this the `typeof` guard is false in the
  // browser and the probes vanish from the demo — the repo's QA vehicle.
  // Defining bare `process` makes the guard pass; Vite's own longer-key
  // `process.env.NODE_ENV` replacement still decides dev vs build, so the
  // probes stay dead-code-eliminated from `npm run demo:build` output.
  define: {
    process: JSON.stringify({ env: {} }),
  },
  resolve: {
    alias: {
      "edge-aura/react": fileURLToPath(new URL("../src/react.tsx", import.meta.url)),
      "edge-aura": fileURLToPath(new URL("../src/index.ts", import.meta.url)),
    },
  },
});

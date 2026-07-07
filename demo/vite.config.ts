import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The demo imports the package by its published names ("edge-aura",
// "edge-aura/react") but resolves them straight to src/ so it always runs
// against the working tree.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "edge-aura/react": fileURLToPath(new URL("../src/react.tsx", import.meta.url)),
      "edge-aura": fileURLToPath(new URL("../src/index.ts", import.meta.url)),
    },
  },
});

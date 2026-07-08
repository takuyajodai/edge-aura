import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react.tsx",
  },
  format: "esm",
  dts: true,
  clean: true,
  deps: {
    neverBundle: ["react", "react/jsx-runtime"],
  },
  // package.json declares ./dist/index.js + ./dist/index.d.ts (and the react
  // pair) — pin the extensions so tsdown's .mjs/.d.mts defaults can't silently
  // break the published entry paths. `check:dist` verifies post-build.
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  // src/react.tsx begins with "use client" — it must survive into
  // dist/react.js so Next.js App Router consumers can import the adapter
  // from a server component tree. Verified post-build by `check:dist`.
});

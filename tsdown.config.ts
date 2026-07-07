import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react.tsx",
  },
  format: "esm",
  dts: true,
  external: ["react", "react/jsx-runtime"],
  // src/react.tsx begins with "use client" — it must survive into
  // dist/react.js so Next.js App Router consumers can import the adapter
  // from a server component tree. Verified post-build.
});

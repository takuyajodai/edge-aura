#!/usr/bin/env node
/**
 * Publish artifact gate — dependency-free sanity checks on dist/ so a build
 * toolchain change can never silently ship a broken package again:
 *
 *   1. The exact entry paths declared in package.json "exports" exist
 *      (dist/index.js, dist/index.d.ts, dist/react.js, dist/react.d.ts) —
 *      hash-named or re-extensioned outputs (.mjs/.d.mts) fail here.
 *   2. dist/react.js starts with the "use client" directive (Next.js App
 *      Router consumers depend on it surviving the bundler).
 *   3. The server-safe core entry graph — dist/index.js plus every local
 *      chunk it (transitively) imports, e.g. the shared dist/engine-<hash>.js
 *      chunk emitted by tsdown/rolldown code-splitting — does not import
 *      react. Matches actual module specifiers, not bare word occurrences,
 *      so the word "React" in preserved comments cannot false-positive.
 *
 * Run via `npm run check:dist`; wired into prepublishOnly.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

// 1. Declared entry paths must exist with those exact names.
for (const rel of [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/react.js",
  "dist/react.d.ts",
]) {
  if (!existsSync(join(root, rel))) {
    errors.push(`${rel} is missing — package.json exports point at it.`);
  }
}

// 2. "use client" must be the first statement of dist/react.js.
const reactJs = join(root, "dist/react.js");
if (existsSync(reactJs)) {
  const src = readFileSync(reactJs, "utf8");
  if (!/^["']use client["']/.test(src)) {
    errors.push(
      'dist/react.js does not start with "use client" — the directive was dropped by the build.',
    );
  }
}

// 3. The core entry graph must stay React-free. dist/index.js can be a thin
//    re-export of a shared chunk (tsdown/rolldown code-splitting), so walk
//    every local `./` specifier transitively and check each module. Match
//    import/re-export/require specifiers rather than any word occurrence:
//    catches `import x from "react"`, `export ... from "react/jsx-runtime"`,
//    bare `import "react"`, and dynamic `import("react")`, while ignoring the
//    word "React" in preserved comments.
const reactSpecifierRe = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']react(?:["']|[/-])/;
const localSpecifierRe = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](\.\.?\/[^"']+)["']/g;

const checkReactFree = (relFromRoot, seen) => {
  if (seen.has(relFromRoot)) return;
  seen.add(relFromRoot);
  const abs = join(root, relFromRoot);
  if (!existsSync(abs)) return; // missing entries are reported by check 1
  const src = readFileSync(abs, "utf8");
  if (reactSpecifierRe.test(src)) {
    errors.push(
      `${relFromRoot} imports react — the core entry graph must be server-safe and React-free.`,
    );
  }
  for (const match of src.matchAll(localSpecifierRe)) {
    // Chunk imports are relative to dist/, where all output files live flat.
    checkReactFree(join("dist", match[1]), seen);
  }
};
checkReactFree("dist/index.js", new Set());

if (errors.length > 0) {
  console.error("check:dist FAILED:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("check:dist OK — entry paths, use-client directive, react-free core.");

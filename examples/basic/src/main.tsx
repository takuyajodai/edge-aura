import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { EdgeAura } from "edge-aura/react";
import type { EdgeAuraPaletteName } from "edge-aura";

const PALETTES: EdgeAuraPaletteName[] = [
  "opal", "aurora", "ocean", "sunset", "sakura", "ember", "ultraviolet",
];

function App() {
  const [palette, setPalette] = useState<EdgeAuraPaletteName>("opal");
  const [dark, setDark] = useState(true);
  const [fill, setFill] = useState(true);

  document.documentElement.toggleAttribute("data-dark", dark);

  return (
    <>
      <EdgeAura
        palette={palette}
        options={{
          palette: { background: dark ? "dark" : "light", ...(dark ? { blendMode: "plus-lighter" as const } : {}) },
          geometry: { cornerFill: fill },
        }}
      />
      <main>
        <h1>edge-aura</h1>
        <p>Click anywhere for a burst. One component, zero CSS.</p>
        <div>
          {PALETTES.map((p) => (
            <button key={p} onClick={() => setPalette(p)} style={{ fontWeight: p === palette ? 700 : 400 }}>
              {p}
            </button>
          ))}
        </div>
        <div>
          <button onClick={() => setDark((d) => !d)}>{dark ? "light page" : "dark page"}</button>
          <button onClick={() => setFill((f) => !f)}>{fill ? "rounded corners" : "filled corners"}</button>
        </div>
      </main>
    </>
  );
}

window.addEventListener("pointerdown", (e) =>
  window.dispatchEvent(new CustomEvent("aura:tap", { detail: { x: e.clientX, y: e.clientY } })),
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EdgeAura } from "edge-aura/react";
import {
  EDGE_AURA_PALETTES,
  keyCodeToPosition,
  type EdgeAuraPaletteName,
} from "edge-aura";

/**
 * Interactive demo:
 *  - click anywhere        → energy burst at the nearest edge (aura:tap)
 *  - type in the textarea  → per-key bumps on the bottom edge + faster rotation
 *  - palette buttons       → remount with a new palette
 *  - kindle                → replay the entrance, spreading from your last click
 *  - saved pulse           → the gentle "autosave succeeded" swell
 */
function Demo() {
  const [palette, setPalette] = useState<EdgeAuraPaletteName>("siri");
  const [typing, setTyping] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  // Bumping the key remounts EdgeAura so the kindle entrance replays.
  const [entranceKey, setEntranceKey] = useState(0);
  const [kindleOrigin, setKindleOrigin] = useState<{ x: number; y: number } | null>(null);
  const lastClick = useRef({ x: innerWidth / 2, y: innerHeight / 2 });
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markTyping = () => {
    setTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 1200);
  };

  return (
    <div
      onPointerDown={(e) => {
        lastClick.current = { x: e.clientX, y: e.clientY };
        window.dispatchEvent(
          new CustomEvent("aura:tap", { detail: { x: e.clientX, y: e.clientY } })
        );
      }}
    >
      <EdgeAura
        key={`${palette}-${entranceKey}`}
        state={typing ? "typing" : "idle"}
        savedAt={savedAt}
        options={{ palette: { stops: EDGE_AURA_PALETTES[palette] } }}
        kindleOrigin={kindleOrigin}
      />

      <main>
        <h1>edge-aura</h1>
        <p>
          A Siri-style organic glow hugging the viewport edges. Click anywhere
          for a burst, type below to make it pulse, switch palettes, or replay
          the kindle entrance.
        </p>

        <textarea
          placeholder="Type here — each key bumps the bottom edge…"
          onKeyDown={(e) => {
            const pos = keyCodeToPosition(e.code);
            if (pos) {
              window.dispatchEvent(new CustomEvent("aura:key", { detail: pos }));
            }
            markTyping();
          }}
        />

        <div className="row">
          {(Object.keys(EDGE_AURA_PALETTES) as EdgeAuraPaletteName[]).map(
            (name) => (
              <button
                key={name}
                className={name === palette ? "active" : ""}
                onClick={() => setPalette(name)}
              >
                {name}
              </button>
            )
          )}
        </div>

        <div className="row">
          <button
            onClick={() => {
              setKindleOrigin({ ...lastClick.current });
              setEntranceKey((k) => k + 1);
            }}
          >
            kindle（点火をリプレイ）
          </button>
          <button onClick={() => setSavedAt(Date.now())}>saved pulse</button>
        </div>

        <div className="hint">
          The overlay is pointer-events:none — the page stays fully interactive.
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Demo />
  </StrictMode>
);

import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EdgeAura } from "edge-aura/react";
import {
  EDGE_AURA_PALETTES,
  EDGE_AURA_PRESETS,
  keyCodeToPosition,
  type EdgeAuraOptions,
  type EdgeAuraPaletteName,
  type EdgeAuraPresetName,
} from "edge-aura";

/**
 * Interactive demo:
 *  - click anywhere        → energy burst at the nearest edge (aura:tap)
 *  - type in the textarea  → per-key bumps on the bottom edge + faster rotation
 *  - palette buttons       → crossfade to a new palette (reactive `palette` prop)
 *  - preset buttons        → remount with an appearance preset (creation-time options)
 *  - pause / resume        → toggle the `active` prop (freezes the last frame)
 *  - light / dark page     → flip the page background + palette.background (remount)
 *  - kindle                → replay the entrance, spreading from your last click
 *  - saved pulse           → the gentle "autosave succeeded" swell
 */
function Demo() {
  const [palette, setPalette] = useState<EdgeAuraPaletteName>("siri");
  const [preset, setPreset] = useState<"default" | EdgeAuraPresetName>("default");
  const [active, setActive] = useState(true);
  const [dark, setDark] = useState(false);
  const [typing, setTyping] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  // Bumping the key remounts EdgeAura so the kindle entrance replays.
  const [entranceKey, setEntranceKey] = useState(0);
  const [kindleOrigin, setKindleOrigin] = useState<{ x: number; y: number } | null>(null);
  const lastClick = useRef({ x: innerWidth / 2, y: innerHeight / 2 });
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the page chrome in sync with the aura's background setting.
  useEffect(() => {
    document.body.classList.toggle("dark", dark);
  }, [dark]);

  const markTyping = () => {
    setTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 1200);
  };

  // Presets and palette.background are creation-time options, so preset /
  // background changes remount (key below). Palette changes do NOT remount —
  // the reactive `palette` prop crossfades the live engine instead.
  const presetOptions: EdgeAuraOptions | undefined =
    preset === "default" ? undefined : EDGE_AURA_PRESETS[preset];
  const options: EdgeAuraOptions = {
    ...presetOptions,
    palette: {
      ...presetOptions?.palette,
      background: dark ? "dark" : "light",
    },
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
        key={`${preset}-${dark}-${entranceKey}`}
        state={typing ? "typing" : "idle"}
        savedAt={savedAt}
        palette={palette}
        active={active}
        options={options}
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
          {(["default", ...Object.keys(EDGE_AURA_PRESETS)] as const).map(
            (name) => (
              <button
                key={name}
                className={name === preset ? "active" : ""}
                onClick={() => {
                  setKindleOrigin(null); // remounts: don't replay the entrance
                  setPreset(name as "default" | EdgeAuraPresetName);
                }}
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
            Replay kindle entrance
          </button>
          <button onClick={() => setSavedAt(Date.now())}>saved pulse</button>
          <button onClick={() => setActive((a) => !a)}>
            {active ? "pause" : "resume"}
          </button>
          <button
            onClick={() => {
              setKindleOrigin(null); // remounts: don't replay the entrance
              setDark((d) => !d);
            }}
          >
            {dark ? "light page" : "dark page"}
          </button>
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

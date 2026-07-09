import {
  StrictMode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { EdgeAura } from "edge-aura/react";
import {
  EDGE_AURA_DEFAULTS,
  EDGE_AURA_PALETTES,
  EDGE_AURA_PRESETS,
  keyCodeToPosition,
  type EdgeAuraOptions,
  type EdgeAuraPaletteName,
  type EdgeAuraPresetName,
} from "edge-aura";
import {
  CopyButton,
  ControlRow,
  GitHubIcon,
  MoonIcon,
  SegmentedControl,
  SliderRow,
  SunIcon,
  type SegmentedOption,
} from "./ui";
import { detectLang, STRINGS, type Lang } from "./i18n";
import "./styles.css";

const REPO_URL = "https://github.com/takuyajodai/edge-aura";
const AUTHOR_URL = "https://github.com/takuyajodai";
const INSTALL_CMD = "npm install edge-aura";

type PresetChoice = "default" | EdgeAuraPresetName;

const PALETTE_NAMES = Object.keys(EDGE_AURA_PALETTES) as EdgeAuraPaletteName[];
const PRESET_CHOICES: PresetChoice[] = [
  "default",
  ...(Object.keys(EDGE_AURA_PRESETS) as EdgeAuraPresetName[]),
];

// -- Slider model -----------------------------------------------------------
// The eight tunable scalars. Preset selection RESETS these to the preset's
// values (falling back to the engine defaults for fields the preset omits).

interface Sliders {
  band: number;
  cornerRadius: number;
  inset: number;
  ringAlpha: number;
  pastel: number;
  rotateIdleS: number;
  hueDriftDeg: number;
  highlightArcDeg: number; // 0 = highlight off
}

const D = EDGE_AURA_DEFAULTS;

function slidersFromPreset(choice: PresetChoice): Sliders {
  const p: EdgeAuraOptions = choice === "default" ? {} : EDGE_AURA_PRESETS[choice];
  return {
    band: p.geometry?.band ?? D.geometry.band,
    cornerRadius: p.geometry?.cornerRadius ?? D.geometry.cornerRadius,
    inset: p.geometry?.inset ?? D.geometry.inset,
    ringAlpha: p.palette?.ringAlpha ?? D.palette.ringAlpha,
    pastel: p.palette?.pastel ?? D.palette.pastel,
    rotateIdleS: p.motion?.rotateIdleS ?? D.motion.rotateIdleS,
    hueDriftDeg: p.motion?.hueDriftDeg ?? D.motion.hueDriftDeg,
    highlightArcDeg: p.motion?.highlight?.arcDeg ?? 0,
  };
}

// -- Theme bootstrap --------------------------------------------------------

type Theme = "light" | "dark";

function detectTheme(): Theme {
  try {
    const saved = localStorage.getItem("edge-aura-demo-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  return typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

// -- Live code-snippet generation ------------------------------------------
// Emit ONLY values that differ from the engine defaults, per section, as a
// copy-pasteable <EdgeAura … /> JSX block.

function fmtVal(v: unknown): string {
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return String(v);
  if (v && typeof v === "object") {
    const inner = Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}: ${fmtVal(val)}`)
      .join(", ");
    return `{ ${inner} }`;
  }
  return String(v);
}

function diffSection(
  section: object | undefined,
  defaults: object,
): string[] {
  if (!section) return [];
  const out: string[] = [];
  const def = defaults as Record<string, unknown>;
  for (const [k, v] of Object.entries(section)) {
    if (k === "stops") continue; // governed by the `palette` prop
    if (v === undefined) continue;
    if (JSON.stringify(v) === JSON.stringify(def[k])) continue;
    out.push(`${k}: ${fmtVal(v)}`);
  }
  return out;
}

function buildSnippet(
  options: EdgeAuraOptions,
  palette: EdgeAuraPaletteName,
  active: boolean,
): string {
  const props: string[] = [];
  if (palette !== "opal") props.push(`palette="${palette}"`);
  if (!active) props.push(`active={false}`);

  const sections: Array<[string, string[]]> = [
    ["geometry", diffSection(options.geometry, D.geometry)],
    ["palette", diffSection(options.palette, D.palette)],
    ["motion", diffSection(options.motion, D.motion)],
    ["input", diffSection(options.input, D.input)],
  ];
  const optLines = sections
    .filter(([, entries]) => entries.length > 0)
    .map(([name, entries]) => `    ${name}: { ${entries.join(", ")} },`);

  if (optLines.length > 0) {
    props.push("options={{\n" + optLines.join("\n") + "\n  }}");
  }

  if (props.length === 0) return "<EdgeAura />";
  return `<EdgeAura\n  ${props.join("\n  ")}\n/>`;
}

const USAGE_SNIPPET = `import { EdgeAura } from "edge-aura/react";

export function App() {
  return <EdgeAura palette="opal" />;
}`;

// -- Root component ---------------------------------------------------------

function Demo() {
  const [lang, setLang] = useState<Lang>(detectLang);
  const [theme, setTheme] = useState<Theme>(detectTheme);
  const [palette, setPalette] = useState<EdgeAuraPaletteName>("opal");
  const [preset, setPreset] = useState<PresetChoice>("default");
  const [sliders, setSliders] = useState<Sliders>(() => slidersFromPreset("default"));
  const [active, setActive] = useState(true);
  const [typing, setTyping] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [entranceKey, setEntranceKey] = useState(0);
  const [kindleOrigin, setKindleOrigin] =
    useState<{ x: number; y: number } | null>(null);

  const lastPoint = useRef({ x: 0, y: 0 });
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const t = STRINGS[lang];

  // Persist + reflect language on <html lang>.
  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem("edge-aura-demo-lang", lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  // Persist + reflect theme on <html data-theme>.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("edge-aura-demo-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  // Accent tint derived from the current palette's first stop. Pressed pills
  // put text on the raw accent, so pick the text color by accent luminance —
  // pastel-first palettes (sakura, candy) would leave white-on-pink otherwise.
  useEffect(() => {
    const [, [r, g, b]] = EDGE_AURA_PALETTES[palette][0];
    const root = document.documentElement.style;
    root.setProperty("--accent", `${r}, ${g}, ${b}`);
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    root.setProperty("--accent-text", luma > 0.6 ? "17, 17, 20" : "255, 255, 255");
  }, [palette]);

  const markTyping = () => {
    setTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 1200);
  };

  const selectPreset = (choice: PresetChoice) => {
    setPreset(choice);
    setSliders(slidersFromPreset(choice)); // reset sliders to the preset
  };

  const setSlider = <K extends keyof Sliders>(key: K, value: number) =>
    setSliders((s) => ({ ...s, [key]: value }));

  // ONE options object (memoized). Preset extras (e.g. vivid's normalize:false,
  // input tuning, calm's decay) form the base; the slider values override the
  // fields they own; the theme drives palette.background. All REACTIVE — the
  // adapter diffs sections, so no remount is needed for any of this.
  const options: EdgeAuraOptions = useMemo(() => {
    const base: EdgeAuraOptions =
      preset === "default" ? {} : EDGE_AURA_PRESETS[preset];
    // `undefined` explicitly turns the highlight OFF live (updateOptions merges
    // the key, then deriveMotion clears HIGHLIGHT_ON).
    const highlight =
      sliders.highlightArcDeg > 0 ? { arcDeg: sliders.highlightArcDeg } : undefined;
    // Every section is FULLY specified (engine defaults spread first, then the
    // preset base, then the slider-owned fields). updateOptions key-merges and
    // cannot express "reset to default", so any key omitted here would keep its
    // last-applied value on the live engine — leaving stale preset residue when
    // switching presets. Spreading D guarantees each switch overwrites it. The
    // snippet generator still diffs against D (diffSection), so it stays minimal.
    return {
      geometry: {
        ...D.geometry,
        ...base.geometry,
        band: sliders.band,
        cornerRadius: sliders.cornerRadius,
        inset: sliders.inset,
      },
      palette: {
        ...D.palette,
        ...base.palette,
        ringAlpha: sliders.ringAlpha,
        pastel: sliders.pastel,
        background: theme,
      },
      motion: {
        ...D.motion,
        ...base.motion,
        rotateIdleS: sliders.rotateIdleS,
        hueDriftDeg: sliders.hueDriftDeg,
        highlight,
      },
      input: { ...D.input, ...base.input },
    };
  }, [preset, sliders, theme]);

  const snippet = useMemo(
    () => buildSnippet(options, palette, active),
    [options, palette, active],
  );

  // Formatters for the numeric chips.
  const px = (v: number) => `${v}px`;
  const dec = (v: number) => v.toFixed(2);
  const deg = (v: number) => (v === 0 ? t.off : `${v}°`);
  // Japanese attaches the unit directly to the digit (e.g. "8秒/回転"); English
  // keeps the conventional space ("8 s/turn").
  const idle = (v: number) =>
    lang === "ja" ? `${v}${t.idleUnit}` : `${v} ${t.idleUnit}`;

  const paletteOpts: SegmentedOption<EdgeAuraPaletteName>[] = PALETTE_NAMES.map(
    (n) => ({ value: n, label: n }),
  );
  const presetOpts: SegmentedOption<PresetChoice>[] = PRESET_CHOICES.map((n) => ({
    value: n,
    label: n,
  }));

  return (
    <>
      <a className="skip-link" href="#playground">
        {t.skipToContent}
      </a>

      {/* Full-viewport, click-through overlay: the page's own glowing edge. */}
      <EdgeAura
        key={entranceKey}
        state={typing ? "typing" : "idle"}
        savedAt={savedAt}
        palette={palette}
        active={active}
        options={options}
        kindleOrigin={kindleOrigin}
        style={{ zIndex: 0 }}
      />

      <div
        className="page"
        onPointerDown={(e) => {
          lastPoint.current = { x: e.clientX, y: e.clientY };
          window.dispatchEvent(
            new CustomEvent("aura:tap", {
              detail: { x: e.clientX, y: e.clientY },
            }),
          );
        }}
      >
        <header className="site-header">
          <a className="wordmark" href="#top">
            edge<span className="wordmark-dash">-</span>aura
          </a>
          <div className="header-controls">
            <SegmentedControl<Lang>
              size="sm"
              ariaLabel={t.langLabel}
              value={lang}
              onChange={setLang}
              options={[
                { value: "en", label: "EN" },
                { value: "ja", label: "日本語" },
              ]}
            />
            <button
              type="button"
              className="icon-btn theme-btn"
              aria-pressed={theme === "dark"}
              aria-label={theme === "dark" ? t.toLight : t.toDark}
              onClick={() => setTheme((th) => (th === "dark" ? "light" : "dark"))}
            >
              <span className="theme-icon sun">
                <SunIcon />
              </span>
              <span className="theme-icon moon">
                <MoonIcon />
              </span>
            </button>
            <a
              className="icon-btn"
              href={REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={t.github}
            >
              <GitHubIcon />
            </a>
          </div>
        </header>

        <main id="top">
          <section className="hero">
            <h1 className="hero-title">edge-aura</h1>
            <p className="hero-sub">{t.heroSubtitle}</p>
            <div className="install-pill">
              <code>{INSTALL_CMD}</code>
              <CopyButton
                text={INSTALL_CMD}
                copyLabel={t.copy}
                copiedLabel={t.copied}
                className="ghost"
              />
            </div>
          </section>

          <section id="playground" className="panel" aria-label={t.playground}>
            <p className="eyebrow">{t.playground}</p>

            <ControlRow label={t.palette}>
              <SegmentedControl<EdgeAuraPaletteName>
                ariaLabel={t.palette}
                value={palette}
                onChange={setPalette}
                options={paletteOpts}
              />
            </ControlRow>

            <ControlRow label={t.preset}>
              <SegmentedControl<PresetChoice>
                ariaLabel={t.preset}
                value={preset}
                onChange={selectPreset}
                options={presetOpts}
              />
            </ControlRow>

            <div className="divider" />

            <div className="tune-grid" role="group" aria-label={t.tune}>
              <SliderRow label={t.thickness} value={sliders.band} min={30} max={120}
                step={2} onChange={(v) => setSlider("band", v)} format={px} />
              <SliderRow label={t.cornerRadius} value={sliders.cornerRadius} min={0}
                max={40} step={1} onChange={(v) => setSlider("cornerRadius", v)} format={px} />
              <SliderRow label={t.inset} value={sliders.inset} min={0} max={12}
                step={1} onChange={(v) => setSlider("inset", v)} format={px} />
              <SliderRow label={t.opacity} value={sliders.ringAlpha} min={0.3} max={1}
                step={0.01} onChange={(v) => setSlider("ringAlpha", v)} format={dec} />
              <SliderRow label={t.pastel} value={sliders.pastel} min={0} max={0.8}
                step={0.01} onChange={(v) => setSlider("pastel", v)} format={dec} />
              <SliderRow label={t.idleSpeed} value={sliders.rotateIdleS} min={2} max={20}
                step={0.5} onChange={(v) => setSlider("rotateIdleS", v)} format={idle} />
              <SliderRow label={t.hueDrift} value={sliders.hueDriftDeg} min={0} max={45}
                step={1} onChange={(v) => setSlider("hueDriftDeg", v)} format={deg} />
              <SliderRow label={t.highlight} value={sliders.highlightArcDeg} min={0}
                max={140} step={5} onChange={(v) => setSlider("highlightArcDeg", v)} format={deg} />
            </div>

            <div className="divider" />

            <div className="action-row">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setKindleOrigin(
                    lastPoint.current.x || lastPoint.current.y
                      ? { ...lastPoint.current }
                      : { x: innerWidth / 2, y: innerHeight / 2 },
                  );
                  setEntranceKey((k) => k + 1);
                  // The entrance can't play on a stopped loop — resume if paused.
                  setActive(true);
                }}
              >
                {t.replay}
              </button>
              <button type="button" className="btn" onClick={() => setSavedAt(Date.now())}>
                {t.pulse}
              </button>
              <button
                type="button"
                className="btn"
                aria-pressed={!active}
                onClick={() => setActive((a) => !a)}
              >
                {active ? t.pause : t.play}
              </button>
            </div>

            <textarea
              className="type-area"
              placeholder={t.typePlaceholder}
              onKeyDown={(e) => {
                const pos = keyCodeToPosition(e.code);
                if (pos) {
                  window.dispatchEvent(new CustomEvent("aura:key", { detail: pos }));
                }
                markTyping();
              }}
            />
          </section>

          <section className="block">
            <div className="block-head">
              <h2>{t.code}</h2>
              <CopyButton text={snippet} copyLabel={t.copy} copiedLabel={t.copied} />
            </div>
            <p className="block-caption">{t.codeCaption}</p>
            <pre className="code">
              <code>{snippet}</code>
            </pre>
          </section>

          <section className="block">
            <div className="block-head">
              <h2>{t.install}</h2>
              <CopyButton text={INSTALL_CMD} copyLabel={t.copy} copiedLabel={t.copied} />
            </div>
            <pre className="code">
              <code>{INSTALL_CMD}</code>
            </pre>
          </section>

          <section className="block">
            <div className="block-head">
              <h2>{t.usage}</h2>
              <CopyButton text={USAGE_SNIPPET} copyLabel={t.copy} copiedLabel={t.copied} />
            </div>
            <pre className="code">
              <code>{USAGE_SNIPPET}</code>
            </pre>
            <p className="block-caption">
              {t.usageReadme}{" "}
              <a href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer noopener">
                {t.readmeLink}
              </a>
            </p>
          </section>
        </main>

        <footer className="site-footer">
          <a href={AUTHOR_URL} target="_blank" rel="noreferrer noopener">
            {t.madeBy}
          </a>
          <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
            <GitHubIcon />
            <span>{t.repo}</span>
          </a>
        </footer>
      </div>
    </>
  );
}

// Cache the root on the container so Vite HMR re-executing this module reuses
// it (a fresh createRoot on the same node warns and leaks).
const container = document.getElementById("root")! as HTMLElement & {
  _root?: ReturnType<typeof createRoot>;
};
const root = (container._root ??= createRoot(container));
root.render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);

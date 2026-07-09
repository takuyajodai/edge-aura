/**
 * Demo i18n — every visible string in English and Japanese.
 *
 * Code samples and identifiers (palette names, preset names, JSX snippets)
 * stay English by design; only prose/labels/aria text is translated.
 */

export type Lang = "en" | "ja";

export interface Dict {
  // Global chrome
  skipToContent: string;
  langLabel: string; // aria-label for the language segmented control
  toDark: string; // theme toggle aria when it will switch TO dark
  toLight: string; // theme toggle aria when it will switch TO light
  github: string; // aria-label for the GitHub link

  // Hero
  heroSubtitle: string;
  copy: string;
  copied: string;

  // Playground
  playground: string; // muted section eyebrow
  palette: string;
  preset: string;
  tune: string;
  thickness: string;
  cornerRadius: string;
  inset: string;
  opacity: string;
  pastel: string;
  idleSpeed: string;
  hueDrift: string;
  highlight: string;
  off: string;
  idleUnit: string; // e.g. "s/turn"
  actions: string; // muted label for the action row
  replay: string;
  pulse: string;
  play: string;
  pause: string;
  typePlaceholder: string;

  // Code / install / usage
  code: string;
  codeCaption: string;
  install: string;
  usage: string;
  usageReadme: string;
  readmeLink: string;

  // Footer
  madeBy: string;
  repo: string;
}

const en: Dict = {
  skipToContent: "Skip to content",
  langLabel: "Language",
  toDark: "Switch to dark theme",
  toLight: "Switch to light theme",
  github: "View edge-aura on GitHub",

  heroSubtitle: "An organic glow that hugs the edges of your screen.",
  copy: "Copy",
  copied: "Copied",

  playground: "Playground",
  palette: "Palette",
  preset: "Preset",
  tune: "Tune",
  thickness: "Thickness",
  cornerRadius: "Corner radius",
  inset: "Inset",
  opacity: "Opacity",
  pastel: "Pastel",
  idleSpeed: "Idle speed",
  hueDrift: "Hue drift",
  highlight: "Highlight",
  off: "off",
  idleUnit: "s/turn",
  actions: "Actions",
  replay: "Replay entrance",
  pulse: "Pulse",
  play: "Play",
  pause: "Pause",
  typePlaceholder: "Type here — each key bumps the bottom edge…",

  code: "Code",
  codeCaption: "Live — reflects the controls above.",
  install: "Installation",
  usage: "Usage",
  usageReadme: "See the README for the full API.",
  readmeLink: "README",

  madeBy: "Made by Takuya Jodai",
  repo: "GitHub repository",
};

const ja: Dict = {
  skipToContent: "本文へスキップ",
  langLabel: "言語",
  toDark: "ダークテーマに切り替える",
  toLight: "ライトテーマに切り替える",
  github: "GitHub で edge-aura を見る",

  heroSubtitle: "画面の端にやわらかく寄り添う、有機的な光。",
  copy: "コピー",
  copied: "コピーしました",

  playground: "プレイグラウンド",
  palette: "パレット",
  preset: "プリセット",
  tune: "微調整",
  thickness: "太さ",
  cornerRadius: "角の丸み",
  inset: "内側の余白",
  opacity: "不透明度",
  pastel: "パステル",
  idleSpeed: "回転の速さ",
  hueDrift: "色相のゆらぎ",
  highlight: "ハイライト",
  off: "オフ",
  idleUnit: "秒/回転",
  actions: "操作",
  replay: "登場アニメを再生",
  pulse: "パルス",
  play: "再生",
  pause: "一時停止",
  typePlaceholder: "ここに入力 — キーを打つたびに下のふちが跳ねます…",

  code: "コード",
  codeCaption: "上の操作をそのまま反映します。",
  install: "インストール",
  usage: "使い方",
  usageReadme: "完全な API は README をご覧ください。",
  readmeLink: "README",

  madeBy: "制作: Takuya Jodai",
  repo: "GitHub リポジトリ",
};

export const STRINGS: Record<Lang, Dict> = { en, ja };

/** Initial language: honor a saved choice, else fall back to the browser. */
export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem("edge-aura-demo-lang");
    if (saved === "en" || saved === "ja") return saved;
  } catch {
    /* localStorage may be unavailable (private mode) — fall through */
  }
  return typeof navigator !== "undefined" &&
    navigator.language.toLowerCase().startsWith("ja")
    ? "ja"
    : "en";
}

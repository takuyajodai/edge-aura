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
  paletteCaption: string; // one-line hint under the Palette row label
  preset: string;
  presetCaption: string; // one-line hint under the Preset row label
  tune: string;
  thickness: string;
  thicknessCaption: string; // one-line hint under each slider label —
  cornerRadius: string; //   what the user will SEE when moving it
  cornerRadiusCaption: string;
  inset: string;
  insetCaption: string;
  opacity: string;
  opacityCaption: string;
  pastel: string;
  pastelCaption: string;
  idleSpeed: string;
  idleSpeedCaption: string;
  hueDrift: string;
  hueDriftCaption: string;
  highlight: string;
  highlightCaption: string;
  off: string;
  idleUnit: string; // e.g. "s/turn"
  corners: string; // label for the corner-fill toggle row
  cornersCaption: string;
  cornersRounded: string; // toggle button text when cornerFill is off
  cornersFilled: string; // toggle button text when cornerFill is on
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

  heroSubtitle: "An organic glow that hugs the edge of your screen.",
  copy: "Copy",
  copied: "Copied",

  playground: "Playground",
  palette: "Palette",
  paletteCaption: "Swaps the glow's overall color scheme and mood.",
  preset: "Preset",
  presetCaption: "Jumps to a ready-made combination of the settings below.",
  tune: "Tune",
  thickness: "Thickness",
  thicknessCaption: "How deep the glow reads before fading toward the center.",
  cornerRadius: "Corner radius",
  cornerRadiusCaption: "Rounds the glow's corners to match your screen's curve.",
  inset: "Inset",
  insetCaption: "Pulls the glow's edge in from the screen's outer rim.",
  opacity: "Opacity",
  opacityCaption: "Controls how bright and solid the glow's core appears.",
  pastel: "Pastel",
  pastelCaption: "Softens saturated hues into a lighter, milkier tone.",
  idleSpeed: "Idle speed",
  idleSpeedCaption: "How fast the glow drifts around the screen when idle.",
  hueDrift: "Hue drift",
  hueDriftCaption: "Sway range on the hue wheel. 0° = fixed, 45° = broad drift.",
  highlight: "Highlight",
  highlightCaption: "How much of the ring the bright sweep covers. 0 = off.",
  off: "off",
  idleUnit: "s/turn",
  corners: "Corners",
  cornersCaption: "Round off, or fill the square corners with light.",
  cornersRounded: "Rounded",
  cornersFilled: "Filled",
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

  madeBy: "Made by",
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
  paletteCaption: "光の配色パターンを切り替えます",
  preset: "プリセット",
  presetCaption: "下の設定をまとめて切り替えるプリセットです",
  tune: "微調整",
  thickness: "太さ",
  thicknessCaption: "光の帯の奥行き。広げるほど内側へ溶け込みます",
  cornerRadius: "角の丸み",
  cornerRadiusCaption: "角の曲がり具合。丸くするほど画面になじみます",
  inset: "内側の余白",
  insetCaption: "画面端からの距離。離すほど光が内側に浮きます",
  opacity: "不透明度",
  opacityCaption: "光の濃さ。上げるほどくっきり明るくなります",
  pastel: "パステル",
  pastelCaption: "色の淡さ。上げるほど白っぽく優しい発色に",
  idleSpeed: "回転の速さ",
  idleSpeedCaption: "待機中に光が一周する速さです",
  hueDrift: "色相のゆらぎ",
  hueDriftCaption: "色相環上の揺れ幅。0°で固定、45°で大きくうねる",
  highlight: "ハイライト",
  highlightCaption: "リングの何割を明るく照らすか。0でオフ",
  off: "オフ",
  idleUnit: "秒/回転",
  corners: "角の処理",
  cornersCaption: "丸めて消すか、四隅まで光で満たすか",
  cornersRounded: "丸める",
  cornersFilled: "埋める",
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

  madeBy: "Made by",
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

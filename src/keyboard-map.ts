/**
 * Maps a physical KeyboardEvent.code to a normalised (x, y) position on a
 * virtual keyboard grid — x: 0 (left) → 1 (right), y: 0 (top) → 1 (bottom).
 *
 * Row y values follow standard keyboard layout conventions:
 *   Digit row  → y = 0
 *   QWERTY row → y = 0.25
 *   ASDF row   → y = 0.5
 *   ZXCV row   → y = 0.75
 *   Space row  → y = 1
 *
 * x = (index + 0.5) / rowLength, keeping every key centred in its cell.
 * Modifier / navigation keys with no clear lateral position return null.
 */

const ROWS: [string[], number][] = [
  // Digit row (y = 0)
  [
    [
      "Backquote", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5",
      "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal",
      "Backspace",
    ],
    0,
  ],
  // QWERTY row (y = 0.25)
  [
    [
      "Tab", "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT",
      "KeyY", "KeyU", "KeyI", "KeyO", "KeyP",
      "BracketLeft", "BracketRight", "Backslash",
    ],
    0.25,
  ],
  // ASDF row (y = 0.5)
  [
    [
      "CapsLock", "KeyA", "KeyS", "KeyD", "KeyF", "KeyG",
      "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote", "Enter",
    ],
    0.5,
  ],
  // ZXCV row (y = 0.75)
  [
    [
      "ShiftLeft", "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB",
      "KeyN", "KeyM", "Comma", "Period", "Slash", "ShiftRight",
    ],
    0.75,
  ],
  // Space row (y = 1)
  [["Space"], 1],
];

// Build a lookup map once at module load — O(1) per call.
const CODE_MAP = new Map<string, { x: number; y: number }>();

for (const [keys, y] of ROWS) {
  const count = keys.length;
  keys.forEach((code, i) => {
    // Right-side cluster keys (Backspace, Enter, ShiftRight) land near x=0.95
    // naturally because they occupy the last index of their row.
    CODE_MAP.set(code, { x: (i + 0.5) / count, y });
  });
}

// Space is the sole key in its row → x=0.5 by formula, which is correct.

/**
 * Returns the normalised (x, y) keyboard position for a given
 * KeyboardEvent.code, or null for unknown / modifier-only codes.
 */
export function keyCodeToPosition(
  code: string
): { x: number; y: number } | null {
  return CODE_MAP.get(code) ?? null;
}

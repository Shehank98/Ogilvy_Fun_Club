/**
 * Team colours, assigned by team index. Chosen to stay distinguishable on a
 * dark background and to still read as distinct for the common colour-vision
 * deficiencies. The palette repeats if an admin configures more teams than
 * there are entries.
 */
export const TEAM_COLORS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#a855f7", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#e11d48", // rose
] as const;

export function colorForTeamIndex(index: number): string {
  const n = TEAM_COLORS.length;
  const i = ((Math.trunc(index) % n) + n) % n;
  return TEAM_COLORS[i];
}

/** Hex (#rgb or #rrggbb) -> {r,g,b}, or null if unparseable. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const value = hex.trim().replace(/^#/, "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/**
 * Normalise an admin-entered colour to a canonical `#rrggbb` string, or null if
 * it isn't a valid hex colour. Accepts `#rgb`/`#rrggbb`, with or without the
 * leading `#`, in any case; used to validate the team colour picker before it
 * is stored.
 */
export function normalizeHex(hex: string): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const toHex = (c: number) => c.toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

export function rgbaFromHex(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(255, 255, 255, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/**
 * Pick black or white text for a given background, using the WCAG relative
 * luminance formula so team colours stay readable whatever the admin picks.
 */
export function readableTextColor(hex: string): "#000000" | "#ffffff" {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#ffffff";
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance =
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  return luminance > 0.45 ? "#000000" : "#ffffff";
}

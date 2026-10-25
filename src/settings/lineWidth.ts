export type LineWidthMode = "custom" | "full";

export interface LineWidthSettings {
  lineWidthEnabled: boolean;
  lineWidthMode: LineWidthMode;
  lineWidthPx: number;
}

export const LINE_WIDTH_LIMITS = { min: 400, max: 3000, step: 10 } as const;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function px(value: number): string {
  return `${clamp(Math.round(value), LINE_WIDTH_LIMITS.min, LINE_WIDTH_LIMITS.max)}px`;
}

/**
 * Value for Obsidian's `--file-line-width`, or null to leave Obsidian alone.
 *
 * Obsidian applies the variable as `max-width` to several nested elements, so
 * percentages would compound (90% of 90% of 90% ...). Only px and 100% are safe.
 */
export function lineWidthValue(settings: LineWidthSettings): string | null {
  if (!settings.lineWidthEnabled) return null;
  if (settings.lineWidthMode === "full") return "100%";
  return px(settings.lineWidthPx);
}

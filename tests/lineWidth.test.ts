import { describe, expect, it } from "vitest";
import { lineWidthValue } from "../src/settings/lineWidth";

const base = { lineWidthEnabled: true, lineWidthMode: "custom", lineWidthPx: 900 } as const;

describe("lineWidthValue (global)", () => {
  it("is null when the override is off", () => {
    expect(lineWidthValue({ ...base, lineWidthEnabled: false })).toBeNull();
  });
  it("returns pixels or 100%", () => {
    expect(lineWidthValue(base)).toBe("900px");
    expect(lineWidthValue({ ...base, lineWidthMode: "full" })).toBe("100%");
  });
  it("clamps absurd values", () => {
    expect(lineWidthValue({ ...base, lineWidthPx: 99999 })).toBe("3000px");
    expect(lineWidthValue({ ...base, lineWidthPx: 3 })).toBe("400px");
  });
});

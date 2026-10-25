import { describe, expect, it } from "vitest";
import { parseTables } from "../src/tables/tableParser";
import {
  countTables,
  fitWidths,
  matchStored,
  removePath,
  removeTable,
  renamePath,
  saveTable,
  syncKeys,
  type WidthMap,
} from "../src/tables/widthStore";

const note = (...headers: string[]) =>
  parseTables(headers.map((h) => `| ${h} |\n|---|\n| x |\n`).join("\n"));

describe("saveTable / matchStored", () => {
  it("round-trips widths for a table", () => {
    const map: WidthMap = {};
    const tables = note("A", "B");
    saveTable(map, "n.md", tables, 1, [100, 200]);
    const match = matchStored(map["n.md"] ?? [], tables);
    expect(match[0]).toBeUndefined();
    expect(match[1]?.widths).toEqual([100, 200]);
  });

  it("follows a table when another is inserted above it", () => {
    const map: WidthMap = {};
    saveTable(map, "n.md", note("A", "B"), 1, [321]);
    const after = note("New", "A", "B");
    const match = matchStored(map["n.md"] ?? [], after);
    expect(match[2]?.widths).toEqual([321]);
    expect(match[0]).toBeUndefined();
  });

  it("tells apart tables with identical headers", () => {
    const map: WidthMap = {};
    const tables = note("Same", "Same");
    saveTable(map, "n.md", tables, 0, [111]);
    saveTable(map, "n.md", tables, 1, [222]);
    const match = matchStored(map["n.md"] ?? [], tables);
    expect([match[0]?.widths, match[1]?.widths]).toEqual([[111], [222]]);
  });

  it("keeps widths when the header text is edited, then heals the key", () => {
    const map: WidthMap = {};
    saveTable(map, "n.md", note("Old", "Other"), 0, [150]);
    const edited = note("Renamed", "Other");
    expect(matchStored(map["n.md"] ?? [], edited)[0]?.widths).toEqual([150]);

    // Saving the *other* table refreshes the edited table's key.
    saveTable(map, "n.md", edited, 1, [90]);
    const entry = map["n.md"]?.find((e) => e.index === 0);
    expect(entry?.signature).toBe("Renamed");
    expect(entry?.widths).toEqual([150]);
  });

  it("does not hand one entry to two tables", () => {
    const map: WidthMap = {};
    saveTable(map, "n.md", note("A"), 0, [100]);
    const match = matchStored(map["n.md"] ?? [], note("A", "A"));
    expect(match.filter(Boolean)).toHaveLength(1);
  });

  it("drops entries for tables that no longer exist", () => {
    const map: WidthMap = {};
    saveTable(map, "n.md", note("Gone", "Kept"), 0, [100]);
    saveTable(map, "n.md", note("Kept"), 0, [200]);
    expect(map["n.md"]).toHaveLength(1);
    expect(map["n.md"]?.[0]?.signature).toBe("Kept");
  });

  it("ignores an out-of-range table index", () => {
    const map: WidthMap = {};
    saveTable(map, "n.md", note("A"), 5, [1]);
    expect(map).toEqual({});
  });
});

describe("matchStored without the position fallback", () => {
  it("only matches by header and occurrence", () => {
    const map: WidthMap = {};
    saveTable(map, "n.md", note("A", "B"), 0, [100]);
    // A partial view of the note: its first table is "Other", sitting at position 0.
    const partial = note("Other");
    expect(matchStored(map["n.md"] ?? [], partial, true)[0]?.widths).toEqual([100]); // the hazard
    expect(matchStored(map["n.md"] ?? [], partial, false)[0]).toBeUndefined(); // the guard
  });

  it("still finds an exact match", () => {
    const map: WidthMap = {};
    saveTable(map, "n.md", note("A", "B"), 1, [250]);
    expect(matchStored(map["n.md"] ?? [], note("B"), false)[0]?.widths).toEqual([250]);
  });
});

describe("syncKeys", () => {
  it("re-points entries after a table is inserted above, so a later header rename still matches", () => {
    const map: WidthMap = {};
    saveTable(map, "n.md", note("A", "B"), 1, [321]);

    const afterInsert = note("New", "A", "B");
    expect(syncKeys(map, "n.md", afterInsert)).toBe(true);
    expect(map["n.md"]?.[0]).toMatchObject({ signature: "B", index: 2 });

    // "B" is now renamed; position (2) is the only thing left to go on.
    const afterRename = note("New", "A", "Renamed");
    expect(matchStored(map["n.md"] ?? [], afterRename)[2]?.widths).toEqual([321]);
  });

  it("reports no change when keys are already current", () => {
    const map: WidthMap = {};
    const tables = note("A", "B");
    saveTable(map, "n.md", tables, 0, [100]);
    expect(syncKeys(map, "n.md", tables)).toBe(false);
  });

  it("never drops entries", () => {
    const map: WidthMap = {};
    saveTable(map, "n.md", note("A", "B"), 0, [100]);
    saveTable(map, "n.md", note("A", "B"), 1, [200]);
    syncKeys(map, "n.md", note("Only"));
    expect(map["n.md"]).toHaveLength(2);
  });

  it("ignores notes with nothing saved", () => {
    expect(syncKeys({}, "missing.md", note("A"))).toBe(false);
  });
});

describe("removeTable", () => {
  it("removes one table and deletes the file key when empty", () => {
    const map: WidthMap = {};
    const tables = note("A", "B");
    saveTable(map, "n.md", tables, 0, [10]);
    saveTable(map, "n.md", tables, 1, [20]);
    removeTable(map, "n.md", tables, 0);
    expect(map["n.md"]).toHaveLength(1);
    removeTable(map, "n.md", tables, 1);
    expect(map["n.md"]).toBeUndefined();
  });
});

describe("fitWidths", () => {
  it("leaves matching widths alone", () => {
    expect(fitWidths([10, 20], 2)).toEqual([10, 20]);
  });
  it("truncates extra widths", () => {
    expect(fitWidths([10, 20, 30], 2)).toEqual([10, 20]);
  });
  it("pads new columns with the average", () => {
    expect(fitWidths([100, 200], 4)).toEqual([100, 200, 150, 150]);
  });
});

describe("path maintenance", () => {
  const seed = (): WidthMap => {
    const map: WidthMap = {};
    const t = note("A");
    saveTable(map, "a.md", t, 0, [1]);
    saveTable(map, "dir/b.md", t, 0, [2]);
    saveTable(map, "dir/sub/c.md", t, 0, [3]);
    saveTable(map, "dirty/d.md", t, 0, [4]);
    return map;
  };

  it("renames a file", () => {
    const map = seed();
    renamePath(map, "a.md", "z.md");
    expect(Object.keys(map).sort()).toEqual(["dir/b.md", "dir/sub/c.md", "dirty/d.md", "z.md"]);
  });

  it("renames a folder without touching lookalike prefixes", () => {
    const map = seed();
    renamePath(map, "dir", "renamed");
    expect(Object.keys(map).sort()).toEqual(["a.md", "dirty/d.md", "renamed/b.md", "renamed/sub/c.md"]);
  });

  it("removes a folder without touching lookalike prefixes", () => {
    const map = seed();
    removePath(map, "dir");
    expect(Object.keys(map).sort()).toEqual(["a.md", "dirty/d.md"]);
    expect(countTables(map)).toBe(2);
  });
});

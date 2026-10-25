import { describe, expect, it } from "vitest";
import { parseTables, splitRow, tableIndexAtLine, tablesInRange } from "../src/tables/tableParser";

describe("splitRow", () => {
  it("ignores outer pipes and trims cells", () => {
    expect(splitRow("| a | b |")).toEqual(["a", "b"]);
    expect(splitRow("a | b")).toEqual(["a", "b"]);
  });

  it("keeps escaped pipes inside a cell", () => {
    expect(splitRow("| a \\| b | c |")).toEqual(["a \\| b", "c"]);
  });

  it("keeps empty cells", () => {
    expect(splitRow("| a | | c |")).toEqual(["a", "", "c"]);
  });
});

describe("parseTables", () => {
  it("finds a simple table with its line range", () => {
    const text = ["intro", "", "| A | B |", "|---|---|", "| 1 | 2 |", "| 3 | 4 |", "", "outro"].join("\n");
    const [table, ...rest] = parseTables(text);
    expect(rest).toHaveLength(0);
    expect(table).toMatchObject({ startLine: 2, endLine: 5, columns: 2, signature: "A|B", occurrence: 0 });
  });

  it("accepts alignment colons and tables without outer pipes", () => {
    const text = "A | B\n:--- | ---:\n1 | 2";
    expect(parseTables(text)).toHaveLength(1);
  });

  it("does not treat a horizontal rule or a lone pipe row as a table", () => {
    expect(parseTables("| a |\n---\ntext")).toHaveLength(0);
    expect(parseTables("A | B\nplain text")).toHaveLength(0);
  });

  it("requires header and delimiter to have the same column count", () => {
    expect(parseTables("| A | B |\n|---|\n| 1 | 2 |")).toHaveLength(0);
  });

  it("numbers repeated headers by occurrence", () => {
    const row = "| Name | Qty |\n|---|---|\n| x | 1 |\n\n";
    const tables = parseTables(row + row + "| Other |\n|---|\n| y |");
    expect(tables.map((t) => [t.signature, t.occurrence])).toEqual([
      ["Name|Qty", 0],
      ["Name|Qty", 1],
      ["Other", 0],
    ]);
  });

  it("skips tables inside fenced code blocks", () => {
    const text = "```md\n| A | B |\n|---|---|\n```\n\n| Real | One |\n|---|---|";
    const tables = parseTables(text);
    expect(tables).toHaveLength(1);
    expect(tables[0]?.signature).toBe("Real|One");
  });

  it("skips frontmatter", () => {
    const text = "---\ntitle: x | y\n---\n| A | B |\n|---|---|";
    expect(parseTables(text)).toHaveLength(1);
  });

  it("finds tables inside callouts and blockquotes", () => {
    const text = "> [!note]\n> | A | B |\n> |---|---|\n> | 1 | 2 |";
    const [table] = parseTables(text);
    expect(table).toMatchObject({ startLine: 1, endLine: 3, signature: "A|B" });
  });

  it("handles CRLF line endings", () => {
    expect(parseTables("| A |\r\n|---|\r\n| 1 |")).toHaveLength(1);
  });

  it("normalises whitespace in the signature", () => {
    const [a] = parseTables("|  Total   cost |\n|---|\n| 1 |");
    expect(a?.signature).toBe("Total cost");
  });
});

describe("tableIndexAtLine", () => {
  const tables = parseTables("| A |\n|---|\n| 1 |\n\ntext\n\n| B |\n|---|\n| 2 |");

  it("maps any line in a table to its index", () => {
    expect(tableIndexAtLine(tables, 0)).toBe(0);
    expect(tableIndexAtLine(tables, 2)).toBe(0);
    expect(tableIndexAtLine(tables, 6)).toBe(1);
    expect(tableIndexAtLine(tables, 8)).toBe(1);
  });

  it("returns -1 outside tables", () => {
    expect(tableIndexAtLine(tables, 4)).toBe(-1);
  });
});

describe("tablesInRange", () => {
  const text = ["# One", "| A |", "|---|", "| 1 |", "", "# Two", "para", "", "| B |", "|---|", "| 2 |", "", "| C |", "|---|", "| 3 |"].join("\n");
  const tables = parseTables(text);

  it("returns the tables whose header lies in a section's line range", () => {
    expect(tablesInRange(tables, 1, 3)).toEqual([0]);
    expect(tablesInRange(tables, 8, 10)).toEqual([1]);
    expect(tablesInRange(tables, 12, 14)).toEqual([2]);
  });

  it("returns several, in order, for a section spanning more than one table", () => {
    expect(tablesInRange(tables, 0, 14)).toEqual([0, 1, 2]);
  });

  it("returns none for a section without tables", () => {
    expect(tablesInRange(tables, 5, 7)).toEqual([]);
  });
});

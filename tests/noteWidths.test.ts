import { describe, expect, it } from "vitest";
import { applyChanges, planResetAll, planWidthEdit } from "../src/notes/noteWidths";
import { formatWidthComment, parseTables, parseWidthComment } from "../src/tables/tableParser";

const TABLE = "| A | B |\n|---|---|\n| 1 | 2 |";
const key = { signature: "A|B", occurrence: 0 };

const set = (text: string, widths: number[] | null, k = key) => {
  const changes = planWidthEdit(text, k, widths);
  if (!changes) throw new Error("table not found");
  return applyChanges(text, changes);
};

describe("width comments", () => {
  it("formats and parses", () => {
    expect(formatWidthComment([120, 300, 80])).toBe("<!-- width-wizard: 120, 300, 80 -->");
    expect(parseWidthComment("<!-- width-wizard: 120, 300, 80 -->")).toEqual([120, 300, 80]);
    expect(parseWidthComment("<!--width-wizard:120,300-->")).toEqual([120, 300]);
    expect(parseWidthComment("  > <!-- width-wizard: 5 -->")).toEqual([5]);
  });

  it("rejects look-alikes and bad numbers", () => {
    expect(parseWidthComment("<!-- something else: 1, 2 -->")).toBeNull();
    expect(parseWidthComment("<!-- width-wizard: 1, x -->")).toBeNull();
    expect(parseWidthComment("<!-- width-wizard: 0, 5 -->")).toBeNull();
    expect(parseWidthComment("<!-- width-wizard: 1, 2 --> trailing")).toBeNull();
  });
});

describe("parseTables finds the comment", () => {
  it("attaches the first non-blank line after the table", () => {
    const text = `${TABLE}\n\n\n<!-- width-wizard: 100, 200 -->\n\ntext`;
    const [t] = parseTables(text);
    expect(t).toMatchObject({ commentLine: 5, noteWidths: [100, 200] });
  });

  it("does not take a comment that belongs to a later table", () => {
    const text = `${TABLE}\n\n| C |\n|---|\n| 1 |\n\n<!-- width-wizard: 90 -->`;
    const [a, b] = parseTables(text);
    expect(a?.noteWidths).toBeNull();
    expect(b?.noteWidths).toEqual([90]);
  });

  it("ignores the comment if other content sits in between", () => {
    const text = `${TABLE}\n\nsome paragraph\n\n<!-- width-wizard: 100, 200 -->`;
    expect(parseTables(text)[0]?.noteWidths).toBeNull();
  });
});

describe("planWidthEdit", () => {
  it("adds a comment after a table in the middle of a note", () => {
    const out = set(`intro\n\n${TABLE}\n\nafter`, [100, 200]);
    expect(out).toBe(`intro\n\n${TABLE}\n\n<!-- width-wizard: 100, 200 -->\n\nafter`);
  });

  it("adds a comment when the table ends the file (no trailing newline)", () => {
    expect(set(TABLE, [100, 200])).toBe(`${TABLE}\n\n<!-- width-wizard: 100, 200 -->`);
  });

  it("adds a comment when the file ends with a newline", () => {
    expect(set(`${TABLE}\n`, [100, 200])).toBe(`${TABLE}\n\n<!-- width-wizard: 100, 200 -->\n`);
  });

  it("adds a comment when text follows the table directly", () => {
    expect(set(`${TABLE}\nnext line`, [1, 2])).toBe(`${TABLE}\n\n<!-- width-wizard: 1, 2 -->\nnext line`);
  });

  it("replaces an existing comment in place", () => {
    const text = `${TABLE}\n\n<!-- width-wizard: 100, 200 -->\n\nafter`;
    expect(set(text, [150, 250])).toBe(`${TABLE}\n\n<!-- width-wizard: 150, 250 -->\n\nafter`);
  });

  it("changes nothing when the widths are already there", () => {
    const text = `${TABLE}\n\n<!-- width-wizard: 100, 200 -->`;
    expect(planWidthEdit(text, key, [100, 200])).toEqual([]);
    expect(planWidthEdit(text, key, null)).not.toEqual([]);
    expect(planWidthEdit(TABLE, key, null)).toEqual([]);
  });

  it("returns null when the table isn't in the text", () => {
    expect(planWidthEdit("no tables here", key, [1, 2])).toBeNull();
    expect(planWidthEdit(TABLE, { signature: "Other", occurrence: 0 }, [1])).toBeNull();
  });

  it("targets the right table among identical headers", () => {
    const text = `${TABLE}\n\nmiddle\n\n${TABLE}\n\nend`;
    const out = set(text, [7, 8], { signature: "A|B", occurrence: 1 });
    expect(out).toBe(`${TABLE}\n\nmiddle\n\n${TABLE}\n\n<!-- width-wizard: 7, 8 -->\n\nend`);
    expect(parseTables(out).map((t) => t.noteWidths)).toEqual([null, [7, 8]]);
  });

  it("keeps a callout intact", () => {
    const text = "> [!note]\n> | A | B |\n> |---|---|\n> | 1 | 2 |\n\nafter";
    const out = set(text, [100, 200]);
    expect(out).toBe("> [!note]\n> | A | B |\n> |---|---|\n> | 1 | 2 |\n>\n> <!-- width-wizard: 100, 200 -->\n\nafter");
    expect(parseTables(out)[0]?.noteWidths).toEqual([100, 200]);
    expect(set(out, [5, 6])).toContain("> <!-- width-wizard: 5, 6 -->");
  });

  it("respects CRLF line endings", () => {
    const text = `intro\r\n\r\n${TABLE.replace(/\n/g, "\r\n")}\r\n\r\nafter`;
    const out = set(text, [100, 200]);
    expect(out).toBe(`intro\r\n\r\n${TABLE.replace(/\n/g, "\r\n")}\r\n\r\n<!-- width-wizard: 100, 200 -->\r\n\r\nafter`);
    expect(out.replace(/\r\n/g, "")).not.toContain("\n"); // no bare LF introduced
    expect(set(out, null)).toBe(text);
  });
});

describe("removing widths restores the note exactly", () => {
  const layouts: Record<string, string> = {
    "middle of note": `intro\n\n${TABLE}\n\nafter\n`,
    "end of file, no newline": TABLE,
    "end of file, newline": `${TABLE}\n`,
    "text directly after": `${TABLE}\nnext line\n`,
    "two blank lines after": `${TABLE}\n\n\ntext`,
    "callout": "> [!note]\n> | A | B |\n> |---|---|\n> | 1 | 2 |\n\nafter",
    "crlf": `intro\r\n\r\n${TABLE.replace(/\n/g, "\r\n")}\r\n\r\nafter\r\n`,
    "with frontmatter": `---\ntitle: x\n---\n\n${TABLE}\n\nend`,
  };

  for (const [name, text] of Object.entries(layouts)) {
    it(name, () => {
      const withWidths = set(text, [111, 222]);
      expect(withWidths).not.toBe(text);
      expect(parseTables(withWidths)[0]?.noteWidths).toEqual([111, 222]);
      expect(set(withWidths, null)).toBe(text);
    });
  }
});

describe("planResetAll", () => {
  it("removes every comment and nothing else", () => {
    const original = `${TABLE}\n\nmiddle\n\n| C |\n|---|\n| 1 |\n\nend`;
    let text = set(original, [1, 2]);
    text = set(text, [3], { signature: "C", occurrence: 0 });
    expect(parseTables(text).every((t) => t.noteWidths)).toBe(true);
    expect(applyChanges(text, planResetAll(text))).toBe(original);
  });

  it("is a no-op for a note without comments", () => {
    expect(planResetAll(`${TABLE}\n\ntext`)).toEqual([]);
  });
});

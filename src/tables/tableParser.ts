/**
 * Finds markdown tables in a note's source text.
 *
 * Column widths can't live inside a markdown table, so each table is
 * identified by its header row plus how many identical headers came before
 * it. Reading view and Live Preview both resolve to the same identity because
 * both derive it from the note's text.
 */

export interface TableKey {
  /** Normalised header row, e.g. "Name|Qty|Price". */
  signature: string;
  /** How many tables with the same signature appear earlier in the note. */
  occurrence: number;
}

export interface ParsedTable extends TableKey {
  /** 0-based line of the header row. */
  startLine: number;
  /** 0-based line of the last body row (inclusive). */
  endLine: number;
  columns: number;
  /** 0-based line of the width comment that follows the table, if any. */
  commentLine: number | null;
  /** Column widths (px) from that comment, if any. */
  noteWidths: number[] | null;
}

const DELIMITER_CELL = /^:?-+:?$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** Drops leading indentation and blockquote/callout markers. */
function stripQuote(line: string): string {
  return line.replace(/^\s*(?:>\s?)*/, "");
}

/** The indentation and blockquote/callout markers at the start of a line. */
export function linePrefix(line: string): string {
  return /^\s*(?:>\s?)*/.exec(line)?.[0] ?? "";
}

/**
 * Widths can be kept in the note itself as a comment on the line below a table:
 *   <!-- width-wizard: 120, 300, 80 -->
 */
const WIDTH_COMMENT = /^<!--\s*width-wizard:\s*([\d.]+(?:\s*,\s*[\d.]+)*)\s*-->$/;

export function parseWidthComment(line: string): number[] | null {
  const match = WIDTH_COMMENT.exec(stripQuote(line).trim());
  if (!match) return null;
  const widths = (match[1] as string).split(",").map((w) => Number(w.trim()));
  return widths.every((w) => Number.isFinite(w) && w > 0) ? widths : null;
}

export function formatWidthComment(widths: number[]): string {
  return `<!-- width-wizard: ${widths.join(", ")} -->`;
}

/** Splits a table row on unescaped pipes, ignoring the outer pipes. */
export function splitRow(line: string): string[] {
  let row = stripQuote(line).trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);

  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === "\\" && row[i + 1] === "|") {
      current += "\\|";
      i++;
    } else if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isDelimiterRow(line: string): boolean {
  if (!stripQuote(line).includes("|")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(cell));
}

function looksLikeRow(line: string): boolean {
  const row = stripQuote(line);
  return row.trim() !== "" && row.includes("|");
}

export function parseTables(text: string): ParsedTable[] {
  const lines = text.split(/\r?\n/);
  const tables: ParsedTable[] = [];
  const seen = new Map<string, number>();

  let i = 0;

  // YAML frontmatter
  if (lines[0]?.trim() === "---") {
    for (let j = 1; j < lines.length; j++) {
      const l = lines[j]?.trim();
      if (l === "---" || l === "...") {
        i = j + 1;
        break;
      }
    }
  }

  let fence: string | null = null;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    const fenceMatch = FENCE.exec(stripQuote(line));
    if (fenceMatch) {
      const marker = fenceMatch[1] as string;
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      i++;
      continue;
    }
    if (fence !== null) {
      i++;
      continue;
    }

    const next = lines[i + 1];
    if (next !== undefined && looksLikeRow(line) && isDelimiterRow(next)) {
      const header = splitRow(line);
      const delimiter = splitRow(next);
      if (header.length === delimiter.length) {
        let end = i + 1;
        while (end + 1 < lines.length && looksLikeRow(lines[end + 1] ?? "")) end++;

        // The comment is the first non-blank line after the table.
        let next = end + 1;
        while (next < lines.length && stripQuote(lines[next] ?? "").trim() === "") next++;
        const noteWidths = next < lines.length ? parseWidthComment(lines[next] ?? "") : null;

        const signature = header.map((c) => c.replace(/\s+/g, " ")).join("|");
        const occurrence = seen.get(signature) ?? 0;
        seen.set(signature, occurrence + 1);

        tables.push({
          signature,
          occurrence,
          startLine: i,
          endLine: end,
          columns: header.length,
          commentLine: noteWidths ? next : null,
          noteWidths,
        });
        i = end + 1;
        continue;
      }
    }
    i++;
  }

  return tables;
}

/** Index of the table that contains `line`, or -1. */
export function tableIndexAtLine(tables: ParsedTable[], line: number): number {
  return tables.findIndex((t) => line >= t.startLine && line <= t.endLine);
}

/**
 * Indexes of the tables whose header row lies in a rendered section
 * (`lineStart`..`lineEnd`, 0-based, inclusive). Reading view renders a note
 * block by block, so this is how a section's tables are found in the full list.
 */
export function tablesInRange(tables: ParsedTable[], lineStart: number, lineEnd: number): number[] {
  const indexes: number[] = [];
  tables.forEach((table, index) => {
    if (table.startLine >= lineStart && table.startLine <= lineEnd) indexes.push(index);
  });
  return indexes;
}

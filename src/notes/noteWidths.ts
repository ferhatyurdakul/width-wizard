import { formatWidthComment, linePrefix, parseTables, type TableKey } from "../tables/tableParser";

/**
 * Plans edits that keep a table's column widths in the note itself, as a
 * comment on its own line below the table:
 *
 *   | a | b |
 *   |---|---|
 *   | 1 | 2 |
 *
 *   <!-- width-wizard: 120, 300 -->
 *
 * The blank line keeps the comment out of the table in every Markdown parser.
 * Pure text in, text edits out; applying them is the caller's job.
 */

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

/** Offset just past the last character of line `i`, before its line break. */
function contentEnd(text: string, starts: number[], i: number): number {
  const next = starts[i + 1];
  if (next === undefined) return text.length;
  return text[next - 2] === "\r" ? next - 2 : next - 1;
}

/**
 * Set (`widths`) or remove (`null`) the width comment of the table identified
 * by `key`. Returns `null` if the table isn't in `text`, and `[]` when there is
 * nothing to change.
 */
export function planWidthEdit(text: string, key: TableKey, widths: number[] | null): TextChange[] | null {
  const table = parseTables(text).find(
    (t) => t.signature === key.signature && t.occurrence === key.occurrence,
  );
  if (!table) return null;

  const lines = text.split(/\r?\n/);
  const starts = lineStarts(text);
  const tableEnd = contentEnd(text, starts, table.endLine);

  if (widths === null) {
    if (table.commentLine === null) return [];
    // Drop the comment and the blank line(s) that separated it from the table.
    return [{ from: tableEnd, to: contentEnd(text, starts, table.commentLine), insert: "" }];
  }

  const comment = formatWidthComment(widths);

  if (table.commentLine !== null) {
    const line = lines[table.commentLine] ?? "";
    const replacement = linePrefix(line) + comment;
    if (line === replacement) return [];
    return [
      {
        from: starts[table.commentLine] ?? 0,
        to: contentEnd(text, starts, table.commentLine),
        insert: replacement,
      },
    ];
  }

  // Inside a callout the separator line must keep its ">" or the callout ends.
  const prefix = linePrefix(lines[table.endLine] ?? "");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return [{ from: tableEnd, to: tableEnd, insert: `${eol}${prefix.trimEnd()}${eol}${prefix}${comment}` }];
}

/** Remove every width comment in the note. */
export function planResetAll(text: string): TextChange[] {
  const starts = lineStarts(text);
  const changes: TextChange[] = [];
  for (const table of parseTables(text)) {
    if (table.commentLine === null) continue;
    changes.push({
      from: contentEnd(text, starts, table.endLine),
      to: contentEnd(text, starts, table.commentLine),
      insert: "",
    });
  }
  return changes;
}

/** Apply non-overlapping changes expressed against the original `text`. */
export function applyChanges(text: string, changes: TextChange[]): string {
  return [...changes]
    .sort((a, b) => b.from - a.from)
    .reduce((out, c) => out.slice(0, c.from) + c.insert + out.slice(c.to), text);
}

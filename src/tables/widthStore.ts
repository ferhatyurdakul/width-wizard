import type { TableKey } from "./tableParser";

/**
 * Persisted column widths, kept in the plugin's data.json (never in your notes).
 *
 * An entry is matched to a table first by header signature + occurrence, so it
 * survives tables being added or reordered. If the header was edited, an entry
 * whose key no longer matches anything falls back to matching by position.
 */

export interface StoredTable extends TableKey {
  /** Position of the table in the note when it was saved. */
  index: number;
  /** Column widths in px. */
  widths: number[];
}

export type WidthMap = Record<string, StoredTable[]>;

/**
 * For each table in `tables`, the stored entry that belongs to it (if any).
 *
 * `fuzzy` enables the position fallback. Only use it when `tables` is the
 * note's complete table list; with a partial list, positions are meaningless
 * and a table could claim another table's entry.
 */
export function matchStored(
  stored: StoredTable[],
  tables: TableKey[],
  fuzzy = true,
): (StoredTable | undefined)[] {
  const result: (StoredTable | undefined)[] = tables.map(() => undefined);
  const used = new Set<StoredTable>();

  tables.forEach((table, i) => {
    const hit = stored.find(
      (s) =>
        !used.has(s) &&
        s.signature === table.signature &&
        s.occurrence === table.occurrence,
    );
    if (hit) {
      result[i] = hit;
      used.add(hit);
    }
  });

  if (!fuzzy) return result;

  tables.forEach((_, i) => {
    if (result[i]) return;
    const hit = stored.find((s) => !used.has(s) && s.index === i);
    if (hit) {
      result[i] = hit;
      used.add(hit);
    }
  });

  return result;
}

/**
 * Refresh stored keys to where the tables are now, so the position fallback in
 * `matchStored` stays accurate after tables are inserted, removed or renamed.
 * Returns true if anything changed (the caller should persist).
 */
export function syncKeys(map: WidthMap, path: string, tables: TableKey[]): boolean {
  const entries = map[path];
  if (!entries?.length) return false;

  let changed = false;
  matchStored(entries, tables).forEach((entry, i) => {
    const table = tables[i];
    if (!entry || !table) return;
    if (entry.signature !== table.signature || entry.occurrence !== table.occurrence || entry.index !== i) {
      entry.signature = table.signature;
      entry.occurrence = table.occurrence;
      entry.index = i;
      changed = true;
    }
  });
  return changed;
}

/** Pads (with the average width) or truncates so there is one width per column. */
export function fitWidths(widths: number[], columns: number): number[] {
  if (widths.length === columns) return widths;
  if (widths.length > columns) return widths.slice(0, columns);
  const average = Math.round(widths.reduce((a, b) => a + b, 0) / (widths.length || 1)) || 120;
  return [...widths, ...Array<number>(columns - widths.length).fill(average)];
}

export function saveTable(
  map: WidthMap,
  path: string,
  tables: TableKey[],
  index: number,
  widths: number[],
): void {
  const table = tables[index];
  if (!table) return;

  const entries = map[path] ?? [];
  const matches = matchStored(entries, tables);

  // Keep every other matched entry (refreshing its key), swap in the new one.
  // Entries that match no table are dropped; they'd be unreachable anyway.
  const next: StoredTable[] = [];
  tables.forEach((t, i) => {
    if (i === index) {
      next.push({ signature: t.signature, occurrence: t.occurrence, index: i, widths });
      return;
    }
    const match = matches[i];
    if (match) {
      next.push({ ...match, signature: t.signature, occurrence: t.occurrence, index: i });
    }
  });
  map[path] = next;
}

export function removeTable(map: WidthMap, path: string, tables: TableKey[], index: number): void {
  const entries = map[path];
  if (!entries) return;
  const matches = matchStored(entries, tables);
  const doomed = matches[index];
  if (!doomed) return;
  const remaining = entries.filter((e) => e !== doomed);
  if (remaining.length) map[path] = remaining;
  else delete map[path];
}

/** Handles both a single file and a whole folder being renamed. */
export function renamePath(map: WidthMap, from: string, to: string): void {
  for (const key of Object.keys(map)) {
    let renamed: string | null = null;
    if (key === from) renamed = to;
    else if (key.startsWith(from + "/")) renamed = to + key.slice(from.length);
    if (renamed === null) continue;
    const entries = map[key];
    delete map[key];
    if (entries) map[renamed] = entries;
  }
}

/** Handles both a single file and a whole folder being deleted. */
export function removePath(map: WidthMap, path: string): void {
  for (const key of Object.keys(map)) {
    if (key === path || key.startsWith(path + "/")) delete map[key];
  }
}

export function countTables(map: WidthMap): number {
  return Object.values(map).reduce((sum, entries) => sum + entries.length, 0);
}

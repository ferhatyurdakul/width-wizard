import { Notice, TFile } from "obsidian";
import type WidthWizardPlugin from "../main";
import { NoteWriter } from "../notes/noteWriter";
import { planResetAll, planWidthEdit, type TextChange } from "../notes/noteWidths";
import { applyWidths, clearWidths, columnCount } from "./tableLayout";
import { parseTables, type ParsedTable } from "./tableParser";
import { fitWidths, matchStored, removeTable, saveTable, syncKeys } from "./widthStore";

/** Where a rendered <table> sits in its note. */
export interface TableRef {
  path: string;
  /** Every table in the note, in order. */
  tables: ParsedTable[];
  /** Which of those this element is. */
  index: number;
  /**
   * True when `tables` is known to be the whole note. Only then may widths be
   * changed from this table; otherwise (e.g. an embedded section) it just
   * displays whatever exactly matches.
   */
  editable: boolean;
}

/**
 * Knows which note and which table each rendered <table> element belongs to,
 * and keeps the element's column widths in sync with what is saved.
 */
export class TableController {
  /** The table currently being dragged; sync leaves it alone. */
  activeTable: HTMLTableElement | null = null;

  private refs = new WeakMap<HTMLTableElement, TableRef>();
  private tracked = new Set<WeakRef<HTMLTableElement>>();
  private cachedText: string | null = null;
  private cachedTables: ParsedTable[] = [];
  private sizedText: string | null = null;
  private sizedBytes = 0;
  private syncedTables: ParsedTable[] | null = null;
  private syncedPath: string | null = null;

  private notes: NoteWriter;

  constructor(private plugin: WidthWizardPlugin) {
    this.notes = new NoteWriter(plugin.app);
  }

  /** Widths live in the note itself (as a comment) rather than in plugin data. */
  private get inNote(): boolean {
    return this.plugin.settings.widthStorage === "note";
  }

  /** Parsing is O(note length), and one note renders many tables, so cache the last result. */
  parse(text: string): ParsedTable[] {
    if (text !== this.cachedText) {
      this.cachedTables = parseTables(text);
      this.cachedText = text;
    }
    return this.cachedTables;
  }

  /**
   * Reading view hands us the text it rendered, which for an embedded section
   * is only part of the note. The text is the whole note exactly when its size
   * matches the file's. If the cached size is stale this errs on "not whole",
   * which only costs resizability, never correctness.
   */
  isWholeNote(path: string, text: string): boolean {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;
    if (text !== this.sizedText) {
      this.sizedText = text;
      this.sizedBytes = new TextEncoder().encode(text).length;
    }
    return this.sizedBytes === file.stat.size;
  }

  bind(table: HTMLTableElement, path: string, tables: ParsedTable[], index: number, editable = true): void {
    if (!this.refs.has(table)) {
      this.tracked.add(new WeakRef(table));
      if (this.tracked.size > 500) this.sweep();
    }
    this.refs.set(table, { path, tables, index, editable });

    // Once per parse of a note: keep saved entries pointing at the right tables.
    if (editable && !this.inNote && (tables !== this.syncedTables || path !== this.syncedPath)) {
      this.syncedTables = tables;
      this.syncedPath = path;
      if (syncKeys(this.plugin.settings.tableWidths, path, tables)) this.plugin.requestSave();
    }
    this.applyStored(table);
  }

  refFor(table: HTMLTableElement | null): TableRef | undefined {
    return table ? this.refs.get(table) : undefined;
  }

  /** Make `table` show what is saved for it (or plain Obsidian layout if nothing is). */
  applyStored(table: HTMLTableElement): void {
    if (table === this.activeTable) return;

    const ref = this.refs.get(table);
    const widths = ref && this.plugin.settings.tableResizeEnabled ? this.storedWidths(ref) : null;

    if (!widths) {
      clearWidths(table);
      return;
    }
    const columns = columnCount(table);
    if (columns > 0) applyWidths(table, fitWidths(widths, columns));
  }

  private storedWidths(ref: TableRef): number[] | null {
    if (this.inNote) return ref.tables[ref.index]?.noteWidths ?? null;
    const entries = this.plugin.settings.tableWidths[ref.path] ?? [];
    return matchStored(entries, ref.tables, ref.editable)[ref.index]?.widths ?? null;
  }

  saveWidths(ref: TableRef, widths: number[]): void {
    const own = ref.tables[ref.index];
    if (this.inNote) {
      if (own) void this.writeNote(ref.path, (text) => planWidthEdit(text, own, widths));
      return;
    }
    saveTable(this.plugin.settings.tableWidths, ref.path, ref.tables, ref.index, widths);
    void this.plugin.saveNow();
    this.refreshPath(ref.path);
  }

  resetTable(ref: TableRef): void {
    const own = ref.tables[ref.index];
    if (this.inNote) {
      if (own) void this.writeNote(ref.path, (text) => planWidthEdit(text, own, null));
      return;
    }
    removeTable(this.plugin.settings.tableWidths, ref.path, ref.tables, ref.index);
    void this.plugin.saveNow();
    this.refreshPath(ref.path);
  }

  resetPath(path: string): void {
    if (this.inNote) {
      void this.writeNote(path, planResetAll);
      return;
    }
    delete this.plugin.settings.tableWidths[path];
    void this.plugin.saveNow();
    this.refreshPath(path);
  }

  /** Edit the note, then bring every rendered table of it in line with the result. */
  private async writeNote(path: string, plan: (text: string) => TextChange[] | null): Promise<void> {
    let result;
    try {
      result = await this.notes.edit(path, plan);
    } catch (error) {
      console.error("Width Wizard: couldn't save column widths to the note", error);
    }
    if (!result) {
      new Notice("Couldn't save the column widths to this note.");
      this.refreshPath(path); // put tables back as the note has them
      return;
    }
    this.rebindPath(path, this.parse(result.text));
  }

  /**
   * After the note's text changed under already-rendered tables (Reading view
   * doesn't re-render a table just because the line below it changed), point
   * them at the new parse so later syncs don't fall back to stale widths.
   */
  private rebindPath(path: string, fresh: ParsedTable[]): void {
    this.forEachTable((table) => {
      const ref = this.refs.get(table);
      if (ref?.path !== path) return;
      const own = ref.tables[ref.index];
      const index = fresh.findIndex((t) => t.signature === own?.signature && t.occurrence === own?.occurrence);
      if (index >= 0) this.refs.set(table, { ...ref, tables: fresh, index });
      this.applyStored(table);
    });
  }

  clearAllSaved(): void {
    this.plugin.settings.tableWidths = {};
    void this.plugin.saveNow();
    this.refreshAll();
  }

  /** Re-sync every rendered table of one note (e.g. the same note open in two panes). */
  refreshPath(path: string): void {
    this.forEachTable((table) => {
      if (this.refs.get(table)?.path === path) this.applyStored(table);
    });
  }

  refreshAll(): void {
    this.forEachTable((table) => this.applyStored(table));
  }

  /** Undo everything this plugin did to the DOM (on unload). */
  detachAll(): void {
    this.forEachTable((table) => clearWidths(table));
    this.tracked.clear();
  }

  private forEachTable(fn: (table: HTMLTableElement) => void): void {
    for (const weak of this.tracked) {
      const table = weak.deref();
      if (table) fn(table);
      else this.tracked.delete(weak);
    }
  }

  private sweep(): void {
    for (const weak of this.tracked) {
      if (!weak.deref()) this.tracked.delete(weak);
    }
  }
}

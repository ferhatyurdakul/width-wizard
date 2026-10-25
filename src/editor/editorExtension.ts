import { editorInfoField } from "obsidian";
import { ViewPlugin, type EditorView, type PluginValue, type ViewUpdate } from "@codemirror/view";
import type { Text } from "@codemirror/state";
import { GROUP_CLASS } from "../tables/tableLayout";
import { tableIndexAtLine, type ParsedTable } from "../tables/tableParser";
import type { TableController } from "../tables/tableController";

/** Live Preview renders each markdown table as a widget with this root class. */
const TABLE_SELECTOR = ".cm-table-widget table";

/**
 * Live Preview replaces table source with widgets and re-renders them as you
 * edit, so tables are (re)discovered whenever the editor DOM changes.
 */
class TableScanner implements PluginValue {
  private frame = 0;
  private observer: MutationObserver;
  private scannedDoc: Text | null = null;
  private bound = new WeakSet<HTMLTableElement>();

  constructor(
    private view: EditorView,
    private controller: TableController,
  ) {
    this.observer = new MutationObserver((records) => {
      // Adding/removing our own <colgroup> must not trigger another scan.
      const relevant = records.some((r) => !(isTable(r.target) && isOwnMutation(r)));
      if (relevant) this.schedule();
    });
    this.observer.observe(view.dom, { childList: true, subtree: true });
    this.schedule();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) this.schedule();
  }

  destroy(): void {
    this.observer.disconnect();
    if (this.frame) this.view.dom.win.cancelAnimationFrame(this.frame);
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = this.view.dom.win.requestAnimationFrame(() => {
      this.frame = 0;
      this.scan();
    });
  }

  private scan(): void {
    const tables = Array.from(this.view.dom.querySelectorAll<HTMLTableElement>(TABLE_SELECTOR));
    if (!tables.length) return;

    const state = this.view.state;
    if (state.doc !== this.scannedDoc) {
      // Positions may have shifted, so every table needs re-resolving.
      this.scannedDoc = state.doc;
      this.bound = new WeakSet();
    }

    const pending = tables.filter((t) => !this.bound.has(t));
    if (!pending.length) return;

    const path = state.field(editorInfoField, false)?.file?.path;
    if (!path) return;

    const parsed = this.controller.parse(state.doc.toString());
    for (const table of pending) {
      const index = this.indexOf(table, parsed);
      if (index < 0) continue;
      this.controller.bind(table, path, parsed, index);
      this.bound.add(table);
    }
  }

  /** Which table in the note's source is this widget showing? */
  private indexOf(table: HTMLTableElement, parsed: ParsedTable[]): number {
    try {
      const pos = this.view.posAtDOM(table);
      const line = this.view.state.doc.lineAt(pos).number - 1;
      return tableIndexAtLine(parsed, line);
    } catch {
      return -1; // not part of this editor's content
    }
  }
}

// Duck-typed rather than `instanceof`: popout windows have their own DOM classes.
function isTable(node: Node): boolean {
  return (node as Element).localName === "table";
}

function isOwnMutation(record: MutationRecord): boolean {
  const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
  return nodes.length > 0 && nodes.every((n) => (n as Element).classList?.contains(GROUP_CLASS));
}

export function tableScanner(controller: TableController) {
  return ViewPlugin.define((view) => new TableScanner(view, controller));
}

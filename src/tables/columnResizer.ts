import type WidthWizardPlugin from "../main";
import { applyWidths, borderX, measureColumns } from "./tableLayout";
import type { TableController, TableRef } from "./tableController";

/** How close (px) to a cell border the pointer must be to grab it. */
const GRAB_DISTANCE = 5;
const MAX_COLUMN_WIDTH = 4000;

const HOVER_CLASS = "ww-col-resize-hover";
const DRAGGING_CLASS = "ww-resizing";
const GUIDE_CLASS = "ww-resize-guide";
const GUIDE_VISIBLE_CLASS = "is-visible";

/** Obsidian's own Live Preview controls that sit on or beside cell edges. */
const OBSIDIAN_CONTROLS = ".table-col-drag-handle, .table-row-drag-handle, .table-col-btn, .table-row-btn";

interface Hit {
  table: HTMLTableElement;
  ref: TableRef;
  /** Column whose right border is under the pointer. */
  column: number;
}

interface Drag extends Hit {
  doc: Document;
  startX: number;
  startWidths: number[];
  widths: number[];
  moved: boolean;
}

export class ColumnResizer {
  private drag: Drag | null = null;
  private guides = new WeakMap<Document, HTMLElement>();
  private suppressClick = false;

  constructor(
    private plugin: WidthWizardPlugin,
    private tables: TableController,
  ) {}

  /** Listen on a document (the main window, or a popout window). */
  attach(doc: Document): void {
    const capture = { capture: true };
    const passiveCapture = { capture: true, passive: true };

    this.plugin.registerDomEvent(doc, "mousemove", (e) => this.onMouseMove(e, doc), passiveCapture);
    this.plugin.registerDomEvent(doc, "mousedown", (e) => this.onMouseDown(e, doc), capture);
    this.plugin.registerDomEvent(doc, "mouseup", () => this.endDrag(true), capture);
    this.plugin.registerDomEvent(doc, "dblclick", (e) => this.onDoubleClick(e), capture);
    this.plugin.registerDomEvent(doc, "click", (e) => this.onClick(e), capture);
    this.plugin.registerDomEvent(doc, "keydown", (e) => this.onKeyDown(e), capture);
    this.plugin.registerDomEvent(doc, "scroll", () => this.clearHover(doc), passiveCapture);
  }

  /** Remove anything left in the DOM (guide lines, cursor classes). */
  detach(doc: Document): void {
    this.endDrag(false);
    this.clearHover(doc);
    this.guides.get(doc)?.remove();
    this.guides.delete(doc);
  }

  private get enabled(): boolean {
    return this.plugin.settings.tableResizeEnabled;
  }

  // --- hit testing -------------------------------------------------------

  private hitTest(e: MouseEvent): Hit | null {
    const target = e.target as Element | null;
    // Not `instanceof Element`: popout windows have their own Element class.
    if (!target || typeof target.closest !== "function") return null;
    if (target.closest(OBSIDIAN_CONTROLS)) return null;

    const cell = target.closest<HTMLTableCellElement>("td, th");
    const table = cell?.closest("table") ?? null;
    const ref = this.tables.refFor(table);
    if (!cell || !table || !ref?.editable) return null;

    const rect = cell.getBoundingClientRect();
    if (e.clientY < rect.top || e.clientY > rect.bottom) return null;

    if (Math.abs(e.clientX - rect.right) <= GRAB_DISTANCE) {
      return { table, ref, column: cell.cellIndex };
    }
    if (cell.cellIndex > 0 && Math.abs(e.clientX - rect.left) <= GRAB_DISTANCE) {
      return { table, ref, column: cell.cellIndex - 1 };
    }
    return null;
  }

  // --- hover -------------------------------------------------------------

  private onMouseMove(e: MouseEvent, doc: Document): void {
    if (this.drag) {
      if (e.buttons === 0) this.endDrag(true); // released outside the window
      else this.dragTo(e);
      return;
    }
    if (!this.enabled || e.buttons !== 0) {
      this.clearHover(doc);
      return;
    }
    const hit = this.hitTest(e);
    if (!hit) {
      this.clearHover(doc);
      return;
    }
    doc.body.classList.add(HOVER_CLASS);
    this.showGuide(doc, hit.table, hit.column);
  }

  private clearHover(doc: Document): void {
    if (this.drag) return;
    if (doc.body.classList.contains(HOVER_CLASS)) doc.body.classList.remove(HOVER_CLASS);
    this.hideGuide(doc);
  }

  // --- dragging ----------------------------------------------------------

  private onMouseDown(e: MouseEvent, doc: Document): void {
    if (!this.enabled || e.button !== 0) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const hit = this.hitTest(e);
    if (!hit) return;

    // Stop Obsidian from placing a cursor in the cell or starting a text selection.
    e.preventDefault();
    e.stopPropagation();

    // Freeze every column at its current width so only the dragged one changes.
    const startWidths = measureColumns(hit.table);
    this.tables.activeTable = hit.table;
    applyWidths(hit.table, startWidths);

    this.drag = {
      ...hit,
      doc,
      startX: e.clientX,
      startWidths,
      widths: startWidths,
      moved: false,
    };
    doc.body.classList.add(DRAGGING_CLASS);
    doc.body.classList.remove(HOVER_CLASS);
  }

  private dragTo(e: MouseEvent): void {
    const drag = this.drag;
    if (!drag) return;

    const start = drag.startWidths[drag.column] ?? 0;
    const width = Math.round(
      Math.min(MAX_COLUMN_WIDTH, Math.max(this.plugin.settings.minColumnWidth, start + e.clientX - drag.startX)),
    );
    if (width === drag.widths[drag.column]) return;

    drag.widths = drag.widths.map((w, i) => (i === drag.column ? width : w));
    drag.moved = true;
    applyWidths(drag.table, drag.widths);
    this.showGuide(drag.doc, drag.table, drag.column);
  }

  private endDrag(commit: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.tables.activeTable = null;

    drag.doc.body.classList.remove(DRAGGING_CLASS);
    this.hideGuide(drag.doc);

    if (commit && drag.moved) {
      // The editor may have re-bound the table to a fresher ref while dragging.
      this.tables.saveWidths(this.tables.refFor(drag.table) ?? drag.ref, drag.widths);
      // The browser fires a click after mouseup; keep Obsidian from acting on it.
      this.suppressClick = true;
      drag.doc.defaultView?.setTimeout(() => (this.suppressClick = false), 0);
    } else {
      this.tables.applyStored(drag.table);
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.drag && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.endDrag(false);
    }
  }

  private onClick(e: MouseEvent): void {
    if (!this.suppressClick) return;
    this.suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  }

  private onDoubleClick(e: MouseEvent): void {
    if (!this.enabled) return;
    const hit = this.hitTest(e);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    this.tables.resetTable(hit.ref);
  }

  // --- guide line --------------------------------------------------------

  private showGuide(doc: Document, table: HTMLTableElement, column: number): void {
    const x = borderX(table, column);
    if (x === null) return;
    const rect = table.getBoundingClientRect();

    let guide = this.guides.get(doc);
    if (!guide) {
      guide = doc.body.createDiv({ cls: GUIDE_CLASS });
      this.guides.set(doc, guide);
    }
    guide.setCssProps({ left: `${x}px`, top: `${rect.top}px`, height: `${rect.height}px` });
    guide.classList.add(GUIDE_VISIBLE_CLASS);
  }

  private hideGuide(doc: Document): void {
    this.guides.get(doc)?.classList.remove(GUIDE_VISIBLE_CLASS);
  }
}

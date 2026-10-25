/**
 * DOM helpers that give a table fixed column widths.
 *
 * Widths go on a <colgroup>, not on cells: Obsidian's Live Preview table editor
 * sets and strips inline styles on cells while you edit, but leaves the table's
 * other children alone.
 */

export const TABLE_CLASS = "ww-resized";
export const GROUP_CLASS = "ww-colgroup";
const SCROLL_CLASS = "ww-table-scroll";
const TOTAL_WIDTH_VAR = "--ww-table-width";

export function columnCount(table: HTMLTableElement): number {
  return table.rows[0]?.cells.length ?? 0;
}

/** Current rendered width of each column, read from the first row. */
export function measureColumns(table: HTMLTableElement): number[] {
  const cells = Array.from(table.rows[0]?.cells ?? []);
  return cells.map((cell) => Math.round(cell.getBoundingClientRect().width));
}

/** Viewport x of the right border of `column` (read from the first row). */
export function borderX(table: HTMLTableElement, column: number): number | null {
  const cell = table.rows[0]?.cells[column];
  return cell ? cell.getBoundingClientRect().right : null;
}

/** Reading view wraps each table in `.el-table`, which needs to scroll once the table is wider than the page. */
function scrollWrapper(table: HTMLTableElement): HTMLElement | null {
  const parent = table.parentElement;
  return parent?.classList.contains("el-table") ? parent : null;
}

function findGroup(table: HTMLTableElement): HTMLElement | null {
  for (const child of Array.from(table.children)) {
    if (child.classList.contains(GROUP_CLASS)) return child as HTMLElement;
  }
  return null;
}

/**
 * Idempotent on purpose: the editor observer re-runs this after every DOM
 * change, so it must not touch the DOM when nothing differs.
 */
export function applyWidths(table: HTMLTableElement, widths: number[]): void {
  const group = findGroup(table) ?? table.createEl("colgroup", { cls: GROUP_CLASS, prepend: true });

  while (group.children.length > widths.length) group.lastElementChild?.remove();
  while (group.children.length < widths.length) group.createEl("col");

  let total = 0;
  widths.forEach((width, i) => {
    const col = group.children[i] as HTMLElement;
    const value = `${width}px`;
    if (col.style.getPropertyValue("width") !== value) col.style.setProperty("width", value);
    total += width;
  });

  if (!table.classList.contains(TABLE_CLASS)) table.classList.add(TABLE_CLASS);
  const wrapper = scrollWrapper(table);
  if (wrapper && !wrapper.classList.contains(SCROLL_CLASS)) wrapper.classList.add(SCROLL_CLASS);
  const totalValue = `${total}px`;
  if (table.style.getPropertyValue(TOTAL_WIDTH_VAR) !== totalValue) {
    table.style.setProperty(TOTAL_WIDTH_VAR, totalValue);
  }
}

/** Removes everything this plugin added; a no-op on untouched tables. */
export function clearWidths(table: HTMLTableElement): void {
  findGroup(table)?.remove();
  if (table.classList.contains(TABLE_CLASS)) table.classList.remove(TABLE_CLASS);
  const wrapper = scrollWrapper(table);
  if (wrapper?.classList.contains(SCROLL_CLASS)) wrapper.classList.remove(SCROLL_CLASS);
  if (table.style.getPropertyValue(TOTAL_WIDTH_VAR)) {
    table.style.removeProperty(TOTAL_WIDTH_VAR);
    if (!table.getAttribute("style")) table.removeAttribute("style");
  }
}

export function hasCustomWidths(table: HTMLTableElement): boolean {
  return table.classList.contains(TABLE_CLASS);
}

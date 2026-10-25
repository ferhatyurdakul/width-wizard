import { EditorSelection } from "@codemirror/state";
import { TFile, type App } from "obsidian";
import { editorViewFor } from "../editor/editorViews";
import { applyChanges, type TextChange } from "./noteWidths";

export interface EditResult {
  /** The note's text after the edit. */
  text: string;
  changed: boolean;
}

/**
 * Edits a note. If the note is open in an editor (Live Preview or Source mode)
 * the edit goes through that editor, so unsaved typing is preserved; otherwise
 * it is an atomic `vault.process`.
 */
export class NoteWriter {
  constructor(private app: App) {}

  /**
   * `plan` receives the note's current text and returns the changes to make,
   * or `null` if it can't (e.g. the table is gone). Resolves to `null` on failure.
   */
  async edit(path: string, plan: (text: string) => TextChange[] | null): Promise<EditResult | null> {
    const view = editorViewFor(path);
    if (view) {
      const text = view.state.doc.toString();
      const changes = plan(text);
      if (!changes) return null;
      if (!changes.length) return { text, changed: false };

      // Straight to CodeMirror, not Obsidian's Editor.transaction(): that always
      // scrolls the cursor into view, which flings the editor away from the table
      // being resized whenever the cursor is somewhere else. Here the selection is
      // simply carried along with the change and the scroll position is left alone.
      view.dispatch({
        changes: changes.map(({ from, to, insert }) => ({ from, to, insert })),
        selection: selectionAfter(view.state.selection, changes),
      });
      return { text: applyChanges(text, changes), changed: true };
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;

    let result: EditResult | null = null;
    await this.app.vault.process(file, (data) => {
      const changes = plan(data);
      if (!changes) return data;
      const text = applyChanges(data, changes);
      result = { text, changed: changes.length > 0 };
      return text;
    });
    return result;
  }
}

/**
 * Where the cursor should be after `changes`.
 *
 * Adding a comment inserts text at the end of the table's last row, just before
 * the line break. A cursor on the blank line right under the table (where you'd
 * keep typing) would normally be pushed down past the new comment. Keep it on
 * that blank line instead; everything further down moves with its text. Other
 * edits just carry the selection along (`undefined` leaves it to CodeMirror).
 */
function selectionAfter(selection: EditorSelection, changes: TextChange[]): EditorSelection | undefined {
  const [change] = changes;
  if (changes.length !== 1 || !change || change.from !== change.to) return undefined;

  const { from, insert } = change;
  const map = (pos: number) => (pos > from + 1 ? pos + insert.length : pos);
  return EditorSelection.create(
    selection.ranges.map((range) => EditorSelection.range(map(range.anchor), map(range.head))),
    selection.mainIndex,
  );
}

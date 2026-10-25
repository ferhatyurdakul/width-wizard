import { editorLivePreviewField } from "obsidian";
import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Text } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { openEditorViews } from "./editorViews";
import { parseWidthComment } from "../tables/tableParser";

/**
 * Live Preview shows HTML comments as plain text (only Reading view hides
 * them), so the `<!-- width-wizard: ... -->` line under a resized table would
 * sit there in grey. This hides it completely; Source mode shows it.
 *
 * The blank line right after the comment is hidden with it. Writing the
 * comment pushes that (already existing) blank line below it, so leaving it
 * visible would add a gap under every resized table. The blank line between
 * the table and the comment stays visible: it is where the cursor lands when
 * you arrow out of the table.
 *
 * The hidden lines are atomic, so cursor movement skips over them instead of
 * putting the cursor somewhere you can't see it.
 */

const refresh = StateEffect.define<null>();
const hidden = Decoration.replace({ block: true });
const cache = new WeakMap<Text, { from: number; to: number }[]>();

/**
 * The range to hide for each width comment that belongs to a table, i.e. the
 * nearest non-blank line above looks like a table row. Cached per document,
 * because the cursor no longer affects which of these are hidden.
 */
function commentLines(doc: Text): { from: number; to: number }[] {
  const cached = cache.get(doc);
  if (cached) return cached;

  const found: { from: number; to: number }[] = [];
  let previous = "";
  let from = 0;
  let justAfterComment: { from: number; to: number } | null = null;
  for (const text of doc.iterLines()) {
    const to = from + text.length;

    // Take in the blank line straight after a comment, unless it is the last line of
    // the note: that one is where the cursor goes when you click below the end.
    if (justAfterComment && text.trim() === "" && to < doc.length) justAfterComment.to = to;
    justAfterComment = null;

    if (text.trim() !== "") {
      if (
        text.includes("width-wizard:") &&
        !text.trimStart().startsWith(">") && // callouts render their own content
        previous.includes("|") &&
        parseWidthComment(text) !== null
      ) {
        justAfterComment = { from, to };
        found.push(justAfterComment);
      }
      previous = text;
    }
    from = to + 1;
  }
  cache.set(doc, found);
  return found;
}

function build(state: EditorState, enabled: boolean): DecorationSet {
  if (!enabled || !state.field(editorLivePreviewField, false)) return Decoration.none;

  const lines = commentLines(state.doc);
  if (!lines.length) return Decoration.none;

  const builder = new RangeSetBuilder<Decoration>();
  for (const line of lines) builder.add(line.from, line.to, hidden);
  return builder.finish();
}

export function commentHider(enabled: () => boolean) {
  const field = StateField.define<DecorationSet>({
    create: (state) => build(state, enabled()),
    update(value, tr) {
      const modeChanged =
        tr.state.field(editorLivePreviewField, false) !== tr.startState.field(editorLivePreviewField, false);
      if (!tr.docChanged && !modeChanged && !tr.effects.some((e) => e.is(refresh))) return value;
      return build(tr.state, enabled());
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [field, EditorView.atomicRanges.of((view) => view.state.field(field, false) ?? Decoration.none)];
}

/** Call after a setting that affects hiding changes. */
export function refreshCommentHiding(): void {
  for (const view of openEditorViews()) view.dispatch({ effects: refresh.of(null) });
}

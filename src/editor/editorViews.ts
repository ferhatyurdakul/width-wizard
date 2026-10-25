import { editorInfoField } from "obsidian";
import { ViewPlugin, type EditorView } from "@codemirror/view";

/** Every open Live Preview / Source mode editor, so the rest of the plugin can reach them. */
const open = new Set<EditorView>();

export const viewRegistry = ViewPlugin.define((view) => {
  open.add(view);
  return { destroy: () => void open.delete(view) };
});

export function openEditorViews(): Iterable<EditorView> {
  return open;
}

/** An open editor showing the note at `path`, if there is one. */
export function editorViewFor(path: string): EditorView | null {
  for (const view of open) {
    if (view.state.field(editorInfoField, false)?.file?.path === path) return view;
  }
  return null;
}

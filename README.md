# Width Wizard

An [Obsidian](https://obsidian.md) plugin with two jobs:

1. **Line width.** Make your notes use more (or all) of the screen instead of Obsidian's narrow 700px text column.
2. **Table column width.** Drag the border between two table columns to resize them, in both Live Preview and Reading view.

## Line width

Obsidian's "Readable line length" keeps text in a column about 700px wide. Width Wizard replaces that number:

- **Custom width**: pick any width from 400 to 3000px.
- **Full width**: use the whole pane.

It works in Live Preview, Source mode and Reading view. The command **Toggle custom line width** switches it on and off.


## Resizing table columns

Hover over the border between two columns. The cursor changes and a guide line appears. Then:

| Do this | To get this |
| --- | --- |
| Drag a border | Resize that column |
| Double-click a border | Reset that table to automatic widths |
| Press `Esc` while dragging | Cancel the drag |

Command: **Reset column widths in this note** (in **The note** mode this removes the width comments from the note).

Resizing is for mouse and trackpad. On touch devices, saved widths are shown but can't be changed.

### Where widths are saved

Markdown tables have no place for widths, so Width Wizard offers two options. Choose one in the settings under **Save column widths in**.

**Plugin data** (default). Your notes are never touched. Widths are kept in the plugin's own `data.json` and follow a note when it is renamed or moved *inside Obsidian*. Each table is recognised by its header row plus its order among tables with identical headers, so adding, removing or reordering other tables, editing cells, and renaming a header all keep your widths. The catch: if a note is renamed or moved *outside* Obsidian (Finder, a git pull, a sync tool), its widths are lost, and widths don't come along if you copy a note to another vault.

**The note**. Width Wizard adds a one-line comment under a table once you resize it:

```markdown
| Name | Role | Notes |
| ---- | ---- | ----- |
| Ada  | Dev  | ...   |

<!-- width-wizard: 120, 90, 300 -->
```

The widths now travel with the file: renaming, moving, copying, syncing and git all keep them, and so does copying the table into another note. In exchange, your note changes whenever you finish dragging a border. Live Preview would normally show that comment as grey text, so Width Wizard hides it there completely, together with the blank line after it, which means a resized table takes up the same space as before. To see or edit the comment, switch to Source mode. You can turn the hiding off in the settings. The comment must be the first thing below the table (blank lines in between are fine), and the plugin removes it again when you double-click a border or use **Reset column widths in this note**.

Switching between the two doesn't move anything: widths saved one way are kept, but not shown, while the other way is selected.

### Limitations

- With **The note** storage, the hidden comment lines are skipped by the cursor in Live Preview. If you press Backspace twice at the start of the paragraph right below a resized table, the second press can merge that paragraph onto the comment line; the comment then no longer parses and appears as plain text. Undo, or tidy it up in Source mode.
- A table inside an embedded *section* (`![[note#Heading]]`) shows its saved widths but can't be resized there. Open the note itself to resize it. (In **The note** mode it only shows widths if the comment is inside the embedded section.)
- Tables nested inside a table cell or produced by other plugins (e.g. Dataview) aren't supported.
- Columns are sized in pixels. A table wider than the pane scrolls horizontally.

## Installation

Width Wizard needs Obsidian 1.5.0 or newer. It makes no network requests and collects no data.

### From the community plugins list

1. Open **Settings → Community plugins**. If you see "Restricted mode", turn it off.
2. Select **Browse**, search for **Width Wizard**, then **Install** and **Enable**.

*(Available once the plugin has been approved for the list.)*

### With BRAT (before it is listed, or to try new versions early)

1. Install and enable the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
2. Use BRAT's **Add a beta plugin** command and enter `ferhatyurdakul/width-wizard`.
3. Enable **Width Wizard** under **Settings → Community plugins**.

### Manually

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/ferhatyurdakul/width-wizard/releases/latest).
2. Put them in a folder named `width-wizard` inside `<your vault>/.obsidian/plugins/`.
3. Reload Obsidian, then enable **Width Wizard** under **Settings → Community plugins**.

## Development

```bash
npm install
npm run dev     # rebuild main.js on every change
npm test        # unit tests (table parsing, width storage, edit planning)
npm run lint    # Obsidian's plugin review rules
npm run build   # type-check + production bundle
```

For live iteration, symlink the project folder into your vault's `.obsidian/plugins/` as `width-wizard`, run `npm run dev`, and use the [Hot Reload](https://github.com/pjeby/hot-reload) plugin.

### Releasing

1. Run `npm version <x.y.z>` (for example `npm version 1.0.1`). This updates `manifest.json` and `versions.json`, then commits and tags. The tag has no `v` prefix, because Obsidian requires the tag to equal the version.
2. Push the commit and the tag: `git push && git push --tags`.
3. The *Release* workflow runs the tests and lint, builds the plugin, and attaches `main.js`, `manifest.json` and `styles.css` to a draft GitHub release. Publish the draft.
4. **First release only:** submit the plugin at [community.obsidian.md](https://community.obsidian.md). Sign in, connect your GitHub account, then **Plugins → New plugin**, enter the repository URL, and submit. An automated review runs; if it reports problems, fix them and publish a new release with a higher version.

## License

[MIT](LICENSE)

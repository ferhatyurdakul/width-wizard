import { Notice, Plugin, debounce, type TAbstractFile } from "obsidian";
import { ColumnResizer } from "./tables/columnResizer";
import { commentHider } from "./editor/commentHider";
import { tableScanner } from "./editor/editorExtension";
import { viewRegistry } from "./editor/editorViews";
import { lineWidthValue } from "./settings/lineWidth";
import { DEFAULT_SETTINGS, WidthWizardSettingTab, type WidthWizardSettings } from "./settings/settings";
import { TableController } from "./tables/tableController";
import { tablesInRange } from "./tables/tableParser";
import { removePath, renamePath } from "./tables/widthStore";

const LINE_WIDTH_VAR = "--file-line-width";

export default class WidthWizardPlugin extends Plugin {
  settings!: WidthWizardSettings;
  tables!: TableController;

  private resizer!: ColumnResizer;
  private documents = new Set<Document>();

  /** For rapid changes such as dragging a slider. */
  requestSave = debounce(() => void this.saveNow(), 400, true);

  async onload(): Promise<void> {
    await this.loadSettings();

    this.tables = new TableController(this);
    this.resizer = new ColumnResizer(this, this.tables);

    this.addSettingTab(new WidthWizardSettingTab(this.app, this));

    // Reading view: the post-processor knows which note and which section it is rendering.
    this.registerMarkdownPostProcessor((el, ctx) => {
      const tableEls = el.querySelectorAll("table");
      if (!tableEls.length) return;
      const info = ctx.getSectionInfo(el);
      if (!info) return;

      const parsed = this.tables.parse(info.text);
      const inSection = tablesInRange(parsed, info.lineStart, info.lineEnd);
      const editable = this.tables.isWholeNote(ctx.sourcePath, info.text);

      tableEls.forEach((tableEl, i) => {
        const index = inSection[i];
        if (index !== undefined) this.tables.bind(tableEl, ctx.sourcePath, parsed, index, editable);
      });
    });

    // Live Preview: tables are editor widgets, and the width comment is hidden there.
    this.registerEditorExtension([
      viewRegistry,
      tableScanner(this.tables),
      commentHider(() => this.settings.widthStorage === "note" && this.settings.hideWidthComments),
    ]);

    this.addCommand({
      id: "toggle-line-width",
      name: "Toggle custom line width",
      callback: () => {
        this.settings.lineWidthEnabled = !this.settings.lineWidthEnabled;
        this.applyLineWidth();
        this.requestSave();
        new Notice(`Custom line width ${this.settings.lineWidthEnabled ? "on" : "off"}`);
      },
    });

    this.addCommand({
      id: "reset-column-widths",
      name: "Reset column widths in this note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) {
          this.tables.resetPath(file.path);
          new Notice("Column widths reset for this note.");
        }
        return true;
      },
    });

    // Keep saved widths attached to notes that are renamed, moved or deleted.
    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        renamePath(this.settings.tableWidths, oldPath, file.path);
        this.requestSave();
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => {
        removePath(this.settings.tableWidths, file.path);
        this.requestSave();
      }),
    );

    // Popout windows have their own document and <body>.
    this.registerEvent(this.app.workspace.on("window-open", (_win, win) => this.attachDocument(win.document)));
    this.registerEvent(this.app.workspace.on("window-close", (_win, win) => this.documents.delete(win.document)));

    this.attachDocument(document);
    this.app.workspace.onLayoutReady(() => {
      this.app.workspace.iterateAllLeaves((leaf) => this.attachDocument(leaf.view.containerEl.ownerDocument));
    });
  }

  onunload(): void {
    for (const doc of this.documents) {
      doc.body.style.removeProperty(LINE_WIDTH_VAR);
      this.resizer.detach(doc);
    }
    this.tables.detachAll();
    this.documents.clear();
    // Don't lose a change made in the last few hundred milliseconds.
    void this.saveNow();
  }

  private attachDocument(doc: Document): void {
    if (this.documents.has(doc)) return;
    this.documents.add(doc);
    this.resizer.attach(doc);
    this.applyLineWidthTo(doc);
  }

  applyLineWidth(): void {
    for (const doc of this.documents) this.applyLineWidthTo(doc);
  }

  private applyLineWidthTo(doc: Document): void {
    const value = lineWidthValue(this.settings);
    if (value === null) doc.body.style.removeProperty(LINE_WIDTH_VAR);
    else doc.body.style.setProperty(LINE_WIDTH_VAR, value);
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<WidthWizardSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...saved };
    this.settings.tableWidths = { ...(saved?.tableWidths ?? {}) };
  }

  async saveNow(): Promise<void> {
    await this.saveData(this.settings);
  }
}

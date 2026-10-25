import { App, Notice, PluginSettingTab, Setting, type SliderComponent, type TextComponent } from "obsidian";
import type WidthWizardPlugin from "../main";
import { refreshCommentHiding } from "../editor/commentHider";
import { LINE_WIDTH_LIMITS, clamp, type LineWidthMode } from "./lineWidth";
import { countTables, type WidthMap } from "../tables/widthStore";

/** Where column widths are kept: in this plugin's data, or in the note itself. */
export type WidthStorage = "plugin" | "note";

export interface WidthWizardSettings {
  lineWidthEnabled: boolean;
  lineWidthMode: LineWidthMode;
  lineWidthPx: number;
  tableResizeEnabled: boolean;
  widthStorage: WidthStorage;
  hideWidthComments: boolean;
  minColumnWidth: number;
  tableWidths: WidthMap;
}

export const DEFAULT_SETTINGS: WidthWizardSettings = {
  lineWidthEnabled: true,
  lineWidthMode: "custom",
  lineWidthPx: 700,
  tableResizeEnabled: true,
  widthStorage: "plugin",
  hideWidthComments: true,
  minColumnWidth: 40,
  tableWidths: {},
};

export const COLUMN_WIDTH_LIMITS = { min: 20, max: 200, step: 5 } as const;

export class WidthWizardSettingTab extends PluginSettingTab {
  private confirmClear = false;

  constructor(app: App, private plugin: WidthWizardPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl).setName("Line width").setHeading();

    if (this.readableLineLengthIsOff()) {
      new Setting(containerEl)
        .setName("Readable line length is turned off")
        .setDesc(
          "Obsidian already lets text use the full width of the pane while this is off, so the " +
            "setting below has no visible effect. Turn on 'Readable line length' in Settings → Editor to use it.",
        );
    }

    new Setting(containerEl)
      .setName("Override line width")
      .setDesc("Replace Obsidian's default 700px text column.")
      .addToggle((toggle) =>
        toggle.setValue(settings.lineWidthEnabled).onChange((value) => {
          settings.lineWidthEnabled = value;
          this.plugin.applyLineWidth();
          this.plugin.requestSave();
          this.display();
        }),
      );

    if (settings.lineWidthEnabled) {
      new Setting(containerEl)
        .setName("Width mode")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("custom", "Custom width")
            .addOption("full", "Full width")
            .setValue(settings.lineWidthMode)
            .onChange((value) => {
              settings.lineWidthMode = value as LineWidthMode;
              this.plugin.applyLineWidth();
              this.plugin.requestSave();
              this.display();
            }),
        );

      if (settings.lineWidthMode === "custom") this.addLineWidthControl(containerEl);
    }

    new Setting(containerEl).setName("Tables").setHeading();

    new Setting(containerEl)
      .setName("Resize table columns")
      .setDesc(
        "Drag the border between two columns to resize it, in Live Preview and Reading view. " +
          "Double-click a border to reset that table.",
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.tableResizeEnabled).onChange((value) => {
          settings.tableResizeEnabled = value;
          this.plugin.tables.refreshAll();
          this.plugin.requestSave();
        }),
      );

    new Setting(containerEl)
      .setName("Save column widths in")
      .setDesc(
        "Plugin data leaves your notes untouched, but a note's widths are lost if it is renamed or " +
          "moved outside Obsidian. The note adds a small comment below each resized table, so the " +
          "widths travel with the file. Widths already saved the other way are kept but not shown.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("plugin", "Plugin data")
          .addOption("note", "The note")
          .setValue(settings.widthStorage)
          .onChange((value) => {
            settings.widthStorage = value as WidthStorage;
            this.plugin.tables.refreshAll();
            refreshCommentHiding();
            this.plugin.requestSave();
            this.display();
          }),
      );

    if (settings.widthStorage === "note") {
      new Setting(containerEl)
        .setName("Hide width comments")
        .setDesc(
          "Live Preview shows HTML comments as plain text. This hides the width comment under a table " +
            "there completely. To see or edit it, switch to Source mode.",
        )
        .addToggle((toggle) =>
          toggle.setValue(settings.hideWidthComments).onChange((value) => {
            settings.hideWidthComments = value;
            refreshCommentHiding();
            this.plugin.requestSave();
          }),
        );
    }

    new Setting(containerEl)
      .setName("Minimum column width")
      .setDesc("Columns can't be dragged narrower than this (px).")
      .addSlider((slider) =>
        slider
          .setLimits(COLUMN_WIDTH_LIMITS.min, COLUMN_WIDTH_LIMITS.max, COLUMN_WIDTH_LIMITS.step)
          .setValue(settings.minColumnWidth)
          .setDynamicTooltip()
          .onChange((value) => {
            settings.minColumnWidth = value;
            this.plugin.requestSave();
          }),
      );

    this.addClearControl(containerEl);
  }

  private addLineWidthControl(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    const { min, max, step } = LINE_WIDTH_LIMITS;
    let slider: SliderComponent;
    let input: TextComponent;

    const apply = (value: number) => {
      settings.lineWidthPx = value;
      this.plugin.applyLineWidth();
      this.plugin.requestSave();
    };

    new Setting(containerEl)
      .setName("Maximum line width")
      .setDesc(`Width of the text column in pixels (${min}–${max}). Obsidian's default is 700.`)
      .addSlider((s) => {
        slider = s;
        s.setLimits(min, max, step)
          .setValue(clamp(settings.lineWidthPx, min, max))
          .setDynamicTooltip()
          .onChange((value) => {
            input.setValue(String(value));
            apply(value);
          });
      })
      .addText((t) => {
        input = t;
        t.inputEl.type = "number";
        t.inputEl.addClass("ww-number-input");
        t.setValue(String(settings.lineWidthPx));
        // "change" fires on blur/Enter, so half-typed numbers don't jump around.
        t.inputEl.addEventListener("change", () => {
          const parsed = Number(t.getValue());
          if (!Number.isFinite(parsed)) {
            t.setValue(String(settings.lineWidthPx));
            return;
          }
          const value = clamp(Math.round(parsed), min, max);
          t.setValue(String(value));
          slider.setValue(value);
          apply(value);
        });
      })
      .addExtraButton((button) =>
        button
          .setIcon("reset")
          .setTooltip("Restore default")
          .onClick(() => {
            apply(DEFAULT_SETTINGS.lineWidthPx);
            this.display();
          }),
      );
  }

  private addClearControl(containerEl: HTMLElement): void {
    const count = countTables(this.plugin.settings.tableWidths);
    const inNote = this.plugin.settings.widthStorage === "note";
    if (inNote && count === 0) return;

    new Setting(containerEl)
      .setName("Column widths in plugin data")
      .setDesc(
        count === 0
          ? "No tables have custom column widths yet."
          : `${count} ${count === 1 ? "table has" : "tables have"} custom column widths stored in this plugin's data, not in your notes.` +
              (inNote ? " They aren't used while widths are saved in the note." : ""),
      )
      .addButton((button) => {
        button
          .setButtonText(this.confirmClear ? "Click again to confirm" : "Clear all")
          .setDisabled(count === 0)
          .onClick(() => {
            if (!this.confirmClear) {
              this.confirmClear = true;
              this.display();
              return;
            }
            this.confirmClear = false;
            this.plugin.tables.clearAllSaved();
            new Notice("Saved column widths cleared.");
            this.display();
          });
        if (this.confirmClear) button.setWarning();
      });
  }

  hide(): void {
    this.confirmClear = false;
  }

  private readableLineLengthIsOff(): boolean {
    const vault = this.app.vault as unknown as { getConfig?: (key: string) => unknown };
    return vault.getConfig?.("readableLineLength") === false;
  }
}

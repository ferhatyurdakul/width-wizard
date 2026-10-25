import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  requireApiVersion,
  type SettingDefinitionItem,
  type SliderComponent,
  type TextComponent,
} from "obsidian";
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

/**
 * One row of the settings tab. It has the shape of a `render` setting
 * definition, so the same list drives both the declarative tab (1.13+) and the
 * `display()` fallback for older versions.
 */
interface Row {
  name: string;
  desc?: string;
  /** Extra search terms. */
  aliases?: string[];
  /** The row is hidden while this returns false. */
  visible?: () => boolean;
  render: (setting: Setting) => void;
}

interface Section {
  heading: string;
  items: Row[];
}

export class WidthWizardSettingTab extends PluginSettingTab {
  private confirmClear = false;

  constructor(app: App, private plugin: WidthWizardPlugin) {
    super(app, plugin);
  }

  /** Obsidian 1.13 and later build the tab, and its search index, from these. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.sections().map((section) => ({ type: "group", heading: section.heading, items: section.items }));
  }

  /** Before 1.13, Obsidian only knows how to call display(); 1.13+ never does. */
  display(): void {
    this.renderRows();
  }

  private renderRows(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const section of this.sections()) {
      new Setting(containerEl).setName(section.heading).setHeading();
      for (const row of section.items) {
        if (row.visible && !row.visible()) continue;
        const setting = new Setting(containerEl).setName(row.name);
        if (row.desc) setting.setDesc(row.desc);
        row.render(setting);
      }
    }
  }

  hide(): void {
    this.confirmClear = false;
  }

  /**
   * Bring the tab up to date after a value changed. Obsidian 1.13+ either only
   * re-evaluates which rows are visible or rebuilds the rows (when their text
   * or controls change); older versions redraw everything.
   */
  private refresh(rebuild: boolean): void {
    if (requireApiVersion("1.13.0")) {
      if (rebuild) this.update();
      else this.refreshDomState();
    } else {
      this.renderRows();
    }
  }

  private sections(): Section[] {
    const settings = this.plugin.settings;
    const customWidth = () => settings.lineWidthEnabled && settings.lineWidthMode === "custom";

    return [
      {
        heading: "Line width",
        items: [
          {
            name: "Readable line length is turned off",
            desc:
              "Obsidian already lets text use the full width of the pane while this is off, so the " +
              "setting below has no visible effect. Turn on 'Readable line length' in Settings → Editor to use it.",
            visible: () => this.readableLineLengthIsOff(),
            render: () => {},
          },
          {
            name: "Override line width",
            desc: "Replace Obsidian's default 700px text column.",
            aliases: ["readable line length", "page width", "note width"],
            render: (setting) => {
              setting.addToggle((toggle) =>
                toggle.setValue(settings.lineWidthEnabled).onChange((value) => {
                  settings.lineWidthEnabled = value;
                  this.plugin.applyLineWidth();
                  this.plugin.requestSave();
                  this.refresh(false);
                }),
              );
            },
          },
          {
            name: "Width mode",
            visible: () => settings.lineWidthEnabled,
            render: (setting) => {
              setting.addDropdown((dropdown) =>
                dropdown
                  .addOption("custom", "Custom width")
                  .addOption("full", "Full width")
                  .setValue(settings.lineWidthMode)
                  .onChange((value) => {
                    settings.lineWidthMode = value as LineWidthMode;
                    this.plugin.applyLineWidth();
                    this.plugin.requestSave();
                    this.refresh(false);
                  }),
              );
            },
          },
          {
            name: "Maximum line width",
            desc: `Width of the text column in pixels (${LINE_WIDTH_LIMITS.min}–${LINE_WIDTH_LIMITS.max}). Obsidian's default is 700.`,
            aliases: ["pixels", "text column"],
            visible: customWidth,
            render: (setting) => this.renderLineWidthControl(setting),
          },
        ],
      },
      {
        heading: "Tables",
        items: [
          {
            name: "Resize table columns",
            desc:
              "Drag the border between two columns to resize it, in Live Preview and Reading view. " +
              "Double-click a border to reset that table.",
            aliases: ["column width", "table width", "drag"],
            render: (setting) => {
              setting.addToggle((toggle) =>
                toggle.setValue(settings.tableResizeEnabled).onChange((value) => {
                  settings.tableResizeEnabled = value;
                  this.plugin.tables.refreshAll();
                  this.plugin.requestSave();
                }),
              );
            },
          },
          {
            name: "Save column widths in",
            desc:
              "Plugin data leaves your notes untouched, but a note's widths are lost if it is renamed or " +
              "moved outside Obsidian. The note adds a small comment below each resized table, so the " +
              "widths travel with the file. Widths already saved the other way are kept but not shown.",
            aliases: ["storage", "comment", "data.json"],
            render: (setting) => {
              setting.addDropdown((dropdown) =>
                dropdown
                  .addOption("plugin", "Plugin data")
                  .addOption("note", "The note")
                  .setValue(settings.widthStorage)
                  .onChange((value) => {
                    settings.widthStorage = value as WidthStorage;
                    this.plugin.tables.refreshAll();
                    refreshCommentHiding();
                    this.plugin.requestSave();
                    this.refresh(true);
                  }),
              );
            },
          },
          {
            name: "Hide width comments",
            desc:
              "Live Preview shows HTML comments as plain text. This hides the width comment under a table " +
              "there completely. To see or edit it, switch to Source mode.",
            visible: () => settings.widthStorage === "note",
            render: (setting) => {
              setting.addToggle((toggle) =>
                toggle.setValue(settings.hideWidthComments).onChange((value) => {
                  settings.hideWidthComments = value;
                  refreshCommentHiding();
                  this.plugin.requestSave();
                }),
              );
            },
          },
          {
            name: "Minimum column width",
            desc: this.minWidthDesc(settings.minColumnWidth),
            render: (setting) => {
              setting.addSlider((slider) => {
                slider
                  .setLimits(COLUMN_WIDTH_LIMITS.min, COLUMN_WIDTH_LIMITS.max, COLUMN_WIDTH_LIMITS.step)
                  .setValue(settings.minColumnWidth)
                  .onChange((value) => {
                    settings.minColumnWidth = value;
                    setting.setDesc(this.minWidthDesc(value));
                    this.plugin.requestSave();
                  });
              });
            },
          },
          this.clearRow(),
        ],
      },
    ];
  }

  private renderLineWidthControl(setting: Setting): void {
    const settings = this.plugin.settings;
    const { min, max, step } = LINE_WIDTH_LIMITS;
    let slider: SliderComponent;
    let input: TextComponent;

    const apply = (value: number) => {
      settings.lineWidthPx = value;
      this.plugin.applyLineWidth();
      this.plugin.requestSave();
    };

    setting
      .addSlider((s) => {
        slider = s;
        s.setLimits(min, max, step)
          .setValue(clamp(settings.lineWidthPx, min, max))
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
          const text = t.getValue().trim();
          const parsed = Number(text);
          // An emptied box reads as 0, which would silently jump to the minimum width.
          if (text === "" || !Number.isFinite(parsed)) {
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
            const value = DEFAULT_SETTINGS.lineWidthPx;
            apply(value);
            slider.setValue(value);
            input.setValue(String(value));
          }),
      );
  }

  private clearRow(): Row {
    const settings = this.plugin.settings;
    const count = countTables(settings.tableWidths);
    const inNote = settings.widthStorage === "note";

    return {
      name: "Column widths in plugin data",
      desc:
        count === 0
          ? "No tables have custom column widths yet."
          : `${count} ${count === 1 ? "table has" : "tables have"} custom column widths stored in this plugin's data, not in your notes.` +
            (inNote ? " They aren't used while widths are saved in the note." : ""),
      visible: () => !(settings.widthStorage === "note" && countTables(settings.tableWidths) === 0),
      render: (setting) => {
        setting.addButton((button) => {
          button
            .setButtonText(this.confirmClear ? "Click again to confirm" : "Clear all")
            .setDisabled(count === 0)
            .onClick(() => {
              if (!this.confirmClear) {
                this.confirmClear = true;
                this.refresh(true);
                return;
              }
              this.confirmClear = false;
              this.plugin.tables.clearAllSaved();
              new Notice("Saved column widths cleared.");
              this.refresh(true);
            });
          if (requireApiVersion("1.13.0") && this.confirmClear) button.setDestructive();
        });
      },
    };
  }

  /** Before 1.13 a slider doesn't show its value, so the description does. */
  private minWidthDesc(value: number): string {
    const base = "Columns can't be dragged narrower than this (px).";
    return requireApiVersion("1.13.0") ? base : `${base} Currently ${value}.`;
  }

  private readableLineLengthIsOff(): boolean {
    const vault = this.app.vault as unknown as { getConfig?: (key: string) => unknown };
    return vault.getConfig?.("readableLineLength") === false;
  }
}

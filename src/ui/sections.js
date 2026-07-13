import { matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { errorTitle, renderErrorText, trimBlankLines } from "../format.js";

export class SectionController {
  constructor() {
    this.sectionsById = new Map();
    this.sectionIds = [];
  }

  register(section) {
    if (!this.sectionsById.has(section.id)) {
      // Transcript rebuilds remove stale section kinds before registering the
      // active branch again. Do not impose a second global FIFO cap here: a
      // tool-heavy turn could otherwise evict every Thinking section even
      // though the navigator itself is windowed and can browse long lists.
      this.sectionIds.push(section.id);
    }
    this.sectionsById.set(section.id, section);
  }

  removeKinds(kinds) {
    const removedKinds = new Set(kinds);
    this.sectionIds = this.sectionIds.filter((id) => {
      const section = this.sectionsById.get(id);
      if (!section || !removedKinds.has(section.kind)) return true;
      this.sectionsById.delete(id);
      return false;
    });
  }

  list() {
    return this.sectionIds
      .map((id) => this.sectionsById.get(id))
      .filter(Boolean)
      .reverse();
  }
}

export class SectionNavigator {
  constructor({ sections, theme, onClose, requestRender, viewportRows }) {
    this.sections = sections;
    this.theme = theme;
    this.onClose = onClose;
    this.requestRender = requestRender;
    // Optional () => terminal rows, used to fit both list and detail panes to
    // the overlay's visible height. Falls back to a conservative default.
    this.viewportRows = viewportRows;
    this.selectedIndex = 0;
    this.detailScrollOffset = 0;
    this.detailLineCount = 0;
    this.detailPageRows = 1;
  }

  handleInput(data) {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onClose();
      return;
    }
    if (matchesKey(data, "up")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.detailScrollOffset = 0;
      this.requestRender();
      return;
    }
    if (matchesKey(data, "down")) {
      this.selectedIndex = Math.min(this.sections.length - 1, this.selectedIndex + 1);
      this.detailScrollOffset = 0;
      this.requestRender();
      return;
    }
    if (matchesKey(data, "pageup")) {
      this.detailScrollOffset = Math.max(
        0,
        this.detailScrollOffset - Math.max(1, this.detailPageRows - 1),
      );
      this.requestRender();
      return;
    }
    if (matchesKey(data, "pagedown")) {
      const maxOffset = Math.max(0, this.detailLineCount - this.detailPageRows);
      this.detailScrollOffset = Math.min(
        maxOffset,
        this.detailScrollOffset + Math.max(1, this.detailPageRows - 1),
      );
      this.requestRender();
      return;
    }
    if (matchesKey(data, "home")) {
      this.detailScrollOffset = 0;
      this.requestRender();
      return;
    }
    if (matchesKey(data, "end")) {
      this.detailScrollOffset = Math.max(0, this.detailLineCount - this.detailPageRows);
      this.requestRender();
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "space")) {
      this.sections[this.selectedIndex]?.toggle();
      this.requestRender();
    }
  }

  renderSectionDetail(section, width) {
    if (typeof section?.renderDetail !== "function") {
      return [this.theme.fg("dim", "No detail preview is available for this section.")];
    }
    try {
      const lines = section.renderDetail(Math.max(1, width));
      if (!Array.isArray(lines) || lines.length === 0) {
        return [this.theme.fg("dim", "This section has no visible detail.")];
      }
      return lines.map((line) => String(line));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return [this.theme.fg("error", `Could not render section detail: ${message}`)];
    }
  }

  windowDetail(lines, capacity) {
    const scrolling = lines.length > capacity;
    const pageRows = scrolling ? Math.max(1, capacity - 2) : capacity;
    const maxOffset = Math.max(0, lines.length - pageRows);
    this.detailScrollOffset = Math.min(this.detailScrollOffset, maxOffset);
    this.detailLineCount = lines.length;
    this.detailPageRows = pageRows;
    const end = Math.min(lines.length, this.detailScrollOffset + pageRows);
    const visible = lines.slice(this.detailScrollOffset, end);
    if (!scrolling) return visible;
    return [
      this.detailScrollOffset > 0
        ? this.theme.fg("dim", `↑ ${this.detailScrollOffset} lines above`)
        : "",
      ...visible,
      end < lines.length
        ? this.theme.fg("dim", `↓ ${lines.length - end} lines below`)
        : "",
    ];
  }

  windowSections(capacity) {
    const total = this.sections.length;
    const scrolling = total > capacity;
    const listRows = scrolling ? Math.max(1, capacity - 2) : total;
    const start = scrolling
      ? Math.min(
        Math.max(0, this.selectedIndex - Math.floor(listRows / 2)),
        Math.max(0, total - listRows),
      )
      : 0;
    const end = Math.min(total, start + listRows);
    const lines = [];
    if (scrolling) lines.push(start > 0 ? this.theme.fg("dim", `  ↑ ${start} more`) : "");
    for (let index = start; index < end; index += 1) {
      const section = this.sections[index];
      const selection = index === this.selectedIndex ? ">" : " ";
      const arrow = section.isExpanded() ? "▾" : "▸";
      const label = `${selection} ${arrow} ${section.label}`;
      lines.push(index === this.selectedIndex
        ? this.theme.fg("accent", label)
        : this.theme.fg("text", label));
    }
    if (scrolling) lines.push(end < total ? this.theme.fg("dim", `  ↓ ${total - end} more`) : "");
    return lines;
  }

  render(width) {
    const renderWidth = Math.max(1, width);
    const terminalRows = Math.max(8, this.viewportRows?.() ?? 24);
    const overlayRows = Math.max(7, Math.floor(terminalRows * 0.8) - 2);
    const selected = this.sections[this.selectedIndex];
    const arrow = selected?.isExpanded() ? "▾" : "▸";
    const footer = this.theme.fg(
      "dim",
      "↑↓ select · PgUp/PgDn detail · Enter toggle · Esc close",
    );

    if (renderWidth < 100) {
      const detailRows = Math.max(1, overlayRows - 3);
      const detail = this.windowDetail(
        this.renderSectionDetail(selected, renderWidth),
        detailRows,
      );
      const title = `${arrow} ${selected?.label ?? "Section"} (${this.selectedIndex + 1}/${this.sections.length})`;
      return [
        this.theme.fg("accent", this.theme.bold("Section detail · ↑ recent · ↓ older")),
        this.theme.fg("accent", title),
        ...detail,
        footer,
      ].map((line) => truncateToWidth(line, renderWidth, "…"));
    }

    const divider = this.theme.fg("dim", " │ ");
    const dividerWidth = 3;
    const listWidth = Math.max(30, Math.floor((renderWidth - dividerWidth) * 0.38));
    const detailWidth = Math.max(1, renderWidth - listWidth - dividerWidth);
    const bodyRows = Math.max(1, overlayRows - 2);
    const listLines = this.windowSections(bodyRows);
    const detailLines = this.windowDetail(
      this.renderSectionDetail(selected, detailWidth),
      bodyRows,
    );
    const leftHeader = this.theme.fg(
      "accent",
      this.theme.bold("Sections · ↑ recent · ↓ older"),
    );
    const rightHeader = this.theme.fg("accent", this.theme.bold(`Detail · ${selected?.label ?? "Section"}`));
    const fitColumn = (line, columnWidth) => {
      const fitted = truncateToWidth(line ?? "", columnWidth, "…");
      return fitted + " ".repeat(Math.max(0, columnWidth - visibleWidth(fitted)));
    };
    const rows = [
      `${fitColumn(leftHeader, listWidth)}${divider}${fitColumn(rightHeader, detailWidth)}`,
    ];
    for (let row = 0; row < bodyRows; row += 1) {
      rows.push(
        `${fitColumn(listLines[row], listWidth)}${divider}${fitColumn(detailLines[row], detailWidth)}`,
      );
    }
    rows.push(truncateToWidth(footer, renderWidth, "…"));
    return rows;
  }

  invalidate() {}
}

export class RuntimeNotice {
  constructor({ id, level, message, requestRender, sectionController, theme, isEnabled }) {
    this.id = id;
    this.level = level;
    this.message = message;
    this.requestRender = requestRender;
    this.sectionController = sectionController;
    this.theme = theme;
    this.isEnabled = isEnabled;
    this.nativeNotice = new Text(
      theme.fg(level, `${level === "error" ? "Error" : "Warning"}: ${message}`),
      1,
      0,
    );
    this.isOpen = true;
    this.registerSection();
  }

  registerSection() {
    const label = this.level === "error" ? "Error" : "Warning";
    this.sectionController.register({
      id: this.id,
      kind: "runtimeNotice",
      label: `${label} · ${this.level === "error" ? errorTitle(this.message) : "Attention"}`,
      isExpanded: () => this.isOpen,
      renderDetail: (width) => renderErrorText(
        this.theme,
        this.level,
        this.message,
        true,
      ).split("\n").map(
        (line) => truncateToWidth(line, Math.max(1, width), "…"),
      ),
      toggle: () => {
        this.isOpen = !this.isOpen;
        this.requestRender();
      },
    });
  }

  render(width) {
    if (!this.isEnabled()) return this.nativeNotice.render(width);
    this.registerSection();
    return renderErrorText(
      this.theme,
      this.level,
      this.message,
      this.isOpen,
    ).split("\n").map(
      (line) => truncateToWidth(line, Math.max(1, width), "…"),
    );
  }

  invalidate() {}
}

export class Empty {
  render() {
    return [];
  }

  invalidate() {}
}

export class VerticallyTrimmed {
  constructor(component) {
    this.component = component;
  }

  render(width) {
    return trimBlankLines(this.component.render(width));
  }

  invalidate() {
    this.component.invalidate?.();
  }
}

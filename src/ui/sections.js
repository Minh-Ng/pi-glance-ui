import { matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { errorTitle, renderErrorText, trimBlankLines } from "../format.js";

const MAX_NAVIGABLE_SECTIONS = 50;

export class SectionController {
  constructor() {
    this.sectionsById = new Map();
    this.sectionIds = [];
  }

  register(section) {
    if (!this.sectionsById.has(section.id)) {
      this.sectionIds.push(section.id);
      if (this.sectionIds.length > MAX_NAVIGABLE_SECTIONS) {
        const removedId = this.sectionIds.shift();
        this.sectionsById.delete(removedId);
      }
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
    // Optional () => terminal rows, used to window the list to the overlay's
    // visible height. Falls back to a conservative default when unavailable.
    this.viewportRows = viewportRows;
    this.selectedIndex = 0;
  }

  handleInput(data) {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onClose();
      return;
    }
    if (matchesKey(data, "up")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.requestRender();
      return;
    }
    if (matchesKey(data, "down")) {
      this.selectedIndex = Math.min(this.sections.length - 1, this.selectedIndex + 1);
      this.requestRender();
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "space")) {
      this.sections[this.selectedIndex]?.toggle();
      this.requestRender();
    }
  }

  render(width) {
    const truncate = (line) => truncateToWidth(line, Math.max(1, width), "…");
    const total = this.sections.length;
    // render(width) is not given a height, so derive the overlay's usable rows
    // from the terminal height (the overlay opens at maxHeight 70%). Without a
    // window the list overflows the clipped overlay, so the selection — and the
    // visible effect of toggling it — scrolls off the bottom of the page.
    const terminalRows = Math.max(8, this.viewportRows?.() ?? 24);
    const overlayRows = Math.max(6, Math.floor(terminalRows * 0.7) - 2);
    const capacity = Math.max(3, overlayRows - 4); // reserve header + footer
    const scrolling = total > capacity;
    const listRows = scrolling ? Math.max(1, capacity - 2) : total; // reserve ↑/↓ hints
    const start = scrolling
      ? Math.min(
        Math.max(0, this.selectedIndex - Math.floor(listRows / 2)),
        Math.max(0, total - listRows),
      )
      : 0;
    const end = Math.min(total, start + listRows);

    const lines = [this.theme.fg("accent", this.theme.bold("Sections")), ""];
    if (start > 0) lines.push(this.theme.fg("dim", `  ↑ ${start} more`));
    for (let index = start; index < end; index += 1) {
      const section = this.sections[index];
      const selection = index === this.selectedIndex ? ">" : " ";
      const arrow = section.isExpanded() ? "▾" : "▸";
      const label = `${selection} ${arrow} ${section.label}`;
      lines.push(index === this.selectedIndex
        ? this.theme.fg("accent", label)
        : this.theme.fg("text", label));
    }
    if (end < total) lines.push(this.theme.fg("dim", `  ↓ ${total - end} more`));
    lines.push("", this.theme.fg("dim", "↑↓ select · Enter toggle · Esc close"));
    return lines.map(truncate);
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

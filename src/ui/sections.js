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
  constructor({ sections, theme, onClose, requestRender }) {
    this.sections = sections;
    this.theme = theme;
    this.onClose = onClose;
    this.requestRender = requestRender;
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
    const lines = [
      this.theme.fg("accent", this.theme.bold("Sections")),
      "",
    ];
    for (let index = 0; index < this.sections.length; index += 1) {
      const section = this.sections[index];
      const selection = index === this.selectedIndex ? ">" : " ";
      const arrow = section.isExpanded() ? "▾" : "▸";
      const label = `${selection} ${arrow} ${section.label}`;
      lines.push(index === this.selectedIndex
        ? this.theme.fg("accent", label)
        : this.theme.fg("text", label));
    }
    lines.push("", this.theme.fg("dim", "↑↓ select · Enter toggle · Esc close"));
    return lines.map((line) => truncateToWidth(line, Math.max(1, width), "…"));
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

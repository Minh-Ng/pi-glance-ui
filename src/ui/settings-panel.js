import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

function cycle(values, current, direction) {
  if (!Array.isArray(values) || values.length === 0) return current;
  const index = values.indexOf(current);
  const base = index === -1 ? 0 : index;
  const next = (base + direction + values.length) % values.length;
  return values[next];
}

// Interactive, live-updating settings overlay for /glance-ui. Rows are read
// fresh from getRows() on every render, so values reflect state mutated by
// onChange without the panel caching anything.
export class SettingsPanel {
  constructor({ theme, getRows, onChange, requestRender, onClose }) {
    this.theme = theme;
    this.getRows = getRows;
    this.onChange = onChange;
    this.requestRender = requestRender;
    this.onClose = onClose;
    this.selectedIndex = 0;
    this.busy = false;
    this.status = "";
  }

  async handleInput(data) {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onClose();
      return;
    }
    const rows = this.getRows();
    if (rows.length === 0) return;
    this.selectedIndex = Math.min(this.selectedIndex, rows.length - 1);
    if (matchesKey(data, "up")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.requestRender();
      return;
    }
    if (matchesKey(data, "down")) {
      this.selectedIndex = Math.min(rows.length - 1, this.selectedIndex + 1);
      this.requestRender();
      return;
    }
    if (this.busy) return;
    const row = rows[this.selectedIndex];
    if (!row) return;
    let next;
    if (matchesKey(data, "left")) next = cycle(row.values, row.value, -1);
    else if (
      matchesKey(data, "right")
      || matchesKey(data, "enter")
      || matchesKey(data, "space")
    ) next = cycle(row.values, row.value, 1);
    else return;
    if (next === row.value) return;
    this.busy = true;
    this.status = `Applying ${row.key}…`;
    this.requestRender();
    try {
      await this.onChange(row.key, next);
      this.status = "";
    } catch (error) {
      this.status = `Could not apply ${row.key}: ${error?.message ?? error}`;
    } finally {
      this.busy = false;
      this.requestRender();
    }
  }

  render(width) {
    const rows = this.getRows();
    const clamp = (line) => truncateToWidth(line, Math.max(1, width), "…");
    const lines = [
      this.theme.fg("accent", this.theme.bold("Glance UI settings")),
      "",
    ];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const selected = index === this.selectedIndex;
      const pointer = selected ? ">" : " ";
      const choices = (row.values || [])
        .map((value) => (value === row.value
          ? this.theme.fg("accent", this.theme.bold(`[${value}]`))
          : this.theme.fg("dim", value)))
        .join(" ");
      const heading = `${pointer} ${row.label}: ${choices}`;
      lines.push(selected ? this.theme.fg("text", heading) : this.theme.fg("dim", heading));
      if (row.effect) lines.push(clamp(this.theme.fg("dim", `    ${row.effect}`)));
    }
    lines.push("");
    lines.push(this.theme.fg(
      this.status.startsWith("Could not") ? "warning" : "dim",
      this.status || "↑↓ select · ←/→ or Enter change · Esc close",
    ));
    return lines.map(clamp);
  }

  invalidate() {}
}

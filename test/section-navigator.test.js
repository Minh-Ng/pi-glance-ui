import assert from "node:assert/strict";
import { test } from "node:test";

import { SectionController, SectionNavigator } from "../src/ui/sections.js";

const theme = { fg: (_c, t) => t, bold: (t) => t };
const plain = (lines) => lines.join("\n");

const makeSections = (count) => Array.from({ length: count }, (_, i) => {
  let expanded = false;
  return {
    id: `s-${i}`,
    kind: "tools",
    label: `Section ${i}`,
    isExpanded: () => expanded,
    renderDetail: () => [`Detail for section ${i}`, `Result ${i}`],
    toggle: () => { expanded = !expanded; },
  };
});

const navigator = (count, rows) => new SectionNavigator({
  sections: makeSections(count),
  theme,
  onClose() {},
  requestRender() {},
  viewportRows: () => rows,
});

test("tool-heavy transcripts do not evict Thinking sections", () => {
  const controller = new SectionController();
  controller.register({
    id: "thinking:retained",
    kind: "thinking",
    label: "Thinking · retained",
    isExpanded: () => false,
    renderDetail: () => ["Important reasoning"],
    toggle() {},
  });
  for (let index = 0; index < 75; index += 1) {
    controller.register({
      id: `tools:${index}`,
      kind: "tools",
      label: `Tool group ${index}`,
      isExpanded: () => false,
      renderDetail: () => [`Tool detail ${index}`],
      toggle() {},
    });
  }

  const sections = controller.list();
  assert.equal(sections.length, 76);
  assert.ok(sections.some((section) => section.id === "thinking:retained"));
});

test("windows the list to the viewport and keeps the selection on screen", () => {
  const nav = navigator(50, 20);
  nav.selectedIndex = 40;
  const out = plain(nav.render(120));
  assert.match(out, /> ▸ Section 40/, "selected row is rendered");
  assert.doesNotMatch(out, /Section 0\b/, "far-off rows are not rendered (windowed)");
  assert.match(out, /↑ \d+ more/, "shows how many rows are above");
  assert.match(out, /↓ \d+ more/, "shows how many rows are below");
});

test("no top indicator at the start, no bottom indicator at the end", () => {
  const nav = navigator(50, 20);
  nav.selectedIndex = 0;
  const atTop = plain(nav.render(120));
  assert.doesNotMatch(atTop, /↑ \d+ more/);
  assert.match(atTop, /↓ \d+ more/);
  assert.match(atTop, /> ▸ Section 0/);

  nav.selectedIndex = 49;
  const atBottom = plain(nav.render(120));
  assert.match(atBottom, /↑ \d+ more/);
  assert.doesNotMatch(atBottom, /↓ \d+ more/);
  assert.match(atBottom, /> ▸ Section 49/);
});

test("selection cannot run off the page as it moves down", () => {
  const nav = navigator(50, 20);
  for (let i = 0; i < 60; i += 1) nav.handleInput("\u001b[B"); // arrow down past the end
  assert.equal(nav.selectedIndex, 49, "clamped to the last section");
  assert.match(plain(nav.render(120)), /> ▸ Section 49/, "selection stays visible");
});

test("short lists render fully with no scroll indicators", () => {
  const nav = navigator(3, 40);
  const out = plain(nav.render(120));
  assert.doesNotMatch(out, /more/);
  assert.match(out, /Section 0/);
  assert.match(out, /Section 2/);
});

test("Enter toggles the selected section's expansion arrow", () => {
  const nav = navigator(5, 40);
  nav.selectedIndex = 2;
  assert.match(plain(nav.render(120)), /> ▸ Section 2/);
  nav.handleInput("\r");
  assert.match(plain(nav.render(120)), /> ▾ Section 2/, "arrow flips to expanded");
});

test("wide overlays render the selected section in a detail pane", () => {
  const nav = navigator(5, 30);
  let out = plain(nav.render(120));
  assert.match(out, /Sections · ↑ recent · ↓ older/);
  assert.match(out, /Detail · Section 0/);
  assert.match(out, /Detail for section 0/);

  nav.handleInput("\u001b[B");
  out = plain(nav.render(120));
  assert.match(out, /Detail · Section 1/);
  assert.match(out, /Detail for section 1/);
  assert.doesNotMatch(out, /Detail for section 0/);
});

test("narrow overlays prioritize readable selected detail", () => {
  const nav = navigator(5, 30);
  nav.selectedIndex = 3;
  const out = plain(nav.render(80));
  assert.match(out, /Section detail · ↑ recent · ↓ older/);
  assert.match(out, /Section 3 \(4\/5\)/);
  assert.match(out, /Detail for section 3/);
  assert.doesNotMatch(out, /Section 2/);
});

test("PageUp and PageDown scroll long section detail", () => {
  const sections = makeSections(1);
  sections[0].renderDetail = () => Array.from({ length: 40 }, (_, i) => `Detail line ${i}`);
  const nav = new SectionNavigator({
    sections,
    theme,
    onClose() {},
    requestRender() {},
    viewportRows: () => 20,
  });

  const firstPage = plain(nav.render(120));
  assert.match(firstPage, /Detail line 0/);
  assert.match(firstPage, /lines below/);

  nav.handleInput("\u001b[6~");
  const secondPage = plain(nav.render(120));
  assert.doesNotMatch(secondPage, /Detail line 0\b/);
  assert.match(secondPage, /lines above/);
  assert.match(secondPage, /Detail line \d+/);

  nav.handleInput("\u001b[5~");
  assert.match(plain(nav.render(120)), /Detail line 0/);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { SectionNavigator } from "../src/ui/sections.js";

const theme = { fg: (_c, t) => t, bold: (t) => t };
const plain = (lines) => lines.join("\n");

const makeSections = (count) => Array.from({ length: count }, (_, i) => {
  let expanded = false;
  return {
    id: `s-${i}`,
    kind: "tools",
    label: `Section ${i}`,
    isExpanded: () => expanded,
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

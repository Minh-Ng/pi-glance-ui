import assert from "node:assert/strict";
import { test } from "node:test";

import { rebuildActionSections } from "../src/index.js";
import { ToolTimeline } from "../src/timeline.js";
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

test("opening the navigator self-heals missing reload action sections", () => {
  const sections = new SectionController();
  const timeline = new ToolTimeline(sections);
  sections.register({
    id: "thinking:reload",
    kind: "thinking",
    label: "Thinking after reload",
    isExpanded: () => false,
    renderDetail: () => ["reasoning"],
    toggle() {},
  });
  sections.register({
    id: "tools:stale",
    kind: "tools",
    label: "Stale action",
    isExpanded: () => false,
    renderDetail: () => ["stale result"],
    toggle() {},
  });
  const messages = [
    { role: "user", content: "inspect" },
    {
      role: "assistant",
      content: [{
        type: "toolCall",
        id: "reload-action",
        name: "read",
        arguments: { path: "README.md" },
      }],
    },
    {
      role: "toolResult",
      toolCallId: "reload-action",
      toolName: "read",
      content: [{ type: "text", text: "restored on open" }],
      isError: false,
    },
  ];

  const recovery = rebuildActionSections({
    timeline,
    sectionController: sections,
    sessionManager: { buildSessionContext: () => ({ messages }) },
  });

  assert.deepEqual(recovery, { rebuilt: true, toolCalls: 1, actionSections: 1 });
  assert.ok(sections.list().some((section) => section.kind === "thinking"));
  const actions = sections.list().filter((section) => section.kind === "tools");
  assert.equal(actions.length, 1, "stale action sections are replaced, not accepted as sufficient");
  assert.doesNotMatch(actions[0].label, /Stale/);
  assert.match(actions[0].renderDetail(120).join("\n"), /restored on open/);
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

test("lowercase f cycles section-type filters and the footer makes that clear", () => {
  const typedSections = [
    { id: "plan", kind: "tools", filterType: "plan", label: "Plan · Explored", detail: "plan" },
    { id: "impl-1", kind: "tools", filterType: "implement", label: "Implement · Changed", detail: "one" },
    { id: "impl-2", kind: "tools", filterType: "implement", label: "Implement · Changed", detail: "two" },
    { id: "thinking", kind: "thinking", label: "Thinking", detail: "thought" },
  ].map((section) => ({
    ...section,
    isExpanded: () => false,
    renderDetail: () => [section.detail],
    toggle() {},
  }));
  const nav = new SectionNavigator({
    sections: typedSections,
    theme,
    onClose() {},
    requestRender() {},
    viewportRows: () => 30,
  });

  const initial = nav.render(120);
  assert.match(plain(initial), /Filter: All · 4\/4/);
  assert.match(initial.at(-1), /^  f: cycle filter   ·/);
  assert.doesNotMatch(initial.at(-1), /F filter/);
  nav.selectedIndex = 2;
  nav.handleInput("f");
  assert.equal(nav.selectedIndex, 0);
  assert.deepEqual(nav.sections.map((section) => section.id), ["plan"]);
  assert.match(plain(nav.render(120)), /Filter: Plan · 1\/4/);

  nav.handleInput("f");
  assert.deepEqual(nav.sections.map((section) => section.id), ["impl-1", "impl-2"]);
  const implementView = plain(nav.render(120));
  assert.match(implementView, /Filter: Implement · 2\/4/);
  assert.match(implementView, /Implement · Changed/);
  assert.doesNotMatch(implementView, /Plan · Explored/);
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
  assert.match(out, /Filter: All · 5\/5/);
  assert.match(out, /Detail · Section 0/);
  assert.match(out, /Detail for section 0/);

  nav.handleInput("\u001b[B");
  out = plain(nav.render(120));
  assert.match(out, /Detail · Section 1/);
  assert.match(out, /Detail for section 1/);
  assert.doesNotMatch(out, /Detail for section 0/);
});

test("wide overlays reserve more width for detail and use 85% viewport height", () => {
  const nav = navigator(5, 100);
  const lines = nav.render(120);
  assert.equal(lines[0].indexOf(" │ "), 32, "left pane uses 28% instead of the previous 38%");
  assert.equal(lines.length, 83, "navigator body follows the 85% overlay height");
});

test("narrow overlays prioritize readable selected detail", () => {
  const nav = navigator(5, 30);
  nav.selectedIndex = 3;
  const out = plain(nav.render(80));
  assert.match(out, /Section detail · Filter: All · 5\/5 · ↑ recent · ↓ older/);
  assert.match(out, /Section 3 \(4\/5\)/);
  assert.match(out, /Detail for section 3/);
  assert.doesNotMatch(out, /Section 2/);
});

test("arrow keys scroll the focused detail pane and preserve section selection", () => {
  const sections = makeSections(2);
  sections[0].renderDetail = () => Array.from({ length: 40 }, (_, i) => `Detail line ${i}`);
  const nav = new SectionNavigator({
    sections,
    theme,
    onClose() {},
    requestRender() {},
    viewportRows: () => 20,
  });

  assert.match(plain(nav.render(120)), /› Filter: All/, "section list starts focused");
  nav.handleInput("\u001b[C");
  assert.match(plain(nav.render(120)), /› Detail · Section 0/, "right focuses detail");

  nav.handleInput("\u001b[B");
  const scrolled = plain(nav.render(120));
  assert.equal(nav.selectedIndex, 0, "down does not change selection while detail is focused");
  assert.doesNotMatch(scrolled, /Detail line 0\b/);
  assert.match(scrolled, /Detail line 1\b/);

  nav.handleInput("\u001b[A");
  assert.match(plain(nav.render(120)), /Detail line 0\b/, "up scrolls detail toward the start");

  nav.handleInput("\u001b[D");
  nav.handleInput("\u001b[B");
  assert.equal(nav.selectedIndex, 1, "left restores list navigation");
});

test("Tab toggles between section and detail panes", () => {
  const nav = navigator(2, 20);
  nav.render(120);
  nav.handleInput("\t");
  assert.equal(nav.focusedPane, "detail");
  nav.handleInput("\t");
  assert.equal(nav.focusedPane, "sections");
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

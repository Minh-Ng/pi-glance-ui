import { test } from "node:test";
import { Spacer } from "@earendil-works/pi-tui";

import { SectionController, SectionNavigator } from "../src/ui/sections.js";
import { TranscriptSpacer } from "../src/ui/transcript-spacing.js";

const enabled = process.env.GLANCE_UI_BENCHMARK === "1";
const theme = { fg: (_c, t) => t, bold: (t) => t };

const time = (iterations, fn) => {
  const startedAt = performance.now();
  for (let i = 0; i < iterations; i += 1) fn(i);
  return performance.now() - startedAt;
};

// Cost of opening and navigating the Ctrl+Shift+O section navigator: building
// the section list and rendering the overlay each frame. This is the plugin's
// own contribution, isolated from Pi's overlay/re-render machinery.
test("section navigator benchmark", { skip: !enabled }, () => {
  const controller = new SectionController();
  for (let i = 0; i < 50; i += 1) {
    let expanded = i % 2 === 0;
    controller.register({
      id: `section-${i}`,
      kind: i % 3 === 0 ? "thinking" : i % 3 === 1 ? "custom" : "assistantError",
      label: `Section ${i} — ${"detail ".repeat(6)}`,
      isExpanded: () => expanded,
      toggle: () => { expanded = !expanded; },
    });
  }

  const listIterations = 20000;
  const listMs = time(listIterations, () => controller.list());

  const navigator = new SectionNavigator({
    sections: controller.list(),
    theme,
    onClose() {},
    requestRender() {},
  });
  const renderIterations = 20000;
  const renderMs = time(renderIterations, (i) => {
    navigator.selectedIndex = i % navigator.sections.length;
    navigator.render(160);
  });

  console.log(JSON.stringify({
    sections: 50,
    listIterations,
    listMsTotal: Number(listMs.toFixed(1)),
    listUsPerOpen: Number(((listMs / listIterations) * 1000).toFixed(2)),
    renderIterations,
    renderMsTotal: Number(renderMs.toFixed(1)),
    renderUsPerFrame: Number(((renderMs / renderIterations) * 1000).toFixed(2)),
  }));
});

// Cost of the per-render transcript spacing pass over a large transcript. An
// overlay open (Ctrl+Shift+O) can trigger a full re-render, which pays this.
test("transcript spacing benchmark", { skip: !enabled }, () => {
  const spacer = new TranscriptSpacer({
    isThinkingOnlyComponent: (c) => c?.type === "thinking",
    isTextBearingAssistant: (c) => c?.type === "prose",
    isToolComponent: (c) => c?.constructor?.name === "ToolExecutionComponent",
  });

  const makeChildren = (count) => {
    const children = [];
    for (let i = 0; i < count; i += 1) {
      const mod = i % 4;
      if (mod === 0) children.push({ type: "prose", contentContainer: { children: [{}] } });
      else if (mod === 1) children.push({ constructor: { name: "ToolExecutionComponent" } });
      else if (mod === 2) children.push({ type: "thinking", contentContainer: { children: [new Spacer(1), {}] } });
      else children.push({ constructor: { name: "UserMessageComponent" } });
      children.push(new Spacer(1));
    }
    return children;
  };

  for (const count of [100, 500, 1000]) {
    const children = makeChildren(count);
    const iterations = 2000;
    const ms = time(iterations, () => spacer.normalize(children));
    console.log(JSON.stringify({
      entries: count,
      childrenIncludingSpacers: children.length,
      iterations,
      msTotal: Number(ms.toFixed(1)),
      usPerNormalize: Number(((ms / iterations) * 1000).toFixed(2)),
    }));
  }
});

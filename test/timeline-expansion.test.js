import assert from "node:assert/strict";
import { test } from "node:test";

import { ToolTimeline } from "../src/timeline.js";
import { SectionController } from "../src/ui/sections.js";

const messages = [
  { role: "user", content: "inspect" },
  {
    role: "assistant",
    content: [{
      type: "toolCall",
      id: "tool-stable",
      name: "read",
      arguments: { path: "README.md" },
    }],
    stopReason: "toolUse",
  },
];

function attach(timeline, component) {
  const entry = timeline.entriesById.get("tool-stable");
  timeline.attachComponent(entry, component, (expanded) => {
    component.expanded = expanded;
  });
  return entry;
}

function applyPiGlobalExpansion(timeline, component, expanded) {
  timeline.setGlobalExpanded("tool-stable", expanded);
  const entry = timeline.entriesById.get("tool-stable");
  component.expanded = entry.group.expandedOverride ?? expanded;
}

test("reload rebuilds action sections even when tool components never render", () => {
  const sections = new SectionController();
  const timeline = new ToolTimeline(sections);
  const replayMessages = [
    ...messages,
    {
      role: "toolResult",
      toolCallId: "tool-stable",
      toolName: "read",
      content: [{ type: "text", text: "\u001b[31mreloaded file body\u001b[0m" }],
      details: {},
      isError: false,
    },
  ];

  timeline.rebuildFromMessages(replayMessages);
  timeline.finishTranscriptRebuild();

  const action = sections.list().find((section) => section.kind === "tools");
  assert.ok(action, "the action remains navigable without a component render");
  const detail = action.renderDetail(120).join("\n");
  assert.match(detail, /read/);
  assert.match(detail, /README\.md/);
  assert.match(detail, /reloaded file body/);
  assert.doesNotMatch(detail, /\u001b/, "fallback detail strips terminal controls");
});

test("rebuilt tools register alongside Thinking in transcript render order", () => {
  const sections = new SectionController();
  const timeline = new ToolTimeline(sections);

  timeline.rebuildFromMessages(messages);
  assert.deepEqual(sections.list(), [], "tool prepass must not preempt assistant sections");

  sections.register({
    id: "thinking:before-tool",
    kind: "thinking",
    label: "Thinking before tool",
    isExpanded: () => false,
    renderDetail: () => ["reasoning"],
    toggle() {},
  });
  attach(timeline, { expanded: false });
  timeline.finishTranscriptRebuild();

  assert.deepEqual(
    sections.list().map((section) => section.kind),
    ["tools", "thinking"],
    "reverse-chronological viewer order retains both interleaved kinds",
  );
});

test("section expansion survives Pi global resets and transcript rebuilds", () => {
  const sections = new SectionController();
  const timeline = new ToolTimeline(sections);

  timeline.rebuildFromMessages(messages);
  const originalComponent = { expanded: false };
  const originalEntry = attach(timeline, originalComponent);
  timeline.finishTranscriptRebuild();

  const originalSection = sections.list().find((section) => section.id === "tools:tool-stable");
  assert.equal(originalSection.isExpanded(), false);
  originalSection.toggle();
  assert.equal(originalSection.isExpanded(), true);
  assert.equal(originalComponent.expanded, true);

  // Pi reapplies the unchanged global toolOutputExpanded=false after many UI events.
  applyPiGlobalExpansion(timeline, originalComponent, false);
  assert.equal(originalEntry.group.expandedOverride, true);
  assert.equal(originalSection.isExpanded(), true);
  assert.equal(originalComponent.expanded, true);

  // A transcript reconstruction creates a new group/component for the same tool id.
  timeline.rebuildFromMessages(messages);
  const rebuiltComponent = { expanded: false };
  const rebuiltEntry = timeline.entriesById.get("tool-stable");
  applyPiGlobalExpansion(timeline, rebuiltComponent, false);
  attach(timeline, rebuiltComponent);
  timeline.finishTranscriptRebuild();

  const rebuiltSection = sections.list().find((section) => section.id === "tools:tool-stable");
  assert.notEqual(rebuiltEntry.group, originalEntry.group);
  assert.equal(rebuiltEntry.group.expandedOverride, true);
  assert.equal(rebuiltSection.isExpanded(), true);
  assert.equal(rebuiltComponent.expanded, true);

  // A real global toggle changes the authoritative baseline and clears overrides.
  applyPiGlobalExpansion(timeline, rebuiltComponent, true);
  applyPiGlobalExpansion(timeline, rebuiltComponent, false);
  assert.equal(rebuiltEntry.group.expandedOverride, undefined);
  assert.equal(rebuiltSection.isExpanded(), false);
  assert.equal(rebuiltComponent.expanded, false);
});

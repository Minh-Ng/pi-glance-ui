import assert from "node:assert/strict";
import { test } from "node:test";
import { Spacer } from "@earendil-works/pi-tui";

import { TranscriptSpacer } from "../src/ui/transcript-spacing.js";

const spacer = (mode = "separated") => new TranscriptSpacer({
  isThinkingOnlyComponent: (c) => c?.type === "thinking",
  startsWithThinkingComponent: (c) => c?.startsThinking ?? c?.type === "thinking",
  endsWithThinkingComponent: (c) => c?.endsThinking ?? c?.type === "thinking",
  isTextBearingAssistant: (c) => c?.endsProse ?? c?.type === "prose",
  isToolComponent: (c) => c?.constructor?.name === "ToolExecutionComponent",
  getTranscriptSpacingMode: typeof mode === "function" ? mode : () => mode,
});

const prose = () => ({ type: "prose", contentContainer: { children: [{}] } });
const thinking = (leadingBlank = true) => ({
  type: "thinking",
  contentContainer: { children: leadingBlank ? [new Spacer(1), {}] : [{}] },
});
const tool = () => ({ constructor: { name: "ToolExecutionComponent" } });
const user = () => ({ constructor: { name: "UserMessageComponent" } });

const isSpacer = (c) => c instanceof Spacer;
const trailing = (c) => {
  const ch = c.contentContainer.children;
  return ch.length > 0 && isSpacer(ch[ch.length - 1]);
};
const leading = (c) => isSpacer(c.contentContainer.children[0]);

test("prose followed by a tool gains one trailing blank; idempotent", () => {
  const s = spacer();
  const p = prose();
  s.normalize([p, tool()]);
  assert.equal(trailing(p), true);
  assert.equal(p.contentContainer.children.length, 2);
  s.normalize([p, tool()]);
  assert.equal(p.contentContainer.children.length, 2, "must not stack a second blank");
});

test("separator is removed when the successor is not a tool or is absent", () => {
  const s = spacer();
  const p = prose();
  s.normalize([p, tool()]);
  assert.equal(trailing(p), true);
  s.normalize([p, user()]);
  assert.equal(trailing(p), false, "removed when a non-tool follows");
  s.normalize([p, tool()]);
  s.normalize([p]);
  assert.equal(trailing(p), false, "removed when prose is last");
});

test("thinking-only keeps exactly one leading blank after any visible block", () => {
  const s = spacer();
  const afterProse = thinking(false);
  s.normalize([prose(), afterProse]);
  assert.equal(leading(afterProse), true, "repairs a missing blank after prose");
  assert.equal(afterProse.contentContainer.children.length, 2);

  const afterUser = thinking(true);
  s.normalize([user(), afterUser]);
  assert.equal(leading(afterUser), true, "preserves the turn-opening blank");
  assert.equal(afterUser.contentContainer.children.length, 2);
});

test("mixed assistant content gets exactly one blank before every Thinking child", () => {
  const s = spacer();
  const firstThinking = {};
  const proseChild = {};
  const secondThinking = {};
  const thirdThinking = {};
  const component = {
    contentContainer: {
      children: [
        firstThinking,
        new Spacer(1),
        proseChild,
        secondThinking,
        new Spacer(1),
        new Spacer(1),
        thirdThinking,
      ],
    },
  };
  const thinkingChildren = new Set([firstThinking, secondThinking, thirdThinking]);
  const normalize = () => s.normalizeRenderedThinkingChildren(
    component,
    (child) => thinkingChildren.has(child),
  );

  normalize();
  const normalized = component.contentContainer.children;
  assert.equal(normalized.length, 8);
  assert.deepEqual(
    [normalized[1], normalized[3], normalized[5], normalized[7]],
    [firstThinking, proseChild, secondThinking, thirdThinking],
  );
  assert.ok([0, 2, 4, 6].every((index) => isSpacer(normalized[index])));
  normalize();
  assert.equal(component.contentContainer.children.length, 8, "repeated normalization never stacks");
});

test("all transcript→Thinking boundaries have the expected gap in both modes", () => {
  const previousCases = [
    { label: "start of transcript", create: () => undefined, dense: 1 },
    { label: "user", create: user, dense: 1 },
    { label: "prose assistant", create: prose, dense: 1 },
    {
      label: "mixed assistant ending in prose",
      create: () => ({ endsProse: true, contentContainer: { children: [{}] } }),
      dense: 1,
    },
    { label: "Thinking assistant", create: () => thinking(true), dense: 0 },
    {
      label: "mixed assistant ending in Thinking",
      create: () => ({ endsThinking: true, contentContainer: { children: [{}] } }),
      dense: 0,
    },
    { label: "tool", create: tool, dense: 0 },
    { label: "custom artifact", create: () => ({ type: "custom" }), dense: 1 },
    { label: "runtime/cache notice", create: () => ({ type: "runtime" }), dense: 1 },
  ];

  for (const mode of ["dense", "separated"]) {
    for (const previousCase of previousCases) {
      const current = thinking(true);
      const previous = previousCase.create();
      spacer(mode).normalize(previous ? [previous, current] : [current]);
      const expected = mode === "dense" ? previousCase.dense : 1;
      assert.equal(
        Number(leading(current)),
        expected,
        `${mode}: ${previousCase.label}→Thinking`,
      );
      assert.ok(
        current.contentContainer.children.filter(isSpacer).length <= 1,
        `${mode}: ${previousCase.label}→Thinking never doubles`,
      );
    }
  }
});

test("all assistant→tool boundaries add spacing only when final prose requires it", () => {
  const previousCases = [
    { label: "prose assistant", create: prose, expected: true },
    {
      label: "mixed assistant ending in prose",
      create: () => ({ endsProse: true, contentContainer: { children: [{}] } }),
      expected: true,
    },
    { label: "Thinking assistant", create: () => thinking(true), expected: false },
    {
      label: "mixed assistant ending in Thinking",
      create: () => ({ endsThinking: true, contentContainer: { children: [{}] } }),
      expected: false,
    },
  ];

  for (const mode of ["dense", "separated"]) {
    for (const previousCase of previousCases) {
      const previous = previousCase.create();
      const s = spacer(mode);
      s.normalize([previous, tool()]);
      assert.equal(trailing(previous), previousCase.expected, `${mode}: ${previousCase.label}→tool`);
      s.normalize([previous, tool()]);
      assert.equal(
        previous.contentContainer.children.filter(isSpacer).length,
        previousCase.expected ? 1 : Number(leading(previous)),
        `${mode}: ${previousCase.label}→tool never doubles`,
      );
    }
  }
});

test("dense cluster exits and action transitions preserve the boundary matrix", () => {
  const clusterSources = [
    { label: "Thinking", create: () => thinking(true) },
    { label: "tool", create: tool },
  ];
  const destinations = [
    { label: "tool", create: tool, expected: 0, standalone: false },
    {
      label: "prose assistant",
      create: () => ({ type: "prose-target", contentContainer: { children: [new Spacer(1), {}] } }),
      expected: 1,
      standalone: false,
    },
    { label: "user", create: user, expected: 1, standalone: true },
    { label: "custom artifact", create: () => ({ type: "custom" }), expected: 1, standalone: true },
    { label: "runtime/cache notice", create: () => ({ type: "runtime" }), expected: 1, standalone: true },
  ];

  for (const sourceCase of clusterSources) {
    for (const destination of destinations) {
      const source = sourceCase.create();
      const target = destination.create();
      const children = [source, ...(destination.standalone ? [new Spacer(1)] : []), target];
      spacer("dense").normalize(children);
      const topLevelGap = children.slice(
        children.indexOf(source) + 1,
        children.indexOf(target),
      ).filter(isSpacer).length;
      const internalGap = target.contentContainer && leading(target) ? 1 : 0;
      const gap = topLevelGap + internalGap;
      assert.equal(gap, destination.expected, `${sourceCase.label}→${destination.label}`);
      assert.ok(gap <= 1, `${sourceCase.label}→${destination.label} never doubles`);
    }
  }
});

test("dense mode keeps one cluster boundary and removes internal Thinking/tool gaps", () => {
  let mode = "dense";
  const s = spacer(() => mode);
  const first = thinking(true);
  const second = thinking(true);
  const hiddenTool = tool();
  const children = [user(), first, hiddenTool, second];

  s.normalize(children);
  assert.equal(leading(first), true, "cluster starts with one outer blank");
  assert.equal(leading(second), false, "tool→Thinking continuation has no internal blank");

  mode = "separated";
  s.normalize(children);
  assert.equal(leading(first), true);
  assert.equal(leading(second), true, "switching modes restores separated spacing");
});

test("all intra-assistant Thinking/text transitions match the spacing matrix", () => {
  const cases = [
    { from: "thinking", to: "thinking", dense: 0, separated: 1 },
    { from: "thinking", to: "text", dense: 1, separated: 1 },
    { from: "text", to: "thinking", dense: 1, separated: 1 },
    { from: "text", to: "text", dense: 0, separated: 0 },
  ];

  for (const mode of ["dense", "separated"]) {
    for (const transition of cases) {
      const from = { kind: transition.from };
      const to = { kind: transition.to };
      // Pi natively inserts a blank after Thinking when visible content follows.
      const children = [from, ...(transition.from === "thinking" ? [new Spacer(1)] : []), to];
      const component = { contentContainer: { children } };
      spacer(mode).normalizeRenderedThinkingChildren(
        component,
        (child) => child?.kind === "thinking",
      );
      const fromIndex = children.indexOf(from);
      const toIndex = children.indexOf(to);
      const gap = children.slice(fromIndex + 1, toIndex).filter(isSpacer).length;
      assert.equal(gap, transition[mode], `${mode}: ${transition.from}→${transition.to}`);
      assert.ok(gap <= 1, `${mode}: ${transition.from}→${transition.to} never doubles`);
    }
  }
});

test("dense mode compacts adjacent Thinking children but preserves text boundaries", () => {
  const s = spacer("dense");
  const firstThinking = {};
  const secondThinking = {};
  const proseChild = {};
  const thirdThinking = {};
  const component = {
    contentContainer: {
      children: [
        firstThinking,
        new Spacer(1),
        secondThinking,
        new Spacer(1),
        proseChild,
        thirdThinking,
      ],
    },
  };
  const thinkingChildren = new Set([firstThinking, secondThinking, thirdThinking]);
  s.normalizeRenderedThinkingChildren(component, (child) => thinkingChildren.has(child));

  const normalized = component.contentContainer.children;
  assert.deepEqual(
    normalized.filter((child) => !isSpacer(child)),
    [firstThinking, secondThinking, proseChild, thirdThinking],
  );
  assert.equal(normalized[0].constructor.name, "Spacer", "one blank above cluster");
  assert.equal(normalized[2], secondThinking, "no blank between adjacent Thinking blocks");
  assert.equal(normalized[3].constructor.name, "Spacer", "one blank below cluster before prose");
  assert.equal(normalized[5].constructor.name, "Spacer", "text starts a new Thinking cluster");
  assert.equal(normalized.length, 7);
});

test("thinking removes duplicate transcript spacers but keeps its internal blank", () => {
  const s = spacer();
  const first = thinking(true);
  const second = thinking(true);
  const children = [first, new Spacer(1), new Spacer(1), second];

  s.normalize(children);
  assert.deepEqual(children, [first, second], "transcript-level duplicate rows are removed");
  assert.equal(leading(first), true);
  assert.equal(leading(second), true);
  s.normalize(children);
  assert.deepEqual(children, [first, second], "re-normalizing is idempotent");
  assert.equal(second.contentContainer.children.length, 2, "internal blank never stacks");

  children.splice(1, 0, new Spacer(1)); // native replay reintroduces a boundary row
  spacer().normalize(children); // fresh /reload generation
  assert.deepEqual(children, [first, second], "fresh generation removes the duplicate again");
  assert.equal(second.contentContainer.children.length, 2, "reload still leaves exactly one blank");
});

test("spacers between entries are ignored when computing adjacency", () => {
  const s = spacer();
  const p = prose();
  s.normalize([p, new Spacer(1), tool()]);
  assert.equal(trailing(p), true, "tool after an interleaved spacer still counts");
});

// A /reload or session replacement creates a new extension generation with a
// fresh TranscriptSpacer. Its bookkeeping must survive that handoff: replayed
// components were stamped by the previous generation, and re-normalizing them
// must not duplicate separators or strand suppression state.
test("a new generation does not duplicate a separator added by a prior generation", () => {
  const p = prose();
  spacer().normalize([p, tool()]); // old generation
  assert.equal(p.contentContainer.children.length, 2);
  spacer().normalize([p, tool()]); // new generation, fresh instance
  assert.equal(
    p.contentContainer.children.length,
    2,
    "must not stack a second blank across generations",
  );
});

test("a new generation removes a separator added by a prior generation", () => {
  const p = prose();
  spacer().normalize([p, tool()]);
  assert.equal(trailing(p), true);
  spacer().normalize([p, user()]);
  assert.equal(trailing(p), false, "stale separator from prior generation must be removed");
});

test("thinking spacing survives the generation handoff without stacking", () => {
  const t = thinking(false);
  spacer().normalize([prose(), t]);
  assert.equal(leading(t), true);
  assert.equal(t.contentContainer.children.length, 2);
  spacer().normalize([user(), t]);
  assert.equal(leading(t), true);
  assert.equal(t.contentContainer.children.length, 2, "new generation must not stack a blank");
});

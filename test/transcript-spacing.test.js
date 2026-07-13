import assert from "node:assert/strict";
import { test } from "node:test";
import { Spacer } from "@earendil-works/pi-tui";

import { TranscriptSpacer } from "../src/ui/transcript-spacing.js";

const spacer = (mode = "separated") => new TranscriptSpacer({
  isThinkingOnlyComponent: (c) => c?.type === "thinking",
  startsWithThinkingComponent: (c) => c?.type === "thinking",
  endsWithThinkingComponent: (c) => c?.type === "thinking",
  isTextBearingAssistant: (c) => c?.type === "prose",
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

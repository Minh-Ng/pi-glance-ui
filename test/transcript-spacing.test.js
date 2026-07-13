import assert from "node:assert/strict";
import { test } from "node:test";
import { Spacer } from "@earendil-works/pi-tui";

import { TranscriptSpacer } from "../src/ui/transcript-spacing.js";

const spacer = () => new TranscriptSpacer({
  isThinkingOnlyComponent: (c) => c?.type === "thinking",
  isTextBearingAssistant: (c) => c?.type === "prose",
  isToolComponent: (c) => c?.constructor?.name === "ToolExecutionComponent",
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

test("thinking-only collapses its leading blank unless it opens a turn", () => {
  const s = spacer();
  // After prose (not a user boundary) -> leading blank suppressed.
  const t1 = thinking(true);
  s.normalize([prose(), t1]);
  assert.equal(leading(t1), false, "suppressed after non-user content");
  // After a user message -> leading blank preserved (restored if once removed).
  const t2 = thinking(true);
  s.normalize([prose(), t2]);
  assert.equal(leading(t2), false);
  s.normalize([user(), t2]);
  assert.equal(leading(t2), true, "restored when following a user boundary");
});

test("spacers between entries are ignored when computing adjacency", () => {
  const s = spacer();
  const p = prose();
  s.normalize([p, new Spacer(1), tool()]);
  assert.equal(trailing(p), true, "tool after an interleaved spacer still counts");
});

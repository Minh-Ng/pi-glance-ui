// Flicker-class regression: the compact render path mutates Spacer children
// (normalizeRenderedThinkingChildren / refreshThinking). If it mutates an
// already-rendered neighbor or is non-idempotent,
// a component's height changes between otherwise-identical frames and the
// transcript reflows ("flicker up top, redrawing spaces"). These tests pin the
// invariant: with unchanged state, (a) rendering the same frame twice is
// byte-identical, and (b) a rebuild pass followed by render converges to the
// same output as steady-state render. Run for both spacing modes and for the
// shapes most prone to spacer churn (consecutive Thinking, prose→tool→Thinking).

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";

import glanceUi from "../src/index.js";

const plain = (lines) => lines.map((line) => stripVTControlCharacters(line)).join("\n");

function createHarness() {
  const handlersByEvent = new Map();
  const registeredTools = [];
  const pi = {
    on(event, handler) {
      const handlers = handlersByEvent.get(event) || [];
      handlers.push(handler);
      handlersByEvent.set(event, handlers);
    },
    registerCommand() {},
    registerShortcut() {},
    registerTool(tool) { registeredTools.push(tool); },
  };
  let hiddenThinkingLabel = "Thinking hidden";
  const ui = {
    custom() { return Promise.resolve(undefined); },
    notify() {},
    requestRender() {},
    setHiddenThinkingLabel(label) { hiddenThinkingLabel = label; },
    setWidget() {},
  };
  const ctx = { cwd: process.cwd(), sessionManager: {}, ui };
  return { ctx, pi, ui, registeredTools, handlersByEvent, getHiddenThinkingLabel: () => hiddenThinkingLabel };
}

async function emitAsync(harness, event, payload = {}) {
  for (const handler of harness.handlersByEvent.get(event) || []) {
    await handler(payload, harness.ctx);
  }
}

async function setup(spacing) {
  const dir = mkdtempSync(join(tmpdir(), "flicker-"));
  const previous = process.env.PI_GLANCE_UI_CONFIG;
  process.env.PI_GLANCE_UI_CONFIG = join(dir, "glance-ui.json");
  writeFileSync(process.env.PI_GLANCE_UI_CONFIG, JSON.stringify({
    enabled: true,
    patchesVersion: "0.82.0",
    workingDetailMode: "hidden",
    transcriptSpacing: spacing,
  }));
  const harness = createHarness();
  glanceUi(harness.pi);
  const codingAgentEntryUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
  const { initTheme } = await import(new URL("./modes/interactive/theme/theme.js", codingAgentEntryUrl).href);
  initTheme("dark");
  await emitAsync(harness, "session_start");
  await emitAsync(harness, "before_agent_start");
  const [{ AssistantMessageComponent }, { ToolExecutionComponent }, { InteractiveMode }] = await Promise.all([
    import(new URL("./modes/interactive/components/assistant-message.js", codingAgentEntryUrl).href),
    import(new URL("./modes/interactive/components/tool-execution.js", codingAgentEntryUrl).href),
    import(new URL("./modes/interactive/interactive-mode.js", codingAgentEntryUrl).href),
  ]);
  const cleanup = () => {
    if (previous === undefined) delete process.env.PI_GLANCE_UI_CONFIG;
    else process.env.PI_GLANCE_UI_CONFIG = previous;
    rmSync(dir, { recursive: true, force: true });
  };
  return { harness, AssistantMessageComponent, ToolExecutionComponent, InteractiveMode, cleanup };
}

// Build the component list through the real renderSessionEntries + spacing
// normalization path, then return the components in transcript order.
function buildTranscript(env, components) {
  const { InteractiveMode } = env;
  const children = [];
  InteractiveMode.prototype.renderSessionEntries.call({
    streamingMessage: undefined,
    chatContainer: { children },
    renderSessionItems() {
      for (const component of components) children.push(component);
    },
  }, components.map(() => ({ type: "message", message: { role: "assistant", content: [] } })));
  return children;
}

const WIDTH = 120;
const renderAll = (children) => plain(children.flatMap((child) => child.render(WIDTH)));

function assertFrameStable(children, label) {
  const frame1 = renderAll(children);
  const frame2 = renderAll(children);
  const frame3 = renderAll(children);
  assert.equal(frame2, frame1, `${label}: 2nd frame must match 1st (no per-frame flicker)`);
  assert.equal(frame3, frame1, `${label}: 3rd frame must match 1st (no per-frame flicker)`);
  return frame1;
}

for (const spacing of ["dense", "separated"]) {
  test(`consecutive Thinking blocks render byte-stable across frames (${spacing})`, async () => {
    const env = await setup(spacing);
    try {
      const mk = (text) => new env.AssistantMessageComponent(
        { role: "assistant", content: [{ type: "thinking", thinking: text }], stopReason: "toolUse" },
        true, undefined, env.harness.getHiddenThinkingLabel(),
      );
      const children = buildTranscript(env, [
        mk("First thought paragraph.\n\nSecond thought paragraph."),
        mk("Third thought paragraph that keeps going for a while so it wraps across the width."),
      ]);
      assertFrameStable(children, `consecutive-thinking/${spacing}`);
    } finally {
      env.cleanup();
    }
  });

  test(`rendering Thinking never mutates preceding prose across hidden tools (${spacing})`, async () => {
    const env = await setup(spacing);
    try {
      const prose = new env.AssistantMessageComponent(
        { role: "assistant", content: [{ type: "text", text: "Here is the plan and rationale." }], stopReason: "toolUse" },
        false,
      );
      const readDef = env.harness.registeredTools.find((tool) => tool.name === "read") || {};
      const hiddenTool = new env.ToolExecutionComponent(
        "read", "tool-hidden", { path: "a.txt" }, {}, readDef, env.harness.ui, env.harness.ctx.cwd,
      );
      hiddenTool.markExecutionStarted?.();
      hiddenTool.setArgsComplete?.();
      const thinking = new env.AssistantMessageComponent(
        { role: "assistant", content: [{ type: "thinking", thinking: "Follow-up reasoning after the tool." }], stopReason: "stop" },
        true, undefined, env.harness.getHiddenThinkingLabel(),
      );
      const children = buildTranscript(env, [prose, hiddenTool, thinking]);
      const precedingChildren = [...prose.contentContainer.children];
      thinking.render(WIDTH);
      assert.deepEqual(
        prose.contentContainer.children,
        precedingChildren,
        `hidden-tool-neighbor/${spacing}: later render must not rewrite earlier prose`,
      );
      assertFrameStable(children, `hidden-tool-neighbor/${spacing}`);
    } finally {
      env.cleanup();
    }
  });

  test(`prose then tool then Thinking renders byte-stable across frames (${spacing})`, async () => {
    const env = await setup(spacing);
    try {
      const prose = new env.AssistantMessageComponent(
        { role: "assistant", content: [{ type: "text", text: "Here is the plan and rationale." }], stopReason: "toolUse" },
        false,
      );
      const readDef = env.harness.registeredTools.find((tool) => tool.name === "read") || {};
      const tool = new env.ToolExecutionComponent(
        "read", "tool-read", { path: "a.txt" }, {}, readDef, env.harness.ui, env.harness.ctx.cwd,
      );
      tool.markExecutionStarted?.();
      tool.setArgsComplete?.();
      tool.updateResult?.({ content: [{ type: "text", text: "file body" }], details: {}, isError: false });
      tool.setExpanded?.(false);
      const thinking = new env.AssistantMessageComponent(
        { role: "assistant", content: [{ type: "thinking", thinking: "Follow-up reasoning after the tool." }], stopReason: "stop" },
        true, undefined, env.harness.getHiddenThinkingLabel(),
      );
      const children = buildTranscript(env, [prose, tool, thinking]);
      assertFrameStable(children, `prose-tool-thinking/${spacing}`);
    } finally {
      env.cleanup();
    }
  });

  test(`streaming Thinking is byte-stable per token frame (${spacing})`, async () => {
    const env = await setup(spacing);
    try {
      const streamingMessage = {
        role: "assistant",
        content: [{ type: "thinking", thinking: "" }],
        stopReason: undefined,
      };
      const thinking = new env.AssistantMessageComponent(
        streamingMessage, true, undefined, env.harness.getHiddenThinkingLabel(),
      );
      thinking.setHideThinkingBlock(true);
      const children = [thinking];
      // Simulate the per-token streaming loop: updateContent then render, many
      // times. Each updateContent rebuilds children (Pi may re-add its own
      // leading spacer); the extension normalization must not oscillate it.
      const grow = (n) => "reasoning token ".repeat(n);
      const frames = [];
      for (let n = 1; n <= 12; n += 1) {
        streamingMessage.content[0].thinking = grow(n * 40);
        thinking.updateContent(streamingMessage);
        frames.push(renderAll(children));
      }
      // Once past the head cap the streamed frames must stop changing.
      const tail = frames.slice(-4);
      for (let i = 1; i < tail.length; i += 1) {
        assert.equal(tail[i], tail[0], `streaming/${spacing}: capped frames must stop changing (no flicker)`);
      }
      // Re-rendering the same streamed state must be byte-identical.
      assert.equal(renderAll(children), renderAll(children), `streaming/${spacing}: identical-state re-render must match`);
    } finally {
      env.cleanup();
    }
  });

  test(`rebuild pass then render converges to steady-state render (${spacing})`, async () => {
    const env = await setup(spacing);
    try {
      const mk = (text) => new env.AssistantMessageComponent(
        { role: "assistant", content: [{ type: "thinking", thinking: text }], stopReason: "toolUse" },
        true, undefined, env.harness.getHiddenThinkingLabel(),
      );
      const components = [
        mk("Alpha reasoning block."),
        mk("Beta reasoning block that is a little longer to force wrapping across the render width."),
      ];
      const children = buildTranscript(env, components);
      const steady = assertFrameStable(children, `rebuild-converge/${spacing}`);
      // A rebuild (renderSessionEntries) re-runs normalize on the same
      // components; the following render must not shift any spacer vs steady.
      const rebuilt = buildTranscript(env, components);
      const afterRebuild = assertFrameStable(rebuilt, `rebuild-converge-2/${spacing}`);
      assert.equal(afterRebuild, steady, `rebuild+render must converge to steady-state (${spacing})`);
    } finally {
      env.cleanup();
    }
  });
}

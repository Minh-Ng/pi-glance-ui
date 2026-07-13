import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";

import glanceUi from "../src/index.js";

function createHarness() {
  const handlersByEvent = new Map();
  const registeredTools = [];
  const ui = {
    notify() {},
    requestRender() {},
    setHiddenThinkingLabel() {},
    setWidget() {},
  };
  const pi = {
    on(event, handler) {
      const handlers = handlersByEvent.get(event) || [];
      handlers.push(handler);
      handlersByEvent.set(event, handlers);
    },
    registerCommand() {},
    registerShortcut() {},
    registerTool(tool) {
      registeredTools.push(tool);
    },
  };
  return {
    ctx: { cwd: process.cwd(), sessionManager: {}, ui },
    handlersByEvent,
    pi,
    registeredTools,
    ui,
  };
}

async function emit(harness, event) {
  for (const handler of harness.handlersByEvent.get(event) || []) {
    await handler({}, harness.ctx);
  }
}

function plain(lines) {
  return lines.map((line) => stripVTControlCharacters(line)).join("\n");
}

test("resume replay stays compact before the replacement session_start", async (t) => {
  const configDirectory = mkdtempSync(join(tmpdir(), "glance-ui-resume-"));
  const previousConfigPath = process.env.PI_GLANCE_UI_CONFIG;
  process.env.PI_GLANCE_UI_CONFIG = join(configDirectory, "glance-ui.json");
  writeFileSync(process.env.PI_GLANCE_UI_CONFIG, JSON.stringify({
    enabled: true,
    patchesVersion: "0.80.6",
  }));
  t.after(() => {
    if (previousConfigPath === undefined) delete process.env.PI_GLANCE_UI_CONFIG;
    else process.env.PI_GLANCE_UI_CONFIG = previousConfigPath;
    rmSync(configDirectory, { recursive: true, force: true });
  });

  const codingAgentEntryUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
  const assistantMessageUrl = new URL(
    "./modes/interactive/components/assistant-message.js",
    codingAgentEntryUrl,
  );
  const toolExecutionUrl = new URL(
    "./modes/interactive/components/tool-execution.js",
    codingAgentEntryUrl,
  );
  const interactiveModeUrl = new URL(
    "./modes/interactive/interactive-mode.js",
    codingAgentEntryUrl,
  );
  const themeUrl = new URL("./modes/interactive/theme/theme.js", codingAgentEntryUrl);
  const [
    { createReadToolDefinition },
    { AssistantMessageComponent },
    { ToolExecutionComponent },
    { InteractiveMode },
    { initTheme },
  ] = await Promise.all([
    import(codingAgentEntryUrl),
    import(assistantMessageUrl.href),
    import(toolExecutionUrl.href),
    import(interactiveModeUrl.href),
    import(themeUrl.href),
  ]);
  initTheme("dark");

  const initialHarness = createHarness();
  glanceUi(initialHarness.pi);
  await emit(initialHarness, "session_start");
  const sharedRuntimeSymbol = Symbol.for("pi-compact-ui.shared-runtime-state");
  assert.equal(globalThis[sharedRuntimeSymbol].patchesActive, true);

  // Pi creates the replacement extension generation before it replays the
  // selected session, but emits session_start only after that replay.
  const replacementHarness = createHarness();
  glanceUi(replacementHarness.pi);
  assert.equal(globalThis[sharedRuntimeSymbol].patchesActive, true);

  const toolCall = {
    type: "toolCall",
    id: "resumed-read",
    name: "read",
    arguments: { path: "/tmp/resumed.txt" },
  };
  const assistantMessage = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "Historical resumed reasoning" },
      toolCall,
    ],
    stopReason: "toolUse",
  };
  const toolResult = {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text: "historical file body" }],
    details: {},
    isError: false,
  };
  let assistantComponent;
  let toolComponent;
  const mode = {
    streamingMessage: undefined,
    chatContainer: { children: [] },
    renderSessionItems(items) {
      for (const item of items) {
        if (item.role === "assistant") {
          assistantComponent = new AssistantMessageComponent(item, true);
          toolComponent = new ToolExecutionComponent(
            toolCall.name,
            toolCall.id,
            toolCall.arguments,
            {},
            createReadToolDefinition(process.cwd()),
            initialHarness.ui,
            process.cwd(),
          );
          toolComponent.markExecutionStarted();
          toolComponent.setArgsComplete();
        } else if (item.role === "toolResult") {
          toolComponent.updateResult(item);
        }
      }
    },
  };

  InteractiveMode.prototype.renderSessionEntries.call(mode, [
    { type: "message", message: { role: "user", content: "inspect" } },
    { type: "message", message: assistantMessage },
    { type: "message", message: toolResult },
  ]);

  assert.match(plain(assistantComponent.render(160)), /Thinking.*Historical resumed reasoning/);
  assert.match(plain(toolComponent.render(160)), /Plan · Explored/);
  assert.doesNotMatch(plain(toolComponent.render(160)), /historical file body/);

  writeFileSync(process.env.PI_GLANCE_UI_CONFIG, JSON.stringify({ enabled: true }));
  glanceUi(createHarness().pi);
  assert.equal(
    globalThis[sharedRuntimeSymbol].patchesActive,
    false,
    "removed consent must disable inherited wrappers immediately",
  );
});

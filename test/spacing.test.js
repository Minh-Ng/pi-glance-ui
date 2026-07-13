import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";

import glanceUi from "../src/index.js";

function harness() {
  const handlers = new Map();
  return {
    pi: {
      on(event, handler) {
        const registered = handlers.get(event) || [];
        registered.push(handler);
        handlers.set(event, registered);
      },
      registerCommand() {},
      registerShortcut() {},
      registerTool() {},
    },
    handlers,
    ctx: {
      cwd: process.cwd(),
      sessionManager: {},
      ui: {
        notify() {},
        requestRender() {},
        setHiddenThinkingLabel() {},
        setWidget() {},
      },
    },
  };
}

async function emit(target, event) {
  for (const handler of target.handlers.get(event) || []) {
    await handler({}, target.ctx);
  }
}

function leadingBlankRows(component, width) {
  let count = 0;
  for (const line of component.render(width)) {
    if (stripVTControlCharacters(line).trim() !== "") break;
    count += 1;
  }
  return count;
}

test("Thinking spacing follows transcript boundaries live and after reconstruction", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-glance-ui-spacing-"));
  const previousConfig = process.env.PI_GLANCE_UI_CONFIG;
  process.env.PI_GLANCE_UI_CONFIG = join(directory, "glance-ui.json");
  t.after(() => {
    if (previousConfig === undefined) delete process.env.PI_GLANCE_UI_CONFIG;
    else process.env.PI_GLANCE_UI_CONFIG = previousConfig;
    rmSync(directory, { recursive: true, force: true });
  });

  const target = harness();
  glanceUi(target.pi);
  const codingAgentEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
  const themeUrl = new URL("./modes/interactive/theme/theme.js", codingAgentEntry);
  const assistantUrl = new URL(
    "./modes/interactive/components/assistant-message.js",
    codingAgentEntry,
  );
  const userUrl = new URL(
    "./modes/interactive/components/user-message.js",
    codingAgentEntry,
  );
  const interactiveUrl = new URL(
    "./modes/interactive/interactive-mode.js",
    codingAgentEntry,
  );
  const [
    { initTheme },
    { AssistantMessageComponent },
    { UserMessageComponent },
    { InteractiveMode },
  ] = await Promise.all([
    import(themeUrl.href),
    import(assistantUrl.href),
    import(userUrl.href),
    import(interactiveUrl.href),
  ]);
  initTheme("dark");
  await emit(target, "session_start");

  const thinkingMessage = {
    role: "assistant",
    content: [{ type: "thinking", thinking: "Spacing contract thought" }],
    stopReason: "stop",
  };
  const boundaries = [
    {
      label: "user message",
      create: () => new UserMessageComponent("Spacing boundary user"),
      blankRows: 1,
    },
    {
      label: "tool execution",
      create: () => ({ constructor: { name: "ToolExecutionComponent" } }),
      blankRows: 0,
    },
    {
      label: "assistant text",
      create: () => ({ constructor: { name: "AssistantMessageComponent" } }),
      blankRows: 0,
    },
    {
      label: "custom artifact",
      create: () => ({ constructor: { name: "CustomMessageComponent" } }),
      blankRows: 0,
    },
    {
      label: "runtime notice",
      create: () => ({ constructor: { name: "RuntimeNotice" } }),
      blankRows: 0,
    },
  ];

  for (const { label, create, blankRows } of boundaries) {
    const liveChildren = [create()];
    const liveMode = {
      isInitialized: true,
      footer: { invalidate() {} },
      hideThinkingBlock: true,
      hiddenThinkingLabel: "Thinking hidden",
      outputPad: 1,
      pendingTools: new Map(),
      getMarkdownThemeWithSettings: () => undefined,
      chatContainer: {
        children: liveChildren,
        addChild(component) {
          this.children.push(component);
        },
      },
      ui: { requestRender() {} },
    };
    await InteractiveMode.prototype.handleEvent.call(liveMode, {
      type: "message_start",
      message: thinkingMessage,
    });

    const widths = [40, 80, 160];
    const liveBlankRows = widths.map(
      (width) => leadingBlankRows(liveMode.streamingComponent, width),
    );

    const reconstructedThinking = new AssistantMessageComponent(
      thinkingMessage,
      true,
      undefined,
      "Thinking hidden",
    );
    const reconstructedChildren = [create(), reconstructedThinking];
    InteractiveMode.prototype.renderSessionEntries.call({
      chatContainer: { children: reconstructedChildren },
      renderSessionItems() {},
    }, []);

    for (const [index, width] of widths.entries()) {
      assert.equal(
        liveBlankRows[index],
        blankRows,
        `live ${label}→Thinking spacing at width ${width}`,
      );
      assert.equal(
        leadingBlankRows(reconstructedThinking, width),
        blankRows,
        `reconstructed ${label}→Thinking spacing at width ${width}`,
      );
    }
  }
});

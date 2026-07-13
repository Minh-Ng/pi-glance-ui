import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";

import glanceUi from "../src/index.js";

function harness() {
  const handlers = new Map();
  const commands = new Map();
  return {
    pi: {
      on(event, handler) {
        const registered = handlers.get(event) || [];
        registered.push(handler);
        handlers.set(event, registered);
      },
      registerCommand(name, command) { commands.set(name, command); },
      registerShortcut() {},
      registerTool() {},
    },
    handlers,
    commands,
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

test("a text-bearing message gains one blank line before a following action group, removed otherwise", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-glance-ui-sep-"));
  const previousConfig = process.env.PI_GLANCE_UI_CONFIG;
  process.env.PI_GLANCE_UI_CONFIG = join(directory, "glance-ui.json");
  t.after(() => {
    if (previousConfig === undefined) delete process.env.PI_GLANCE_UI_CONFIG;
    else process.env.PI_GLANCE_UI_CONFIG = previousConfig;
    rmSync(directory, { recursive: true, force: true });
  });
  writeFileSync(process.env.PI_GLANCE_UI_CONFIG, JSON.stringify({
    enabled: true,
    patchesVersion: "0.80.6",
    workingDetailMode: "auto",
  }));

  const target = harness();
  glanceUi(target.pi);
  const codingAgentEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
  const [{ initTheme }, { AssistantMessageComponent }, { UserMessageComponent }, { InteractiveMode }] =
    await Promise.all([
      import(new URL("./modes/interactive/theme/theme.js", codingAgentEntry).href),
      import(new URL("./modes/interactive/components/assistant-message.js", codingAgentEntry).href),
      import(new URL("./modes/interactive/components/user-message.js", codingAgentEntry).href),
      import(new URL("./modes/interactive/interactive-mode.js", codingAgentEntry).href),
    ]);
  initTheme("dark");
  await emit(target, "session_start");

  const isSpacer = (component) => component?.constructor?.name === "Spacer";
  const trailingSpacers = (component) => {
    const children = component.contentContainer?.children ?? [];
    let count = 0;
    for (let i = children.length - 1; i >= 0 && isSpacer(children[i]); i -= 1) count += 1;
    return count;
  };
  const normalize = (children) => InteractiveMode.prototype.renderSessionEntries.call(
    { chatContainer: { children }, renderSessionItems() {} },
    [],
  );

  const prose = new AssistantMessageComponent(
    { role: "assistant", content: [{ type: "text", text: "Yes\u2014intentionally." }], stopReason: "stop" },
    true,
    undefined,
    "Thinking hidden",
  );
  const toolStub = { constructor: { name: "ToolExecutionComponent" } };
  const userAfter = new UserMessageComponent("ok");

  // Followed by a tool/action group -> exactly one trailing blank line.
  normalize([prose, toolStub]);
  assert.equal(trailingSpacers(prose), 1, "one blank line before the action group");
  // Idempotent: re-normalizing must not stack another blank.
  normalize([prose, toolStub]);
  assert.equal(trailingSpacers(prose), 1, "separator must not stack on re-render");
  // Successor is no longer a tool -> separator removed (not needed).
  normalize([prose, userAfter]);
  assert.equal(trailingSpacers(prose), 0, "separator removed when no action group follows");
  // Message becomes last in the transcript -> also removed.
  normalize([prose, toolStub]);
  assert.equal(trailingSpacers(prose), 1);
  normalize([prose]);
  assert.equal(trailingSpacers(prose), 0, "separator removed when the message is last");
});

test("only thinking-only blocks collapse leading spacing; text-bearing messages match native", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-glance-ui-parity-"));
  const previousConfig = process.env.PI_GLANCE_UI_CONFIG;
  process.env.PI_GLANCE_UI_CONFIG = join(directory, "glance-ui.json");
  t.after(() => {
    if (previousConfig === undefined) delete process.env.PI_GLANCE_UI_CONFIG;
    else process.env.PI_GLANCE_UI_CONFIG = previousConfig;
    rmSync(directory, { recursive: true, force: true });
  });
  writeFileSync(process.env.PI_GLANCE_UI_CONFIG, JSON.stringify({
    enabled: true,
    patchesVersion: "0.80.6",
    workingDetailMode: "auto",
  }));

  const target = harness();
  glanceUi(target.pi);
  const codingAgentEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
  const [{ initTheme }, { AssistantMessageComponent }] = await Promise.all([
    import(new URL("./modes/interactive/theme/theme.js", codingAgentEntry).href),
    import(new URL("./modes/interactive/components/assistant-message.js", codingAgentEntry).href),
  ]);
  initTheme("dark");
  await emit(target, "session_start");

  const widths = [40, 80, 160];
  const make = (content) => new AssistantMessageComponent(
    { role: "assistant", content, stopReason: "stop" },
    true,
    undefined,
    "Thinking hidden",
  );
  const cases = {
    thinkingOnly: () => make([{ type: "thinking", thinking: "t" }]),
    thinkingPlusText: () => make([
      { type: "thinking", thinking: "t" },
      { type: "text", text: "All 22 tests pass, diagnostics clean." },
    ]),
    textOnly: () => make([{ type: "text", text: "All 22 tests pass." }]),
  };

  const measure = (components) => Object.fromEntries(
    Object.entries(components).map(([name, component]) => [
      name,
      widths.map((width) => leadingBlankRows(component, width)),
    ]),
  );

  const glanceComponents = Object.fromEntries(
    Object.entries(cases).map(([name, factory]) => [name, factory()]),
  );
  const glanceRows = measure(glanceComponents);

  // Toggle glance off in-process to capture the true native baseline; the
  // render path re-runs updateContent when the enabled state changes.
  const command = target.commands.get("glance-ui").handler;
  const nativeComponents = Object.fromEntries(
    Object.entries(cases).map(([name, factory]) => [name, factory()]),
  );
  await command("off", target.ctx);
  const nativeRows = measure(nativeComponents);
  // Restore shared runtime state so later tests still see glance enabled.
  await command("on", target.ctx);

  // Text-bearing messages must be spaced exactly like native Pi.
  assert.deepEqual(glanceRows.thinkingPlusText, nativeRows.thinkingPlusText,
    "thinking+text must match native leading spacing");
  assert.deepEqual(glanceRows.textOnly, nativeRows.textOnly,
    "text-only must match native leading spacing");
  // The only intentional divergence: thinking-only blocks collapse their blank.
  assert.ok(
    glanceRows.thinkingOnly.every((n, i) => n <= nativeRows.thinkingOnly[i]),
    "thinking-only must not add blank rows vs native",
  );
  assert.ok(
    glanceRows.thinkingOnly.some((n, i) => n < nativeRows.thinkingOnly[i]),
    "thinking-only should collapse at least one native blank row",
  );
});

test("live: prose→action separator lands in the same frame the tool row streams in", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-glance-ui-flicker-"));
  const previousConfig = process.env.PI_GLANCE_UI_CONFIG;
  process.env.PI_GLANCE_UI_CONFIG = join(directory, "glance-ui.json");
  t.after(() => {
    if (previousConfig === undefined) delete process.env.PI_GLANCE_UI_CONFIG;
    else process.env.PI_GLANCE_UI_CONFIG = previousConfig;
    rmSync(directory, { recursive: true, force: true });
  });
  writeFileSync(process.env.PI_GLANCE_UI_CONFIG, JSON.stringify({
    enabled: true,
    patchesVersion: "0.80.6",
    workingDetailMode: "auto",
  }));

  const target = harness();
  glanceUi(target.pi);
  const codingAgentEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
  const [{ initTheme }, { AssistantMessageComponent }, { InteractiveMode }] = await Promise.all([
    import(new URL("./modes/interactive/theme/theme.js", codingAgentEntry).href),
    import(new URL("./modes/interactive/components/assistant-message.js", codingAgentEntry).href),
    import(new URL("./modes/interactive/interactive-mode.js", codingAgentEntry).href),
  ]);
  initTheme("dark");
  await emit(target, "session_start");

  const isSpacer = (component) => component?.constructor?.name === "Spacer";
  const hasTrailingSpacer = (component) => {
    const children = component.contentContainer?.children ?? [];
    return children.length > 0 && isSpacer(children[children.length - 1]);
  };

  const prose = new AssistantMessageComponent(
    { role: "assistant", content: [{ type: "text", text: "Let me verify." }], stopReason: "stop" },
    true,
    undefined,
    "Thinking hidden",
  );
  // Simulates the ToolExecutionComponent Pi appends mid-stream.
  const toolRow = { constructor: { name: "ToolExecutionComponent" }, updateArgs() {}, setExpanded() {} };
  const children = [prose, toolRow];
  const liveMode = {
    isInitialized: true,
    footer: { invalidate() {} },
    streamingComponent: prose,
    streamingMessage: undefined,
    pendingTools: new Map([["t1", toolRow]]),
    chatContainer: { children, addChild(component) { this.children.push(component); } },
    ui: { requestRender() {} },
  };

  // Before the toolCall streams in there is no separator (nothing to separate).
  assert.equal(hasTrailingSpacer(prose), false, "no separator before the tool row exists");

  // The frame the toolCall arrives is a `message_update`, not a `message_start`.
  // The fix must normalize here so the blank line is present immediately.
  await InteractiveMode.prototype.handleEvent.call(liveMode, {
    type: "message_update",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Let me verify." },
        { type: "toolCall", id: "t1", name: "bash", arguments: {} },
      ],
    },
  });

  assert.equal(
    hasTrailingSpacer(prose),
    true,
    "separator must appear on the same message_update frame the tool row streams in",
  );
});

test("Thinking spacing follows transcript boundaries live and after reconstruction", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-glance-ui-spacing-"));
  const previousConfig = process.env.PI_GLANCE_UI_CONFIG;
  process.env.PI_GLANCE_UI_CONFIG = join(directory, "glance-ui.json");
  t.after(() => {
    if (previousConfig === undefined) delete process.env.PI_GLANCE_UI_CONFIG;
    else process.env.PI_GLANCE_UI_CONFIG = previousConfig;
    rmSync(directory, { recursive: true, force: true });
  });

  writeFileSync(process.env.PI_GLANCE_UI_CONFIG, JSON.stringify({
    patchesVersion: "0.80.6",
  }));
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

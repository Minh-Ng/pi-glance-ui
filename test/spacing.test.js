import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { Spacer } from "@earendil-works/pi-tui";

import glanceUi from "../src/index.js";
import { removeBlankOnlyToolRows } from "../src/patches/tools.js";

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

function trailingBlankRows(component, width) {
  let count = 0;
  for (const line of component.render(width).toReversed()) {
    if (stripVTControlCharacters(line).trim() !== "") break;
    count += 1;
  }
  return count;
}

test("blank-only hidden tool renders cannot add transcript spacing", () => {
  assert.deepEqual(removeBlankOnlyToolRows(["", "   ", "\u2800"]), []);
  const visible = ["", "Tool output", ""];
  assert.strictEqual(removeBlankOnlyToolRows(visible), visible);
});

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
    patchesVersion: "0.80.10",
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

  const proseBeforeHiddenTool = new AssistantMessageComponent(
    { role: "assistant", content: [{ type: "text", text: "Before hidden work." }], stopReason: "stop" },
    true,
    undefined,
    "Thinking hidden",
  );
  const hiddenTool = {
    constructor: { name: "ToolExecutionComponent" },
    [Symbol.for("pi-glance-ui:tool-has-visible-rows")]: false,
  };
  const proseAfterHiddenTool = new AssistantMessageComponent(
    { role: "assistant", content: [{ type: "text", text: "After hidden work." }], stopReason: "stop" },
    true,
    undefined,
    "Thinking hidden",
  );
  normalize([proseBeforeHiddenTool, hiddenTool, proseAfterHiddenTool]);
  assert.equal(trailingSpacers(proseBeforeHiddenTool), 1, "pre-render action boundary is reserved");
  proseAfterHiddenTool.render(80);
  assert.equal(trailingSpacers(proseBeforeHiddenTool), 0, "blank-only tool releases the extra boundary");
  assert.equal(
    trailingBlankRows(proseBeforeHiddenTool, 80) + leadingBlankRows(proseAfterHiddenTool, 80),
    1,
    "hidden work between prose blocks renders exactly one blank",
  );
});

test("compact assistant rendering preserves native text-bearing spacing", async (t) => {
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
    patchesVersion: "0.80.10",
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

  const mixedMessage = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "Thought before prose" },
      { type: "text", text: "Visible prose boundary" },
      { type: "thinking", thinking: "Thought after prose" },
    ],
    stopReason: "stop",
  };
  const mixed = new AssistantMessageComponent(
    mixedMessage,
    true,
    undefined,
    "Thinking hidden",
  );
  mixed.setHideThinkingBlock(false);
  const assertMixedSpacing = () => {
    const children = mixed.contentContainer.children;
    const thinkingIndexes = children
      .map((child, index) => child?.defaultTextStyle?.italic === true ? index : -1)
      .filter((index) => index >= 0);
    assert.equal(thinkingIndexes.length, 2);
    for (const index of thinkingIndexes) {
      assert.equal(
        children[index - 1]?.constructor?.name,
        "Spacer",
        "every rendered Thinking child has a blank before it",
      );
      assert.notEqual(
        children[index - 2]?.constructor?.name,
        "Spacer",
        "rendered Thinking never has two blanks before it",
      );
    }
  };
  assertMixedSpacing();
  mixed.updateContent(mixedMessage);
  assertMixedSpacing();

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
  // Before chat-level transcript normalization, compact Thinking rendering may
  // use fewer rows than native. The boundary test below enforces exactly one
  // visible blank once the component is attached to the transcript.
  assert.ok(
    glanceRows.thinkingOnly.every((n, i) => n <= nativeRows.thinkingOnly[i]),
    "thinking-only must not add blank rows vs native",
  );
  assert.ok(
    glanceRows.thinkingOnly.some((n, i) => n < nativeRows.thinkingOnly[i]),
    "compact Thinking should use fewer rows before transcript normalization",
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
    patchesVersion: "0.80.10",
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

test("Thinking keeps exactly one blank across transcript boundaries live and after reconstruction", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-glance-ui-spacing-"));
  const previousConfig = process.env.PI_GLANCE_UI_CONFIG;
  process.env.PI_GLANCE_UI_CONFIG = join(directory, "glance-ui.json");
  t.after(() => {
    if (previousConfig === undefined) delete process.env.PI_GLANCE_UI_CONFIG;
    else process.env.PI_GLANCE_UI_CONFIG = previousConfig;
    rmSync(directory, { recursive: true, force: true });
  });

  writeFileSync(process.env.PI_GLANCE_UI_CONFIG, JSON.stringify({
    patchesVersion: "0.80.10",
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
      denseBlankRows: 1,
    },
    {
      label: "visible tool execution",
      create: () => ({
        constructor: { name: "ToolExecutionComponent" },
        render: () => ["tool"],
      }),
      blankRows: 1,
      denseBlankRows: 0,
    },
    {
      label: "hidden tool execution",
      create: () => ({
        constructor: { name: "ToolExecutionComponent" },
        render: () => [],
      }),
      blankRows: 1,
      denseBlankRows: 1,
    },
    {
      label: "assistant text",
      create: () => ({ constructor: { name: "AssistantMessageComponent" } }),
      blankRows: 1,
      denseBlankRows: 1,
    },
    {
      label: "custom artifact",
      create: () => ({ constructor: { name: "CustomMessageComponent" } }),
      blankRows: 1,
      denseBlankRows: 1,
    },
    {
      label: "runtime notice",
      create: () => ({ constructor: { name: "RuntimeNotice" } }),
      blankRows: 1,
      denseBlankRows: 1,
    },
    {
      label: "cache notice text",
      create: () => ({ constructor: { name: "Text" } }),
      blankRows: 1,
      denseBlankRows: 1,
    },
  ];

  for (const { label, create, blankRows } of boundaries) {
    for (const hideThinkingBlock of [true, false]) {
      const visibility = hideThinkingBlock ? "hidden" : "shown";
      const liveChildren = [create()];
      const liveMode = {
        isInitialized: true,
        footer: { invalidate() {} },
        hideThinkingBlock,
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
        hideThinkingBlock,
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
          `live ${visibility} ${label}→Thinking spacing at width ${width}`,
        );
        assert.equal(
          leadingBlankRows(reconstructedThinking, width),
          blankRows,
          `reconstructed ${visibility} ${label}→Thinking spacing at width ${width}`,
        );
      }
    }
  }

  // Real session pattern: Thinking+toolCall, compact/hidden tool component,
  // then the next Thinking continuation. Standalone transcript spacers around
  // the zero-row tool must not combine with the latter component's own blank.
  const mixedEndingThinkingMessage = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "Thought before visible prose" },
      { type: "text", text: "Visible prose inside the assistant continuation" },
      { type: "thinking", thinking: "Final thought before the tool call" },
      { type: "toolCall", id: "mixed-boundary-tool", name: "TaskCreate", arguments: {} },
    ],
    stopReason: "toolUse",
  };
  const firstThinking = new AssistantMessageComponent(
    mixedEndingThinkingMessage,
    true,
    undefined,
    "Thinking hidden",
  );
  const secondThinking = new AssistantMessageComponent(
    thinkingMessage,
    true,
    undefined,
    "Thinking hidden",
  );
  const hiddenTool = { constructor: { name: "ToolExecutionComponent" } };
  const replayChildren = [firstThinking, hiddenTool, secondThinking];
  InteractiveMode.prototype.renderSessionEntries.call({
    chatContainer: { children: replayChildren },
    renderSessionItems() {},
  }, []);
  firstThinking.setHideThinkingBlock(false);
  assert.deepEqual(replayChildren, [firstThinking, hiddenTool, secondThinking]);
  assert.notEqual(
    firstThinking.contentContainer.children.at(-1)?.constructor?.name,
    "Spacer",
    "earlier prose must not add a trailing blank when the message ends in Thinking",
  );
  assert.equal(leadingBlankRows(secondThinking, 80), 1);

  await target.commands.get("glance-ui").handler(
    "settings transcript-spacing dense",
    target.ctx,
  );
  assert.equal(leadingBlankRows(firstThinking, 80), 1, "dense cluster keeps its outer blank");
  assert.equal(leadingBlankRows(secondThinking, 80), 0, "dense tool→Thinking continuation is contiguous");
  for (const { label, create, denseBlankRows } of boundaries) {
    for (const hideThinkingBlock of [true, false]) {
      const denseThinking = new AssistantMessageComponent(
        thinkingMessage,
        hideThinkingBlock,
        undefined,
        "Thinking hidden",
      );
      const denseChildren = [create(), denseThinking];
      InteractiveMode.prototype.renderSessionEntries.call({
        chatContainer: { children: denseChildren },
        renderSessionItems() {},
      }, []);
      assert.equal(
        leadingBlankRows(denseThinking, 80),
        denseBlankRows,
        `dense replay ${hideThinkingBlock ? "hidden" : "shown"}: ${label}→Thinking`,
      );
    }
  }
  assert.equal(
    JSON.parse(readFileSync(process.env.PI_GLANCE_UI_CONFIG, "utf8")).transcriptSpacing,
    "dense",
  );

  // Actual streaming order starts with an empty assistant message; Thinking
  // arrives on a later update. This must still honor the user→cluster boundary.
  const streamingChildren = [new UserMessageComponent("Live dense boundary")];
  const streamingMode = {
    isInitialized: true,
    footer: { invalidate() {} },
    hideThinkingBlock: true,
    hiddenThinkingLabel: "Thinking hidden",
    outputPad: 1,
    pendingTools: new Map(),
    getMarkdownThemeWithSettings: () => undefined,
    chatContainer: {
      children: streamingChildren,
      addChild(component) { this.children.push(component); },
    },
    ui: { requestRender() {} },
  };
  await InteractiveMode.prototype.handleEvent.call(streamingMode, {
    type: "message_start",
    message: { role: "assistant", content: [], stopReason: "stop" },
  });
  await InteractiveMode.prototype.handleEvent.call(streamingMode, {
    type: "message_update",
    message: thinkingMessage,
  });
  assert.equal(
    leadingBlankRows(streamingMode.streamingComponent, 80),
    1,
    "dense live user→Thinking stream keeps one outer blank",
  );

  // Persisted sessions can place tool-only assistant/components between the
  // user and the first visible Thinking. Hidden tools must remain transparent.
  const toolOnlyMessage = {
    role: "assistant",
    content: [{ type: "toolCall", id: "hidden-tool", name: "TaskList", arguments: {} }],
    stopReason: "toolUse",
  };
  const toolOnlyAssistant = new AssistantMessageComponent(
    toolOnlyMessage,
    true,
    undefined,
    "Thinking hidden",
  );
  const hiddenReplayTool = {
    constructor: { name: "ToolExecutionComponent" },
    render: () => [],
  };
  const afterHiddenTools = new AssistantMessageComponent(
    thinkingMessage,
    true,
    undefined,
    "Thinking hidden",
  );
  const hiddenReplayChildren = [
    new UserMessageComponent("Persisted dense boundary"),
    toolOnlyAssistant,
    hiddenReplayTool,
    afterHiddenTools,
  ];
  InteractiveMode.prototype.renderSessionEntries.call({
    chatContainer: { children: hiddenReplayChildren },
    renderSessionItems() {},
  }, []);
  assert.equal(
    leadingBlankRows(afterHiddenTools, 80),
    1,
    "dense replay user→hidden tools→Thinking keeps one outer blank",
  );

  const finalProseWithTool = new AssistantMessageComponent(
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Assistant output before hidden actions.\n\nA second prose paragraph before Thinking.",
        },
        { type: "toolCall", id: "prose-tool", name: "TaskUpdate", arguments: {} },
      ],
      stopReason: "toolUse",
    },
    true,
    undefined,
    "Thinking hidden",
  );
  const afterProseTools = new AssistantMessageComponent(
    thinkingMessage,
    true,
    undefined,
    "Thinking hidden",
  );
  const proseReplayChildren = [
    finalProseWithTool,
    {
      constructor: { name: "ToolExecutionComponent" },
      render: () => removeBlankOnlyToolRows(["", "\u2800"]),
    },
    toolOnlyAssistant,
    hiddenReplayTool,
    afterProseTools,
  ];
  InteractiveMode.prototype.renderSessionEntries.call({
    chatContainer: { children: proseReplayChildren },
    renderSessionItems() {},
  }, []);
  assert.equal(
    finalProseWithTool.contentContainer.children.at(-1)?.constructor?.name,
    "Spacer",
    "final assistant prose supplies one outer cluster blank",
  );
  assert.equal(
    leadingBlankRows(afterProseTools, 80),
    1,
    "assistant prose→hidden tools→Thinking keeps one boundary on Thinking",
  );
  const intermediateBlankRows = proseReplayChildren.slice(1, -1)
    .flatMap((component) => component.render?.(80) ?? [])
    .filter((line) => stripVTControlCharacters(line).trim() === "")
    .length;
  assert.equal(
    trailingBlankRows(finalProseWithTool, 80)
      + intermediateBlankRows
      + leadingBlankRows(afterProseTools, 80),
    1,
    "multi-paragraph prose→hidden tools→Thinking has one total rendered blank",
  );

  const hiddenThinkingChildren = [new UserMessageComponent("Hidden Thinking boundary")];
  InteractiveMode.prototype.renderSessionEntries.call({
    chatContainer: { children: hiddenThinkingChildren },
    renderSessionItems(items) {
      for (const item of items) {
        if (item.role !== "assistant") continue;
        hiddenThinkingChildren.push(new AssistantMessageComponent(
          item,
          true,
          undefined,
          "Thinking hidden",
        ));
      }
    },
  }, [
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "Older fully hidden thought" }],
        stopReason: "stop",
      },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "Latest visible compact thought" }],
        stopReason: "stop",
      },
    },
  ]);
  const hiddenHistoricalThinking = hiddenThinkingChildren[1];
  const visibleCurrentThinking = hiddenThinkingChildren[2];
  assert.equal(
    hiddenHistoricalThinking.contentContainer.children.length,
    0,
    "fully hidden Thinking owns no spacer rows",
  );
  assert.equal(
    leadingBlankRows(visibleCurrentThinking, 80),
    1,
    "hidden Thinking remains transparent to the preceding user boundary",
  );

  // Ctrl+T clears and rebuilds historical chat, then Pi re-adds the retained
  // streaming component. The final normalization must run after that re-add so
  // shown Thinking cannot combine native transcript and component spacers.
  let rebuiltThinking;
  const toggleChildren = [];
  const streamingThinking = new AssistantMessageComponent(
    thinkingMessage,
    true,
    undefined,
    "Thinking hidden",
  );
  const toggleMode = {
    hideThinkingBlock: true,
    settingsManager: { setHideThinkingBlock() {} },
    chatContainer: {
      children: toggleChildren,
      clear() { this.children.length = 0; },
      addChild(component) { this.children.push(component); },
    },
    rebuildChatFromMessages() {
      rebuiltThinking = new AssistantMessageComponent(
        thinkingMessage,
        this.hideThinkingBlock,
        undefined,
        "Thinking hidden",
      );
      this.chatContainer.addChild(new UserMessageComponent("Ctrl+T replay boundary"));
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(rebuiltThinking);
    },
    streamingComponent: streamingThinking,
    streamingMessage: thinkingMessage,
    showStatus() {},
  };
  InteractiveMode.prototype.toggleThinkingBlockVisibility.call(toggleMode);
  assert.equal(toggleMode.hideThinkingBlock, false);
  assert.equal(
    toggleChildren.filter((child) => child instanceof Spacer).length
      + leadingBlankRows(rebuiltThinking, 80),
    1,
    "Ctrl+T shown replay has one outer blank rather than two",
  );
  assert.equal(
    leadingBlankRows(streamingThinking, 80),
    0,
    "re-added streaming Thinking remains inside the dense cluster",
  );

  await target.commands.get("glance-ui").handler(
    "settings transcript-spacing separated",
    target.ctx,
  );
  assert.equal(leadingBlankRows(secondThinking, 80), 1, "separated mode restores the blank after a visible tool");
  assert.equal(
    leadingBlankRows(afterProseTools, 80),
    1,
    "separated mode moves the single boundary onto Thinking after hidden tools",
  );
  assert.equal(
    trailingBlankRows(finalProseWithTool, 80)
      + intermediateBlankRows
      + leadingBlankRows(afterProseTools, 80),
    1,
    "separated multi-paragraph prose→hidden tools→Thinking has one total blank",
  );
});

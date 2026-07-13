import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";

import glanceUi, {
  loadGlanceUiConfig,
  saveGlanceUiConfig,
} from "../src/index.js";

function createExtensionHarness() {
  const handlersByEvent = new Map();
  const notifications = [];
  const registeredCommands = new Map();
  const registeredShortcuts = new Map();
  const registeredTools = [];
  let customComponent;
  let customOptions;
  let hiddenThinkingLabel;
  const widgetOperations = [];
  let renderRequests = 0;
  const pi = {
    on(event, handler) {
      const handlers = handlersByEvent.get(event) || [];
      handlers.push(handler);
      handlersByEvent.set(event, handlers);
    },
    registerCommand(name, command) {
      registeredCommands.set(name, command);
    },
    registerShortcut(shortcut, command) {
      registeredShortcuts.set(shortcut, command);
    },
    registerTool(tool) {
      registeredTools.push(tool);
    },
  };
  const ui = {
    custom(factory, options) {
      customOptions = options;
      const tui = { requestRender() {} };
      const theme = {
        bold: (text) => text,
        fg: (_color, text) => text,
      };
      customComponent = factory(tui, theme, {}, () => {});
      return Promise.resolve(undefined);
    },
    notify(message, level) {
      notifications.push({ message, level });
    },
    requestRender() {
      renderRequests += 1;
    },
    setHiddenThinkingLabel(label) {
      hiddenThinkingLabel = label;
    },
    setWidget(key, content) {
      widgetOperations.push({ key, content });
    },
  };
  const ctx = { cwd: process.cwd(), sessionManager: {}, ui };
  return {
    ctx,
    getCustomComponent: () => customComponent,
    getCustomOptions: () => customOptions,
    getHiddenThinkingLabel: () => hiddenThinkingLabel,
    getRenderRequests: () => renderRequests,
    handlersByEvent,
    notifications,
    pi,
    registeredCommands,
    registeredShortcuts,
    registeredTools,
    ui,
    widgetOperations,
  };
}

async function emitAsync(harness, event, payload = {}) {
  for (const handler of harness.handlersByEvent.get(event) || []) {
    await handler(payload, harness.ctx);
  }
}

async function startTool(harness, toolCallId, toolName, args = {}) {
  await emitAsync(harness, "tool_execution_start", {
    toolCallId,
    toolName,
    args,
  });
}

function plain(lines) {
  return lines.map((line) => stripVTControlCharacters(line)).join("\n");
}

test("glance-ui config persists valid settings and tolerates malformed data", () => {
  const directory = mkdtempSync(join(tmpdir(), "glance-ui-config-"));
  const path = join(directory, "nested", "glance-ui.json");
  try {
    saveGlanceUiConfig({
      enabled: false,
      patchesVersion: "0.80.6",
      workingDetailMode: "hidden",
    }, path);
    assert.deepEqual(loadGlanceUiConfig(path), {
      enabled: false,
      patchesVersion: "0.80.6",
      workingDetailMode: "hidden",
    });
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
      enabled: false,
      patchesVersion: "0.80.6",
      workingDetailMode: "hidden",
    });

    writeFileSync(path, "not json");
    assert.deepEqual(loadGlanceUiConfig(path), {});

    writeFileSync(path, JSON.stringify({
      enabled: "no",
      patchesVersion: " ",
      workingDetailMode: "invalid",
    }));
    assert.deepEqual(loadGlanceUiConfig(path), {});
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("collapsed tools show the last ten actions and thinking uses a compact label", async (t) => {
  const configDirectory = mkdtempSync(join(tmpdir(), "glance-ui-integration-"));
  const previousConfigPath = process.env.PI_GLANCE_UI_CONFIG;
  process.env.PI_GLANCE_UI_CONFIG = join(configDirectory, "glance-ui.json");
  t.after(() => {
    if (previousConfigPath === undefined) delete process.env.PI_GLANCE_UI_CONFIG;
    else process.env.PI_GLANCE_UI_CONFIG = previousConfigPath;
    rmSync(configDirectory, { recursive: true, force: true });
  });
  writeFileSync(process.env.PI_GLANCE_UI_CONFIG, JSON.stringify({
    patchesVersion: "0.80.6",
  }));
  const harness = createExtensionHarness();
  glanceUi(harness.pi);

  const codingAgentEntryUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
  const themeUrl = new URL(
    "./modes/interactive/theme/theme.js",
    codingAgentEntryUrl,
  );
  const { initTheme } = await import(themeUrl.href);
  initTheme("dark");

  await emitAsync(harness, "session_start");
  await emitAsync(harness, "before_agent_start");

  assert.equal(
    harness.getHiddenThinkingLabel(),
    "Thinking hidden · Ctrl+T to show",
  );
  assert.equal(harness.registeredTools.length, 7);
  assert.deepEqual(harness.notifications, []);
  assert.deepEqual(harness.widgetOperations, [
    { key: "compact-ui-activity", content: undefined },
    { key: "glance-ui-activity", content: undefined },
  ]);
  assert.deepEqual(JSON.parse(readFileSync(process.env.PI_GLANCE_UI_CONFIG, "utf8")), {
    enabled: true,
    patchesVersion: "0.80.6",
    workingDetailMode: "auto",
  });
  await harness.registeredCommands.get("glance-ui").handler("settings", harness.ctx);
  assert.deepEqual(harness.notifications.at(-1), {
    message: [
      "Glance UI settings",
      "enabled: on (on|off) — compact tool rendering is active",
      "patches: on for Pi 0.80.6 (on|off) — optional native transcript layout patches",
      "working-detail: auto (auto|compact|expanded|hidden) — only the bottom-most running tool stays compact",
      "Change: /glance-ui settings <name> <value>",
      "Sections: /sections or Ctrl+Shift+O",
    ].join("\n"),
    level: "info",
  });

  const toolExecutionUrl = new URL(
    "./modes/interactive/components/tool-execution.js",
    codingAgentEntryUrl,
  );
  const assistantMessageUrl = new URL(
    "./modes/interactive/components/assistant-message.js",
    codingAgentEntryUrl,
  );
  const customMessageUrl = new URL(
    "./modes/interactive/components/custom-message.js",
    codingAgentEntryUrl,
  );
  const userMessageUrl = new URL(
    "./modes/interactive/components/user-message.js",
    codingAgentEntryUrl,
  );
  const footerUrl = new URL(
    "./modes/interactive/components/footer.js",
    codingAgentEntryUrl,
  );
  const interactiveModeUrl = new URL(
    "./modes/interactive/interactive-mode.js",
    codingAgentEntryUrl,
  );
  const [
    { ToolExecutionComponent },
    { AssistantMessageComponent },
    { CustomMessageComponent },
    { UserMessageComponent },
    { FooterComponent },
    { InteractiveMode },
  ] = await Promise.all([
    import(toolExecutionUrl.href),
    import(assistantMessageUrl.href),
    import(customMessageUrl.href),
    import(userMessageUrl.href),
    import(footerUrl.href),
    import(interactiveModeUrl.href),
  ]);

  const markdownAssistant = new AssistantMessageComponent({
    role: "assistant",
    content: [{
      type: "text",
      text: "### Rendered heading\n\nBody with **bold text** and `inline code`.",
    }],
    stopReason: "stop",
  }, false);
  const compactUserMessage = new UserMessageComponent("Existing user message");
  assert.equal(compactUserMessage.render(100).length, 1);

  const renderedMarkdown = plain(markdownAssistant.render(100));
  assert.match(renderedMarkdown, /Rendered heading/);
  assert.match(renderedMarkdown, /Body with bold text and inline code\./);
  assert.doesNotMatch(renderedMarkdown, /###|\*\*|`inline code`/);

  const copySafeCode = new AssistantMessageComponent({
    role: "assistant",
    content: [{
      type: "text",
      text: "```text\nfirst line\nsecond line\n```",
    }],
    stopReason: "stop",
  }, false);
  const copiedCode = plain(copySafeCode.render(100)).trim();
  assert.deepEqual(copiedCode.split("\n").map((line) => line.trim()), [
    "first line",
    "second line",
  ]);
  assert.doesNotMatch(copiedCode, /[│›]/);

  const nestedCodeQuote = new AssistantMessageComponent({
    role: "assistant",
    content: [{
      type: "text",
      text: "> Quoted code:\n>\n> ```text\n> nested code\n> ```\n\nAfter quote.",
    }],
    stopReason: "stop",
  }, false);
  const renderedNestedCodeQuote = plain(nestedCodeQuote.render(100));
  assert.match(renderedNestedCodeQuote, /│ nested code/);
  assert.match(
    renderedNestedCodeQuote,
    /nested code[^\n]*\n\s*\n After quote\./,
  );

  const footerSession = {
    state: {
      model: { id: "test-model", contextWindow: 128_000, reasoning: false },
      thinkingLevel: "off",
    },
    sessionManager: {
      getCwd: () => "/tmp/project",
      getEntries: () => [],
      getSessionName: () => undefined,
    },
    modelRegistry: { isUsingOAuth: () => false },
    getContextUsage: () => ({ contextWindow: 128_000, percent: 10, tokens: 12_800 }),
  };
  const footerData = {
    getAvailableProviderCount: () => 1,
    getExtensionStatuses: () => new Map([["context-window", "epoch_win 1/20t"]]),
    getGitBranch: () => "main",
  };
  const footer = new FooterComponent(footerSession, footerData);
  const nativeFooterLines = FooterComponent.prototype[
    Symbol.for("pi-compact-ui.footer-base-render")
  ].call(footer, 78);
  const compactFooterLines = footer.render(80);
  assert.deepEqual(
    compactFooterLines,
    nativeFooterLines.map((line) => ` ${line}`),
  );
  assert.ok(compactFooterLines.every((line) => plain([line]).startsWith(" ")));
  assert.equal(plain([compactFooterLines[1]]).length, 79);

  for (let index = 0; index < 12; index += 1) {
    await startTool(harness, `tool-${index}`, "custom_action", {
      value: `action-${index}`,
    });
  }
  const components = Array.from({ length: 12 }, (_, index) => {
    const component = new ToolExecutionComponent(
      "custom_action",
      `tool-${index}`,
      { value: `action-${index}` },
      {},
      undefined,
      harness.ui,
      harness.ctx.cwd,
    );
    component.markExecutionStarted();
    component.setArgsComplete();
    component.updateResult({
      content: [{ type: "text", text: `result-${index}` }],
      details: {},
      isError: false,
    });
    return component;
  });

  for (const component of components) component.render(200);
  const collapsed = plain(components.flatMap((component) => component.render(200)));
  assert.match(collapsed, /Interacted · last 10 of 12/);
  assert.doesNotMatch(collapsed, /Recent actions/);
  assert.doesNotMatch(collapsed, /"action-(?:0|1)"/);
  assert.match(collapsed, /"action-2"/);
  assert.match(collapsed, /"action-11"/);
  assert.equal(collapsed.match(/Custom Action/g)?.length, 10);

  for (const component of components) component.setExpanded(true);
  const expanded = plain(components.flatMap((component) => component.render(200)));
  assert.match(expanded, /action-0/);
  assert.match(expanded, /action-11/);

  await emitAsync(harness, "before_agent_start");
  const categorizedTools = [
    ["inspect_file", "inspect"],
    ["update_file", "update"],
  ];
  for (const [index, [toolName, value]] of categorizedTools.entries()) {
    await startTool(harness, `tool-category-${index}`, toolName, { value });
  }
  const categoryComponents = categorizedTools.map(([toolName, value], index) => {
    const component = new ToolExecutionComponent(
      toolName,
      `tool-category-${index}`,
      { value },
      {},
      undefined,
      harness.ui,
      harness.ctx.cwd,
    );
    component.markExecutionStarted();
    component.setArgsComplete();
    component.updateResult({
      content: [{ type: "text", text: value }],
      details: {},
      isError: false,
    });
    component.render(200);
    return component;
  });

  const bashDefinition = harness.registeredTools.find((tool) => tool.name === "bash");
  assert.ok(bashDefinition);
  await startTool(harness, "tool-bash", "bash", {
    command: "printf glance-ui-test",
  });
  const bashComponent = new ToolExecutionComponent(
    "bash",
    "tool-bash",
    { command: "printf glance-ui-test" },
    {},
    bashDefinition,
    harness.ui,
    harness.ctx.cwd,
  );
  bashComponent.markExecutionStarted();
  bashComponent.setArgsComplete();
  bashComponent.updateResult({
    content: [{ type: "text", text: "glance-ui-test" }],
    details: {},
    isError: false,
  });
  bashComponent.render(200);
  const categorizedLines = [
    ...categoryComponents.flatMap((component) => component.render(200)),
    ...bashComponent.render(200),
  ];
  assert.equal(stripVTControlCharacters(categorizedLines[0]), "\u2800");
  assert.equal(
    categorizedLines.slice(1).some((line) => stripVTControlCharacters(line) === ""),
    false,
  );
  const categorizedActions = plain(categorizedLines);
  assert.match(categorizedActions, /▸ Plan · Explored · 3/);
  assert.match(categorizedActions, /Implement · Changed/);
  assert.match(categorizedActions, /Act · Ran/);
  assert.match(categorizedActions, /Bash printf glance-ui-test/);
  bashComponent.setExpanded(true);
  const nativeExpandedBashLines = ToolExecutionComponent.prototype[
    Symbol.for("pi-compact-ui.tool-execution-base-render")
  ].call(bashComponent, 200);
  const compactExpandedBashLines = bashComponent.render(200);
  const expandedBash = plain(compactExpandedBashLines);
  assert.match(expandedBash, /printf glance-ui-test/);
  assert.match(expandedBash, /glance-ui-test/);
  assert.match(expandedBash, /▾ Ran/);
  assert.deepEqual(
    compactExpandedBashLines.slice(-nativeExpandedBashLines.length),
    nativeExpandedBashLines,
  );

  bashComponent.setExpanded(false);

  await emitAsync(harness, "before_agent_start", { prompt: "Verify Glance UI" });
  await startTool(harness, "tool-verify", "bash", { command: "npm test" });
  const verifyComponent = new ToolExecutionComponent(
    "bash",
    "tool-verify",
    { command: "npm test" },
    {},
    bashDefinition,
    harness.ui,
    harness.ctx.cwd,
  );
  verifyComponent.markExecutionStarted();
  verifyComponent.setArgsComplete();
  verifyComponent.updateResult({
    content: [{ type: "text", text: "tests passed" }],
    details: {},
    isError: false,
  });
  assert.match(plain(verifyComponent.render(200)), /Verify · Ran/);

  await emitAsync(harness, "before_agent_start");
  await startTool(harness, "working-auto", "bash", { command: "printf working-auto" });
  const workingAuto = new ToolExecutionComponent(
    "bash",
    "working-auto",
    { command: "printf working-auto" },
    {},
    bashDefinition,
    harness.ui,
    harness.ctx.cwd,
  );
  workingAuto.markExecutionStarted();
  workingAuto.setArgsComplete();
  workingAuto.setExpanded(true);
  const compactWorking = plain(workingAuto.render(200));
  assert.match(compactWorking, /▸ Act · Ran/);
  assert.match(compactWorking, /Bash printf working-auto/);
  assert.doesNotMatch(compactWorking, /\$ printf working-auto/);
  workingAuto.updateResult({
    content: [{ type: "text", text: "working-auto complete" }],
    details: {},
    isError: false,
  });
  const completedWorking = plain(workingAuto.render(200));
  assert.match(completedWorking, /\$ printf working-auto/);
  assert.match(completedWorking, /working-auto complete/);

  await startTool(harness, "working-earlier", "bash", {
    command: "printf working-earlier",
  });
  const workingEarlier = new ToolExecutionComponent(
    "bash",
    "working-earlier",
    { command: "printf working-earlier" },
    {},
    bashDefinition,
    harness.ui,
    harness.ctx.cwd,
  );
  workingEarlier.markExecutionStarted();
  workingEarlier.setArgsComplete();
  workingEarlier.setExpanded(true);
  await startTool(harness, "working-bottom", "bash", {
    command: "printf working-bottom",
  });
  const workingBottom = new ToolExecutionComponent(
    "bash",
    "working-bottom",
    { command: "printf working-bottom" },
    {},
    bashDefinition,
    harness.ui,
    harness.ctx.cwd,
  );
  workingBottom.markExecutionStarted();
  workingBottom.setArgsComplete();
  workingBottom.setExpanded(true);
  assert.match(plain(workingEarlier.render(200)), /\$ printf working-earlier/);
  assert.doesNotMatch(plain(workingBottom.render(200)), /\$ printf working-bottom/);
  workingBottom.updateResult({
    content: [{ type: "text", text: "working-bottom complete" }],
    details: {},
    isError: false,
  });
  assert.doesNotMatch(plain(workingEarlier.render(200)), /\$ printf working-earlier/);
  await harness.registeredCommands.get("sections").handler("", harness.ctx);
  const workingSection = harness.getCustomComponent().sections.find(
    (section) => section.kind === "tools" && section.label === "Act · Ran · 3 actions",
  );
  assert.equal(workingSection.isExpanded(), false);
  workingSection.toggle();
  assert.equal(workingSection.isExpanded(), true);
  assert.match(plain(workingBottom.render(200)), /\$ printf working-bottom/);
  workingSection.toggle();
  await harness.registeredCommands.get("glance-ui").handler("off", harness.ctx);
  workingEarlier.setExpanded(true);
  assert.match(plain(workingEarlier.render(200)), /\$ printf working-earlier/);
  await harness.registeredCommands.get("glance-ui").handler("on", harness.ctx);
  await harness.registeredCommands.get("sections").handler("", harness.ctx);
  const priorWorkingSectionIds = new Set(
    harness.getCustomComponent().sections.map((section) => section.id),
  );

  await emitAsync(harness, "before_agent_start");
  await harness.registeredCommands.get("glance-ui").handler(
    "working-detail expanded",
    harness.ctx,
  );
  await startTool(harness, "working-expanded", "bash", {
    command: "printf working-expanded",
  });
  const workingExpanded = new ToolExecutionComponent(
    "bash",
    "working-expanded",
    { command: "printf working-expanded" },
    {},
    bashDefinition,
    harness.ui,
    harness.ctx.cwd,
  );
  workingExpanded.markExecutionStarted();
  workingExpanded.setArgsComplete();
  workingExpanded.setExpanded(true);
  assert.match(plain(workingExpanded.render(200)), /\$ printf working-expanded/);
  await harness.registeredCommands.get("glance-ui").handler(
    "working-detail compact",
    harness.ctx,
  );
  assert.doesNotMatch(plain(workingExpanded.render(200)), /\$ printf working-expanded/);
  workingExpanded.updateResult({
    content: [{ type: "text", text: "working-expanded complete" }],
    details: {},
    isError: false,
  });
  assert.doesNotMatch(plain(workingExpanded.render(200)), /\$ printf working-expanded/);
  await harness.registeredCommands.get("sections").handler("", harness.ctx);
  const compactWorkingSection = harness.getCustomComponent().sections.find(
    (section) => section.kind === "tools" && !priorWorkingSectionIds.has(section.id),
  );
  assert.equal(compactWorkingSection.isExpanded(), false);
  compactWorkingSection.toggle();
  assert.match(plain(workingExpanded.render(200)), /\$ printf working-expanded/);
  compactWorkingSection.toggle();
  await harness.registeredCommands.get("glance-ui").handler(
    "working-detail hidden",
    harness.ctx,
  );
  assert.equal(
    JSON.parse(readFileSync(process.env.PI_GLANCE_UI_CONFIG, "utf8")).workingDetailMode,
    "hidden",
  );
  assert.deepEqual(harness.notifications.at(-1), {
    message: "Glance UI working-detail: hidden · running tools appear when they finish · saved",
    level: "info",
  });
  await startTool(harness, "working-hidden", "bash", { command: "printf working-hidden" });
  const workingHidden = new ToolExecutionComponent(
    "bash",
    "working-hidden",
    { command: "printf working-hidden" },
    {},
    bashDefinition,
    harness.ui,
    harness.ctx.cwd,
  );
  workingHidden.markExecutionStarted();
  workingHidden.setArgsComplete();
  assert.deepEqual(workingHidden.render(200), []);
  workingHidden.updateResult({
    content: [{ type: "text", text: "working-hidden complete" }],
    details: {},
    isError: false,
  });
  assert.match(plain(workingHidden.render(200)), /Bash printf working-hidden/);
  await harness.registeredCommands.get("glance-ui").handler(
    "working-detail auto",
    harness.ctx,
  );
  workingExpanded.setExpanded(true);
  assert.match(plain(workingExpanded.render(200)), /\$ printf working-expanded/);
  await harness.registeredCommands.get("glance-ui").handler(
    "working-detail auto extra",
    harness.ctx,
  );
  assert.deepEqual(harness.notifications.at(-1), {
    message: "Usage: /glance-ui settings working-detail auto|compact|expanded|hidden",
    level: "warning",
  });
  await harness.registeredCommands.get("glance-ui").handler("settings enabled maybe", harness.ctx);
  assert.deepEqual(harness.notifications.at(-1), {
    message: "Usage: /glance-ui settings enabled on|off",
    level: "warning",
  });
  await harness.registeredCommands.get("glance-ui").handler("typo", harness.ctx);
  assert.deepEqual(harness.notifications.at(-1), {
    message: "Unknown setting. Use /glance-ui settings to list valid names and values.",
    level: "warning",
  });

  const writableConfigPath = process.env.PI_GLANCE_UI_CONFIG;
  process.env.PI_GLANCE_UI_CONFIG = configDirectory;
  await harness.registeredCommands.get("glance-ui").handler("settings enabled off", harness.ctx);
  assert.match(harness.notifications.at(-2).message, /^Could not persist Glance UI settings:/);
  assert.deepEqual(harness.notifications.at(-1), {
    message: "Glance UI enabled: off · native Pi rendering active · session only",
    level: "warning",
  });
  process.env.PI_GLANCE_UI_CONFIG = writableConfigPath;
  await harness.registeredCommands.get("glance-ui").handler("settings enabled on", harness.ctx);

  bashComponent.rendererState.compactStartedAt = 1_000;
  bashComponent.rendererState.compactEndedAt = 2_200;
  const originalBashDefinition = bashDefinition[
    Symbol.for("pi-compact-ui.original-tool-definition")
  ];
  const nativeDisabledBash = new ToolExecutionComponent(
    "bash",
    "native-disabled-bash",
    { command: "printf glance-ui-test" },
    {},
    originalBashDefinition,
    harness.ui,
    harness.ctx.cwd,
  );
  nativeDisabledBash.markExecutionStarted();
  nativeDisabledBash.setArgsComplete();
  nativeDisabledBash.updateResult({
    content: [{ type: "text", text: "glance-ui-test" }],
    details: {},
    isError: false,
  });
  nativeDisabledBash.rendererState.startedAt = 1_000;
  nativeDisabledBash.rendererState.endedAt = 2_200;
  nativeDisabledBash.updateDisplay();
  await harness.registeredCommands.get("glance-ui").handler("off", harness.ctx);
  const nativeDisabledBashLines = ToolExecutionComponent.prototype[
    Symbol.for("pi-compact-ui.tool-execution-base-render")
  ].call(nativeDisabledBash, 200);
  const firstDisabledBashLines = bashComponent.render(200);
  assert.deepEqual(firstDisabledBashLines, nativeDisabledBashLines);
  assert.match(plain(firstDisabledBashLines), /Took 1\.2s/);
  assert.deepEqual(bashComponent.render(200), firstDisabledBashLines);
  await harness.registeredCommands.get("glance-ui").handler("on", harness.ctx);

  await emitAsync(harness, "before_agent_start");
  const barrierToolComponents = [];
  let barrierArtifact;
  for (const [index, toolCallId] of ["barrier-before", "barrier-after", "barrier-after-two"].entries()) {
    if (index === 1) {
      const artifactMessage = {
        role: "custom",
        customType: "web-search-content-ready",
        content: "Content fetched for 5/5 URLs [fetch-test]. Full page content now available.",
        display: true,
      };
      const artifact = new CustomMessageComponent(artifactMessage);
      barrierArtifact = artifact;
      const artifactLines = artifact.render(200);
      assert.match(plain(artifactLines), /◆ ▸ Web content ready/);
      assert.match(plain(artifactLines), /5\/5 URLs · fetch-test/);
      assert.doesNotMatch(plain(artifactLines), /\[web-search-content-ready\]/);
      artifact.setExpanded(true);
      const expandedArtifact = plain(artifact.render(200));
      assert.match(expandedArtifact, /◆ ▾ Web content ready/);
      assert.match(expandedArtifact, /│ Content fetched for 5\/5 URLs/);
      artifact.setExpanded(false);
      artifact.invalidate();
    }
    await emitAsync(harness, "tool_execution_start", {
      toolCallId,
      toolName: "inspect_file",
      args: { value: toolCallId },
    });
    const component = new ToolExecutionComponent(
      "inspect_file",
      toolCallId,
      { value: toolCallId },
      {},
      undefined,
      harness.ui,
      harness.ctx.cwd,
    );
    component.markExecutionStarted();
    component.setArgsComplete();
    component.updateResult({
      content: [{ type: "text", text: "complete" }],
      details: {},
      isError: false,
    });
    component.render(200);
    barrierToolComponents.push(component);
  }
  const barrierActions = plain(
    barrierToolComponents.flatMap((component) => component.render(200)),
  );
  assert.equal(barrierActions.match(/Explored/g)?.length, 2);

  await emitAsync(harness, "before_agent_start");
  await startTool(harness, "tool-completed-explore", "inspect_file", {
    value: "completed",
  });
  const completedExplore = new ToolExecutionComponent(
    "inspect_file",
    "tool-completed-explore",
    { value: "completed" },
    {},
    undefined,
    harness.ui,
    harness.ctx.cwd,
  );
  completedExplore.markExecutionStarted();
  completedExplore.setArgsComplete();
  completedExplore.updateResult({
    content: [{ type: "text", text: "completed" }],
    details: {},
    isError: false,
  });
  completedExplore.render(200);

  const initiatingThinking = new AssistantMessageComponent({
    role: "assistant",
    content: [
      { type: "thinking", thinking: "Inspecting the next file" },
      {
        type: "toolCall",
        id: "tool-running-explore",
        name: "inspect_file",
        arguments: {},
      },
    ],
    stopReason: "toolUse",
  }, true);
  assert.match(
    stripVTControlCharacters(initiatingThinking.render(200).at(-1)),
    /Inspecting the next file/,
  );

  await startTool(harness, "tool-running-explore", "inspect_file", {
    value: "running",
  });
  const runningExplore = new ToolExecutionComponent(
    "inspect_file",
    "tool-running-explore",
    { value: "running" },
    {},
    undefined,
    harness.ui,
    harness.ctx.cwd,
  );
  runningExplore.markExecutionStarted();
  runningExplore.setArgsComplete();
  const detachedRunningLines = runningExplore.render(200);
  assert.match(plain(detachedRunningLines), /Explored/);

  runningExplore.updateResult({
    content: [{ type: "text", text: "complete" }],
    details: {},
    isError: false,
  });
  const detachedCompletedLines = runningExplore.render(200);
  assert.match(plain(detachedCompletedLines), /Explored/);

  new AssistantMessageComponent({
    role: "assistant",
    content: [{ type: "thinking", thinking: "Continuing after inspection" }],
    stopReason: "stop",
  }, true);
  const mergedCompletedLines = runningExplore.render(200);
  assert.doesNotMatch(plain(mergedCompletedLines), /Explored/);

  await emitAsync(harness, "before_agent_start");
  const toolOnlyMessage = {
    role: "assistant",
    content: [{ type: "toolCall", id: "first-tool", name: "task_get", arguments: {} }],
    stopReason: "toolUse",
  };
  const firstToolOnlyLines = new AssistantMessageComponent(
    toolOnlyMessage,
    true,
  ).render(200);
  assert.deepEqual(firstToolOnlyLines, []);

  await startTool(harness, "first-tool", "task_get");
  const firstToolAfterUser = new ToolExecutionComponent(
    "task_get",
    "first-tool",
    {},
    {},
    undefined,
    harness.ui,
    harness.ctx.cwd,
  );
  firstToolAfterUser.markExecutionStarted();
  firstToolAfterUser.setArgsComplete();
  firstToolAfterUser.updateResult({
    content: [{ type: "text", text: "complete" }],
    details: {},
    isError: false,
  });
  const firstToolActionLines = firstToolAfterUser.render(200);
  assert.equal(stripVTControlCharacters(firstToolActionLines[0]), "\u2800");

  const laterToolOnlyLines = new AssistantMessageComponent({
    ...toolOnlyMessage,
    content: [{ type: "toolCall", id: "later-tool", name: "task_update", arguments: {} }],
  }, true).render(200);
  assert.deepEqual(laterToolOnlyLines, []);

  const message = {
    role: "assistant",
    content: [
      {
        type: "thinking",
        thinking: "Preparing to inspect\n\n<!-- -->\n\nwith correct path handling",
      },
      { type: "toolCall", id: "thinking-tool", name: "read", arguments: {} },
    ],
    stopReason: "toolUse",
  };
  const visibleThinkingComponent = new AssistantMessageComponent(message, false);
  const visibleThinkingLines = visibleThinkingComponent.render(200);
  const visibleThinking = plain(visibleThinkingLines);
  assert.deepEqual(
    visibleThinking.split("\n").map((line) => line.trim()).filter(Boolean),
    ["○ ▸ Thinking", "├ Preparing to inspect", "└ with correct path handling"],
  );
  assert.doesNotMatch(visibleThinking, /<!-- -->/);
  const alignedThinkingLine = stripVTControlCharacters(
    visibleThinkingLines.find((line) => line.includes("Thinking")),
  );
  const alignedToolLine = stripVTControlCharacters(
    categorizedLines.find((line) => line.includes("Act · Ran")),
  );
  assert.equal(alignedThinkingLine.indexOf("○"), alignedToolLine.indexOf("●"));
  assert.equal(
    alignedThinkingLine.indexOf("Thinking"),
    alignedToolLine.indexOf("Act"),
  );
  assert.match(stripVTControlCharacters(visibleThinkingLines.at(-1)), /with correct path handling/);

  const firstCollapsedThinking = new AssistantMessageComponent({
    ...message,
    content: [{ type: "thinking", thinking: "First thought block" }],
  }, true, undefined, harness.getHiddenThinkingLabel());
  const latestCollapsedThinking = new AssistantMessageComponent({
    ...message,
    content: [
      { type: "thinking", thinking: "Older thought block with complete recorded prose" },
      { type: "thinking", thinking: "**Latest thought block**" },
    ],
  }, true, undefined, harness.getHiddenThinkingLabel());

  assert.doesNotMatch(plain(firstCollapsedThinking.render(200)), /First thought block/);
  const collapsedThinking = plain(latestCollapsedThinking.render(200));
  assert.doesNotMatch(collapsedThinking, /Older thought block/);
  assert.match(collapsedThinking, /○ ▸ Thinking: Latest thought block/);
  assert.doesNotMatch(latestCollapsedThinking.render(200).join("\n"), /\x1b\[1mLatest thought block/);

  firstCollapsedThinking.setHideThinkingBlock(false);
  latestCollapsedThinking.setHideThinkingBlock(false);
  assert.match(plain(firstCollapsedThinking.render(200)), /Thinking: First thought block/);
  const expandedThinking = plain(latestCollapsedThinking.render(200));
  assert.match(expandedThinking, /▸ Thinking: Older thought block with complete recorded prose/);
  assert.match(expandedThinking, /▸ Thinking: Latest thought block/);

  firstCollapsedThinking.setHideThinkingBlock(true);
  latestCollapsedThinking.setHideThinkingBlock(true);
  assert.doesNotMatch(plain(firstCollapsedThinking.render(200)), /First thought block/);
  const reCollapsedThinking = plain(latestCollapsedThinking.render(200));
  assert.doesNotMatch(reCollapsedThinking, /Older thought block/);
  assert.match(reCollapsedThinking, /○ ▸ Thinking: Latest thought block/);

  // Assistant messages participate in Pi's actual global Ctrl+O expansion path.
  const globalExpansionMode = {
    toolOutputExpanded: false,
    loadedResourcesContainer: { children: [] },
    chatContainer: { children: [firstCollapsedThinking, latestCollapsedThinking] },
    ui: { requestRender() {} },
  };
  InteractiveMode.prototype.setToolsExpanded.call(globalExpansionMode, true);
  assert.match(plain(firstCollapsedThinking.render(200)), /First thought block/);
  assert.match(
    plain(latestCollapsedThinking.render(200)),
    /Older thought block with complete recorded prose/,
  );
  InteractiveMode.prototype.setToolsExpanded.call(globalExpansionMode, false);
  assert.doesNotMatch(plain(firstCollapsedThinking.render(200)), /First thought block/);
  assert.doesNotMatch(plain(latestCollapsedThinking.render(200)), /Older thought block/);

  const assistantErrorComponent = new AssistantMessageComponent({
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: "WebSocket error",
  }, true);
  const assistantError = plain(assistantErrorComponent.render(200));
  assert.match(assistantError, /× ▾ Error · WebSocket/);
  assert.match(assistantError, /└ WebSocket error/);
  assert.doesNotMatch(assistantError, /Error: WebSocket error/);

  const abortedAssistant = plain(new AssistantMessageComponent({
    role: "assistant",
    content: [],
    stopReason: "aborted",
    errorMessage: "Request was aborted",
  }, true).render(200));
  assert.match(abortedAssistant, /× ▾ Error · Cancelled/);
  assert.match(abortedAssistant, /Operation aborted/);

  const lengthLimitedAssistant = plain(new AssistantMessageComponent({
    role: "assistant",
    content: [{ type: "toolCall", id: "incomplete-tool", name: "read", arguments: {} }],
    stopReason: "length",
  }, true).render(200));
  assert.match(lengthLimitedAssistant, /× ▾ Error · Output limit/);
  assert.equal(lengthLimitedAssistant.match(/maximum output token limit/g)?.length, 1);

  await emitAsync(harness, "before_agent_start");
  await startTool(harness, "failed-tool", "inspect_file", {
    value: "broken",
  });
  const failedTool = new ToolExecutionComponent(
    "inspect_file",
    "failed-tool",
    { value: "failure" },
    {},
    undefined,
    harness.ui,
    harness.ctx.cwd,
  );
  failedTool.markExecutionStarted();
  failedTool.setArgsComplete();
  failedTool.updateResult({
    content: [{ type: "text", text: "Error: unable to inspect file" }],
    details: {},
    isError: true,
  });
  const failedToolOutput = plain(failedTool.render(200));
  assert.match(failedToolOutput, /▸ Plan · Explored/);
  assert.match(failedToolOutput, /failed/);
  assert.match(failedToolOutput, /Error: unable to inspect file/);
  failedTool.setExpanded(true);
  assert.match(plain(failedTool.render(200)), /▾ Explored/);

  const runtimeChildren = [];
  const runtimeMode = {
    chatContainer: { addChild: (child) => runtimeChildren.push(child) },
    ui: { requestRender() {} },
  };
  InteractiveMode.prototype.showError.call(runtimeMode, "WebSocket error");
  const runtimeError = plain(
    runtimeChildren.flatMap((component) => component.render(200)),
  );
  assert.match(runtimeError, /× ▾ Error · WebSocket/);
  assert.match(runtimeError, /└ WebSocket error/);

  const warningChildren = [];
  InteractiveMode.prototype.showWarning.call({
    chatContainer: { addChild: (child) => warningChildren.push(child) },
    ui: { requestRender() {} },
  }, "Model metadata may be stale");
  const runtimeWarning = plain(
    warningChildren.flatMap((component) => component.render(200)),
  );
  assert.match(runtimeWarning, /! ▾ Warning · Attention/);
  assert.match(runtimeWarning, /└ Model metadata may be stale/);

  assert.ok(harness.registeredShortcuts.has("ctrl+shift+o"));
  await harness.registeredCommands.get("sections").handler("", harness.ctx);
  const sectionNavigator = harness.getCustomComponent();
  assert.equal(harness.getCustomOptions().overlay, true);
  assert.match(plain(sectionNavigator.render(120)), /Sections/);

  const failedToolSectionIndex = sectionNavigator.sections.findIndex(
    (section) => section.label === "Plan · Explored · 1 action" && section.isExpanded(),
  );
  assert.notEqual(failedToolSectionIndex, -1);
  sectionNavigator.selectedIndex = failedToolSectionIndex;
  sectionNavigator.handleInput("\r");
  assert.match(plain(failedTool.render(200)), /▸ Plan · Explored/);

  const artifactSectionIndex = sectionNavigator.sections.findIndex(
    (section) => section.label === "Web content ready",
  );
  assert.notEqual(artifactSectionIndex, -1);
  sectionNavigator.selectedIndex = artifactSectionIndex;
  sectionNavigator.handleInput("\r");
  assert.match(plain(barrierArtifact.render(200)), /◆ ▾ Web content ready/);

  const errorSectionIndex = sectionNavigator.sections.findIndex(
    (section) => section.id.startsWith("error:") && section.label === "Error · WebSocket",
  );
  assert.notEqual(errorSectionIndex, -1);
  sectionNavigator.selectedIndex = errorSectionIndex;
  sectionNavigator.handleInput("\r");
  const collapsedError = plain(assistantErrorComponent.render(200));
  assert.match(collapsedError, /× ▸ Error · WebSocket/);
  assert.doesNotMatch(collapsedError, /└ WebSocket error/);

  const runtimeErrorSectionIndex = sectionNavigator.sections.findIndex(
    (section) => section.id.startsWith("runtime-error:")
      && section.label === "Error · WebSocket",
  );
  assert.notEqual(runtimeErrorSectionIndex, -1);
  sectionNavigator.selectedIndex = runtimeErrorSectionIndex;
  sectionNavigator.handleInput("\r");
  const collapsedRuntimeError = plain(
    runtimeChildren.flatMap((component) => component.render(200)),
  );
  assert.match(collapsedRuntimeError, /× ▸ Error · WebSocket/);
  assert.doesNotMatch(collapsedRuntimeError, /└ WebSocket error/);

  const firstThinkingSectionIndex = sectionNavigator.sections.findIndex(
    (section) => section.label.includes("First thought block"),
  );
  assert.notEqual(firstThinkingSectionIndex, -1);
  sectionNavigator.selectedIndex = firstThinkingSectionIndex;

  firstCollapsedThinking.setHideThinkingBlock(false);
  sectionNavigator.handleInput("\r");
  assert.doesNotMatch(plain(firstCollapsedThinking.render(200)), /First thought block/);
  firstCollapsedThinking.setHideThinkingBlock(false);
  assert.match(plain(firstCollapsedThinking.render(200)), /First thought block/);

  firstCollapsedThinking.setHideThinkingBlock(true);
  sectionNavigator.handleInput("\r");
  assert.match(plain(firstCollapsedThinking.render(200)), /First thought block/);
  firstCollapsedThinking.setHideThinkingBlock(true);
  assert.doesNotMatch(plain(firstCollapsedThinking.render(200)), /First thought block/);

  const streamingThinkingMessage = {
    role: "assistant",
    content: [{ type: "thinking", thinking: "Current streaming thought" }],
    stopReason: "stop",
  };
  const streamingThinking = new AssistantMessageComponent(
    streamingThinkingMessage,
    true,
    undefined,
    harness.getHiddenThinkingLabel(),
  );
  let rebuiltHistoricalThinking;
  const historicalThinkingMessage = {
    role: "assistant",
    content: [{ type: "thinking", thinking: "Rebuilt historical thought" }],
    stopReason: "stop",
  };
  const rebuildMode = {
    streamingMessage: streamingThinkingMessage,
    renderSessionItems() {
      rebuiltHistoricalThinking = new AssistantMessageComponent(
        historicalThinkingMessage,
        true,
        undefined,
        harness.getHiddenThinkingLabel(),
      );
    },
  };
  InteractiveMode.prototype.renderSessionEntries.call(rebuildMode, [
    { type: "message", message: historicalThinkingMessage },
  ]);
  streamingThinking.setHideThinkingBlock(true);
  streamingThinking.updateContent(streamingThinkingMessage);
  assert.doesNotMatch(
    plain(rebuiltHistoricalThinking.render(200)),
    /Rebuilt historical thought/,
  );
  assert.match(plain(streamingThinking.render(200)), /Current streaming thought/);

  await harness.registeredCommands.get("sections").handler("", harness.ctx);
  const rebuiltSectionNavigator = harness.getCustomComponent();
  const rebuiltSectionLabels = rebuiltSectionNavigator.sections.map(
    (section) => section.label,
  );
  assert.equal(
    rebuiltSectionLabels.filter((label) => label.includes("Current streaming thought")).length,
    1,
  );
  assert.equal(
    rebuiltSectionLabels.filter((label) => label.includes("Rebuilt historical thought")).length,
    1,
  );
  assert.equal(
    rebuiltSectionLabels.some((label) => label.includes("First thought block")),
    false,
  );

  const consecutiveThinkingChildren = [];
  const consecutiveThinkingEntries = [
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "First consecutive thought" },
          { type: "toolCall", id: "first-consecutive-tool", name: "read", arguments: {} },
        ],
        stopReason: "toolUse",
      },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Second consecutive thought" },
          { type: "toolCall", id: "second-consecutive-tool", name: "read", arguments: {} },
        ],
        stopReason: "toolUse",
      },
    },
  ];
  InteractiveMode.prototype.renderSessionEntries.call({
    chatContainer: { children: consecutiveThinkingChildren },
    renderSessionItems(items) {
      for (const item of items) {
        if (item.role !== "assistant") continue;
        consecutiveThinkingChildren.push(new AssistantMessageComponent(
          item,
          true,
          undefined,
          harness.getHiddenThinkingLabel(),
        ));
      }
    },
  }, consecutiveThinkingEntries);
  consecutiveThinkingChildren[0].setHideThinkingBlock(false);
  consecutiveThinkingChildren[1].setHideThinkingBlock(false);
  const firstConsecutiveThinkingLines = consecutiveThinkingChildren[0].render(200);
  const secondConsecutiveThinkingLines = consecutiveThinkingChildren[1].render(200);
  assert.equal(stripVTControlCharacters(firstConsecutiveThinkingLines[0]), "");
  assert.match(
    stripVTControlCharacters(firstConsecutiveThinkingLines.at(-1)),
    /First consecutive thought/,
  );
  assert.notEqual(stripVTControlCharacters(secondConsecutiveThinkingLines[0]), "");
  assert.match(plain(secondConsecutiveThinkingLines).trimStart(), /^○ ▸ Thinking/);
  assert.match(
    stripVTControlCharacters(secondConsecutiveThinkingLines.at(-1)),
    /Second consecutive thought/,
  );

  consecutiveThinkingChildren[0].updateContent({
    role: "assistant",
    content: [{ type: "text", text: "A non-thinking boundary" }],
    stopReason: "stop",
  });
  assert.equal(
    stripVTControlCharacters(consecutiveThinkingChildren[0].render(200)[0]),
    "",
  );
  assert.notEqual(
    stripVTControlCharacters(consecutiveThinkingChildren[1].render(200)[0]),
    "",
  );
  consecutiveThinkingChildren[0].updateContent(consecutiveThinkingEntries[0].message);
  const restoredConsecutiveThinkingLines = consecutiveThinkingChildren[1].render(200);
  assert.notEqual(stripVTControlCharacters(restoredConsecutiveThinkingLines[0]), "");
  assert.match(plain(restoredConsecutiveThinkingLines).trimStart(), /^○ ▸ Thinking/);

  const rebuiltToolComponents = [];
  const rebuiltEntries = [
    {
      type: "message",
      message: { role: "user", content: "historical actions" },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{
          type: "toolCall",
          id: "rebuilt-historical",
          name: "bash",
          arguments: { command: "printf historical" },
        }],
        stopReason: "toolUse",
      },
    },
    {
      type: "message",
      message: { role: "user", content: "rebuild actions" },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{
          type: "toolCall",
          id: "rebuilt-before-artifact",
          name: "inspect_file",
          arguments: { value: "before" },
        }],
        stopReason: "toolUse",
      },
    },
    {
      type: "custom_message",
      customType: "web-search-content-ready",
      content: "Content fetched for 1/1 URLs [rebuilt-fetch]. Full page content now available.",
      display: true,
      timestamp: new Date().toISOString(),
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "rebuilt-after-artifact",
            name: "inspect_file",
            arguments: { value: "after" },
          },
          {
            type: "toolCall",
            id: "rebuilt-after-artifact-two",
            name: "inspect_file",
            arguments: { value: "after-two" },
          },
        ],
        stopReason: "toolUse",
      },
    },
  ];
  const toolRebuildMode = {
    renderSessionItems(items) {
      for (const item of items) {
        if (item.role === "custom") {
          new CustomMessageComponent(item);
          continue;
        }
        if (item.role !== "assistant") continue;
        for (const toolCall of item.content) {
          const definition = harness.registeredTools.find(
            (tool) => tool.name === toolCall.name,
          );
          const component = new ToolExecutionComponent(
            toolCall.name,
            toolCall.id,
            toolCall.arguments,
            {},
            definition,
            harness.ui,
            harness.ctx.cwd,
          );
          component.markExecutionStarted();
          component.setArgsComplete();
          if (toolCall.id !== "historical-tool") {
            component.updateResult({
              content: [{ type: "text", text: "complete" }],
              details: {},
              isError: false,
            });
          }
          rebuiltToolComponents.push(component);
        }
      }
    },
  };
  InteractiveMode.prototype.renderSessionEntries.call(toolRebuildMode, rebuiltEntries);
  const rebuiltHistoricalActions = plain(
    rebuiltToolComponents.slice(0, 2).flatMap((component) => component.render(200)),
  );
  const rebuiltPreCustomExplore = plain(rebuiltToolComponents[1].render(200));
  const rebuiltPostCustomExplore = plain(
    rebuiltToolComponents.slice(2).flatMap((component) => component.render(200)),
  );
  const rebuiltActions = rebuiltPostCustomExplore;
  assert.match(rebuiltHistoricalActions, /historical/);
  assert.match(rebuiltHistoricalActions, /before/);
  assert.match(rebuiltHistoricalActions, /Ran/);
  for (const component of rebuiltToolComponents) component.setExpanded(true);
  const rebuiltExpandedActions = plain(
    rebuiltToolComponents.flatMap((component) => component.render(200)),
  );
  assert.equal(rebuiltExpandedActions.match(/complete/g)?.length, 4);
  assert.match(rebuiltExpandedActions, /\$ printf historical/);
  for (const component of rebuiltToolComponents) component.setExpanded(false);
  assert.equal(rebuiltPreCustomExplore.match(/Explored/g)?.length, 1);
  assert.match(rebuiltPreCustomExplore, /▸ Plan · Explored · 1/);
  assert.equal(rebuiltPostCustomExplore.match(/Explored/g)?.length, 1);
  assert.match(rebuiltPostCustomExplore, /▸ Plan · Explored · 2/);
  assert.equal(
    `${rebuiltPreCustomExplore}\n${rebuiltPostCustomExplore}`.match(/Explored/g)?.length,
    2,
  );
  assert.doesNotMatch(rebuiltActions, /last 10 of 3/);

  await harness.registeredCommands.get("sections").handler("", harness.ctx);
  const rebuiltToolSections = harness.getCustomComponent().sections;
  assert.equal(
    rebuiltToolSections.filter((section) => section.kind === "tools").length,
    3,
  );
  assert.deepEqual(
    rebuiltToolSections
      .filter((section) => section.kind === "tools" && section.label.includes("Explored"))
      .map((section) => section.label)
      .sort(),
    ["Plan · Explored · 1 action", "Plan · Explored · 2 actions"],
  );
  assert.equal(
    rebuiltToolSections.some((section) => section.label.includes("Current streaming thought")),
    false,
  );

  await harness.registeredCommands.get("glance-ui").handler(
    "working-detail compact",
    harness.ctx,
  );
  const renderRequestsBeforeDisable = harness.getRenderRequests();
  await harness.registeredCommands.get("glance-ui").handler("settings enabled off", harness.ctx);
  assert.equal(harness.getRenderRequests(), renderRequestsBeforeDisable + 1);
  assert.deepEqual(harness.notifications.at(-1), {
    message: "Glance UI enabled: off · native Pi rendering active · saved",
    level: "info",
  });
  assert.equal(compactUserMessage.render(100).length, 3);
  assert.notEqual(plain(copySafeCode.render(100)).trim(), copiedCode);
  assert.deepEqual(
    footer.render(80),
    FooterComponent.prototype[Symbol.for("pi-compact-ui.footer-base-render")].call(footer, 80),
  );
  const nativeAssistantError = plain(assistantErrorComponent.render(200));
  assert.match(nativeAssistantError, /Error: WebSocket error/);
  assert.doesNotMatch(nativeAssistantError, /× [▾▸] Error/);
  assert.doesNotMatch(plain(firstCollapsedThinking.render(200)), /○ [▾▸] Thinking/);
  assert.match(plain(barrierArtifact.render(200)), /\[web-search-content-ready\]/);
  assert.match(
    plain(runtimeChildren.flatMap((component) => component.render(200))),
    /Error: WebSocket error/,
  );
  await harness.registeredCommands.get("sections").handler("", harness.ctx);
  assert.deepEqual(harness.notifications.at(-1), {
    message: "No collapsible sections yet",
    level: "info",
  });
  assert.deepEqual(JSON.parse(readFileSync(process.env.PI_GLANCE_UI_CONFIG, "utf8")), {
    enabled: false,
    patchesVersion: "0.80.6",
    workingDetailMode: "compact",
  });

  const reloadHarness = createExtensionHarness();
  reloadHarness.ctx.sessionManager = harness.ctx.sessionManager;
  glanceUi(reloadHarness.pi);
  await emitAsync(reloadHarness, "session_start");
  assert.equal(reloadHarness.getHiddenThinkingLabel(), undefined);
  await reloadHarness.registeredCommands.get("glance-ui").handler("settings enabled on", reloadHarness.ctx);
  assert.equal(reloadHarness.getHiddenThinkingLabel(), "Thinking hidden · Ctrl+T to show");
  assert.deepEqual(JSON.parse(readFileSync(process.env.PI_GLANCE_UI_CONFIG, "utf8")), {
    enabled: true,
    patchesVersion: "0.80.6",
    workingDetailMode: "compact",
  });
  await emitAsync(reloadHarness, "before_agent_start");

  firstCollapsedThinking.setHideThinkingBlock(false);
  const thinkingAfterReload = plain(firstCollapsedThinking.render(200));
  assert.equal(thinkingAfterReload.match(/Thinking/g)?.length, 1);
  assert.doesNotMatch(thinkingAfterReload, /Thinking:\s*[▾▸] Thinking/);

  firstCollapsedThinking.updateContent({
    role: "assistant",
    content: [{ type: "thinking", thinking: "▾ Thinking: First thought block" }],
    stopReason: "stop",
  });
  const recoveredThinking = plain(firstCollapsedThinking.render(200));
  assert.equal(recoveredThinking.match(/Thinking/g)?.length, 1);
  assert.doesNotMatch(recoveredThinking, /Thinking:\s*[▾▸] Thinking/);

  await startTool(reloadHarness, "reloaded-working", "bash", {
    command: "printf reloaded-working",
  });
  const reloadedWorking = new ToolExecutionComponent(
    "bash",
    "reloaded-working",
    { command: "printf reloaded-working" },
    {},
    reloadHarness.registeredTools.find((tool) => tool.name === "bash"),
    reloadHarness.ui,
    reloadHarness.ctx.cwd,
  );
  reloadedWorking.markExecutionStarted();
  reloadedWorking.setArgsComplete();
  reloadedWorking.updateResult({
    content: [{ type: "text", text: "reloaded-working complete" }],
    details: {},
    isError: false,
  });
  reloadedWorking.setExpanded(true);
  assert.doesNotMatch(plain(reloadedWorking.render(200)), /\$ printf reloaded-working/);
  await reloadHarness.registeredCommands.get("glance-ui").handler(
    "working-detail auto",
    reloadHarness.ctx,
  );
  const reloadedHistoricalTool = plain(rebuiltToolComponents[0].render(200));
  assert.match(reloadedHistoricalTool, /Ran/);
  assert.match(reloadedHistoricalTool, /historical/);
  assert.doesNotMatch(reloadedHistoricalTool, /complete/);

  await reloadHarness.registeredCommands.get("glance-ui").handler("off", reloadHarness.ctx);
  const disabledRebuildComponents = [];
  InteractiveMode.prototype.renderSessionEntries.call({
    renderSessionItems(items) {
      for (const item of items) {
        if (item.role === "custom") {
          new CustomMessageComponent(item);
          continue;
        }
        if (item.role !== "assistant") continue;
        for (const toolCall of item.content) {
          const definition = reloadHarness.registeredTools.find(
            (tool) => tool.name === toolCall.name,
          );
          const component = new ToolExecutionComponent(
            toolCall.name,
            toolCall.id,
            toolCall.arguments,
            {},
            definition,
            reloadHarness.ui,
            reloadHarness.ctx.cwd,
          );
          component.markExecutionStarted();
          component.setArgsComplete();
          component.updateResult({
            content: [{ type: "text", text: "native disabled result" }],
            details: {},
            isError: false,
          });
          disabledRebuildComponents.push(component);
        }
      }
    },
  }, rebuiltEntries);
  assert.match(plain(disabledRebuildComponents[0].render(200)), /native disabled result/);
  await reloadHarness.registeredCommands.get("sections").handler("", reloadHarness.ctx);
  assert.deepEqual(reloadHarness.notifications.at(-1), {
    message: "No collapsible sections yet",
    level: "info",
  });
  await reloadHarness.registeredCommands.get("glance-ui").handler("on", reloadHarness.ctx);
});

test("startup render benchmark", {
  skip: process.env.GLANCE_UI_BENCHMARK !== "1",
}, async (t) => {
  const configDirectory = mkdtempSync(join(tmpdir(), "glance-ui-benchmark-"));
  const previousConfigPath = process.env.PI_GLANCE_UI_CONFIG;
  process.env.PI_GLANCE_UI_CONFIG = join(configDirectory, "glance-ui.json");
  t.after(() => {
    if (previousConfigPath === undefined) delete process.env.PI_GLANCE_UI_CONFIG;
    else process.env.PI_GLANCE_UI_CONFIG = previousConfigPath;
    rmSync(configDirectory, { recursive: true, force: true });
  });

  writeFileSync(process.env.PI_GLANCE_UI_CONFIG, JSON.stringify({
    patchesVersion: "0.80.6",
  }));
  const harness = createExtensionHarness();
  glanceUi(harness.pi);
  const codingAgentEntryUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
  const themeUrl = new URL(
    "./modes/interactive/theme/theme.js",
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
  const [{ initTheme }, { ToolExecutionComponent }, { InteractiveMode }] = await Promise.all([
    import(themeUrl.href),
    import(toolExecutionUrl.href),
    import(interactiveModeUrl.href),
  ]);
  initTheme("dark");
  await emitAsync(harness, "session_start");

  const entries = [];
  for (let turn = 0; turn < 112; turn += 1) {
    entries.push({
      type: "message",
      message: { role: "user", content: `turn ${turn}` },
    });
    entries.push({
      type: "message",
      message: {
        role: "assistant",
        content: Array.from({ length: 6 }, (_, index) => {
          const id = `benchmark-${turn}-${index}`;
          const toolName = index % 3 === 0
            ? "bash"
            : index % 3 === 1 ? "read" : "custom_action";
          const args = toolName === "bash"
            ? { command: `printf ${id}` }
            : toolName === "read" ? { path: `/tmp/${id}.txt` } : { value: id };
          return { type: "toolCall", id, name: toolName, arguments: args };
        }),
        stopReason: "toolUse",
      },
    });
  }

  const components = [];
  const definitionsByName = new Map(
    harness.registeredTools.map((definition) => [definition.name, definition]),
  );
  const mode = {
    renderSessionItems(items) {
      for (const item of items) {
        if (item.role !== "assistant") continue;
        for (const toolCall of item.content) {
          const component = new ToolExecutionComponent(
            toolCall.name,
            toolCall.id,
            toolCall.arguments,
            {},
            definitionsByName.get(toolCall.name),
            harness.ui,
            harness.ctx.cwd,
          );
          component.markExecutionStarted();
          component.setArgsComplete();
          component.updateResult({
            // Realistic multi-line output so the expanded (Ctrl+O) render cost is
            // representative; collapsed compact rendering ignores the body.
            content: [{
              type: "text",
              text: Array.from({ length: 30 }, (_, line) => `result ${toolCall.id} line ${line}`).join("\n"),
            }],
            details: {},
            isError: false,
          });
          components.push(component);
        }
      }
    },
  };

  const reconstructionStartedAt = performance.now();
  InteractiveMode.prototype.renderSessionEntries.call(mode, entries);
  const reconstructionMs = performance.now() - reconstructionStartedAt;
  const renderStartedAt = performance.now();
  const renderedLines = components.flatMap((component) => component.render(160));
  const renderMs = performance.now() - renderStartedAt;

  // Simulate Ctrl+O (toggleToolOutputExpansion): flip expanded on every tool,
  // then re-render. This is the path the user reports as slow.
  const expandToggleStartedAt = performance.now();
  for (const component of components) component.setExpanded(true);
  const expandToggleMs = performance.now() - expandToggleStartedAt;
  const expandedRenderStartedAt = performance.now();
  const expandedLines = components.flatMap((component) => component.render(160));
  const expandedRenderMs = performance.now() - expandedRenderStartedAt;
  const expandedCachedStartedAt = performance.now();
  components.flatMap((component) => component.render(160));
  const expandedCachedMs = performance.now() - expandedCachedStartedAt;
  for (const component of components) component.setExpanded(false);

  await harness.registeredCommands.get("glance-ui").handler("off", harness.ctx);
  const nativeRenderStartedAt = performance.now();
  const nativeLines = components.flatMap((component) => component.render(160));
  const nativeRenderMs = performance.now() - nativeRenderStartedAt;
  const cachedNativeRenderStartedAt = performance.now();
  components.flatMap((component) => component.render(160));
  const cachedNativeRenderMs = performance.now() - cachedNativeRenderStartedAt;

  assert.equal(components.length, 672);
  assert.ok(renderedLines.length > components.length);
  assert.ok(nativeLines.length > renderedLines.length * 2);
  assert.ok(renderMs < nativeRenderMs);
  console.log(JSON.stringify({
    tools: components.length,
    reconstructionMs: Number(reconstructionMs.toFixed(1)),
    compactRenderMs: Number(renderMs.toFixed(1)),
    compactLines: renderedLines.length,
    nativeCloneRenderMs: Number(nativeRenderMs.toFixed(1)),
    nativeLines: nativeLines.length,
    cachedNativeRenderMs: Number(cachedNativeRenderMs.toFixed(1)),
    expandToggleMs: Number(expandToggleMs.toFixed(1)),
    expandedRenderMs: Number(expandedRenderMs.toFixed(1)),
    expandedLines: expandedLines.length,
    expandedCachedMs: Number(expandedCachedMs.toFixed(1)),
  }));
});

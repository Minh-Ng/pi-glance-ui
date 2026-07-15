import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";

import glanceUi from "../src/index.js";

function createHarness(confirmations) {
  const handlers = new Map();
  const notifications = [];
  const registeredCommands = new Map();
  const registeredTools = [];
  const confirmationRequests = [];
  let hiddenThinkingLabel;
  const pi = {
    on(event, handler) {
      const registered = handlers.get(event) || [];
      registered.push(handler);
      handlers.set(event, registered);
    },
    registerCommand(name, command) {
      registeredCommands.set(name, command);
    },
    registerShortcut() {},
    registerTool(tool) {
      registeredTools.push(tool);
    },
  };
  const ui = {
    async confirm(title, message) {
      confirmationRequests.push({ title, message });
      return confirmations.shift() ?? false;
    },
    notify(message, level) {
      notifications.push({ message, level });
    },
    setHiddenThinkingLabel(label) {
      hiddenThinkingLabel = label;
    },
    setWidget() {},
  };
  return {
    confirmationRequests,
    ctx: { cwd: process.cwd(), sessionManager: {}, ui },
    getHiddenThinkingLabel: () => hiddenThinkingLabel,
    handlers,
    notifications,
    pi,
    registeredCommands,
    registeredTools,
  };
}

async function emit(target, event) {
  for (const handler of target.handlers.get(event) || []) {
    await handler({}, target.ctx);
  }
}

function plain(lines) {
  return lines.map((line) => stripVTControlCharacters(line)).join("\n");
}

test("private layout patches require explicit version-scoped consent", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-glance-ui-consent-"));
  const configPath = join(directory, "glance-ui.json");
  const previousConfig = process.env.PI_GLANCE_UI_CONFIG;
  process.env.PI_GLANCE_UI_CONFIG = configPath;
  t.after(() => {
    if (previousConfig === undefined) delete process.env.PI_GLANCE_UI_CONFIG;
    else process.env.PI_GLANCE_UI_CONFIG = previousConfig;
    rmSync(directory, { recursive: true, force: true });
  });
  writeFileSync(configPath, JSON.stringify({ patchesVersion: "0.80.6" }));

  const codingAgentEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
  const tuiEntry = import.meta.resolve("@earendil-works/pi-tui");
  const urls = {
    assistant: new URL("./modes/interactive/components/assistant-message.js", codingAgentEntry),
    custom: new URL("./modes/interactive/components/custom-message.js", codingAgentEntry),
    footer: new URL("./modes/interactive/components/footer.js", codingAgentEntry),
    interactive: new URL("./modes/interactive/interactive-mode.js", codingAgentEntry),
    theme: new URL("./modes/interactive/theme/theme.js", codingAgentEntry),
    tool: new URL("./modes/interactive/components/tool-execution.js", codingAgentEntry),
    user: new URL("./modes/interactive/components/user-message.js", codingAgentEntry),
    markdown: new URL("./components/markdown.js", tuiEntry),
  };
  const [
    { AssistantMessageComponent },
    { CustomMessageComponent },
    { FooterComponent },
    { InteractiveMode },
    { initTheme },
    { ToolExecutionComponent },
    { UserMessageComponent },
    { Markdown },
  ] = await Promise.all([
    import(urls.assistant.href),
    import(urls.custom.href),
    import(urls.footer.href),
    import(urls.interactive.href),
    import(urls.theme.href),
    import(urls.tool.href),
    import(urls.user.href),
    import(urls.markdown.href),
  ]);
  initTheme("dark");

  const nativeMethods = new Map([
    [AssistantMessageComponent.prototype, AssistantMessageComponent.prototype.updateContent],
    [CustomMessageComponent.prototype, CustomMessageComponent.prototype.render],
    [FooterComponent.prototype, FooterComponent.prototype.render],
    [InteractiveMode.prototype, InteractiveMode.prototype.renderSessionEntries],
    [ToolExecutionComponent.prototype, ToolExecutionComponent.prototype.render],
    [UserMessageComponent.prototype, UserMessageComponent.prototype.render],
    [Markdown.prototype, Markdown.prototype.render],
  ]);
  const target = createHarness([false, true]);
  glanceUi(target.pi);
  await emit(target, "session_start");

  for (const [prototype, method] of nativeMethods) {
    const current = prototype === AssistantMessageComponent.prototype
      ? prototype.updateContent
      : prototype.renderSessionEntries ?? prototype.render;
    assert.equal(current, method, "startup mutated a native prototype without current consent");
  }
  assert.equal(target.getHiddenThinkingLabel(), undefined);
  assert.equal(target.registeredTools.length, 7);
  assert.ok(
    target.registeredTools.every(
      (tool) => tool[Symbol.for("pi-compact-ui.original-tool-definition")],
    ),
    "public compact tool definitions should remain active",
  );
  assert.deepEqual(target.notifications.at(-1), {
    message: "Glance UI: private patches remain off on Pi 0.80.7; approval was for Pi 0.80.6.",
    level: "warning",
  });

  const command = target.registeredCommands.get("glance-ui").handler;
  await command("off", target.ctx);
  await command("on", target.ctx);
  assert.deepEqual(target.notifications.at(-1), {
    message: "Glance UI enabled: on · compact tool rendering active · saved",
    level: "info",
  });

  await command("patches on", target.ctx);
  assert.equal(target.confirmationRequests.length, 1);
  assert.deepEqual(target.notifications.at(-1), {
    message: "Glance UI private patches remain off.",
    level: "info",
  });
  assert.equal(AssistantMessageComponent.prototype.updateContent, nativeMethods.get(
    AssistantMessageComponent.prototype,
  ));
  assert.equal(JSON.parse(readFileSync(configPath, "utf8")).patchesVersion, "0.80.6");

  await command("install-patch", target.ctx);
  assert.equal(target.confirmationRequests.length, 2);
  assert.match(target.confirmationRequests[1].message, /in-memory prototype patches to Pi 0\.80\.7/);
  assert.notEqual(AssistantMessageComponent.prototype.updateContent, nativeMethods.get(
    AssistantMessageComponent.prototype,
  ));
  assert.equal(target.getHiddenThinkingLabel(), "Thinking hidden · Ctrl+T to show");
  assert.equal(JSON.parse(readFileSync(configPath, "utf8")).patchesVersion, "0.80.7");
  assert.deepEqual(target.notifications.at(-1), {
    message: "Glance UI private patches: on for Pi 0.80.7 · saved",
    level: "info",
  });

  const compactThinking = new AssistantMessageComponent({
    role: "assistant",
    content: [{ type: "thinking", thinking: "Consent test thought" }],
    stopReason: "stop",
  }, true, undefined, "Thinking hidden · Ctrl+T to show");
  assert.match(plain(compactThinking.render(100)), /○ ▸ Thinking/);

  writeFileSync(configPath, JSON.stringify({ enabled: true, workingDetailMode: "auto" }));
  const reloadTarget = createHarness([]);
  glanceUi(reloadTarget.pi);
  await emit(reloadTarget, "session_start");
  assert.equal(
    reloadTarget.getHiddenThinkingLabel(),
    undefined,
    "deleting persisted consent must keep patches dormant after reload",
  );
  assert.equal(JSON.parse(readFileSync(configPath, "utf8")).patchesVersion, undefined);
  assert.doesNotMatch(plain(compactThinking.render(100)), /○ ▸ Thinking/);

  await command("patches off", target.ctx);
  assert.equal(JSON.parse(readFileSync(configPath, "utf8")).patchesVersion, undefined);
  assert.equal(target.getHiddenThinkingLabel(), undefined);
  assert.deepEqual(target.notifications.at(-1), {
    message: "Glance UI private patches: off · native layout active · saved",
    level: "info",
  });
  const nativeThinking = plain(compactThinking.render(100));
  assert.doesNotMatch(nativeThinking, /○ ▸ Thinking/);
  assert.match(nativeThinking, /Thinking hidden/);
  assert.ok(
    target.registeredTools.slice(-7).every(
      (tool) => tool[Symbol.for("pi-compact-ui.original-tool-definition")],
    ),
    "patch opt-out must not disable the latest public compact tool definitions",
  );
});

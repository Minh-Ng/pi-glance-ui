import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";

import glanceUi from "../src/index.js";
import { AUTO_WORKING_DETAIL_MIN_EXPANDED_MS } from "../src/patches/tools.js";

function plain(lines) {
  return lines.map((line) => stripVTControlCharacters(line)).join("\n");
}

function harness() {
  const commands = new Map();
  const handlers = new Map();
  const registeredTools = [];
  let renderRequests = 0;
  const ui = {
    notify() {},
    requestRender() { renderRequests += 1; },
    setHiddenThinkingLabel() {},
    setWidget() {},
  };
  return {
    pi: {
      on(event, handler) {
        const current = handlers.get(event) ?? [];
        current.push(handler);
        handlers.set(event, current);
      },
      registerCommand(name, command) { commands.set(name, command); },
      registerShortcut() {},
      registerTool(tool) { registeredTools.push(tool); },
    },
    commands,
    ctx: { cwd: process.cwd(), sessionManager: {}, ui },
    handlers,
    registeredTools,
    renderRequests: () => renderRequests,
    ui,
  };
}

async function emit(target, event, payload = {}) {
  for (const handler of target.handlers.get(event) ?? []) {
    await handler(payload, target.ctx);
  }
}

async function createRunningBash(
  target,
  ToolExecutionComponent,
  id,
  command,
  { argsComplete = true, initiallyExpanded = false } = {},
) {
  const args = { command };
  const definition = target.registeredTools.find((tool) => tool.name === "bash");
  const component = new ToolExecutionComponent(
    "bash",
    id,
    args,
    {},
    definition,
    target.ui,
    target.ctx.cwd,
  );
  // Pi applies the global expansion baseline and completes assistant arguments
  // before tool_execution_start marks the already-created component as live.
  component.setExpanded(initiallyExpanded);
  if (argsComplete) component.setArgsComplete();
  await emit(target, "tool_execution_start", { toolCallId: id, toolName: "bash", args });
  component.markExecutionStarted();
  return component;
}

test("compact mode stays compact while tool arguments are streaming", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-glance-ui-compact-streaming-"));
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
    workingDetailMode: "compact",
  }));

  const target = harness();
  glanceUi(target.pi);
  const codingAgentEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
  const [{ initTheme }, { ToolExecutionComponent }] = await Promise.all([
    import(new URL("./modes/interactive/theme/theme.js", codingAgentEntry).href),
    import(new URL("./modes/interactive/components/tool-execution.js", codingAgentEntry).href),
  ]);
  initTheme("dark");
  await emit(target, "session_start");
  await emit(target, "before_agent_start");

  const args = {
    path: "src/streaming.js",
    content: "const streamed = true;\n".repeat(20),
  };
  const definition = target.registeredTools.find((tool) => tool.name === "write");
  const component = new ToolExecutionComponent(
    "write",
    "streaming-write",
    args,
    {},
    definition,
    target.ui,
    target.ctx.cwd,
  );
  component.setExpanded(true);

  for (const repetitions of [1, 10, 20]) {
    component.updateArgs({
      ...args,
      content: "const streamed = true;\n".repeat(repetitions),
    });
    const preExecution = plain(component.render(160));
    assert.match(preExecution, /Implement · Changed/);
    assert.match(preExecution, /Write src\/streaming\.js/);
    assert.doesNotMatch(preExecution, /const streamed = true/);
  }

  await target.commands.get("glance-ui").handler("working-detail hidden", target.ctx);
  assert.deepEqual(component.render(160), []);
  await target.commands.get("glance-ui").handler("working-detail compact", target.ctx);
  assert.doesNotMatch(plain(component.render(160)), /const streamed = true/);

  component.setArgsComplete();
  await emit(target, "tool_execution_start", {
    toolCallId: "streaming-write",
    toolName: "write",
    args,
  });
  component.markExecutionStarted();
  const active = plain(component.render(160));
  assert.match(active, /Implement · Changed/);
  assert.match(active, /Write src\/streaming\.js/);
  assert.doesNotMatch(active, /const streamed = true/);
});

test("auto working detail waits five seconds after the completed result render", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-glance-ui-auto-delay-"));
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
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10_000 });

  const target = harness();
  glanceUi(target.pi);
  const codingAgentEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
  const [{ initTheme }, { ToolExecutionComponent }] = await Promise.all([
    import(new URL("./modes/interactive/theme/theme.js", codingAgentEntry).href),
    import(new URL("./modes/interactive/components/tool-execution.js", codingAgentEntry).href),
  ]);
  initTheme("dark");
  await emit(target, "session_start");
  await emit(target, "before_agent_start");

  const component = await createRunningBash(
    target,
    ToolExecutionComponent,
    "delayed",
    "printf delayed",
    { argsComplete: false },
  );

  // Streaming argument frames do not start the minimum-visible clock.
  assert.match(plain(component.render(160)), /\$ printf delayed/);
  t.mock.timers.tick(AUTO_WORKING_DETAIL_MIN_EXPANDED_MS * 2);
  assert.match(plain(component.render(160)), /\$ printf delayed/);

  // Argument completion still is not the full result render, so a long-running
  // tool remains expanded without consuming the post-result interval.
  component.setArgsComplete();
  assert.match(plain(component.render(160)), /\$ printf delayed/);
  t.mock.timers.tick(AUTO_WORKING_DETAIL_MIN_EXPANDED_MS * 2);
  assert.match(plain(component.render(160)), /\$ printf delayed/);

  component.updateResult({
    content: [{ type: "text", text: "done" }],
    details: {},
    isError: false,
  });
  assert.match(plain(component.render(160)), /\$ printf delayed/);
  t.mock.timers.tick(AUTO_WORKING_DETAIL_MIN_EXPANDED_MS - 1);
  assert.match(plain(component.render(160)), /\$ printf delayed/);
  t.mock.timers.tick(1);
  assert.doesNotMatch(plain(component.render(160)), /\$ printf delayed/);
  assert.ok(target.renderRequests() >= 1, "timer requests the collapse render");

  // A tool created while Ctrl+O is already expanded must never be auto-compacted.
  const initiallyExpanded = await createRunningBash(
    target,
    ToolExecutionComponent,
    "initially-expanded",
    "printf initially-expanded",
    { initiallyExpanded: true },
  );
  assert.match(plain(initiallyExpanded.render(160)), /\$ printf initially-expanded/);
  t.mock.timers.tick(AUTO_WORKING_DETAIL_MIN_EXPANDED_MS * 2);
  assert.match(plain(initiallyExpanded.render(160)), /\$ printf initially-expanded/);

  // Explicit collapse remains immediate, while explicit expansion wins over
  // auto-compaction for as long as the global detail state stays expanded.
  const manual = await createRunningBash(target, ToolExecutionComponent, "manual", "printf manual");
  assert.match(plain(manual.render(160)), /\$ printf manual/);
  manual.setExpanded(false);
  assert.doesNotMatch(plain(manual.render(160)), /\$ printf manual/);
  manual.setExpanded(true);
  assert.match(plain(manual.render(160)), /\$ printf manual/);
  t.mock.timers.tick(AUTO_WORKING_DETAIL_MIN_EXPANDED_MS * 2);
  assert.match(plain(manual.render(160)), /\$ printf manual/);
});

test("early completion stays expanded until the deadline and shutdown cancels timers", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-glance-ui-auto-cleanup-"));
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
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 20_000 });

  const target = harness();
  glanceUi(target.pi);
  const codingAgentEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
  const [{ initTheme }, { ToolExecutionComponent }] = await Promise.all([
    import(new URL("./modes/interactive/theme/theme.js", codingAgentEntry).href),
    import(new URL("./modes/interactive/components/tool-execution.js", codingAgentEntry).href),
  ]);
  initTheme("dark");
  await emit(target, "session_start");
  await emit(target, "before_agent_start");

  const completed = await createRunningBash(target, ToolExecutionComponent, "complete-early", "printf done");
  completed.render(160);
  t.mock.timers.tick(1_000);
  completed.updateResult({
    content: [{ type: "text", text: "done" }],
    details: {},
    isError: false,
  });
  const afterCompletion = target.renderRequests();
  assert.match(plain(completed.render(160)), /\$ printf done/);
  t.mock.timers.tick(AUTO_WORKING_DETAIL_MIN_EXPANDED_MS - 1);
  assert.match(plain(completed.render(160)), /\$ printf done/);
  t.mock.timers.tick(1);
  assert.ok(target.renderRequests() > afterCompletion);
  assert.doesNotMatch(plain(completed.render(160)), /\$ printf done/);

  const shutdown = await createRunningBash(target, ToolExecutionComponent, "shutdown", "printf shutdown");
  shutdown.updateResult({
    content: [{ type: "text", text: "shutdown" }],
    details: {},
    isError: false,
  });
  shutdown.render(160);
  await emit(target, "session_shutdown");
  const afterShutdown = target.renderRequests();
  t.mock.timers.tick(AUTO_WORKING_DETAIL_MIN_EXPANDED_MS);
  assert.equal(target.renderRequests(), afterShutdown);
});

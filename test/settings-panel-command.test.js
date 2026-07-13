import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import glanceUi from "../src/index.js";

function createHarness() {
  const handlers = new Map();
  const registeredCommands = new Map();
  const notifications = [];
  let custom = null;
  const pi = {
    on(event, handler) { (handlers.get(event) || handlers.set(event, []).get(event)).push(handler); },
    registerCommand(name, command) { registeredCommands.set(name, command); },
    registerShortcut() {},
    registerTool() {},
  };
  const tui = { requestRender() {} };
  const theme = { fg: (_c, t) => t, bold: (t) => t };
  const ui = {
    async confirm() { return true; },
    notify(message, level) { notifications.push({ message, level }); },
    setHiddenThinkingLabel() {},
    setWidget() {},
    async custom(factory, options) {
      const done = (result) => { custom.result = result; };
      const component = await factory(tui, theme, {}, done);
      custom = { component, options, done };
      return undefined;
    },
  };
  return {
    pi,
    ctx: { cwd: process.cwd(), sessionManager: {}, ui },
    handlers,
    notifications,
    registeredCommands,
    getCustom: () => custom,
  };
}

async function emit(target, event) {
  for (const h of target.handlers.get(event) || []) await h({}, target.ctx);
}

test("bare /glance-ui opens the live panel and changes persist", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "glance-panel-"));
  const cfg = join(dir, "glance-ui.json");
  const prev = process.env.PI_GLANCE_UI_CONFIG;
  process.env.PI_GLANCE_UI_CONFIG = cfg;
  t.after(() => {
    if (prev === undefined) delete process.env.PI_GLANCE_UI_CONFIG;
    else process.env.PI_GLANCE_UI_CONFIG = prev;
    rmSync(dir, { recursive: true, force: true });
  });
  writeFileSync(cfg, JSON.stringify({ enabled: true, workingDetailMode: "auto" }));

  const h = createHarness();
  glanceUi(h.pi);
  await emit(h, "session_start");

  const command = h.registeredCommands.get("glance-ui").handler;
  const notifBefore = h.notifications.length;
  await command("", h.ctx);

  const custom = h.getCustom();
  assert.ok(custom, "bare command must open a custom overlay");
  assert.equal(custom.options.overlay, true);
  assert.equal(h.notifications.length, notifBefore, "bare command should not emit a text summary");

  const panel = custom.component;
  // Navigate to working-detail (row 2) and cycle auto -> compact.
  await panel.handleInput("\x1b[B");
  await panel.handleInput("\x1b[B");
  await panel.handleInput("\x1b[C");

  assert.equal(JSON.parse(readFileSync(cfg, "utf8")).workingDetailMode, "compact");
  assert.match(h.notifications.at(-1).message, /working-detail: compact/);

  // The panel re-reads state, so the row now shows the applied value.
  const rendered = panel.render(80).join("\n");
  assert.match(rendered, /working-detail: auto \[compact\]/);

  // Esc closes.
  await panel.handleInput("\x1b");
  assert.equal(custom.result, undefined);
});

test("/glance-ui settings still prints the text summary (non-panel)", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "glance-panel2-"));
  const cfg = join(dir, "glance-ui.json");
  const prev = process.env.PI_GLANCE_UI_CONFIG;
  process.env.PI_GLANCE_UI_CONFIG = cfg;
  t.after(() => {
    if (prev === undefined) delete process.env.PI_GLANCE_UI_CONFIG;
    else process.env.PI_GLANCE_UI_CONFIG = prev;
    rmSync(dir, { recursive: true, force: true });
  });
  writeFileSync(cfg, JSON.stringify({ enabled: true, workingDetailMode: "auto" }));

  const h = createHarness();
  glanceUi(h.pi);
  await emit(h, "session_start");
  const command = h.registeredCommands.get("glance-ui").handler;
  await command("settings", h.ctx);
  assert.equal(h.getCustom(), null, "settings must not open the overlay");
  assert.match(h.notifications.at(-1).message, /Glance UI settings/);
});

test("falls back to a text summary when custom overlays are unavailable", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "glance-panel3-"));
  const cfg = join(dir, "glance-ui.json");
  const prev = process.env.PI_GLANCE_UI_CONFIG;
  process.env.PI_GLANCE_UI_CONFIG = cfg;
  t.after(() => {
    if (prev === undefined) delete process.env.PI_GLANCE_UI_CONFIG;
    else process.env.PI_GLANCE_UI_CONFIG = prev;
    rmSync(dir, { recursive: true, force: true });
  });
  writeFileSync(cfg, JSON.stringify({ enabled: true, workingDetailMode: "auto" }));

  const h = createHarness();
  delete h.ctx.ui.custom; // RPC/print modes may not provide custom overlays.
  glanceUi(h.pi);
  await emit(h, "session_start");
  const command = h.registeredCommands.get("glance-ui").handler;
  await command("", h.ctx);
  assert.match(h.notifications.at(-1).message, /Glance UI settings/);
});

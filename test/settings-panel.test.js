import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";

import { SettingsPanel } from "../src/ui/settings-panel.js";

const theme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

function makeState() {
  const state = { enabled: "on", patches: "off", "working-detail": "auto" };
  const changes = [];
  const rows = () => [
    { key: "enabled", label: "enabled", value: state.enabled, values: ["on", "off"], effect: "e" },
    { key: "patches", label: "patches", value: state.patches, values: ["on", "off"], effect: "p" },
    { key: "working-detail", label: "working-detail", value: state["working-detail"], values: ["auto", "compact", "expanded", "hidden"], effect: "w" },
  ];
  return { state, changes, rows };
}

function panel(overrides = {}) {
  const { state, changes, rows } = makeState();
  const p = new SettingsPanel({
    theme,
    getRows: rows,
    onChange: async (key, value) => { changes.push([key, value]); state[key] = value; },
    requestRender: () => {},
    onClose: () => { state.closed = true; },
    ...overrides,
  });
  return { p, state, changes };
}

const plain = (lines) => lines.map(stripVTControlCharacters).join("\n");

test("renders every setting with the current value marked", () => {
  const { p } = panel();
  const out = plain(p.render(80));
  assert.match(out, /Glance UI settings/);
  assert.match(out, /enabled: \[on\] off/);
  assert.match(out, /patches: on \[off\]/);
  assert.match(out, /working-detail: \[auto\] compact expanded hidden/);
  assert.match(out, /↑↓ select/);
});

test("Enter cycles the selected row's value and calls onChange", async () => {
  const { p, changes, state } = panel();
  await p.handleInput("\r"); // enter on "enabled" -> on => off
  assert.deepEqual(changes.at(-1), ["enabled", "off"]);
  assert.equal(state.enabled, "off");
  assert.match(plain(p.render(80)), /enabled: on \[off\]/);
});

test("arrow keys navigate and change the right row", async () => {
  const { p, changes } = panel();
  await p.handleInput("\x1b[B"); // down -> patches
  await p.handleInput("\x1b[B"); // down -> working-detail
  await p.handleInput("\x1b[C"); // right -> auto => compact
  assert.deepEqual(changes.at(-1), ["working-detail", "compact"]);
  await p.handleInput("\x1b[D"); // left -> compact => auto
  assert.deepEqual(changes.at(-1), ["working-detail", "auto"]);
});

test("Esc closes the panel", async () => {
  const { p, state } = panel();
  await p.handleInput("\x1b");
  assert.equal(state.closed, true);
});

test("a slow onChange is not run concurrently", async () => {
  let active = 0;
  let maxActive = 0;
  const { rows } = makeState();
  const p = new SettingsPanel({
    theme,
    getRows: rows,
    onChange: async () => {
      active += 1; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
    },
    requestRender: () => {},
    onClose: () => {},
  });
  await Promise.all([p.handleInput("\r"), p.handleInput("\r"), p.handleInput("\r")]);
  assert.equal(maxActive, 1, "onChange must be serialized while busy");
});

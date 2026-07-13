import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import {
  loadRunningPiRuntime,
  runningPiCodingAgentEntry,
} from "../src/pi-runtime.js";

// Guards the fix for the local-dev-checkout bug where a shadowing
// node_modules copy of pi-coding-agent made import.meta.resolve return the
// wrong module instance, leaving private layout patches inert.
test("resolves the running pi-coding-agent install from the CLI entry", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-entry-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const installDist = join(
    dir,
    "lib/node_modules/@earendil-works/pi-coding-agent/dist",
  );
  mkdirSync(installDist, { recursive: true });
  writeFileSync(join(installDist, "cli.js"), "// cli\n");
  writeFileSync(join(installDist, "index.js"), "// index\n");

  // Mimic the npm bin symlink that Pi is actually launched through.
  const binDir = join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  const binLink = join(binDir, "pi");
  symlinkSync(join(installDist, "cli.js"), binLink);

  const previousArgv1 = process.argv[1];
  process.argv[1] = binLink;
  t.after(() => { process.argv[1] = previousArgv1; });

  const entry = runningPiCodingAgentEntry();
  assert.match(entry, /^file:\/\//);
  assert.match(
    entry,
    /\/node_modules\/@earendil-works\/pi-coding-agent\/dist\/index\.js$/,
    "must anchor to the running install's dist/index.js via the bin symlink",
  );
  // The resolved install must be the symlink target, never the dev shadow.
  assert.doesNotMatch(entry, /pi-glance-ui\/node_modules/);
  assert.match(entry, /pi-entry-/);
  assert.ok(entry.startsWith(pathToFileURL(tmpdir()).href.slice(0, 7)));
});

test("falls back to import.meta.resolve when argv[1] is not a pi install", (t) => {
  const previousArgv1 = process.argv[1];
  process.argv[1] = join(tmpdir(), "not-pi", "runner.js");
  t.after(() => { process.argv[1] = previousArgv1; });

  const entry = runningPiCodingAgentEntry();
  assert.match(entry, /@earendil-works\/pi-coding-agent/);
});

test("loads version and tool factories from the running Pi entry", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-runtime-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const packageRoot = join(
    dir,
    "node_modules/@earendil-works/pi-coding-agent",
  );
  const installDist = join(packageRoot, "dist");
  mkdirSync(installDist, { recursive: true });
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(installDist, "cli.js"), "// cli\n");
  writeFileSync(join(installDist, "index.js"), [
    "export const VERSION = '9.9.9';",
    "export const createReadToolDefinition = () => {};",
    "export const createBashToolDefinition = () => {};",
    "export const createEditToolDefinition = () => {};",
    "export const createWriteToolDefinition = () => {};",
    "export const createGrepToolDefinition = () => {};",
    "export const createFindToolDefinition = () => {};",
    "export const createLsToolDefinition = () => {};",
  ].join("\n"));
  const binLink = join(dir, "pi");
  symlinkSync(join(installDist, "cli.js"), binLink);

  const previousArgv1 = process.argv[1];
  process.argv[1] = binLink;
  t.after(() => { process.argv[1] = previousArgv1; });

  const runtime = await loadRunningPiRuntime();
  assert.equal(runtime.version, "9.9.9");
  assert.equal(runtime.toolFactories.length, 7);
  assert.match(runtime.entryUrl, /pi-runtime-/);
});

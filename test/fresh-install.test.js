import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { test } from "node:test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const piCli = resolve(dirname(codingAgentEntry), "cli.js");

function isolatedEnvironment(home) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    PI_GLANCE_UI_CONFIG: resolve(home, ".pi", "agent", "glance-ui.json"),
  };
}

function waitForRpcResponse(child, requestId, timeoutMs = 15_000) {
  return new Promise((resolveResponse, reject) => {
    let stdout = "";
    let stderr = "";
    const messages = [];
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for Pi RPC startup. stderr: ${stderr}`));
    }, timeoutMs);

    const finish = (callback) => {
      clearTimeout(timeout);
      callback();
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      while (stdout.includes("\n")) {
        const newline = stdout.indexOf("\n");
        const line = stdout.slice(0, newline).replace(/\r$/, "");
        stdout = stdout.slice(newline + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line);
          messages.push(message);
          if (message.id === requestId && message.type === "response") {
            finish(() => resolveResponse({ message, messages, stderr }));
            return;
          }
        } catch (error) {
          finish(() => reject(new Error(`Invalid Pi RPC output: ${line}\n${error}`)));
          return;
        }
      }
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code, signal) => {
      finish(() => reject(new Error(
        `Pi RPC exited before startup response (code ${code}, signal ${signal}). stderr: ${stderr}`,
      )));
    });
  });
}

test("a fresh Pi home installs and starts Glance UI successfully", async (t) => {
  const home = mkdtempSync(resolve(tmpdir(), "pi-glance-ui-smoke-"));
  const env = isolatedEnvironment(home);
  let child;
  t.after(async () => {
    if (child?.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, "exit");
    }
    rmSync(home, { recursive: true, force: true });
  });

  const installation = spawnSync(process.execPath, [piCli, "install", projectRoot], {
    cwd: home,
    env,
    encoding: "utf8",
  });
  assert.equal(
    installation.status,
    0,
    `Pi package installation failed:\n${installation.stdout}\n${installation.stderr}`,
  );

  child = spawn(process.execPath, [piCli, "--mode", "rpc", "--no-session"], {
    cwd: home,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const requestId = "glance-ui-startup-smoke";
  child.stdin.write(`${JSON.stringify({ id: requestId, type: "get_state" })}\n`);
  const { message, messages, stderr } = await waitForRpcResponse(child, requestId);

  assert.equal(message.success, true, JSON.stringify(message));
  assert.deepEqual(
    messages
      .filter((entry) => entry.type === "extension_ui_request" && entry.method === "setWidget")
      .map((entry) => entry.widgetKey),
    ["compact-ui-activity", "glance-ui-activity"],
    "Glance UI did not run its session_start setup",
  );
  assert.equal(
    messages.some(
      (entry) => entry.type === "extension_ui_request"
        && entry.method === "notify"
        && entry.notifyType === "warning"
        && entry.message?.startsWith("Glance UI: layout extras unavailable"),
    ),
    false,
    "Glance UI's compatibility patch failed during fresh startup",
  );
  assert.equal(stderr, "", `Pi emitted startup errors:\n${stderr}`);

  child.kill();
});

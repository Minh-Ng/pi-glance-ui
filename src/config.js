import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const WORKING_DETAIL_MODES = new Set(["auto", "compact", "expanded", "hidden"]);

function glanceUiConfigPath() {
  return process.env.PI_GLANCE_UI_CONFIG || join(homedir(), ".pi", "agent", "glance-ui.json");
}

export function loadGlanceUiConfig(path = glanceUiConfigPath()) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return {
      ...(typeof parsed.enabled === "boolean" ? { enabled: parsed.enabled } : {}),
      ...(typeof parsed.patchesVersion === "string" && parsed.patchesVersion.trim()
        ? { patchesVersion: parsed.patchesVersion.trim() }
        : {}),
      ...(WORKING_DETAIL_MODES.has(parsed.workingDetailMode)
        ? { workingDetailMode: parsed.workingDetailMode }
        : {}),
    };
  } catch {
    return {};
  }
}

export function saveGlanceUiConfig(config, path = glanceUiConfigPath()) {
  const directory = dirname(path);
  const temporaryPath = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

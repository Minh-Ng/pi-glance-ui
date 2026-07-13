import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  VERSION,
} from "@earendil-works/pi-coding-agent";

import { loadGlanceUiConfig, saveGlanceUiConfig } from "./config.js";
import { activityPhaseForTool, compactWhitespace, compatibilityError, toolCategory } from "./format.js";
import { compactDefinition } from "./tools.js";
import { ToolTimeline } from "./timeline.js";
import { SectionController, SectionNavigator } from "./ui/sections.js";
import { SettingsPanel } from "./ui/settings-panel.js";

export { loadGlanceUiConfig, saveGlanceUiConfig } from "./config.js";

const TOOL_FACTORIES = [
  createReadToolDefinition,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
];
const SHARED_RUNTIME_STATE = Symbol.for("pi-compact-ui.shared-runtime-state");
const SUPPORTED_PATCH_VERSIONS = new Set(["0.80.6"]);
const WORKING_DETAIL_MODES = new Set(["auto", "compact", "expanded", "hidden"]);

export default function glanceUi(pi) {
  let cwd;
  // Pi owns one interactive transcript per process and rebuilds it before newly
  // reloaded extension handlers run. Preserve that transcript's runtime through
  // the handoff so existing tool components never fall back to full output.
  let sharedRuntime = globalThis[SHARED_RUNTIME_STATE];
  if (!sharedRuntime || sharedRuntime instanceof WeakMap) {
    const nextSectionController = new SectionController();
    sharedRuntime = {
      sectionController: nextSectionController,
      timeline: new ToolTimeline(nextSectionController),
    };
    globalThis[SHARED_RUNTIME_STATE] = sharedRuntime;
  }
  Object.setPrototypeOf(sharedRuntime.sectionController, SectionController.prototype);
  Object.setPrototypeOf(sharedRuntime.timeline, ToolTimeline.prototype);
  sharedRuntime.timeline.sectionController = sharedRuntime.sectionController;
  delete sharedRuntime.activity;
  delete sharedRuntime.briefEnabled;
  const { sectionController, timeline } = sharedRuntime;
  const persistedConfig = loadGlanceUiConfig();
  const legacyEnabled = typeof sharedRuntime.enabled === "boolean"
    ? sharedRuntime.enabled
    : undefined;
  let enabled = persistedConfig.enabled
    ?? sharedRuntime.publicEnabled
    ?? legacyEnabled
    ?? true;
  // Consent must come from the persisted config on every extension generation.
  // Falling back to process-global state would resurrect consent after a user
  // deletes patchesVersion and reloads Pi.
  let patchesVersion = persistedConfig.patchesVersion;
  let workingDetailMode = persistedConfig.workingDetailMode
    ?? sharedRuntime.workingDetailMode
    ?? "auto";
  sharedRuntime.publicEnabled = enabled;
  sharedRuntime.patchesVersion = patchesVersion;
  sharedRuntime.patchesActive = false;
  sharedRuntime.workingDetailMode = workingDetailMode;
  // Wrappers from builds predating explicit consent consult this legacy slot.
  // Keep them dormant until the current generation installs successfully.
  sharedRuntime.enabled = false;
  let layoutPatch;
  let patchInstallInProgress = false;

  const isEnabled = () => sharedRuntime.publicEnabled;
  const isPatchEnabled = () => isEnabled()
    && (sharedRuntime.patchesActive || patchInstallInProgress);
  const syncLegacyPatchState = () => {
    sharedRuntime.enabled = isPatchEnabled();
  };
  const currentSettings = () => ({
    enabled,
    ...(patchesVersion ? { patchesVersion } : {}),
    workingDetailMode,
  });
  const workingDetailEffects = {
    auto: "only the bottom-most running tool stays compact",
    compact: "running tools stay compact",
    expanded: "running tools follow Ctrl+O",
    hidden: "running tools appear when they finish",
  };
  const patchStatus = () => patchesVersion === VERSION && sharedRuntime.patchesActive
    ? `on for Pi ${VERSION}`
    : patchesVersion && patchesVersion !== VERSION
      ? `off (approval was for Pi ${patchesVersion})`
      : "off";
  const settingsSummary = () => [
    "Glance UI settings",
    `enabled: ${enabled ? "on" : "off"} (on|off) — ${enabled ? "compact tool rendering is active" : "native Pi rendering is active"}`,
    `patches: ${patchStatus()} (on|off) — optional native transcript layout patches`,
    `working-detail: ${workingDetailMode} (auto|compact|expanded|hidden) — ${workingDetailEffects[workingDetailMode]}`,
    "Change: /glance-ui settings <name> <value>",
    "Sections: /sections or Ctrl+Shift+O",
  ].join("\n");

  const persistSettings = (ctx) => {
    try {
      const config = currentSettings();
      saveGlanceUiConfig(config);
      if (!patchesVersion) delete persistedConfig.patchesVersion;
      Object.assign(persistedConfig, config);
      return true;
    } catch (error) {
      ctx?.ui.notify(
        `Could not persist Glance UI settings: ${compatibilityError(error)}`,
        "warning",
      );
      return false;
    }
  };

  const removePrivateSections = () => {
    sectionController.removeKinds(["assistantError", "custom", "runtimeNotice", "thinking"]);
  };

  const showSections = async (ctx) => {
    const sections = isEnabled() ? sectionController.list() : [];
    if (sections.length === 0) {
      ctx.ui.notify("No collapsible sections yet", "info");
      return;
    }
    await ctx.ui.custom((_tui, theme, _keybindings, done) => new SectionNavigator({
      sections,
      theme,
      onClose: () => done(undefined),
      requestRender: () => _tui.requestRender(),
    }), {
      overlay: true,
      overlayOptions: {
        width: "60%",
        maxHeight: "70%",
        anchor: "center",
        margin: 1,
      },
    });
  };

  const updatePatchPresentation = (ctx) => {
    ctx?.ui.setHiddenThinkingLabel(
      isPatchEnabled() ? "Thinking hidden · Ctrl+T to show" : undefined,
    );
  };

  const installTools = (nextCwd, ctx) => {
    cwd = nextCwd;
    for (const factory of TOOL_FACTORIES) {
      const original = factory(nextCwd);
      pi.registerTool(isEnabled() ? compactDefinition(original, timeline, isEnabled) : original);
    }
    updatePatchPresentation(ctx);
  };

  const ensureLayoutPatch = async () => {
    if (!SUPPORTED_PATCH_VERSIONS.has(VERSION)) {
      return { ok: false, error: `Pi ${VERSION} is not a tested patch target` };
    }
    if (!layoutPatch) {
      patchInstallInProgress = true;
      syncLegacyPatchState();
      layoutPatch = (async () => {
        const { patchHiddenThinkingLayout } = await import("./patches/layout.js");
        return patchHiddenThinkingLayout(
          timeline,
          sectionController,
          isPatchEnabled,
          () => workingDetailMode,
        );
      })();
    }
    let compatibility;
    try {
      compatibility = await layoutPatch;
      sharedRuntime.patchesActive = compatibility.ok;
      if (!compatibility.ok) layoutPatch = undefined;
      return compatibility;
    } catch (error) {
      layoutPatch = undefined;
      sharedRuntime.patchesActive = false;
      return { ok: false, error: compatibilityError(error) };
    } finally {
      patchInstallInProgress = false;
      syncLegacyPatchState();
    }
  };

  const notifyPatchFailure = (ctx, compatibility) => {
    const reason = compactWhitespace(compatibility.error).slice(0, 120);
    ctx.ui.notify(
      `Glance UI: layout extras unavailable (${reason}). Compact tools remain active.`,
      "warning",
    );
  };

  pi.on("session_start", async (_event, ctx) => {
    if (
      persistedConfig.enabled !== enabled
      || persistedConfig.patchesVersion !== patchesVersion
      || persistedConfig.workingDetailMode !== workingDetailMode
    ) {
      persistSettings(ctx);
    }

    // Remove activity-brief state left by older Compact UI builds.
    ctx.ui.setWidget?.("compact-ui-activity", undefined);
    ctx.ui.setWidget?.("glance-ui-activity", undefined);
    // Keep the legacy Symbol namespace so a hot reload recognizes existing patches.
    ctx.ui[Symbol.for("pi-compact-ui.widget-tracker")]?.listeners?.clear();

    installTools(ctx.cwd, ctx);
    if (enabled && patchesVersion === VERSION) {
      const compatibility = await ensureLayoutPatch();
      updatePatchPresentation(ctx);
      if (!compatibility.ok) notifyPatchFailure(ctx, compatibility);
    } else if (patchesVersion && patchesVersion !== VERSION) {
      ctx.ui.notify(
        `Glance UI: private patches remain off on Pi ${VERSION}; approval was for Pi ${patchesVersion}.`,
        "warning",
      );
    }
  });

  pi.on("before_agent_start", () => {
    timeline.startAgent();
  });

  pi.on("agent_start", () => {
    timeline.startAgent();
  });

  pi.on("tool_execution_start", (event) => {
    timeline.registerActive(
      event.toolCallId,
      toolCategory(event.toolName, event.args),
      activityPhaseForTool(event.toolName, event.args),
    );
  });

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setHiddenThinkingLabel();
  });

  pi.registerCommand("sections", {
    description: "Expand or collapse a specific transcript section",
    handler: async (_raw, ctx) => showSections(ctx),
  });

  pi.registerShortcut("ctrl+shift+o", {
    description: "Open transcript section navigator",
    handler: async (ctx) => showSections(ctx),
  });

  const applyEnabled = async (nextEnabled, ctx) => {
    enabled = nextEnabled;
    sharedRuntime.publicEnabled = enabled;
    if (enabled && patchesVersion === VERSION) {
      const compatibility = await ensureLayoutPatch();
      if (!compatibility.ok) notifyPatchFailure(ctx, compatibility);
    }
    syncLegacyPatchState();
    if (!enabled) {
      sectionController.removeKinds([
        "assistantError",
        "custom",
        "runtimeNotice",
        "thinking",
        "tools",
      ]);
    }
    const saved = persistSettings(ctx);
    installTools(ctx.cwd || cwd || process.cwd(), ctx);
    ctx.ui.requestRender?.();
    const effect = enabled ? "compact tool rendering active" : "native Pi rendering active";
    ctx.ui.notify(
      `Glance UI enabled: ${enabled ? "on" : "off"} · ${effect} · ${saved ? "saved" : "session only"}`,
      saved ? "info" : "warning",
    );
  };

  const applyPatches = async (turnOn, ctx) => {
    if (!turnOn) {
      patchesVersion = undefined;
      sharedRuntime.patchesVersion = undefined;
      sharedRuntime.patchesActive = false;
      syncLegacyPatchState();
      removePrivateSections();
      updatePatchPresentation(ctx);
      const saved = persistSettings(ctx);
      ctx.ui.requestRender?.();
      ctx.ui.notify(
        `Glance UI private patches: off · native layout active · ${saved ? "saved" : "session only"}`,
        saved ? "info" : "warning",
      );
      return;
    }
    if (!enabled) {
      ctx.ui.notify("Enable Glance UI before enabling private patches.", "warning");
      return;
    }
    if (!SUPPORTED_PATCH_VERSIONS.has(VERSION)) {
      ctx.ui.notify(
        `Glance UI private patches are not available for untested Pi ${VERSION}.`,
        "warning",
      );
      return;
    }
    if (patchesVersion === VERSION && sharedRuntime.patchesActive) {
      ctx.ui.notify(`Glance UI private patches are already on for Pi ${VERSION}.`, "info");
      return;
    }
    const confirmed = await ctx.ui.confirm(
      "Enable private layout patches?",
      `This applies tested in-memory prototype patches to Pi ${VERSION}. No installed files are changed. Approval expires when Pi's version changes.`,
    );
    if (!confirmed) {
      ctx.ui.notify("Glance UI private patches remain off.", "info");
      return;
    }
    const compatibility = await ensureLayoutPatch();
    if (!compatibility.ok) {
      notifyPatchFailure(ctx, compatibility);
      return;
    }
    patchesVersion = VERSION;
    sharedRuntime.patchesVersion = VERSION;
    syncLegacyPatchState();
    updatePatchPresentation(ctx);
    const saved = persistSettings(ctx);
    ctx.ui.requestRender?.();
    ctx.ui.notify(
      `Glance UI private patches: on for Pi ${VERSION} · ${saved ? "saved" : "session only"}`,
      saved ? "info" : "warning",
    );
  };

  const applyWorkingDetail = async (value, ctx) => {
    workingDetailMode = value;
    sharedRuntime.workingDetailMode = value;
    const saved = persistSettings(ctx);
    ctx.ui.notify(
      `Glance UI working-detail: ${value} · ${workingDetailEffects[value]} · ${saved ? "saved" : "session only"}`,
      saved ? "info" : "warning",
    );
  };

  const applySettingByKey = (key, value, ctx) => {
    if (key === "enabled") return applyEnabled(value === "on", ctx);
    if (key === "patches") return applyPatches(value === "on", ctx);
    if (key === "working-detail") return applyWorkingDetail(value, ctx);
    return undefined;
  };

  const settingsRows = () => [
    {
      key: "enabled",
      label: "enabled",
      value: enabled ? "on" : "off",
      values: ["on", "off"],
      effect: enabled ? "compact tool rendering is active" : "native Pi rendering is active",
    },
    {
      key: "patches",
      label: "patches",
      value: patchesVersion === VERSION && sharedRuntime.patchesActive ? "on" : "off",
      values: ["on", "off"],
      effect: `optional native transcript layout patches (${patchStatus()})`,
    },
    {
      key: "working-detail",
      label: "working-detail",
      value: workingDetailMode,
      values: [...WORKING_DETAIL_MODES],
      effect: workingDetailEffects[workingDetailMode],
    },
  ];

  const openSettingsPanel = async (ctx) => {
    if (typeof ctx.ui.custom !== "function") {
      ctx.ui.notify(settingsSummary(), "info");
      return;
    }
    await ctx.ui.custom((tui, theme, _keybindings, done) => new SettingsPanel({
      theme,
      getRows: settingsRows,
      onChange: (key, value) => applySettingByKey(key, value, ctx),
      requestRender: () => tui.requestRender(),
      onClose: () => done(undefined),
    }), {
      overlay: true,
      overlayOptions: {
        width: "60%",
        maxHeight: "70%",
        anchor: "center",
        margin: 1,
      },
    });
  };

  pi.registerCommand("glance-ui", {
    description: "Open the Glance UI settings panel or update a setting",
    handler: async (raw, ctx) => {
      const requested = raw.trim().toLowerCase();
      let tokens = requested ? requested.split(/\s+/) : [];

      if (tokens[0] === "install-patch") tokens = ["patches", "on"];
      // A bare `/glance-ui` opens the interactive, live-updating panel.
      if (tokens.length === 0) {
        await openSettingsPanel(ctx);
        return;
      }
      if (["settings", "config"].includes(tokens[0])) tokens = tokens.slice(1);
      if (
        tokens.length === 0
        || (tokens.length === 1 && ["list", "help"].includes(tokens[0]))
      ) {
        ctx.ui.notify(settingsSummary(), "info");
        return;
      }

      const [setting, value] = tokens;
      if (setting === "enabled" || (tokens.length === 1 && ["on", "off"].includes(setting))) {
        const requestedValue = setting === "enabled" ? value : setting;
        if (tokens.length > 2 || !["on", "off"].includes(requestedValue)) {
          ctx.ui.notify("Usage: /glance-ui settings enabled on|off", "warning");
          return;
        }
        await applyEnabled(requestedValue === "on", ctx);
        return;
      }

      if (setting === "patches") {
        if (tokens.length !== 2 || !["on", "off"].includes(value)) {
          ctx.ui.notify("Usage: /glance-ui patches on|off", "warning");
          return;
        }
        await applyPatches(value === "on", ctx);
        return;
      }

      if (setting === "working-detail") {
        if (tokens.length !== 2 || !WORKING_DETAIL_MODES.has(value)) {
          ctx.ui.notify(
            "Usage: /glance-ui settings working-detail auto|compact|expanded|hidden",
            "warning",
          );
          return;
        }
        await applyWorkingDetail(value, ctx);
        return;
      }

      ctx.ui.notify(
        "Unknown setting. Use /glance-ui settings to list valid names and values.",
        "warning",
      );
    },
  });
}

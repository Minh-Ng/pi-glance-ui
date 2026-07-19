import { loadGlanceUiConfig, saveGlanceUiConfig } from "./config.js";
import { activityPhaseForTool, compactWhitespace, compatibilityError, toolCategory } from "./format.js";
import { loadRunningPiRuntime } from "./pi-runtime.js";
import { compactDefinition } from "./tools.js";
import { clearAutoWorkingDetailTimers } from "./patches/tools.js";
import { ToolTimeline } from "./timeline.js";
import { SectionController, SectionNavigator } from "./ui/sections.js";
import { SettingsPanel } from "./ui/settings-panel.js";

export { loadGlanceUiConfig, saveGlanceUiConfig } from "./config.js";

export function rebuildActionSections({ timeline, sectionController, sessionManager }) {
  let messages;
  try {
    messages = sessionManager?.buildSessionContext?.().messages;
  } catch (error) {
    return { rebuilt: false, error: compatibilityError(error), toolCalls: 0, actionSections: 0 };
  }
  if (!Array.isArray(messages)) {
    return { rebuilt: false, error: "session context unavailable", toolCalls: 0, actionSections: 0 };
  }
  const toolCalls = messages.reduce(
    (count, message) => count + (
      message.role === "assistant" && Array.isArray(message.content)
        ? message.content.filter((item) => item.type === "toolCall").length
        : 0
    ),
    0,
  );
  if (toolCalls === 0) {
    return { rebuilt: false, error: "no tool calls in active context", toolCalls, actionSections: 0 };
  }
  sectionController.removeKinds(["tools"]);
  timeline.rebuildFromMessages(messages);
  timeline.finishTranscriptRebuild();
  const actionSections = sectionController.list().filter((section) => section.kind === "tools").length;
  return { rebuilt: actionSections > 0, toolCalls, actionSections };
}

const SHARED_RUNTIME_STATE = Symbol.for("pi-compact-ui.shared-runtime-state");
const MINIMUM_PATCH_VERSION = [0, 80, 8];
const MINIMUM_PATCH_VERSION_TEXT = MINIMUM_PATCH_VERSION.join(".");
const WORKING_DETAIL_MODES = new Set(["auto", "compact", "expanded", "hidden"]);
const TRANSCRIPT_SPACING_MODES = new Set(["dense", "separated"]);
const RETAINED_TOOL_CALL_VALUES = new Set(["all", "10", "25", "50"]);

export function isPatchVersionSupported(version) {
  if (typeof version !== "string") return false;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) return false;

  const current = match.slice(1, 4).map(Number);
  for (let index = 0; index < MINIMUM_PATCH_VERSION.length; index += 1) {
    if (current[index] !== MINIMUM_PATCH_VERSION[index]) {
      return current[index] > MINIMUM_PATCH_VERSION[index];
    }
  }
  return match[4] === undefined;
}

function requiresFreshContainer(current, fallback) {
  if (fallback instanceof Map) return !(current instanceof Map);
  if (fallback instanceof Set) return !(current instanceof Set);
  if (Array.isArray(fallback)) return !Array.isArray(current);
  return false;
}

function migrateInstance(instance, fallback, prototype) {
  if (!instance || typeof instance !== "object") return fallback;
  try {
    Object.setPrototypeOf(instance, prototype);
  } catch {
    return fallback;
  }
  for (const property of Reflect.ownKeys(fallback)) {
    const current = instance[property];
    if (
      Object.hasOwn(instance, property)
      && !requiresFreshContainer(current, fallback[property])
    ) continue;
    Object.defineProperty(
      instance,
      property,
      Object.getOwnPropertyDescriptor(fallback, property),
    );
  }
  return instance;
}

function migrateSharedRuntime(candidate) {
  const sharedRuntime = candidate
    && typeof candidate === "object"
    && !(candidate instanceof WeakMap)
    ? candidate
    : {};
  const nextSectionController = new SectionController();
  const sectionController = migrateInstance(
    sharedRuntime.sectionController,
    nextSectionController,
    SectionController.prototype,
  );
  const timeline = migrateInstance(
    sharedRuntime.timeline,
    new ToolTimeline(sectionController),
    ToolTimeline.prototype,
  );
  timeline.sectionController = sectionController;
  sharedRuntime.sectionController = sectionController;
  sharedRuntime.timeline = timeline;
  return sharedRuntime;
}

export default function glanceUi(pi) {
  let cwd;
  // Pi owns one interactive transcript per process and rebuilds it before newly
  // reloaded extension handlers run. Preserve that transcript's runtime through
  // the handoff so existing tool components never fall back to full output.
  const sharedRuntime = migrateSharedRuntime(globalThis[SHARED_RUNTIME_STATE]);
  globalThis[SHARED_RUNTIME_STATE] = sharedRuntime;
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
  let transcriptSpacing = persistedConfig.transcriptSpacing
    ?? sharedRuntime.transcriptSpacing
    ?? "separated";
  let retainedToolCalls = persistedConfig.retainedToolCalls
    ?? sharedRuntime.retainedToolCalls
    ?? "all";
  let lastSectionRecovery;
  // Session replacement loads the next extension generation before Pi replays
  // the selected transcript, then emits session_start afterward. Keep already
  // installed wrappers active through that replay only when the new generation
  // reads the same persisted consent. Otherwise historical components are
  // constructed natively and cannot be retrofitted once session_start arrives.
  const inheritedPatchesActive = enabled
    && sharedRuntime.patchesActive === true
    && sharedRuntime.patchesVersion === patchesVersion;
  sharedRuntime.publicEnabled = enabled;
  sharedRuntime.patchesVersion = patchesVersion;
  sharedRuntime.patchesActive = inheritedPatchesActive;
  sharedRuntime.workingDetailMode = workingDetailMode;
  sharedRuntime.transcriptSpacing = transcriptSpacing;
  sharedRuntime.retainedToolCalls = retainedToolCalls;
  timeline.setCollapsedActionLimit(retainedToolCalls);
  // Wrappers from builds predating explicit consent consult this legacy slot.
  sharedRuntime.enabled = inheritedPatchesActive;
  let layoutPatch;
  let patchInstallInProgress = false;
  let runningPiRuntime;
  let runningPiRuntimePromise;

  const ensureRunningPiRuntime = async () => {
    if (!runningPiRuntimePromise) {
      runningPiRuntimePromise = loadRunningPiRuntime().then((runtime) => {
        runningPiRuntime = runtime;
        return runtime;
      });
    }
    return runningPiRuntimePromise;
  };
  const runningPiVersion = () => runningPiRuntime?.version;

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
    transcriptSpacing,
    retainedToolCalls,
  });
  const workingDetailEffects = {
    auto: "tools stay expanded while running and for 5s after the completed result renders",
    compact: "running tools stay compact",
    expanded: "running tools follow Ctrl+O",
    hidden: "running tools appear when they finish",
  };
  const transcriptSpacingEffects = {
    dense: "Thinking and action clusters have only outer spacing",
    separated: "every Thinking block has a leading blank",
  };
  const retainedToolsEffect = () => retainedToolCalls === "all"
    ? "all compact tool rows remain stable; full history stays in Sections"
    : `rolling last ${retainedToolCalls} compact rows; full history stays in Sections`;
  const patchStatus = () => patchesVersion === runningPiVersion() && sharedRuntime.patchesActive
    ? `on for Pi ${runningPiVersion()}`
    : patchesVersion && patchesVersion !== runningPiVersion()
      ? `off (approval was for Pi ${patchesVersion})`
      : "off";
  const settingsSummary = () => [
    "Glance UI settings",
    `enabled: ${enabled ? "on" : "off"} (on|off) — ${enabled ? "compact tool rendering is active" : "native Pi rendering is active"}`,
    `patches: ${patchStatus()} (on|off) — required for Thinking, artifacts, errors, custom tools, and the full section viewer`,
    `working-detail: ${workingDetailMode} (auto|compact|expanded|hidden) — ${workingDetailEffects[workingDetailMode]}`,
    `transcript-spacing: ${transcriptSpacing} (dense|separated) — ${transcriptSpacingEffects[transcriptSpacing]}`,
    `retained-tools: ${retainedToolCalls} (all|10|25|50) — ${retainedToolsEffect()}`,
    ...(lastSectionRecovery
      ? [`sections: ${lastSectionRecovery.actionSections} action groups from ${lastSectionRecovery.toolCalls} calls${lastSectionRecovery.error ? ` — ${lastSectionRecovery.error}` : ""}`]
      : []),
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
    if (isEnabled()) {
      lastSectionRecovery = rebuildActionSections({
        timeline,
        sectionController,
        sessionManager: ctx.sessionManager,
      });
    }
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
      viewportRows: () => _tui?.terminal?.rows,
    }), {
      overlay: true,
      overlayOptions: {
        width: "90%",
        maxHeight: "85%",
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
    if (!runningPiRuntime) throw new Error("running Pi runtime is not initialized");
    for (const factory of runningPiRuntime.toolFactories) {
      const original = factory(nextCwd);
      pi.registerTool(isEnabled() ? compactDefinition(original, timeline, isEnabled) : original);
    }
    updatePatchPresentation(ctx);
  };

  const ensureLayoutPatch = async () => {
    const runtime = await ensureRunningPiRuntime();
    if (!isPatchVersionSupported(runtime.version)) {
      return {
        ok: false,
        error: `Pi ${runtime.version} does not satisfy the patch requirement >=${MINIMUM_PATCH_VERSION_TEXT}`,
      };
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
          {
            codingAgentEntryUrl: runtime.entryUrl,
            getTranscriptSpacingMode: () => sharedRuntime.transcriptSpacing ?? transcriptSpacing,
          },
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
    const runtime = await ensureRunningPiRuntime();
    if (
      persistedConfig.enabled !== enabled
      || persistedConfig.patchesVersion !== patchesVersion
      || persistedConfig.workingDetailMode !== workingDetailMode
      || persistedConfig.transcriptSpacing !== transcriptSpacing
      || persistedConfig.retainedToolCalls !== retainedToolCalls
    ) {
      persistSettings(ctx);
    }

    // Remove activity-brief state left by older Compact UI builds.
    ctx.ui.setWidget?.("compact-ui-activity", undefined);
    ctx.ui.setWidget?.("glance-ui-activity", undefined);
    // Keep the legacy Symbol namespace so a hot reload recognizes existing patches.
    ctx.ui[Symbol.for("pi-compact-ui.widget-tracker")]?.listeners?.clear();

    installTools(ctx.cwd, ctx);
    if (enabled && patchesVersion === runtime.version) {
      const compatibility = await ensureLayoutPatch();
      updatePatchPresentation(ctx);
      if (!compatibility.ok) notifyPatchFailure(ctx, compatibility);
    } else if (patchesVersion && patchesVersion !== runtime.version) {
      ctx.ui.notify(
        `Glance UI: private patches remain off on Pi ${runtime.version}; approval was for Pi ${patchesVersion}.`,
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
    clearAutoWorkingDetailTimers();
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
    const runtime = await ensureRunningPiRuntime();
    enabled = nextEnabled;
    sharedRuntime.publicEnabled = enabled;
    if (enabled && patchesVersion === runtime.version) {
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
    const runtime = await ensureRunningPiRuntime();
    if (!isPatchVersionSupported(runtime.version)) {
      ctx.ui.notify(
        `Glance UI private patches require Pi >=${MINIMUM_PATCH_VERSION_TEXT}; found ${runtime.version}.`,
        "warning",
      );
      return;
    }
    if (patchesVersion === runtime.version && sharedRuntime.patchesActive) {
      ctx.ui.notify(`Glance UI private patches are already on for Pi ${runtime.version}.`, "info");
      return;
    }
    const confirmed = await ctx.ui.confirm(
      "Enable private layout patches?",
      `This applies guarded in-memory prototype patches to Pi ${runtime.version}. Compatibility is probed before activation, no installed files are changed, and approval expires when Pi's version changes.`,
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
    patchesVersion = runtime.version;
    sharedRuntime.patchesVersion = runtime.version;
    syncLegacyPatchState();
    updatePatchPresentation(ctx);
    const saved = persistSettings(ctx);
    ctx.ui.requestRender?.();
    ctx.ui.notify(
      `Glance UI private patches: on for Pi ${runtime.version} · ${saved ? "saved" : "session only"}`,
      saved ? "info" : "warning",
    );
  };

  const applyWorkingDetail = async (value, ctx) => {
    clearAutoWorkingDetailTimers();
    workingDetailMode = value;
    sharedRuntime.workingDetailMode = value;
    const saved = persistSettings(ctx);
    ctx.ui.requestRender?.();
    ctx.ui.notify(
      `Glance UI working-detail: ${value} · ${workingDetailEffects[value]} · ${saved ? "saved" : "session only"}`,
      saved ? "info" : "warning",
    );
  };

  const applyTranscriptSpacing = async (value, ctx) => {
    transcriptSpacing = value;
    sharedRuntime.transcriptSpacing = value;
    const saved = persistSettings(ctx);
    ctx.ui.requestRender?.();
    ctx.ui.notify(
      `Glance UI transcript-spacing: ${value} · ${transcriptSpacingEffects[value]} · ${saved ? "saved" : "session only"}`,
      saved ? "info" : "warning",
    );
  };

  const applyRetainedTools = async (value, ctx) => {
    retainedToolCalls = value === "all" ? "all" : Number(value);
    sharedRuntime.retainedToolCalls = retainedToolCalls;
    timeline.setCollapsedActionLimit(retainedToolCalls);
    const saved = persistSettings(ctx);
    ctx.ui.requestRender?.();
    ctx.ui.notify(
      `Glance UI retained-tools: ${retainedToolCalls} · ${retainedToolsEffect()} · ${saved ? "saved" : "session only"}`,
      saved ? "info" : "warning",
    );
  };

  const applySettingByKey = (key, value, ctx) => {
    if (key === "enabled") return applyEnabled(value === "on", ctx);
    if (key === "patches") return applyPatches(value === "on", ctx);
    if (key === "working-detail") return applyWorkingDetail(value, ctx);
    if (key === "transcript-spacing") return applyTranscriptSpacing(value, ctx);
    if (key === "retained-tools") return applyRetainedTools(value, ctx);
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
      value: patchesVersion === runningPiVersion() && sharedRuntime.patchesActive ? "on" : "off",
      values: ["on", "off"],
      effect: `required for the full viewer and transcript presentation (${patchStatus()})`,
    },
    {
      key: "working-detail",
      label: "working-detail",
      value: workingDetailMode,
      values: [...WORKING_DETAIL_MODES],
      effect: workingDetailEffects[workingDetailMode],
    },
    {
      key: "transcript-spacing",
      label: "transcript-spacing",
      value: transcriptSpacing,
      values: [...TRANSCRIPT_SPACING_MODES],
      effect: transcriptSpacingEffects[transcriptSpacing],
    },
    {
      key: "retained-tools",
      label: "retained-tools",
      value: String(retainedToolCalls),
      values: [...RETAINED_TOOL_CALL_VALUES],
      effect: retainedToolsEffect(),
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
    }));
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

      if (setting === "transcript-spacing") {
        if (tokens.length !== 2 || !TRANSCRIPT_SPACING_MODES.has(value)) {
          ctx.ui.notify(
            "Usage: /glance-ui settings transcript-spacing dense|separated",
            "warning",
          );
          return;
        }
        await applyTranscriptSpacing(value, ctx);
        return;
      }

      if (setting === "retained-tools") {
        if (tokens.length !== 2 || !RETAINED_TOOL_CALL_VALUES.has(value)) {
          ctx.ui.notify(
            "Usage: /glance-ui settings retained-tools all|10|25|50",
            "warning",
          );
          return;
        }
        await applyRetainedTools(value, ctx);
        return;
      }

      ctx.ui.notify(
        "Unknown setting. Use /glance-ui settings to list valid names and values.",
        "warning",
      );
    },
  });
}

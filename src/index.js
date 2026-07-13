import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";

import { loadGlanceUiConfig, saveGlanceUiConfig } from "./config.js";
import { activityPhaseForTool, compactWhitespace, compatibilityError, toolCategory } from "./format.js";
import { patchHiddenThinkingLayout } from "./patches/layout.js";
import { compactDefinition } from "./patches/tools.js";
import { ToolTimeline } from "./timeline.js";
import { SectionController, SectionNavigator } from "./ui/sections.js";

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
  let enabled = persistedConfig.enabled
    ?? sharedRuntime.enabled
    ?? true;
  let workingDetailMode = persistedConfig.workingDetailMode
    ?? sharedRuntime.workingDetailMode
    ?? "auto";
  sharedRuntime.enabled = enabled;
  sharedRuntime.workingDetailMode = workingDetailMode;
  let layoutPatch;

  const isEnabled = () => sharedRuntime.enabled;
  const currentSettings = () => ({ enabled, workingDetailMode });
  const workingDetailEffects = {
    auto: "only the bottom-most running tool stays compact",
    compact: "running tools stay compact",
    expanded: "running tools follow Ctrl+O",
    hidden: "running tools appear when they finish",
  };
  const settingsSummary = () => [
    "Glance UI settings",
    `enabled: ${enabled ? "on" : "off"} (on|off) — ${enabled ? "compact transcript rendering is active" : "native Pi rendering is active"}`,
    `working-detail: ${workingDetailMode} (auto|compact|expanded|hidden) — ${workingDetailEffects[workingDetailMode]}`,
    "Change: /glance-ui settings <name> <value>",
    "Sections: /sections or Ctrl+Shift+O",
  ].join("\n");

  const persistSettings = (ctx) => {
    try {
      const config = currentSettings();
      saveGlanceUiConfig(config);
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

  const install = (nextCwd, ctx) => {
    cwd = nextCwd;
    for (const factory of TOOL_FACTORIES) {
      const original = factory(nextCwd);
      pi.registerTool(isEnabled() ? compactDefinition(original, timeline, isEnabled) : original);
    }
    ctx?.ui.setHiddenThinkingLabel(
      enabled ? "Thinking hidden · Ctrl+T to show" : undefined,
    );
  };

  pi.on("session_start", async (_event, ctx) => {
    if (
      persistedConfig.enabled !== enabled
      || persistedConfig.workingDetailMode !== workingDetailMode
    ) {
      persistSettings(ctx);
    }

    // Remove activity-brief state left by older Compact UI builds.
    ctx.ui.setWidget?.("compact-ui-activity", undefined);
    ctx.ui.setWidget?.("glance-ui-activity", undefined);
    // Keep the legacy Symbol namespace so a hot reload recognizes existing patches.
    ctx.ui[Symbol.for("pi-compact-ui.widget-tracker")]?.listeners?.clear();

    // User-message compatibility probing needs Pi's theme, which is not initialized
    // while extensions are first imported. Defer all private layout patches until
    // session_start so a probe failure cannot prevent the tool-spacing patch.
    layoutPatch = patchHiddenThinkingLayout(
      timeline,
      sectionController,
      isEnabled,
      () => workingDetailMode,
    );
    const compatibility = await layoutPatch;
    install(ctx.cwd, ctx);
    if (!compatibility.ok) {
      const reason = compactWhitespace(compatibility.error).slice(0, 120);
      ctx.ui.notify(
        `Glance UI: layout extras unavailable (${reason}). Compact tools remain active.`,
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

  pi.registerCommand("glance-ui", {
    description: "Show or update persistent Glance UI settings",
    handler: async (raw, ctx) => {
      const requested = raw.trim().toLowerCase();
      let tokens = requested ? requested.split(/\s+/) : [];

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
        enabled = requestedValue === "on";
        sharedRuntime.enabled = enabled;
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
        install(ctx.cwd || cwd || process.cwd(), ctx);
        ctx.ui.requestRender();
        const effect = enabled ? "compact rendering active" : "native Pi rendering active";
        ctx.ui.notify(
          `Glance UI enabled: ${requestedValue} · ${effect} · ${saved ? "saved" : "session only"}`,
          saved ? "info" : "warning",
        );
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
        workingDetailMode = value;
        sharedRuntime.workingDetailMode = value;
        const saved = persistSettings(ctx);
        ctx.ui.notify(
          `Glance UI working-detail: ${value} · ${workingDetailEffects[value]} · ${saved ? "saved" : "session only"}`,
          saved ? "info" : "warning",
        );
        return;
      }

      ctx.ui.notify(
        "Unknown setting. Use /glance-ui settings to list valid names and values.",
        "warning",
      );
    },
  });
}

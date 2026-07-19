import { activityPhaseForTool, formatDuration, getToolErrorMessage, groupLabel, groupLabelColor, renderBlockHeading, sanitizeTerminalText, summarize, toolAction, toolCategory } from "../format.js";
import { RecentToolSummary } from "../timeline.js";

const ORIGINAL_TOOL_DEFINITION = Symbol.for("pi-compact-ui.original-tool-definition");
const TOOL_HAS_VISIBLE_ROWS = Symbol.for("pi-glance-ui:tool-has-visible-rows");
const AUTO_DETAIL_TIMERS = Symbol.for("pi-glance-ui:auto-detail-timers");
const AUTO_DETAIL_GENERATION = Symbol.for("pi-glance-ui:auto-detail-generation");

export const AUTO_WORKING_DETAIL_MIN_EXPANDED_MS = 5_000;

export function clearAutoWorkingDetailTimers() {
  const timers = globalThis[AUTO_DETAIL_TIMERS];
  if (timers instanceof Set) {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }
  globalThis[AUTO_DETAIL_GENERATION] = Number(globalThis[AUTO_DETAIL_GENERATION] ?? 0) + 1;
}

export function removeBlankOnlyToolRows(lines) {
  if (!Array.isArray(lines)) return lines;
  const hasVisibleRows = lines.some(
    (line) => sanitizeTerminalText(line).replaceAll("\u2800", " ").trim().length > 0,
  );
  return hasVisibleRows ? lines : [];
}

function rememberVisibleRows(component, lines) {
  const visibleLines = removeBlankOnlyToolRows(lines);
  component[TOOL_HAS_VISIBLE_ROWS] = visibleLines.length > 0;
  return visibleLines;
}

export async function patchCompactToolSpacing(
  codingAgentEntryUrl,
  timeline,
  isEnabled,
  getWorkingDetailMode,
  transaction,
) {
  const baseRenderMethod = Symbol.for("pi-compact-ui.tool-execution-base-render");
  const baseSetExpandedMethod = Symbol.for("pi-compact-ui.tool-execution-base-set-expanded");
  const baseSetArgsCompleteMethod = Symbol.for("pi-compact-ui.tool-execution-base-set-args-complete");
  const baseMarkExecutionStartedMethod = Symbol.for("pi-compact-ui.tool-execution-base-mark-execution-started");
  const baseUpdateDisplayMethod = Symbol.for("pi-compact-ui.tool-execution-base-update-display");
  const nativeComponents = new WeakMap();
  const timing = new WeakMap();
  const autoDetailTiming = new WeakMap();
  // A hot reload installs a new patch closure. Invalidate pending callbacks
  // from the previous generation before adopting the process-global registry.
  clearAutoWorkingDetailTimers();
  const autoDetailTimers = new Set();
  globalThis[AUTO_DETAIL_TIMERS] = autoDetailTimers;
  const currentAutoDetailState = (component) => {
    const state = autoDetailTiming.get(component);
    if (!state || state.generation === globalThis[AUTO_DETAIL_GENERATION]) return state;
    autoDetailTiming.delete(component);
    return undefined;
  };
  const getOrCreateAutoDetailState = (component) => {
    let state = currentAutoDetailState(component);
    if (!state) {
      state = { generation: globalThis[AUTO_DETAIL_GENERATION] };
      autoDetailTiming.set(component, state);
    }
    return state;
  };
  const clearAutoDetailTimer = (component, { forget = true } = {}) => {
    const state = currentAutoDetailState(component);
    if (!state) return;
    if (state.timer !== undefined) {
      clearTimeout(state.timer);
      autoDetailTimers.delete(state.timer);
      state.timer = undefined;
    }
    if (forget) autoDetailTiming.delete(component);
  };
  const rememberFullAutoDetailRender = (component) => {
    const state = getOrCreateAutoDetailState(component);
    if (state.fullRenderedAt !== undefined) return;
    state.fullRenderedAt = Date.now();
    state.timer = setTimeout(() => {
      autoDetailTimers.delete(state.timer);
      state.timer = undefined;
      if (
        state.generation === globalThis[AUTO_DETAIL_GENERATION]
        && getWorkingDetailMode() === "auto"
        && !component.isPartial
        && component.result
      ) component.ui?.requestRender?.();
    }, AUTO_WORKING_DETAIL_MIN_EXPANDED_MS);
    autoDetailTimers.add(state.timer);
  };
  const moduleUrl = new URL(
    "./modes/interactive/components/tool-execution.js",
    codingAgentEntryUrl,
  );
  const themeUrl = new URL("./modes/interactive/theme/theme.js", codingAgentEntryUrl);
  const [{ ToolExecutionComponent }, { theme }] = await Promise.all([
    import(moduleUrl.href),
    import(themeUrl.href),
  ]);
  if (typeof ToolExecutionComponent !== "function") {
    throw new Error("ToolExecutionComponent is unavailable");
  }

  const prototype = ToolExecutionComponent.prototype;
  if (typeof prototype.render !== "function" || typeof prototype.setExpanded !== "function") {
    throw new Error("tool execution layout has changed");
  }
  transaction?.capture(prototype, [
    "render",
    "setExpanded",
    "setArgsComplete",
    "markExecutionStarted",
    "updateDisplay",
    baseRenderMethod,
    baseSetExpandedMethod,
    baseSetArgsCompleteMethod,
    baseMarkExecutionStartedMethod,
    baseUpdateDisplayMethod,
  ]);
  if (!prototype[baseRenderMethod]) prototype[baseRenderMethod] = prototype.render;
  if (!prototype[baseSetExpandedMethod]) {
    prototype[baseSetExpandedMethod] = prototype.setExpanded;
  }
  if (!prototype[baseSetArgsCompleteMethod]) {
    prototype[baseSetArgsCompleteMethod] = prototype.setArgsComplete;
  }
  if (!prototype[baseMarkExecutionStartedMethod]) {
    prototype[baseMarkExecutionStartedMethod] = prototype.markExecutionStarted;
  }
  if (!prototype[baseUpdateDisplayMethod]) {
    prototype[baseUpdateDisplayMethod] = prototype.updateDisplay;
  }
  const baseRender = prototype[baseRenderMethod];
  const baseSetExpanded = prototype[baseSetExpandedMethod];
  const baseSetArgsComplete = prototype[baseSetArgsCompleteMethod];
  const baseMarkExecutionStarted = prototype[baseMarkExecutionStartedMethod];
  const baseUpdateDisplay = prototype[baseUpdateDisplayMethod];
  const renderNative = (component, width) => {
    const toolDefinition = component.toolDefinition;
    const originalDefinition = toolDefinition?.[ORIGINAL_TOOL_DEFINITION];
    const needsGenericDetailRenderer = toolDefinition
      && typeof toolDefinition.renderCall !== "function"
      && typeof toolDefinition.renderResult !== "function";
    if (!originalDefinition && !needsGenericDetailRenderer) {
      return baseRender.call(component, width);
    }
    // Pi treats the mere presence of a custom tool definition as an instruction
    // to suppress generic JSON arguments, even when it provides no renderers.
    // Recreate renderer-less tools without that empty definition so expanded
    // mode uses Pi's complete name + arguments + result fallback.
    const expandedDefinition = originalDefinition;
    let record = nativeComponents.get(component);
    if (!record || record.definition !== expandedDefinition) {
      const native = new ToolExecutionComponent(
        component.toolName,
        component.toolCallId,
        component.args,
        {
          showImages: component.showImages,
          imageWidthCells: component.imageWidthCells,
        },
        expandedDefinition,
        component.ui,
        component.cwd,
      );
      const clock = timing.get(component);
      const startedAt = component.rendererState.compactStartedAt ?? clock?.started;
      const endedAt = component.rendererState.compactEndedAt ?? clock?.ended;
      if (startedAt !== undefined) native.rendererState.startedAt = startedAt;
      if (endedAt !== undefined) native.rendererState.endedAt = endedAt;
      record = { component: native, definition: expandedDefinition };
      nativeComponents.set(component, record);
    }
    const native = record.component;
    const convertedImageCount = component.convertedImages.size;
    const changed = record.args !== component.args
      || record.expanded !== component.expanded
      || record.showImages !== component.showImages
      || record.imageWidthCells !== component.imageWidthCells
      || record.executionStarted !== component.executionStarted
      || record.argsComplete !== component.argsComplete
      || record.result !== component.result
      || record.isPartial !== component.isPartial
      || record.convertedImageCount !== convertedImageCount;
    if (changed) {
      native.args = component.args;
      native.expanded = component.expanded;
      native.showImages = component.showImages;
      native.imageWidthCells = component.imageWidthCells;
      native.executionStarted = component.executionStarted;
      native.argsComplete = component.argsComplete;
      native.result = component.result;
      native.isPartial = component.isPartial;
      native.convertedImages = component.convertedImages;
      native.updateDisplay();
      Object.assign(record, {
        args: component.args,
        expanded: component.expanded,
        showImages: component.showImages,
        imageWidthCells: component.imageWidthCells,
        executionStarted: component.executionStarted,
        argsComplete: component.argsComplete,
        result: component.result,
        isPartial: component.isPartial,
        convertedImageCount,
      });
    }
    return baseRender.call(native, width);
  };
  const renderExpandedDetail = (component, width) => {
    const wasExpanded = component.expanded;
    if (!wasExpanded) baseSetExpanded.call(component, true);
    try {
      const needsGenericDetailRenderer = component.toolDefinition
        && typeof component.toolDefinition.renderCall !== "function"
        && typeof component.toolDefinition.renderResult !== "function";
      return needsGenericDetailRenderer
        ? renderNative(component, width)
        : baseRender.call(component, width);
    } finally {
      if (!wasExpanded) baseSetExpanded.call(component, false);
    }
  };

  const attachTimelineComponent = (component) => {
    const entry = timeline.register(
      component.toolCallId,
      toolCategory(component.toolName, component.args),
      activityPhaseForTool(component.toolName, component.args),
    );
    if (!entry.isTracked) return;
    timeline.attachComponent(
      entry,
      component,
      (isExpanded) => baseSetExpanded.call(component, isExpanded),
      (detailWidth) => renderExpandedDetail(component, detailWidth),
    );
  };

  // Transcript reconstruction creates tool components without necessarily
  // rendering off-screen rows. Attach during updateDisplay so /reload restores
  // action sections even before those rows enter the viewport.
  prototype.updateDisplay = function compactToolDisplay() {
    const result = baseUpdateDisplay.call(this);
    if (isEnabled()) attachTimelineComponent(this);
    return result;
  };

  // Live message completion calls this method; transcript reconstruction does
  // not. The marker lets fast tools retain their full render even if the result
  // arrives before the TUI paints an intermediate frame.
  prototype.setArgsComplete = function compactToolArgsComplete() {
    if (isEnabled() && getWorkingDetailMode() === "auto" && this.isPartial) {
      getOrCreateAutoDetailState(this).live = true;
    }
    return baseSetArgsComplete.call(this);
  };

  // Pi completes assistant arguments before emitting tool_execution_start.
  // markExecutionStarted is therefore the first reliable live-only point at
  // which auto detail can be armed; transcript reconstruction never calls it.
  prototype.markExecutionStarted = function compactToolExecutionStarted() {
    if (isEnabled() && getWorkingDetailMode() === "auto" && this.isPartial) {
      const state = getOrCreateAutoDetailState(this);
      state.live = true;
      state.autoCandidate = true;
    }
    return baseMarkExecutionStarted.call(this);
  };

  prototype.setExpanded = function compactToolExpansion(isExpanded) {
    if (!isEnabled()) return baseSetExpanded.call(this, isExpanded);
    // Pi applies its global expansion baseline before execution starts. The
    // default collapsed baseline enables auto preview, but an already-expanded
    // baseline—and every user toggle after execution starts—must win over it.
    const existingAutoState = currentAutoDetailState(this);
    if (
      getWorkingDetailMode() === "auto"
      && (this.executionStarted || existingAutoState?.live || isExpanded)
    ) {
      const state = existingAutoState ?? getOrCreateAutoDetailState(this);
      state.manualExpansion = Boolean(isExpanded);
      clearAutoDetailTimer(this, { forget: false });
    }
    timeline.setGlobalExpanded(this.toolCallId, isExpanded);
    const entry = timeline.entriesById.get(this.toolCallId);
    const effectiveExpansion = entry?.group.expandedOverride ?? isExpanded;
    return baseSetExpanded.call(this, effectiveExpansion);
  };
  prototype.render = function compactToolSpacing(width) {
    if (!isEnabled()) return rememberVisibleRows(this, renderNative(this, width));
    const timelineEntry = timeline.entriesById.get(this.toolCallId);
    const workingDetailMode = getWorkingDetailMode();
    if (
      workingDetailMode === "hidden"
      && this.isPartial
      && timelineEntry?.group.expandedOverride !== true
    ) {
      const category = toolCategory(this.toolName, this.args);
      const entry = timeline.register(
        this.toolCallId,
        category,
        activityPhaseForTool(this.toolName, this.args),
      );
      if (!entry.isTracked) return rememberVisibleRows(this, []);
      entry.workingCompact = true;
      timeline.attachComponent(
        entry,
        this,
        (isExpanded) => baseSetExpanded.call(this, isExpanded),
        (detailWidth) => renderExpandedDetail(this, detailWidth),
      );
      timeline.update(entry, { state: "running", theme, detail: () => [] });
      return rememberVisibleRows(this, []);
    }
    const isCurrentWorkingEntry = timeline.isCurrentWorkingEntry(timelineEntry);
    let autoDetailState = currentAutoDetailState(this);
    // Re-entering auto mode resets timer generations. A currently running tool
    // can safely establish a fresh candidate from its next full render.
    if (
      !autoDetailState
      && workingDetailMode === "auto"
      && this.isPartial
      && this.executionStarted
      && isCurrentWorkingEntry
    ) {
      autoDetailState = getOrCreateAutoDetailState(this);
      autoDetailState.live = true;
      autoDetailState.autoCandidate = true;
    }
    const autoDetailManaged = workingDetailMode === "auto"
      && autoDetailState?.live === true
      && autoDetailState.autoCandidate === true
      && autoDetailState.manualExpansion === undefined
      && timelineEntry?.group.expandedOverride === undefined;
    const autoDetailEligible = autoDetailManaged && !this.isPartial && Boolean(this.result);
    if (!autoDetailManaged) clearAutoDetailTimer(this, {
      forget: autoDetailState?.manualExpansion === undefined,
    });
    const fullRenderAt = currentAutoDetailState(this)?.fullRenderedAt;
    const autoMinimumElapsed = fullRenderAt !== undefined
      && Date.now() - fullRenderAt >= AUTO_WORKING_DETAIL_MIN_EXPANDED_MS;
    const autoExpandedPreview = autoDetailManaged
      && (this.isPartial || !this.result || !autoMinimumElapsed);
    const compactWorkingTool = timelineEntry?.group.expandedOverride !== true
      && (
        workingDetailMode === "compact"
      );
    if ((!this.expanded && !autoExpandedPreview) || compactWorkingTool) {
      let clock = timing.get(this);
      if (!clock) {
        clock = {};
        timing.set(this, clock);
      }
      if (this.executionStarted && clock.started === undefined) clock.started = Date.now();
      if (!this.isPartial && clock.started !== undefined && clock.ended === undefined) {
        clock.ended = Date.now();
      }

      const failed = !this.isPartial && Boolean(this.result?.isError);
      const state = failed ? "failed" : this.isPartial ? "running" : "complete";
      const category = toolCategory(this.toolName, this.args);
      const phase = activityPhaseForTool(this.toolName, this.args);
      const color = failed
        ? "error"
        : this.isPartial ? "warning" : groupLabelColor(category);
      const elapsed = clock.ended !== undefined
        ? ` · ${formatDuration(clock.ended - clock.started)}`
        : "";
      const label = summarize(this.toolName, this.args || {}, this.cwd);
      const detail = (connector) => {
        const status = failed ? theme.fg("error", " · failed") : "";
        const lines = [
          `${theme.fg("dim", `  ${connector} `)}${theme.fg(color, toolAction(this.toolName))} ${theme.fg("toolOutput", label)}${status}${theme.fg("dim", elapsed)}`,
        ];
        const errorMessage = failed ? getToolErrorMessage(this.result) : "";
        if (errorMessage) {
          lines.push(
            `${theme.fg("dim", "    │ ")}${theme.fg("error", "Error:")} ${theme.fg("text", errorMessage)}`,
          );
        }
        return lines;
      };
      const entry = timeline.register(this.toolCallId, category, phase);
      if (!entry.isTracked) {
        // Pi creates and renders a partial tool component while the model is
        // still streaming its arguments, before tool_execution_start can make
        // the timeline entry active. Keep that frame compact without adopting
        // its incomplete classification into the persistent timeline.
        if (compactWorkingTool && this.isPartial) {
          return rememberVisibleRows(this, timeline.renderTransientEntry({
            category,
            phase,
            state,
            detail,
            theme,
          }, width));
        }
        return rememberVisibleRows(this, renderNative(this, width));
      }
      entry.workingCompact = compactWorkingTool;
      timeline.attachComponent(
        entry,
        this,
        (isExpanded) => baseSetExpanded.call(this, isExpanded),
        (detailWidth) => renderExpandedDetail(this, detailWidth),
      );
      timeline.update(entry, { state, theme, detail });
      return rememberVisibleRows(this, new RecentToolSummary(timeline, entry).render(width));
    }

    // Expanded mode owns rich output (diffs, images, and output panels). Add
    // only a group heading; never re-frame, indent, resize, or trim its rows.
    // Terminal images reserve their height with trailing empty rows, so altering
    // those rows makes later content draw over the image.
    const category = toolCategory(this.toolName, this.args);
    const entry = timeline.register(this.toolCallId, category);
    if (!entry.isTracked) return rememberVisibleRows(this, renderNative(this, width));
    entry.workingCompact = false;
    timeline.attachComponent(
      entry,
      this,
      (isExpanded) => baseSetExpanded.call(this, isExpanded),
      (detailWidth) => renderExpandedDetail(this, detailWidth),
    );
    const failed = !this.isPartial && Boolean(this.result?.isError);
    entry.state = failed ? "failed" : this.isPartial ? "running" : "complete";

    const needsGenericDetailRenderer = this.toolDefinition
      && typeof this.toolDefinition.renderCall !== "function"
      && typeof this.toolDefinition.renderResult !== "function";
    const content = autoExpandedPreview && !this.expanded
      ? renderExpandedDetail(this, width)
      : needsGenericDetailRenderer
        ? renderNative(this, width)
        : baseRender.call(this, width);
    // Start the auto-collapse clock only after the completed result has
    // actually rendered in expanded form. Running/partial frames do not count.
    if (autoDetailEligible) rememberFullAutoDetailRender(this);
    const prefix = [];
    const isDetachedEntry = entry.detached && entry.group.entries[0] !== entry;
    if (entry.firstInAgent && !entry.detached) prefix.push("\u2800");
    if (entry.group.entries[0] === entry || isDetachedEntry) {
      const states = isDetachedEntry
        ? [entry.state]
        : entry.group.entries.map((item) => item.state);
      const state = states.includes("failed")
        ? "failed"
        : states.includes("running") ? "running" : "complete";
      prefix.push(renderBlockHeading(theme, {
        label: groupLabel(category),
        labelColor: groupLabelColor(category),
        state,
        isExpanded: true,
      }));
    }
    return rememberVisibleRows(this, [...prefix, ...content]);
  };
}

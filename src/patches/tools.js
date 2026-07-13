import { activityPhaseForTool, formatDuration, getToolErrorMessage, groupLabel, groupLabelColor, renderBlockHeading, summarize, toolAction, toolCategory } from "../format.js";
import { RecentToolSummary } from "../timeline.js";

const ORIGINAL_TOOL_DEFINITION = Symbol.for("pi-compact-ui.original-tool-definition");

export async function patchCompactToolSpacing(
  codingAgentEntryUrl,
  timeline,
  isEnabled,
  getWorkingDetailMode,
  transaction,
) {
  const baseRenderMethod = Symbol.for("pi-compact-ui.tool-execution-base-render");
  const baseSetExpandedMethod = Symbol.for("pi-compact-ui.tool-execution-base-set-expanded");
  const nativeComponents = new WeakMap();
  const timing = new WeakMap();
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
    baseRenderMethod,
    baseSetExpandedMethod,
  ]);
  if (!prototype[baseRenderMethod]) prototype[baseRenderMethod] = prototype.render;
  if (!prototype[baseSetExpandedMethod]) {
    prototype[baseSetExpandedMethod] = prototype.setExpanded;
  }
  const baseRender = prototype[baseRenderMethod];
  const baseSetExpanded = prototype[baseSetExpandedMethod];
  const renderNative = (component, width) => {
    const originalDefinition = component.toolDefinition?.[ORIGINAL_TOOL_DEFINITION];
    if (!originalDefinition) return baseRender.call(component, width);
    let record = nativeComponents.get(component);
    if (!record || record.component.toolDefinition !== originalDefinition) {
      const native = new ToolExecutionComponent(
        component.toolName,
        component.toolCallId,
        component.args,
        {
          showImages: component.showImages,
          imageWidthCells: component.imageWidthCells,
        },
        originalDefinition,
        component.ui,
        component.cwd,
      );
      const clock = timing.get(component);
      const startedAt = component.rendererState.compactStartedAt ?? clock?.started;
      const endedAt = component.rendererState.compactEndedAt ?? clock?.ended;
      if (startedAt !== undefined) native.rendererState.startedAt = startedAt;
      if (endedAt !== undefined) native.rendererState.endedAt = endedAt;
      record = { component: native };
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

  prototype.setExpanded = function compactToolExpansion(isExpanded) {
    if (!isEnabled()) return baseSetExpanded.call(this, isExpanded);
    timeline.setGlobalExpanded(this.toolCallId, isExpanded);
    const entry = timeline.entriesById.get(this.toolCallId);
    const effectiveExpansion = entry?.group.expandedOverride ?? isExpanded;
    return baseSetExpanded.call(this, effectiveExpansion);
  };
  prototype.render = function compactToolSpacing(width) {
    if (!isEnabled()) return renderNative(this, width);
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
      if (!entry.isTracked) return [];
      entry.workingCompact = true;
      timeline.attachComponent(
        entry,
        this,
        (isExpanded) => baseSetExpanded.call(this, isExpanded),
      );
      timeline.update(entry, { state: "running", theme, detail: () => [] });
      return [];
    }
    const compactWorkingTool = this.expanded
      && timelineEntry?.group.expandedOverride !== true
      && (
        workingDetailMode === "compact"
        || (
          workingDetailMode === "auto"
          && this.isPartial
          && timeline.isCurrentWorkingEntry(timelineEntry)
        )
      );
    if (!this.expanded || compactWorkingTool) {
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
      const category = toolCategory(this.toolName, this.args);
      const color = failed
        ? "error"
        : this.isPartial ? "warning" : groupLabelColor(category);
      const entry = timeline.register(this.toolCallId, category);
      if (!entry.isTracked) return renderNative(this, width);
      entry.workingCompact = compactWorkingTool;
      timeline.attachComponent(
        entry,
        this,
        (isExpanded) => baseSetExpanded.call(this, isExpanded),
      );
      const elapsed = clock.ended !== undefined
        ? ` · ${formatDuration(clock.ended - clock.started)}`
        : "";
      const label = summarize(this.toolName, this.args || {}, this.cwd);
      timeline.update(entry, {
        state: failed ? "failed" : this.isPartial ? "running" : "complete",
        theme,
        detail: (connector) => {
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
        },
      });
      return new RecentToolSummary(timeline, entry).render(width);
    }

    // Expanded mode owns rich output (diffs, images, and output panels). Add
    // only a group heading; never re-frame, indent, resize, or trim its rows.
    // Terminal images reserve their height with trailing empty rows, so altering
    // those rows makes later content draw over the image.
    const category = toolCategory(this.toolName, this.args);
    const entry = timeline.register(this.toolCallId, category);
    if (!entry.isTracked) return renderNative(this, width);
    entry.workingCompact = false;
    timeline.attachComponent(
      entry,
      this,
      (isExpanded) => baseSetExpanded.call(this, isExpanded),
    );
    const failed = !this.isPartial && Boolean(this.result?.isError);
    entry.state = failed ? "failed" : this.isPartial ? "running" : "complete";

    const content = baseRender.call(this, width);
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
    return [...prefix, ...content];
  };
}

import { Box } from "@earendil-works/pi-tui";

import {
  activityPhaseForTool,
  formatDuration,
  getToolErrorMessage,
  groupLabelColor,
  stripVerticalPadding,
  summarize,
  toolAction,
  toolCategory,
} from "./format.js";
import { RecentToolSummary } from "./timeline.js";
import { Empty, VerticallyTrimmed } from "./ui/sections.js";

const ORIGINAL_TOOL_DEFINITION = Symbol.for("pi-compact-ui.original-tool-definition");

export function compactDefinition(original, timeline, isEnabled) {
  return {
    ...original,
    [ORIGINAL_TOOL_DEFINITION]: original,
    renderShell: "self",
    renderCall(args, theme, context) {
      if (!isEnabled()) {
        return original.renderCall?.(args, theme, context) ?? new Empty();
      }
      const category = toolCategory(original.name, args);
      const entry = timeline.register(
        context.toolCallId,
        category,
        activityPhaseForTool(original.name, args),
      );
      if (!entry.isTracked) {
        return original.renderCall?.(args, theme, context) ?? new Empty();
      }
      if (context.expanded && original.renderCall) {
        const component = original.renderCall(args, theme, {
          ...context,
          lastComponent: context.state.compactExpandedCallComponent,
        });
        context.state.compactExpandedCallComponent = component;
        const backgroundColor = context.isPartial
          ? "toolPendingBg"
          : context.isError ? "toolErrorBg" : "toolSuccessBg";
        let frame = context.state.compactExpandedFrame;
        if (!frame) {
          frame = new Box(1, 1, (text) => theme.bg(backgroundColor, text));
          context.state.compactExpandedFrame = frame;
        } else {
          frame.setBgFn((text) => theme.bg(backgroundColor, text));
          frame.clear();
        }
        frame.addChild(new VerticallyTrimmed(stripVerticalPadding(component)));
        return frame;
      }

      const state = context.state;
      if (context.executionStarted && state.compactStartedAt === undefined) {
        state.compactStartedAt = Date.now();
      }

      const running = context.isPartial;
      const failed = !running && context.isError;
      if (!running && state.compactStartedAt !== undefined && state.compactEndedAt === undefined) {
        state.compactEndedAt = Date.now();
      }
      const elapsed = state.compactStartedAt !== undefined && state.compactEndedAt !== undefined
        ? ` · ${formatDuration(state.compactEndedAt - state.compactStartedAt)}`
        : "";
      const color = failed
        ? "error"
        : running ? "warning" : groupLabelColor(category);
      const label = summarize(original.name, args, context.cwd);
      timeline.update(entry, {
        state: failed ? "failed" : running ? "running" : "complete",
        theme,
        detail: (connector) => {
          const status = failed ? theme.fg("error", " · failed") : "";
          const lines = [
            `${theme.fg("dim", `  ${connector} `)}${theme.fg(color, toolAction(original.name))} ${theme.fg("toolOutput", label)}${status}${theme.fg("dim", elapsed)}`,
          ];
          if (failed && state.compactErrorMessage) {
            lines.push(
              `${theme.fg("dim", "    │ ")}${theme.fg("error", "Error:")} ${theme.fg("text", state.compactErrorMessage)}`,
            );
          }
          return lines;
        },
      });
      return new RecentToolSummary(timeline, entry);
    },
    renderResult(result, options, theme, context) {
      const entry = timeline.entriesById.get(context.toolCallId);
      if (!isEnabled() || entry?.isTracked === false) {
        return original.renderResult?.(result, options, theme, context) ?? new Empty();
      }
      context.state.compactErrorMessage = context.isError
        ? getToolErrorMessage(result)
        : "";
      if (options.expanded && original.renderResult) {
        const component = original.renderResult(result, options, theme, {
          ...context,
          lastComponent: context.state.compactExpandedResultComponent,
        });
        context.state.compactExpandedResultComponent = component;
        const renderedResult = new VerticallyTrimmed(stripVerticalPadding(component));
        const frame = context.state.compactExpandedFrame;
        if (frame) {
          frame.addChild(renderedResult);
          return new Empty();
        }
        return renderedResult;
      }
      return new Empty();
    },
  };
}

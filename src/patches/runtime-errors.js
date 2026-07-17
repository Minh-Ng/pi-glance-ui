import { Spacer } from "@earendil-works/pi-tui";
import { RuntimeNotice } from "../ui/sections.js";

export async function patchCompactRuntimeErrors(
  codingAgentEntryUrl,
  timeline,
  sectionController,
  resetAssistantSections,
  normalizeTranscriptSpacing,
  isEnabled,
  transaction,
) {
  const baseHandleEventMethod = Symbol.for("pi-compact-ui.base-handle-event");
  const baseRenderSessionEntriesMethod = Symbol.for("pi-compact-ui.base-render-session-entries");
  const baseToggleThinkingBlockVisibilityMethod = Symbol.for(
    "pi-compact-ui.base-toggle-thinking-block-visibility",
  );
  const baseShowErrorMethod = Symbol.for("pi-compact-ui.base-show-error");
  const baseShowWarningMethod = Symbol.for("pi-compact-ui.base-show-warning");
  let nextRuntimeNoticeId = 1;
  const moduleUrl = new URL("./modes/interactive/interactive-mode.js", codingAgentEntryUrl);
  const sessionManagerUrl = new URL("./core/session-manager.js", codingAgentEntryUrl);
  const themeUrl = new URL("./modes/interactive/theme/theme.js", codingAgentEntryUrl);
  const [
    { InteractiveMode },
    { sessionEntryToContextMessages },
    { theme },
  ] = await Promise.all([
    import(moduleUrl.href),
    import(sessionManagerUrl.href),
    import(themeUrl.href),
  ]);
  const prototype = InteractiveMode.prototype;
  if (
    typeof prototype.handleEvent !== "function"
    || typeof prototype.renderSessionEntries !== "function"
    || typeof prototype.toggleThinkingBlockVisibility !== "function"
    || typeof prototype.showError !== "function"
    || typeof prototype.showWarning !== "function"
  ) {
    throw new Error("interactive error rendering has changed");
  }
  transaction?.capture(prototype, [
    "handleEvent",
    "renderSessionEntries",
    "toggleThinkingBlockVisibility",
    "showError",
    "showWarning",
    baseHandleEventMethod,
    baseRenderSessionEntriesMethod,
    baseToggleThinkingBlockVisibilityMethod,
    baseShowErrorMethod,
    baseShowWarningMethod,
  ]);
  if (!prototype[baseHandleEventMethod]) prototype[baseHandleEventMethod] = prototype.handleEvent;
  if (!prototype[baseRenderSessionEntriesMethod]) {
    prototype[baseRenderSessionEntriesMethod] = prototype.renderSessionEntries;
  }
  if (!prototype[baseToggleThinkingBlockVisibilityMethod]) {
    prototype[baseToggleThinkingBlockVisibilityMethod] = prototype.toggleThinkingBlockVisibility;
  }
  if (!prototype[baseShowErrorMethod]) prototype[baseShowErrorMethod] = prototype.showError;
  if (!prototype[baseShowWarningMethod]) {
    prototype[baseShowWarningMethod] = prototype.showWarning;
  }
  const baseHandleEvent = prototype[baseHandleEventMethod];
  const baseRenderSessionEntries = prototype[baseRenderSessionEntriesMethod];
  const baseToggleThinkingBlockVisibility = prototype[baseToggleThinkingBlockVisibilityMethod];
  const baseShowError = prototype[baseShowErrorMethod];
  const baseShowWarning = prototype[baseShowWarningMethod];

  prototype.handleEvent = async function compactHandleEvent(event) {
    const result = await baseHandleEvent.call(this, event);
    // Tool rows are appended mid-stream on `message_update` (when a toolCall
    // content item first streams in), not on `message_start`. If we only
    // normalized on message_start, the prose→action-group separator would not
    // exist yet when the tool row first paints, then pop in a beat later once the
    // next message_start fired — a visible flicker. Re-run the normalize on
    // update/end as well so the blank line is present in the same frame the tool
    // row appears. The message_update case is guarded to toolCall-bearing frames
    // so ordinary per-token text streaming does not pay for a normalize pass.
    const message = event.message;
    const streamingHasToolCall = Array.isArray(message?.content)
      && message.content.some((item) => item.type === "toolCall");
    const shouldNormalize = message?.role === "assistant" && (
      event.type === "message_start"
      || event.type === "message_end"
      || (event.type === "message_update" && streamingHasToolCall)
    );
    if (shouldNormalize && isEnabled()) {
      normalizeTranscriptSpacing(this.chatContainer?.children);
    }
    return result;
  };

  prototype.renderSessionEntries = function compactRenderSessionEntries(entries, options) {
    resetAssistantSections();
    if (!isEnabled()) {
      timeline.clearTranscript();
      return baseRenderSessionEntries.call(this, entries, options);
    }
    const messages = entries.flatMap((entry) => entry.type === "custom"
      ? []
      : sessionEntryToContextMessages(entry));
    timeline.rebuildFromMessages(messages, this.streamingMessage);
    try {
      const result = baseRenderSessionEntries.call(this, entries, options);
      normalizeTranscriptSpacing(this.chatContainer?.children);
      return result;
    } finally {
      timeline.finishTranscriptRebuild();
    }
  };

  prototype.toggleThinkingBlockVisibility = function compactToggleThinkingBlockVisibility() {
    const result = baseToggleThinkingBlockVisibility.call(this);
    if (isEnabled()) normalizeTranscriptSpacing(this.chatContainer?.children);
    return result;
  };

  prototype.showError = function compactErrorBlock(errorMessage) {
    if (!isEnabled()) return baseShowError.call(this, errorMessage);
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new RuntimeNotice({
      id: `runtime-error:${nextRuntimeNoticeId}`,
      level: "error",
      message: errorMessage,
      requestRender: () => this.ui.requestRender(),
      sectionController,
      theme,
      isEnabled,
    }));
    nextRuntimeNoticeId += 1;
    this.ui.requestRender();
  };

  prototype.showWarning = function compactWarningBlock(warningMessage) {
    if (!isEnabled()) return baseShowWarning.call(this, warningMessage);
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new RuntimeNotice({
      id: `runtime-warning:${nextRuntimeNoticeId}`,
      level: "warning",
      message: warningMessage,
      requestRender: () => this.ui.requestRender(),
      sectionController,
      theme,
      isEnabled,
    }));
    nextRuntimeNoticeId += 1;
    this.ui.requestRender();
  };
}

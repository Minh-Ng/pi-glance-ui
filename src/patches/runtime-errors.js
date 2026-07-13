import { Spacer } from "@earendil-works/pi-tui";
import { RuntimeNotice } from "../ui/sections.js";

export async function patchCompactRuntimeErrors(
  codingAgentEntryUrl,
  timeline,
  sectionController,
  resetAssistantSections,
  recordTranscriptAdjacency,
  normalizeConsecutiveThinkingSpacing,
  isEnabled,
  transaction,
) {
  const baseHandleEventMethod = Symbol.for("pi-compact-ui.base-handle-event");
  const baseRenderSessionEntriesMethod = Symbol.for("pi-compact-ui.base-render-session-entries");
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
    || typeof prototype.showError !== "function"
    || typeof prototype.showWarning !== "function"
  ) {
    throw new Error("interactive error rendering has changed");
  }
  transaction?.capture(prototype, [
    "handleEvent",
    "renderSessionEntries",
    "showError",
    "showWarning",
    baseHandleEventMethod,
    baseRenderSessionEntriesMethod,
    baseShowErrorMethod,
    baseShowWarningMethod,
  ]);
  if (!prototype[baseHandleEventMethod]) prototype[baseHandleEventMethod] = prototype.handleEvent;
  if (!prototype[baseRenderSessionEntriesMethod]) {
    prototype[baseRenderSessionEntriesMethod] = prototype.renderSessionEntries;
  }
  if (!prototype[baseShowErrorMethod]) prototype[baseShowErrorMethod] = prototype.showError;
  if (!prototype[baseShowWarningMethod]) {
    prototype[baseShowWarningMethod] = prototype.showWarning;
  }
  const baseHandleEvent = prototype[baseHandleEventMethod];
  const baseRenderSessionEntries = prototype[baseRenderSessionEntriesMethod];
  const baseShowError = prototype[baseShowErrorMethod];
  const baseShowWarning = prototype[baseShowWarningMethod];

  prototype.handleEvent = async function compactHandleEvent(event) {
    const result = await baseHandleEvent.call(this, event);
    if (event.type === "message_start" && event.message?.role === "assistant") {
      recordTranscriptAdjacency(this.chatContainer?.children);
      if (isEnabled()) normalizeConsecutiveThinkingSpacing(this.chatContainer?.children);
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
      normalizeConsecutiveThinkingSpacing(this.chatContainer?.children);
      return result;
    } finally {
      timeline.finishTranscriptRebuild();
    }
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

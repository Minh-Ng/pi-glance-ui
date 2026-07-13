import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Spacer, Text } from "@earendil-works/pi-tui";
import { compactWhitespace, compatibilityError, errorTitle, formatThinkingText, renderErrorText, unwrapFormattedThinkingText, wrapThinkingLines } from "../format.js";
import { patchCompactCustomMessages } from "./custom-messages.js";
import { patchCompactFooter, patchCompactUserMessages } from "./chrome.js";
import { patchCompactMarkdown } from "./markdown.js";
import { patchCompactRuntimeErrors } from "./runtime-errors.js";
import { patchCompactToolSpacing } from "./tools.js";
import { PatchTransaction } from "./transaction.js";
import { TranscriptSpacer } from "../ui/transcript-spacing.js";

const PI_CODING_AGENT_SCOPES = [
  "@earendil-works/pi-coding-agent",
  "@mariozechner/pi-coding-agent",
];

// Prototype patches only take effect on the exact pi-coding-agent module
// instance the running Pi renders with. A local dev checkout that ran
// `npm install` carries a shadowing node_modules copy, and import.meta.resolve
// (even under Pi's jiti loader) returns that shadow instead of the running
// install — so patches would silently hit a dead module graph. Anchor to the
// running CLI entry (process.argv[1], typically a bin symlink) when it lives
// inside a pi-coding-agent install; otherwise fall back to import.meta.resolve
// (tests and shadow-free distributed installs already resolve correctly).
export function runningPiCodingAgentEntry() {
  const main = process.argv?.[1];
  if (typeof main === "string" && main.length > 0) {
    let resolvedMain = main;
    try {
      resolvedMain = realpathSync(main);
    } catch {
      // Keep the raw argv path if it cannot be realpath-resolved.
    }
    const mainUrl = pathToFileURL(resolvedMain).href;
    for (const scope of PI_CODING_AGENT_SCOPES) {
      const needle = `/node_modules/${scope}/`;
      const at = mainUrl.lastIndexOf(needle);
      if (at !== -1) return `${mainUrl.slice(0, at + needle.length)}dist/index.js`;
    }
  }
  return import.meta.resolve("@earendil-works/pi-coding-agent");
}

export async function patchHiddenThinkingLayout(
  timeline,
  sectionController,
  isEnabled,
  getWorkingDetailMode,
  { transaction = new PatchTransaction() } = {},
) {
  const baseUpdateMethod = Symbol.for("pi-compact-ui.base-update-content");
  const baseSetHideThinkingMethod = Symbol.for("pi-compact-ui.base-set-hide-thinking");
  const baseRenderMethod = Symbol.for("pi-compact-ui.base-assistant-render");
  const originalMessage = Symbol.for("pi-compact-ui.original-assistant-message");
  const renderedMode = Symbol.for("pi-compact-ui.assistant-rendered-mode");
  const filteredMessages = new WeakSet();
  const errorStateByComponent = new WeakMap();
  const thinkingStateByComponent = new WeakMap();
  const compactThinkingRawText = Symbol("compact-thinking-raw-text");
  let assistantGeneration = 0;
  let latestCompactThinkingComponent;
  let nextErrorSectionId = 1;
  let nextThinkingSectionId = 1;

  const resetAssistantSections = () => {
    assistantGeneration += 1;
    latestCompactThinkingComponent = undefined;
    sectionController.removeKinds([
      "assistantError",
      "custom",
      "runtimeNotice",
      "thinking",
      "tools",
    ]);
  };

  const isThinkingOnlyComponent = (component) => {
    const message = component?.[originalMessage] || component?.lastMessage;
    return message?.role === "assistant"
      && message.content?.some((item) => item.type === "thinking" && item.thinking?.trim())
      && message.content.every(
        (item) => item.type === "thinking"
          || item.type === "toolCall"
          || (item.type === "text" && !item.text?.trim()),
      );
  };

  // An assistant message that carries visible prose (text), as opposed to a
  // thinking-only block. Thinking-only blocks manage their own leading spacer.
  const isTextBearingAssistant = (component) => {
    const message = component?.[originalMessage] || component?.lastMessage;
    return message?.role === "assistant"
      && Array.isArray(message.content)
      && message.content.some((item) => item.type === "text" && item.text?.trim());
  };

  const isToolComponent = (component) =>
    component?.constructor?.name === "ToolExecutionComponent";

  // Thinking spacing, the prose→action separator, and their idempotent add/remove
  // bookkeeping live in one cohesive unit; see TranscriptSpacer.
  const transcriptSpacer = new TranscriptSpacer({
    isThinkingOnlyComponent,
    isTextBearingAssistant,
    isToolComponent,
  });

  const getThinkingState = (component) => {
    let thinkingState = thinkingStateByComponent.get(component);
    if (!thinkingState || thinkingState.generation !== assistantGeneration) {
      thinkingState = {
        id: `thinking:${nextThinkingSectionId}`,
        generation: assistantGeneration,
        order: nextThinkingSectionId,
        expansionOverride: undefined,
        globallyExpanded: false,
      };
      nextThinkingSectionId += 1;
      thinkingStateByComponent.set(component, thinkingState);
    }
    return thinkingState;
  };

  try {
    const entryUrl = runningPiCodingAgentEntry();
    await patchCompactMarkdown(entryUrl, isEnabled, transaction);
    transaction.checkpoint("markdown");
    await patchCompactUserMessages(entryUrl, isEnabled, transaction);
    transaction.checkpoint("userMessages");
    await patchCompactFooter(entryUrl, isEnabled, transaction);
    transaction.checkpoint("footer");
    await patchCompactToolSpacing(
      entryUrl,
      timeline,
      isEnabled,
      getWorkingDetailMode,
      transaction,
    );
    transaction.checkpoint("tools");
    await patchCompactCustomMessages(
      entryUrl,
      timeline,
      sectionController,
      isEnabled,
      transaction,
    );
    transaction.checkpoint("customMessages");
    await patchCompactRuntimeErrors(
      entryUrl,
      timeline,
      sectionController,
      resetAssistantSections,
      (children) => transcriptSpacer.normalize(children),
      isEnabled,
      transaction,
    );
    transaction.checkpoint("runtimeErrors");
    const moduleUrl = new URL("./modes/interactive/components/assistant-message.js", entryUrl);
    const themeUrl = new URL("./modes/interactive/theme/theme.js", entryUrl);
    const [{ AssistantMessageComponent }, { theme }] = await Promise.all([
      import(moduleUrl.href),
      import(themeUrl.href),
    ]);
    const prototype = AssistantMessageComponent.prototype;
    if (
      typeof prototype.updateContent !== "function"
      || typeof prototype.setHideThinkingBlock !== "function"
    ) {
      throw new Error("assistant message layout is unavailable");
    }
    transaction.capture(prototype, [
      "render",
      "updateContent",
      "setHideThinkingBlock",
      "setExpanded",
      baseRenderMethod,
      baseUpdateMethod,
      baseSetHideThinkingMethod,
    ]);
    if (!prototype[baseRenderMethod]) prototype[baseRenderMethod] = prototype.render;
    if (!prototype[baseUpdateMethod]) prototype[baseUpdateMethod] = prototype.updateContent;
    if (!prototype[baseSetHideThinkingMethod]) {
      prototype[baseSetHideThinkingMethod] = prototype.setHideThinkingBlock;
    }
    const baseRender = prototype[baseRenderMethod];
    const updateContent = prototype[baseUpdateMethod];
    const setHideThinkingBlock = prototype[baseSetHideThinkingMethod];
    const renderThinking = (component, source, mode) => {
      const thinkingState = getThinkingState(component);
      const isExpanded = mode === "all";
      const compactThinkingByIndex = new Map();
      for (let index = 0; index < source.content.length; index += 1) {
        const item = source.content[index];
        if (item.type !== "thinking") continue;
        const thinking = formatThinkingText(item.thinking, isExpanded);
        if (thinking) compactThinkingByIndex.set(index, thinking);
      }
      const latestThinkingIndex = Array.from(compactThinkingByIndex.keys()).at(-1);
      const sectionSummary = source.content
        .filter((item) => item.type === "thinking")
        .map((item) => compactWhitespace(unwrapFormattedThinkingText(item.thinking)))
        .filter(Boolean)
        .at(-1)
        ?.slice(0, 60);
      sectionController.register({
        id: thinkingState.id,
        kind: "thinking",
        label: `Thinking · ${compactThinkingByIndex.size} step${compactThinkingByIndex.size === 1 ? "" : "s"}${sectionSummary ? ` · ${sectionSummary}` : ""}`,
        isExpanded: () => thinkingState.expansionOverride ?? !component.hideThinkingBlock,
        toggle: () => {
          const isExpanded = thinkingState.expansionOverride ?? !component.hideThinkingBlock;
          thinkingState.expansionOverride = !isExpanded;
          const nextMode = thinkingState.expansionOverride
            ? "all"
            : component === latestCompactThinkingComponent ? "latest" : "none";
          renderThinking(component, source, nextMode);
        },
      });
      const displayed = {
        ...source,
        content: source.content.flatMap((item, index) => {
          if (item.type !== "thinking") return [item];
          const thinking = compactThinkingByIndex.get(index);
          if (!thinking) return [];
          if (mode === "none") return [];
          if (mode === "latest" && index !== latestThinkingIndex) return [];
          return [{ ...item, thinking }];
        }),
      };
      const hasToolCall = displayed.content.some((item) => item.type === "toolCall");
      let failureMessage = "";
      if (displayed.stopReason === "length") {
        failureMessage = "Model stopped because it reached the maximum output token limit. The response may be incomplete.";
      } else if (!hasToolCall && displayed.stopReason === "aborted") {
        failureMessage = displayed.errorMessage
          && displayed.errorMessage !== "Request was aborted"
          ? displayed.errorMessage
          : "Operation aborted";
      } else if (!hasToolCall && displayed.stopReason === "error") {
        failureMessage = displayed.errorMessage || "Unknown error";
      }
      let assistantErrorState;
      if (failureMessage) {
        assistantErrorState = errorStateByComponent.get(component);
        if (!assistantErrorState || assistantErrorState.generation !== assistantGeneration) {
          assistantErrorState = {
            id: `error:${nextErrorSectionId}`,
            generation: assistantGeneration,
            isExpanded: true,
          };
          nextErrorSectionId += 1;
          errorStateByComponent.set(component, assistantErrorState);
        }
        sectionController.register({
          id: assistantErrorState.id,
          kind: "assistantError",
          label: `Error · ${errorTitle(failureMessage)}`,
          isExpanded: () => assistantErrorState.isExpanded,
          toggle: () => {
            assistantErrorState.isExpanded = !assistantErrorState.isExpanded;
            renderThinking(component, source, mode);
          },
        });
      }
      const renderedMessage = failureMessage
        ? {...displayed, stopReason: "stop", errorMessage: undefined}
        : displayed;
      filteredMessages.add(renderedMessage);
      const wasHidden = component.hideThinkingBlock;
      component.hideThinkingBlock = false;
      try {
        const result = updateContent.call(component, renderedMessage);
        const toolCalls = source.content.filter((item) => item.type === "toolCall");
        const hasVisibleContent = displayed.content.some(
          (item) => (item.type === "text" && item.text.trim())
            || (item.type === "thinking" && item.thinking.trim()),
        );
        for (const toolCall of toolCalls) {
          timeline.setDetached(toolCall.id, Boolean(hasVisibleContent));
        }
        if (failureMessage) {
          component.contentContainer.addChild(new Spacer(1));
          component.contentContainer.addChild(new Text(
            renderErrorText(
              theme,
              "error",
              failureMessage,
              assistantErrorState.isExpanded,
            ),
            component.outputPad,
            0,
          ));
        }
        const compactThinking = new Set(compactThinkingByIndex.values());
        for (const child of component.contentContainer.children) {
          if (
            child?.defaultTextStyle?.italic === true
            && compactThinking.has(child.text)
          ) {
            // Stash the unwrapped source so render() can re-wrap idempotently
            // to the live width with a hanging indent.
            child[compactThinkingRawText] = child.text;
            if (child.paddingX !== 0) {
              child.paddingX = 0;
              child.invalidate?.();
            }
          }
        }
        transcriptSpacer.refreshThinking(component);
        return result;
      } finally {
        component.hideThinkingBlock = wasHidden;
      }
    };

    prototype.render = function compactAssistantRender(width) {
      if (this[renderedMode] !== isEnabled()) {
        const source = this[originalMessage] || this.lastMessage;
        if (source) this.updateContent(source);
      }
      if (isEnabled() && this.contentContainer?.children) {
        for (const child of this.contentContainer.children) {
          const raw = child?.[compactThinkingRawText];
          if (raw === undefined) continue;
          const contentWidth = Math.max(8, width - (child.paddingX ?? 0) * 2);
          const wrapped = wrapThinkingLines(raw, contentWidth);
          if (child.text !== wrapped) {
            child.text = wrapped;
            child.invalidate?.();
          }
        }
      }
      return baseRender.call(this, width);
    };

    prototype.setHideThinkingBlock = function compactThinkingVisibility(isHidden) {
      if (!isEnabled()) return setHideThinkingBlock.call(this, isHidden);
      const thinkingState = thinkingStateByComponent.get(this);
      if (thinkingState) thinkingState.expansionOverride = undefined;
      return setHideThinkingBlock.call(this, isHidden);
    };

    // Pi's Ctrl+O path expands every chat child exposing setExpanded(). Joining
    // that protocol makes global detail mode reveal all recorded Thinking prose
    // alongside native tool details.
    prototype.setExpanded = function compactThinkingExpansion(isExpanded) {
      if (!isEnabled()) return undefined;
      const thinkingState = getThinkingState(this);
      thinkingState.expansionOverride = undefined;
      thinkingState.globallyExpanded = isExpanded;
      const source = this[originalMessage] || this.lastMessage;
      if (source) return this.updateContent(source);
    };

    prototype.updateContent = function compactThinking(message) {
      const isPreviouslyRenderedMessage = filteredMessages.has(message)
        || (this[originalMessage] && message === this.lastMessage);
      if (!isPreviouslyRenderedMessage) this[originalMessage] = message;
      const source = this[originalMessage] || message;
      this[renderedMode] = isEnabled();
      if (!this[renderedMode]) return updateContent.call(this, source);
      const thinkingState = getThinkingState(this);
      if (thinkingState.expansionOverride === true || thinkingState.globallyExpanded) {
        return renderThinking(this, source, "all");
      }
      if (thinkingState?.expansionOverride !== false && !this.hideThinkingBlock) {
        return renderThinking(this, source, "all");
      }

      const hasThinking = source.content.some(
        (item) => item.type === "thinking" && formatThinkingText(item.thinking, false),
      );
      if (!hasThinking) return renderThinking(this, source, "none");

      const latestThinkingState = latestCompactThinkingComponent
        ? thinkingStateByComponent.get(latestCompactThinkingComponent)
        : undefined;
      const isLatestThinkingComponent = !latestThinkingState
        || thinkingState.order >= latestThinkingState.order;
      if (!isLatestThinkingComponent) return renderThinking(this, source, "none");

      const previousComponent = latestCompactThinkingComponent;
      latestCompactThinkingComponent = this;
      if (
        previousComponent
        && previousComponent !== this
        && previousComponent.hideThinkingBlock
        && thinkingStateByComponent.get(previousComponent)?.expansionOverride !== true
        && previousComponent[originalMessage]
      ) {
        renderThinking(previousComponent, previousComponent[originalMessage], "none");
      }
      return renderThinking(this, source, "latest");
    };
    transaction.checkpoint("assistant");
    transaction.commit();
    return { ok: true };
  } catch (error) {
    transaction.rollback();
    // Pi's internal component path is not public API. Compact tool rendering
    // remains functional if a future Pi release moves the component.
    return { ok: false, error: compatibilityError(error) };
  }
}

import { truncateToWidth } from "@earendil-works/pi-tui";
import { artifactContent, artifactLabel, artifactSummary, renderBlockHeading } from "../format.js";

export async function patchCompactCustomMessages(
  codingAgentEntryUrl,
  timeline,
  sectionController,
  isEnabled,
  transaction,
) {
  const baseRebuildMethod = Symbol.for("pi-compact-ui.custom-message-base-rebuild");
  const baseRenderMethod = Symbol.for("pi-compact-ui.custom-message-base-render");
  const baseSetExpandedMethod = Symbol.for("pi-compact-ui.custom-message-base-set-expanded");
  const barrierComponents = new WeakSet();
  const stateByMessage = new WeakMap();
  let nextSectionId = 1;
  const moduleUrl = new URL(
    "./modes/interactive/components/custom-message.js",
    codingAgentEntryUrl,
  );
  const themeUrl = new URL("./modes/interactive/theme/theme.js", codingAgentEntryUrl);
  const [{ CustomMessageComponent }, { theme }] = await Promise.all([
    import(moduleUrl.href),
    import(themeUrl.href),
  ]);
  const prototype = CustomMessageComponent.prototype;
  if (
    typeof prototype.rebuild !== "function"
    || typeof prototype.render !== "function"
    || typeof prototype.setExpanded !== "function"
  ) {
    throw new Error("custom message layout has changed");
  }
  transaction?.capture(prototype, [
    "rebuild",
    "render",
    "setExpanded",
    baseRebuildMethod,
    baseRenderMethod,
    baseSetExpandedMethod,
  ]);
  if (!prototype[baseRebuildMethod]) prototype[baseRebuildMethod] = prototype.rebuild;
  if (!prototype[baseRenderMethod]) prototype[baseRenderMethod] = prototype.render;
  if (!prototype[baseSetExpandedMethod]) {
    prototype[baseSetExpandedMethod] = prototype.setExpanded;
  }
  const baseRebuild = prototype[baseRebuildMethod];
  const baseRender = prototype[baseRenderMethod];
  const baseSetExpanded = prototype[baseSetExpandedMethod];

  const getState = (component) => {
    let state = stateByMessage.get(component.message);
    if (!state) {
      state = {
        id: `custom:${nextSectionId}`,
        isGloballyExpanded: Boolean(component._expanded),
        expandedOverride: undefined,
      };
      nextSectionId += 1;
      stateByMessage.set(component.message, state);
    }
    return state;
  };

  const registerSection = (component) => {
    const state = getState(component);
    sectionController.register({
      id: state.id,
      kind: "custom",
      label: artifactLabel(component.message),
      isExpanded: () => state.expandedOverride ?? state.isGloballyExpanded,
      toggle: () => {
        const isExpanded = state.expandedOverride ?? state.isGloballyExpanded;
        state.expandedOverride = !isExpanded;
        baseSetExpanded.call(component, state.expandedOverride);
      },
    });
  };

  prototype.rebuild = function compactCustomMessageRebuild() {
    if (!isEnabled()) return baseRebuild.call(this);
    if (!barrierComponents.has(this)) {
      barrierComponents.add(this);
      if (!timeline.isRebuildingTranscript) timeline.breakGroup();
    }
    const result = baseRebuild.call(this);
    registerSection(this);
    return result;
  };

  prototype.setExpanded = function compactCustomMessageExpansion(isExpanded) {
    if (!isEnabled()) return baseSetExpanded.call(this, isExpanded);
    const state = getState(this);
    state.isGloballyExpanded = isExpanded;
    state.expandedOverride = undefined;
    registerSection(this);
    return baseSetExpanded.call(this, isExpanded);
  };

  prototype.render = function compactCustomMessageRender(width) {
    if (!isEnabled() || this.customRenderer) return baseRender.call(this, width);
    registerSection(this);
    const state = getState(this);
    const isExpanded = state.expandedOverride ?? state.isGloballyExpanded;
    const summary = artifactSummary(this.message);
    const lines = [
      "\u2800",
      renderBlockHeading(theme, {
        label: summary.label,
        labelColor: "customMessageLabel",
        state: summary.state,
        isExpanded,
        glyph: "◆",
      }),
    ];
    if (summary.metadata) {
      lines.push(`${theme.fg("dim", "  └ ")}${theme.fg("muted", summary.metadata)}`);
    }
    if (isExpanded) {
      for (const line of artifactContent(this.message).split("\n")) {
        lines.push(`${theme.fg("dim", "  │ ")}${theme.fg("customMessageText", line)}`);
      }
    }
    lines.push("\u2800");
    return lines.map((line) => truncateToWidth(line, Math.max(1, width), "…"));
  };
}

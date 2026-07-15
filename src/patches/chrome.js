const FAST_MODE_STATUS_KEYS = new Set([
  "claude-fast",
  "pi-openai-fast-mode",
]);

function appendFastModeToModelLine(line, state) {
  const modelName = state?.model?.id;
  if (!modelName) return line;

  const thinkingLevel = state.model.reasoning
    ? state.thinkingLevel === "off"
      ? "thinking off"
      : state.thinkingLevel || "off"
    : undefined;
  const modelText = thinkingLevel ? `${modelName} • ${thinkingLevel}` : modelName;
  const rightSideCandidates = state.model.provider
    ? [`(${state.model.provider}) ${modelText}`, modelText]
    : [modelText];
  const rightSide = rightSideCandidates.find((candidate) => line.lastIndexOf(candidate) >= 0);
  if (!rightSide) return line;
  const rightSideIndex = line.lastIndexOf(rightSide);

  const suffix = " • fast";
  let paddingWidth = 0;
  for (let index = rightSideIndex - 1; index >= 0 && line[index] === " "; index -= 1) {
    paddingWidth += 1;
  }
  if (paddingWidth < suffix.length + 2) return line;

  return `${line.slice(0, rightSideIndex - suffix.length)}${line.slice(rightSideIndex, rightSideIndex + rightSide.length)}${suffix}${line.slice(rightSideIndex + rightSide.length)}`;
}

export async function patchCompactFooter(codingAgentEntryUrl, isEnabled, transaction) {
  const baseRenderMethod = Symbol.for("pi-compact-ui.footer-base-render");
  const moduleUrl = new URL(
    "./modes/interactive/components/footer.js",
    codingAgentEntryUrl,
  );
  const { FooterComponent } = await import(moduleUrl.href);
  const prototype = FooterComponent.prototype;
  if (typeof prototype.render !== "function") {
    throw new Error("footer rendering has changed");
  }
  transaction?.capture(prototype, ["render", baseRenderMethod]);
  if (!prototype[baseRenderMethod]) prototype[baseRenderMethod] = prototype.render;
  const baseRender = prototype[baseRenderMethod];

  prototype.render = function compactFooterRender(width) {
    if (!isEnabled() || width <= 2) return baseRender.call(this, width);

    const contentWidth = width - 2;
    const statuses = this.footerData?.getExtensionStatuses?.();
    if (!(statuses instanceof Map)) {
      return baseRender.call(this, contentWidth).map((line) => ` ${line}`);
    }

    const fastModeStatuses = Array.from(statuses.entries())
      .filter(([key]) => FAST_MODE_STATUS_KEYS.has(key));
    if (fastModeStatuses.length === 0) {
      return baseRender.call(this, contentWidth).map((line) => ` ${line}`);
    }

    for (const [key] of fastModeStatuses) statuses.delete(key);
    let lines;
    try {
      lines = baseRender.call(this, contentWidth);
    } finally {
      for (const [key, text] of fastModeStatuses) statuses.set(key, text);
    }

    if (lines[1]) lines[1] = appendFastModeToModelLine(lines[1], this.session?.state);
    return lines.map((line) => ` ${line}`);
  };
}


export async function patchCompactUserMessages(codingAgentEntryUrl, isEnabled, transaction) {
  const baseRebuildMethod = Symbol.for("pi-compact-ui.user-message-base-rebuild");
  const baseRenderMethod = Symbol.for("pi-compact-ui.user-message-base-render");
  const renderedMode = Symbol.for("pi-compact-ui.user-message-rendered-mode");
  const moduleUrl = new URL(
    "./modes/interactive/components/user-message.js",
    codingAgentEntryUrl,
  );
  const { UserMessageComponent } = await import(moduleUrl.href);
  if (typeof UserMessageComponent !== "function") {
    throw new Error("UserMessageComponent is unavailable");
  }

  const prototype = UserMessageComponent.prototype;
  if (typeof prototype.rebuild !== "function" || typeof prototype.render !== "function") {
    throw new Error("user message rendering has changed");
  }
  transaction?.capture(prototype, [
    "rebuild",
    "render",
    baseRebuildMethod,
    baseRenderMethod,
  ]);
  if (!prototype[baseRebuildMethod]) prototype[baseRebuildMethod] = prototype.rebuild;
  if (!prototype[baseRenderMethod]) prototype[baseRenderMethod] = prototype.render;
  const baseRebuild = prototype[baseRebuildMethod];
  const baseRender = prototype[baseRenderMethod];

  prototype.rebuild = function compactUserMessage() {
    baseRebuild.call(this);
    this[renderedMode] = isEnabled();
    if (!this[renderedMode]) return;
    const contentBox = this.children?.[0];
    if (!contentBox || typeof contentBox.paddingY !== "number") {
      throw new Error("user message content box layout has changed");
    }
    contentBox.paddingY = 0;
    contentBox.invalidate();
  };

  prototype.render = function compactUserMessageRender(width) {
    if (this[renderedMode] !== isEnabled()) this.rebuild();
    return baseRender.call(this, width);
  };

  const probe = new UserMessageComponent("compatibility-probe").render(80);
  if (isEnabled() && probe.length !== 1) {
    throw new Error("compact user-message rendering probe failed");
  }
}

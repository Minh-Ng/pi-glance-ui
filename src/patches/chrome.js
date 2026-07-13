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
    return baseRender.call(this, width - 2).map((line) => ` ${line}`);
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

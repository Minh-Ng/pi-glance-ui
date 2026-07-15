import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export async function patchCompactMarkdown(codingAgentEntryUrl, isEnabled, transaction) {
  const codingAgentRequire = createRequire(codingAgentEntryUrl);
  const tuiEntryUrls = new Set();
  try {
    // Development installs may have a second, package-local TUI instance.
    // Production git installs omit dev dependencies, so this candidate is optional.
    tuiEntryUrls.add(import.meta.resolve("@earendil-works/pi-tui"));
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
  }
  // The running coding-agent dependency is authoritative and is always patched.
  tuiEntryUrls.add(pathToFileURL(codingAgentRequire.resolve("@earendil-works/pi-tui")).href);
  for (const tuiEntryUrl of tuiEntryUrls) {
    await patchCompactMarkdownModule(tuiEntryUrl, isEnabled, transaction);
  }
}

async function patchCompactMarkdownModule(tuiEntryUrl, isEnabled, transaction) {
  const baseRenderMethod = Symbol.for("pi-compact-ui.markdown-base-render");
  const baseRenderTokenMethod = Symbol.for("pi-compact-ui.markdown-base-render-token");
  const previousToken = Symbol.for("pi-compact-ui.markdown-previous-token");
  const renderTokenDepth = Symbol.for("pi-compact-ui.markdown-render-token-depth");
  const nativeRenderDepth = Symbol.for("pi-compact-ui.markdown-native-render-depth");
  const moduleUrl = new URL("./components/markdown.js", tuiEntryUrl);
  const { Markdown } = await import(moduleUrl.href);
  if (typeof Markdown !== "function") {
    throw new Error("Markdown component is unavailable");
  }
  const prototype = Markdown.prototype;
  if (typeof prototype.render !== "function" || typeof prototype.renderToken !== "function") {
    throw new Error("Markdown render methods have changed");
  }

  const previousRender = prototype.render;
  const previousRenderToken = prototype.renderToken;
  transaction?.capture(prototype, [
    "render",
    "renderToken",
    baseRenderMethod,
    baseRenderTokenMethod,
  ]);
  if (!prototype[baseRenderMethod]) prototype[baseRenderMethod] = prototype.render;
  if (!prototype[baseRenderTokenMethod]) prototype[baseRenderTokenMethod] = prototype.renderToken;
  const baseRender = prototype[baseRenderMethod];
  const baseRenderToken = prototype[baseRenderTokenMethod];

  prototype.render = function compactMarkdownRender(width) {
    this[previousToken] = undefined;
    this[renderTokenDepth] = 0;
    if (!isEnabled()) {
      this[nativeRenderDepth] = (this[nativeRenderDepth] || 0) + 1;
      try {
        return baseRender.call(this, width);
      } finally {
        this[nativeRenderDepth] -= 1;
      }
    }
    return baseRender.call(this, width);
  };

  prototype.renderToken = function compactMarkdownToken(token, width, nextTokenType, styleContext) {
    if (!isEnabled() || this[nativeRenderDepth]) {
      return baseRenderToken.call(this, token, width, nextTokenType, styleContext);
    }
    const depth = this[renderTokenDepth] || 0;
    const isTopLevel = depth === 0;
    const priorTokenType = isTopLevel ? this[previousToken] : undefined;
    if (isTopLevel) this[previousToken] = token.type;
    this[renderTokenDepth] = depth + 1;

    try {
      if (
        isTopLevel
        && token.type === "space"
        && (priorTokenType === "code" || nextTokenType === "code")
      ) {
        return [];
      }
      if (token.type === "heading") {
        const headingStyle = token.depth === 1
          ? (text) => this.theme.heading(this.theme.bold(this.theme.underline(text)))
          : (text) => this.theme.heading(this.theme.bold(text));
        const headingStyleContext = {
          applyText: headingStyle,
          stylePrefix: this.getStylePrefix(headingStyle),
        };
        const lines = [this.renderInlineTokens(token.tokens || [], headingStyleContext)];
        if (nextTokenType && nextTokenType !== "space") lines.push("");
        return lines;
      }
      if (token.type !== "code") {
        return baseRenderToken.call(this, token, width, nextTokenType, styleContext);
      }

      const highlighted = this.theme.highlightCode
        ? this.theme.highlightCode(token.text, token.lang)
        : token.text.split("\n").map((line) => this.theme.codeBlock(line));
      return highlighted;
    } finally {
      this[renderTokenDepth] = depth;
    }
  };

  try {
    if (!isEnabled()) return;
    const identity = (text) => text;
    const probe = new Markdown("```text\ncompatibility-probe\n```", 0, 0, {
      codeBlock: identity,
      codeBlockBorder: identity,
    }).render(80);
    if (probe.length !== 1 || probe[0].trimEnd() !== "compatibility-probe") {
      throw new Error("compact fenced-block rendering probe failed");
    }
    const presentationProbe = new Markdown("### Presentation heading", 0, 0, {
      bold: identity,
      heading: identity,
      underline: identity,
    }).render(80);
    if (presentationProbe[0]?.trimEnd() !== "Presentation heading") {
      throw new Error("presentation heading rendering probe failed");
    }
  } catch (error) {
    prototype.render = previousRender;
    prototype.renderToken = previousRenderToken;
    throw error;
  }
}

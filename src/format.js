import { stripVTControlCharacters } from "node:util";

const CHECK_COMMAND_RE = /(?:^|\s|\/)(?:npm\s+(?:test|run\s+(?:check|lint|typecheck|build))|pnpm\s+(?:test|run\s+(?:check|lint|typecheck|build))|yarn\s+(?:test|run\s+(?:check|lint|typecheck|build))|pytest|vitest|ruff|ty\s+check|tsc|node\s+--check|cargo\s+(?:test|check)|go\s+test)(?:\s|$)/i;

function isCheckTool(name, args = {}) {
  const normalized = String(name || "").toLowerCase();
  return normalized === "lsp_diagnostics"
    || (normalized === "bash" && CHECK_COMMAND_RE.test(args.command || ""));
}

export function activityPhaseForTool(name, args = {}) {
  if (/^task(?:create|update|list|get|execute|output|stop)$/i.test(String(name || ""))) {
    return "coordinate";
  }
  if (isCheckTool(name, args)) return "verify";
  if (toolCategory(name, args) === "change") return "implement";
  if (toolCategory(name, args) === "explore") return "plan";
  return "act";
}

export function activityToolPhaseLabel(phase) {
  return {
    plan: "Plan",
    implement: "Implement",
    verify: "Verify",
    coordinate: "Coordinate",
    act: "Act",
  }[phase] || "Act";
}


export function compatibilityError(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || "private Pi renderer is unavailable");
}



export function trimBlankLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && stripVTControlCharacters(lines[start]).trim() === "") start += 1;
  while (end > start && stripVTControlCharacters(lines[end - 1]).trim() === "") end -= 1;
  return lines.slice(start, end);
}

export function stripVerticalPadding(component) {
  if (!component || typeof component !== "object") return component;
  if (typeof component.paddingY === "number") component.paddingY = 0;
  if (Array.isArray(component.children)) {
    for (const child of component.children) stripVerticalPadding(child);
  }
  component.invalidate?.();
  return component;
}

export function toolCategory(name) {
  const normalized = String(name || "").toLowerCase();
  if (
    ["read", "grep", "find", "ls", "web_search", "fetch_content", "get_search_content",
      "context_window_search", "context_window_recall", "code_overview", "ast_search"].includes(normalized)
    || normalized.startsWith("lsp_")
    || /(?:search|find|read|grep|inspect|list|diagnostic|overview|fetch|(?:^|_)ls$)/.test(normalized)
  ) return "explore";
  if (
    ["edit", "write", "code_rewrite"].includes(normalized)
    || /(?:edit|write|rewrite|patch|update|create|delete|remove|rename)/.test(normalized)
  ) return "change";
  if (normalized === "subagent" || /(?:agent|delegate|handoff)/.test(normalized)) {
    return "delegate";
  }
  if (
    normalized === "bash"
    || /(?:bash|shell|exec|command|test|build|compile|run)/.test(normalized)
  ) return "run";
  return "interact";
}

export function renderBlockHeading(theme, {
  label,
  labelColor = "toolTitle",
  state = "complete",
  isExpanded,
  metadata = "",
  glyph,
}) {
  const stateColor = state === "failed"
    ? "error"
    : state === "running" ? "warning" : "success";
  const stateGlyph = glyph || (state === "failed" ? "×" : "●");
  const disclosure = isExpanded === undefined ? "" : `${isExpanded ? "▾" : "▸"} `;
  return `${theme.fg(stateColor, stateGlyph)} ${theme.fg("dim", disclosure)}${theme.fg(labelColor, theme.bold(label))}${theme.fg("dim", metadata)}`;
}

export function renderErrorText(theme, level, message, isExpanded) {
  const normalizedMessage = compactWhitespace(message).replace(/^(?:Error|Warning):\s*/i, "");
  const isError = level === "error";
  const label = isError ? "Error" : "Warning";
  const glyph = isError ? "×" : "!";
  const title = isError ? errorTitle(normalizedMessage) : "Attention";
  const disclosure = isExpanded === undefined ? "" : `${isExpanded ? "▾" : "▸"} `;
  const lines = [theme.fg(level, `${glyph} ${disclosure}${label} · ${title}`)];
  if (isExpanded !== false) {
    lines.push(`${theme.fg("dim", "  └ ")}${theme.fg("text", normalizedMessage)}`);
  }
  return lines.join("\n");
}

export function errorTitle(message) {
  if (/(?:maximum output token|token limit)/i.test(message)) return "Output limit";
  if (/(?:operation|request) aborted/i.test(message)) return "Cancelled";
  if (/websocket/i.test(message)) return "WebSocket";
  if (/(?:network|connection|socket)/i.test(message)) return "Connection";
  if (/(?:auth|credential|token|permission)/i.test(message)) return "Authentication";
  if (/(?:timeout|timed out)/i.test(message)) return "Timeout";
  return "Runtime";
}

export function artifactContent(message) {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

export function artifactSummary(message) {
  const content = artifactContent(message);
  const webContentMatch = content.match(
    /Content fetched for (\d+)\/(\d+) URLs \[([^\]]+)\]/i,
  );
  if (message.customType === "web-search-content-ready" && webContentMatch) {
    return {
      label: "Web content ready",
      metadata: `${webContentMatch[1]}/${webContentMatch[2]} URLs · ${webContentMatch[3]}`,
      state: "complete",
    };
  }
  const isFailure = /(?:error|failed|failure)/i.test(message.customType)
    || /^(?:error|failed|failure)\b/i.test(content);
  return {
    label: artifactLabel(message),
    metadata: isFailure ? compactWhitespace(content).slice(0, 180) : "",
    state: isFailure ? "failed" : "complete",
  };
}

export function artifactLabel(message) {
  return String(message.customType || "Artifact")
    .replace(/^web-search-content-ready$/, "Web content ready")
    .split(/[-_]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function groupLabelColor(category) {
  if (category === "change") return "mdCode";
  if (category === "run") return "bashMode";
  if (category === "delegate") return "customMessageLabel";
  return "toolTitle";
}

export function groupLabel(category) {
  if (category === "explore") return "Explored";
  if (category === "change") return "Changed";
  if (category === "run") return "Ran";
  if (category === "delegate") return "Delegated";
  return "Interacted";
}

export function toolAction(name) {
  const labels = {
    bash: "Bash",
    edit: "Edit",
    find: "Find",
    grep: "Search",
    ls: "List",
    read: "Read",
    write: "Write",
  };
  return labels[name] || String(name || "Tool")
    .split(/[_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getToolErrorMessage(result) {
  const text = result?.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text)
    .join(" ");
  return compactWhitespace(text || "").replace(/^Error:\s*/i, "").slice(0, 180);
}

export function summarize(name, args, cwd) {
  switch (name) {
    case "bash":
      return compactWhitespace(args.command || "").slice(0, 180) || "shell command";
    case "read":
      return `${shortPath(args.path, cwd)}${rangeSuffix(args)}`;
    case "edit": {
      const count = Array.isArray(args.edits) ? args.edits.length : 1;
      return `${shortPath(args.path, cwd)} · ${count} edit${count === 1 ? "" : "s"}`;
    }
    case "write":
      return shortPath(args.path, cwd);
    case "grep":
      return `${quote(args.pattern)} in ${shortPath(args.path || ".", cwd)}`;
    case "find":
      return `${args.pattern || "*"} in ${shortPath(args.path || ".", cwd)}`;
    case "ls":
      return shortPath(args.path || ".", cwd);
    default:
      return compactWhitespace(JSON.stringify(args));
  }
}

export function formatThinkingText(value, isExpanded) {
  const sections = unwrapFormattedThinkingText(value)
    .replace(/<!--[^]*?-->/g, "\n\n")
    .split(/\n\s*\n+/)
    .map((section) => {
      const text = isExpanded ? section.trim() : compactWhitespace(section);
      const summary = text.match(/^\*\*([^]*?)\*\*$/);
      return summary ? summary[1].trim() : text;
    })
    .filter(Boolean);
  if (sections.length === 0) return "";
  const disclosure = "▸";
  const thinkingGlyph = "○";
  if (sections.length === 1) return `${thinkingGlyph} ${disclosure} Thinking: ${sections[0]}`;

  const branches = sections.map((section, index) => {
    const connector = index === sections.length - 1 ? "└" : "├";
    return `  ${connector} ${section}`;
  });
  return [`${thinkingGlyph} ${disclosure} Thinking`, ...branches].join("  \n");
}

// Re-wrap already-formatted thinking text to a target width with a hanging
// indent, so wrapped continuation lines stay aligned under their branch
// connector ("  ├ ") or the "Thinking:" label instead of falling to column 0.
// The host Text component applies only a uniform paddingX and cannot hang-indent.
export function wrapThinkingLines(value, width) {
  const maxWidth = Math.max(8, Math.floor(Number(width)) || 8);
  return String(value)
    .split("\n")
    .map((line) => wrapThinkingLine(line, maxWidth))
    .join("\n");
}

function glyphLength(value) {
  return Array.from(String(value)).length;
}

function wrapThinkingLine(line, maxWidth) {
  if (glyphLength(line) <= maxWidth) return line;
  const prefixMatch = line.match(/^(\s*(?:[○●] )?[▸▾] Thinking:\s+|\s*[├└]\s+)/);
  // Only branch ("  ├ ") and "Thinking:" label lines carry wrappable prose. Leave
  // any other line (e.g. the bare "○ ▸ Thinking" header) intact so it is never
  // broken across the margin.
  if (!prefixMatch) return line;
  const prefix = prefixMatch[0];
  const indent = " ".repeat(glyphLength(prefix));
  const body = line.slice(prefix.length);
  const available = Math.max(4, maxWidth - indent.length);
  const words = body.split(/\s+/).filter(Boolean);
  if (words.length === 0) return line;
  const segments = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (glyphLength(candidate) > available && current) {
      segments.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) segments.push(current);
  return segments
    .map((segment, index) => (index === 0 ? prefix : indent) + segment)
    .join("\n");
}

export function unwrapFormattedThinkingText(value) {
  let text = String(value).trim();
  for (;;) {
    const inlineMatch = text.match(/^(?:[●○] )?[▾▸] Thinking:\s*([^]*)$/);
    if (inlineMatch) {
      text = inlineMatch[1].trim();
      continue;
    }
    if (/^(?:[●○] )?[▾▸] Thinking(?: {2}\n|\n)/.test(text)) {
      text = text
        .split(/ {2}\n|\n/)
        .slice(1)
        .map((line) => line.replace(/^\s*[├└] /, "").trim())
        .filter(Boolean)
        .join("\n\n");
      continue;
    }
    return text;
  }
}

export function compactWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function shortPath(value, cwd) {
  const path = String(value || ".");
  if (cwd && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  const home = process.env.HOME;
  if (home && path === home) return "~";
  if (home && path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return path;
}

function rangeSuffix(args) {
  if (args.offset === undefined && args.limit === undefined) return "";
  const start = args.offset ?? 1;
  return args.limit === undefined ? `:${start}+` : `:${start}-${start + args.limit - 1}`;
}

function quote(value) {
  const text = compactWhitespace(value);
  return text.length > 60 ? `“${text.slice(0, 59)}…”` : `“${text}”`;
}

export function formatDuration(milliseconds) {
  if (milliseconds < 1000) return `${milliseconds}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}

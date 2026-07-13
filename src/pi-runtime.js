import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PI_CODING_AGENT_SCOPES = [
  "@earendil-works/pi-coding-agent",
  "@mariozechner/pi-coding-agent",
];

const TOOL_FACTORY_NAMES = [
  "createReadToolDefinition",
  "createBashToolDefinition",
  "createEditToolDefinition",
  "createWriteToolDefinition",
  "createGrepToolDefinition",
  "createFindToolDefinition",
  "createLsToolDefinition",
];

// Resolve the module graph used by the running CLI, not a development
// checkout's shadowing node_modules directory. Version checks and prototype
// imports must use this same entry or version-scoped consent is meaningless.
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

export async function loadRunningPiRuntime() {
  const entryUrl = runningPiCodingAgentEntry();
  const runtimeModule = await import(entryUrl);
  const version = runtimeModule.VERSION;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("running Pi version is unavailable");
  }
  const toolFactories = TOOL_FACTORY_NAMES.map((name) => {
    const factory = runtimeModule[name];
    if (typeof factory !== "function") {
      throw new Error(`running Pi tool factory is unavailable: ${name}`);
    }
    return factory;
  });
  return { entryUrl, version, toolFactories };
}

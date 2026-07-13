# Architecture and Maintenance

This document is for Glance UI maintainers. Consumer usage is documented in the [README](../README.md), with advanced controls in the [Power User Guide](power-user-guide.md).

## Source layout

```text
src/
├── index.js                  # Extension entry, commands, settings orchestration
├── config.js                 # Persistent configuration
├── format.js                 # Classification and display formatting
├── timeline.js               # Action grouping and rendering state
├── tools.js                  # Public compact tool definitions
├── ui/
│   └── sections.js           # Section navigator and shared UI components
└── patches/
    ├── layout.js             # Patch orchestration and assistant layout
    ├── tools.js              # Tool execution and native-detail integration
    ├── custom-messages.js    # Artifact rendering
    ├── runtime-errors.js     # Runtime warning/error rendering
    ├── chrome.js             # User-message and footer spacing
    ├── markdown.js           # Heading and fenced-code presentation
    └── transaction.js        # Exact-descriptor rollback for patch installation
```

`src/index.js` is the Pi extension entry and the facade used by tests. Patch modules remain dependency leaves; they must not import `src/index.js`.

## Why private patches exist

Pi's public extension API can register replacement tool definitions with custom `renderCall` and `renderResult` functions. Glance UI uses that API for compact built-in tool summaries. It also supports renderers for extension-owned custom messages and entries, but it does not provide hooks that replace or decorate Pi's native transcript components.

The missing hooks matter because Glance UI changes native content rather than adding a separate status panel:

| Patch area | Behavior it enables | Missing public capability |
| --- | --- | --- |
| `layout.js` | Compact native Thinking, per-section expansion, and `Ctrl+T`/`Ctrl+O` integration | Native assistant-message renderer and transcript expansion lifecycle |
| `tools.js` | Group headers and compact spacing around Pi's assembled tool rows while preserving native expanded output | Post-assembly native tool-row renderer/layout hook |
| `custom-messages.js` | Artifact grouping and expansion in the original transcript position | Native custom-message component decorator |
| `runtime-errors.js` | Compact runtime notices and errors with reconstructed-session behavior | Native runtime-message renderer and reconstruction hook |
| `chrome.js` | User-message and footer spacing | Native user-message and footer layout hooks |
| `markdown.js` | Compact headings and fenced code in Pi-rendered Markdown | Native Markdown renderer decorator or presentation options |

Replacing these rows with extension-owned messages or widgets is not equivalent: Pi would still render the native content, the replacement could be duplicated or reordered, and built-in expansion and reconstructed-session behavior would be lost. Maintaining a Pi fork would avoid prototype patching but would require users to replace their Pi installation. Guarded runtime patches keep Glance UI installable as an extension and do not modify files in Pi's installation.

## Patch safety contract

Private paths are unsupported and can change in any Pi release. Glance UI therefore treats each supported Pi version as an explicit compatibility target:

- Fresh installs use only public compact tool definitions; private patch modules are dynamically imported only after `/glance-ui patches on` confirmation.
- Consent is stored for one exact Pi version. A missing or mismatched `patchesVersion` leaves private patches dormant.
- Patch installation waits until the confirmed session's interactive theme exists.
- Structural probes verify every private component and method before the transaction commits.
- Installation snapshots exact prototype descriptors and rolls them back in reverse order if any installer, probe, or assistant stage fails.
- A failed private transaction emits a warning and leaves public compact tool definitions available.
- `/glance-ui patches off` makes installed wrappers delegate to Pi's native layout immediately and prevents installation after restart; `/glance-ui off` also disables public compact tools.
- Release requirements pin the Pi versions exercised by unit, rollback, benchmark, and fresh-install startup tests.
- Patches mutate prototypes only in the running process; they never edit Pi's installed source files.

Patch installation order in `patchHiddenThinkingLayout()` is significant. Per-install `WeakMap`, `WeakSet`, counters, and generation state must stay inside their owning patch closure. Rollback must continue to preserve wrappers from a prior hot-reload generation.

The `pi-compact-ui.*` `Symbol.for()` names are intentionally retained for hot-reload compatibility with earlier builds. Do not rename them without migration coverage.

## Removing private patches

Remove a patch area when Pi exposes a documented, stable public API that provides its behavior without importing a private module path or writing to a native prototype. Removal can happen one area at a time; the public tool-definition overrides do not need to be removed with the private patches.

The private patch layer is fully removable when public APIs provide all of the following:

1. Renderer replacement or decoration for native assistant/Thinking, user, custom, runtime-error, footer, Markdown, and assembled tool-execution components.
2. Read/write access to native global expansion state and Thinking visibility, including `Ctrl+O`, `Ctrl+T`, per-section overrides, invalidation, and rerendering.
3. Component lifecycle hooks that work during live streaming, transcript reconstruction, session switching, and extension reload.
4. A supported way to preserve native expanded tool output and terminal-image row geometry while changing compact layout.

Before deleting the old implementation, a patchless build must pass equivalent behavior, reconstruction, terminal-image, disabled-mode, performance, and fresh-install startup coverage on every supported Pi version. Completion means production code contains no private Pi path imports, native prototype writes, or compatibility symbols retained solely for the removed patch.

## Expanded-rendering invariant

Terminal image renderers reserve screen height with trailing empty rows. The outer tool-execution patch must not indent, resize, or trim native assembled rows. It may prepend a group header; built-in call and result components are compacted separately.

## Validation

Run after any source, dependency, or Pi-version change:

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run benchmark:start
npm pack --dry-run
```

The benchmark creates an isolated temporary Glance UI configuration and generates synthetic turns; it does not read a real transcript.

Also verify interactively:

1. Thinking tree rendering and `Ctrl+T`/`Ctrl+O` behavior.
2. Ten-action windows and phase/category headings.
3. `/sections` expansion for Thinking, tools, artifacts, and errors.
4. Expanded Bash command and native output.
5. Live and reconstructed grouping around custom messages.
6. Terminal images followed by additional transcript content.
7. Enabled and disabled presentation behavior.
8. Fresh startup and declined consent leave native prototype descriptors unchanged.
9. Patch consent, version mismatch, opt-out, and compatibility failures at each private stage.

## Release safety

- Keep GitHub Actions permissions read-only unless a dedicated release workflow requires more.
- Pin third-party actions to immutable commit SHAs.
- Publish through npm trusted publishing with provenance rather than a long-lived token.
- Update the README requirements and peer dependencies together.
- Prefer an immutable release tag for user installation instructions.

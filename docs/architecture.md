# Architecture and Maintenance

This document is for Glance UI maintainers. Consumer usage is documented in the [README](../README.md), with advanced controls in the [Power User Guide](power-user-guide.md).

## Source layout

```text
src/
├── index.js                  # Extension entry, commands, settings orchestration
├── config.js                 # Persistent configuration
├── format.js                 # Classification and display formatting
├── timeline.js               # Action grouping and rendering state
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

## Private renderer hooks

The extension wraps public built-in tool definitions and patches private Pi interactive components for transcript layout. Private paths are unsupported and can change in any Pi release.

Patch installation order in `patchHiddenThinkingLayout()` is significant. Per-install `WeakMap`, `WeakSet`, counters, and generation state must stay inside their owning patch closure. Installation snapshots exact prototype descriptors and rolls them back in reverse order if any later installer, probe, or assistant stage fails; this also preserves wrappers from a prior hot-reload generation.

The `pi-compact-ui.*` `Symbol.for()` names are intentionally retained for hot-reload compatibility with earlier builds. Do not rename them without migration coverage.

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
8. Compatibility failures at each private patch stage.

## Release safety

- Keep GitHub Actions permissions read-only unless a dedicated release workflow requires more.
- Pin third-party actions to immutable commit SHAs.
- Publish through npm trusted publishing with provenance rather than a long-lived token.
- Update the README requirements and peer dependencies together.
- Prefer an immutable release tag for user installation instructions.

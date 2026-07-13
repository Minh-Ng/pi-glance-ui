# Changelog

All notable changes to Pi Glance UI will be documented here.

## Unreleased

- Add an in-overlay detail viewer to Ctrl+Shift+O: wide terminals show section list and selected content side by side, narrow terminals prioritize selected content, and Page Up/Page Down scrolls long blocks.
- Preserve local section expansion through Pi's repeated global-state synchronization and transcript rebuilds.
- Show complete arguments and results for expanded custom tools such as TaskCreate and TaskUpdate when they do not provide custom renderers.

## 0.2.4

- Fix the Ctrl+Shift+O section navigator running off the page: the list is now windowed to the overlay's visible height with `↑ N more` / `↓ N more` indicators and always keeps the selected row on screen. Previously the list rendered from the top with no scrolling, so navigating down moved the selection (and the visible effect of toggling it) past the clipped overlay.
- Add `benchmark:perf` micro-benchmarks for the section navigator and transcript-spacing passes.

## 0.2.3

- `/glance-ui` now opens an interactive, live-updating settings panel (enabled / patches / working-detail) navigable with the keyboard; values update in place as they change. `/glance-ui settings` still prints the text summary, and the panel falls back to text when custom overlays are unavailable (RPC/print modes). Preserves the version-gated confirmation before enabling private layout patches.
- Add one blank line between a text-bearing assistant message and an immediately following grouped action ("Act · Ran") summary, matching native Pi's separation that the compact grouping otherwise removes. The separator is applied the moment the tool row streams in (no flicker), is idempotent, and is self-removing when that adjacency no longer holds.
- Fix wrapped Thinking lines breaking out to the left margin: re-wrap thinking prose to the live render width with a hanging indent so continuation lines stay aligned under their branch connector or the `Thinking:` label. Covers both multi-section and single-section (inline) thinking.
- Add spacing-contract, settings-panel, and hanging-indent test coverage (`wrapThinkingLines` and transcript boundary matrix).

## 0.2.2

- Fix private layout patches silently rendering native in a local dev checkout: anchor pi-coding-agent module resolution to the running CLI (`process.argv[1]`) so prototype patches target the instance Pi renders with, instead of a shadowing `node_modules` copy returned by `import.meta.resolve`.
- Add regression coverage for CLI-anchored resolution and the `import.meta.resolve` fallback.

## 0.2.1

- Avoid calling the optional `requestRender` method from real Pi command contexts.
- Cover enablement and patch consent commands with a command UI that omits `requestRender`.

## 0.2.0

- Keep private layout patches dormant on fresh installs until explicit, version-scoped confirmation.
- Retain public compact tool rendering when private patches are off or incompatible.
- Add `/glance-ui patches on|off` and the `/glance-ui install-patch` opt-in alias.
- Normalize live and reconstructed Thinking spacing with semantic boundary tests.
- Add fresh-install startup and patch-consent regression coverage.

## 0.1.0

- Initial release.
- Compact Thinking, grouped recent actions, artifacts, and runtime notices.
- Section navigator and persistent `/glance-ui` settings.

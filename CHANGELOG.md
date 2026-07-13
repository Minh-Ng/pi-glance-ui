# Changelog

All notable changes to Pi Glance UI will be documented here.

## Unreleased

- Clarify section filtering with an explicit `Filter:` header and a spaced lowercase `f: cycle filter` footer hint.

## 0.2.8

- Expand the `Ctrl+Shift+O` navigator to 85% terminal height, narrow its section list to enlarge detail, and add F-key filtering by action phase or section type.

## 0.2.7

- Restore action sections in `Ctrl+Shift+O` after `/reload` by rebuilding them from the active session whenever the navigator opens; fallback detail retains tool arguments/results even when Pi never renders off-screen tool components, and visible action/Thinking counts make recovery observable.
- Let Left/Right or Tab focus the section list or detail pane; Up/Down then selects sections or scrolls long detail one line.

## 0.2.6

- Fix doubled blank lines in replayed transcripts after `/reload` or `/resume`: transcript-spacing bookkeeping now survives extension-generation handoffs (registered symbols plus a structural never-stack guard), so the new generation no longer inserts a second separator before replayed Thinking and action groups.

## 0.2.5

- Preserve validated private-patch state while `/resume` replays the replacement session before its `session_start`, so historical Thinking and tools remain compact; removed or changed consent still disables inherited wrappers immediately.

## 0.2.4

- Load version checks and built-in tool factories from the running Pi installation so consent and private patches always target the same module graph.
- Strip terminal control sequences from compact summaries, errors, paths, Thinking prose, and custom artifacts before rendering them.
- Migrate constructor-owned state when an extension hot reload retains shared runtime objects, preventing new fields from being absent on older instances.
- Bound compact Thinking formatting during streaming while preserving complete content in expanded detail, avoiding work that grows quadratically with the response.
- Point the README at an existing release tag and validate install refs, package metadata, release tags, and performance benchmarks in CI.
- Preserve transcript ordering during reconstruction so Thinking and action groups remain interleaved instead of appearing as two contiguous type blocks.
- Keep Thinking sections available in tool-heavy transcripts by removing the obsolete 50-section FIFO cap; the windowed navigator now safely browses the complete active transcript section set.
- Make setup and runtime status explicit that version-approved private patches are required for Thinking, artifacts, errors, custom tools, and the complete section viewer; document activation and Pi-upgrade behavior prominently.
- Add an in-overlay detail viewer to Ctrl+Shift+O: wide terminals show section list and selected content side by side, narrow terminals prioritize selected content, Page Up/Page Down scrolls long blocks, and the UI labels its top-recent/bottom-older ordering.
- Preserve local section expansion through Pi's repeated global-state synchronization and transcript rebuilds.
- Show complete arguments and results for expanded custom tools such as TaskCreate and TaskUpdate when they do not provide custom renderers.
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

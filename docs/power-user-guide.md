# Pi Glance UI Power User Guide

This guide covers detailed display behavior and configuration. Most users only need the [README](../README.md).

## Compact transcript behavior

Glance UI formats existing Pi transcript content; it does not summarize with a second model or change tool execution.

Public compact rendering is active by default. It:

- shows at most the ten most recent actions for each reconstructed turn;
- groups adjacent actions by phase and category;
- keeps complete built-in tool content available through expansion.

After explicit private-patch consent, Glance UI also formats the latest visible Thinking prose as a tree and makes native artifacts and other transcript sections available through expansion.

### Phases and categories

The phase describes why an action is occurring:

| Phase | Classification |
| --- | --- |
| `Plan` | Reading, searching, listing, fetching, and most diagnostic-like tools |
| `Implement` | Editing, writing, rewriting, creating, and deleting |
| `Verify` | `lsp_diagnostics` and recognized Bash test, check, lint, typecheck, or build commands |
| `Coordinate` | Task creation, updates, execution, and status checks |
| `Act` | Commands and tools that do not match another phase |

The category describes what the tool did: `Explored`, `Changed`, `Ran`, `Delegated`, or `Interacted`. Adjacent tools merge only when their phase, category, turn, and live grouping boundary match.

Compact rows retain useful arguments such as Bash commands, file paths, edit counts, search patterns, and line ranges. Failed tools include up to 180 characters of textual error detail when available.

## Detail controls

`Ctrl+O` always controls completed tool detail. With private patches on, it also controls recorded Thinking and custom artifacts, while `Ctrl+T` controls Thinking visibility.

Use `/sections` or `Ctrl+Shift+O` to browse and locally override sections. The selected block is rendered in a detail pane beside the list; narrow terminals devote the overlay to that selected detail.

- Up/Down selects a section and refreshes its detail.
- Page Up/Page Down scrolls long detail; Home/End jumps to its bounds.
- Enter or Space expands or collapses the corresponding transcript block.
- Escape closes the navigator.

A later global toggle clears the relevant local override. Expanded built-in tools use Pi's native renderer. Terminal-image rows retain their native reserved height.

## Running tools

```text
/glance-ui working-detail auto
/glance-ui working-detail compact
/glance-ui working-detail expanded
/glance-ui working-detail hidden
```

- `auto` keeps only the bottom-most running tool compact.
- `compact` keeps running tools compact, except an explicit section expansion.
- `expanded` makes running tools follow `Ctrl+O`.
- `hidden` omits active rows until completion.

## Persistent settings

Run `/glance-ui`, `/glance-ui settings`, or `/glance-ui config` to show every setting and its current value.

```text
/glance-ui settings enabled on
/glance-ui settings enabled off
/glance-ui patches on
/glance-ui patches off
/glance-ui settings working-detail auto
```

The persisted file uses this shape:

```json
{
  "enabled": true,
  "patchesVersion": "0.80.6",
  "workingDetailMode": "auto"
}
```

`patchesVersion` records interactive confirmation and is valid only for that exact Pi version. A missing or mismatched value leaves all private patches dormant. An exact manually supplied value is treated as recorded consent, so do not copy it between installations. Unknown or invalid values are ignored. Direct file edits require an extension or session reload.

Settings default to `~/.pi/agent/glance-ui.json`. Set `PI_GLANCE_UI_CONFIG` to choose another path. The file is replaced atomically and created with mode `0600` on platforms that support POSIX file modes.

`/glance-ui patches off` immediately makes installed private wrappers delegate to native layout while retaining public compact tools; after restart, no private prototype patches are installed. `/glance-ui off` also disables compact tools and restores native Pi presentation. Re-enable public rendering with `/glance-ui on`; no reload is required.

## Optional patched presentation

After `/glance-ui patches on` is confirmed for the running Pi version, Glance UI also:

- removes extra vertical padding around user messages;
- aligns the footer with the transcript and editor;
- renders Markdown headings without source `#` markers;
- renders ordinary fenced code without decorative gutters;
- presents displayed custom messages as expandable artifacts;
- presents runtime warnings and errors with a semantic title and readable body.

## Compatibility

Version 0.2.1 requires:

- `@earendil-works/pi-coding-agent` 0.80.6
- `@earendil-works/pi-tui` 0.80.6

Glance UI wraps public built-in tool definitions, but some presentation features require private Pi renderer hooks. Private paths can change between Pi releases.

Private patch modules are loaded only after confirmation. On later starts, compatibility probes run during `session_start` only when stored consent exactly matches the running Pi version. If a private hook is unavailable, Glance UI warns instead of failing the session. Private prototype installation is transactional: a failed installer or probe restores every property descriptor captured earlier in that attempt, while compatible public tool rendering remains available.

For implementation details and upgrade checks, see the [Architecture and Maintenance Guide](architecture.md).

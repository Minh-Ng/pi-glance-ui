# Pi Glance UI Power User Guide

This guide covers detailed display behavior and configuration. Most users only need the [README](../README.md).

## Compact transcript behavior

Glance UI formats existing Pi transcript content; it does not summarize with a second model or change tool execution.

In compact rendering it:

- formats the latest visible Thinking prose as a tree;
- shows at most the ten most recent actions for each reconstructed turn;
- groups adjacent actions by phase and category;
- keeps complete tool and artifact content available through expansion.

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

`Ctrl+O` controls global detail for recorded Thinking, completed tools, and custom artifacts. `Ctrl+T` controls Thinking visibility.

Use `/sections` or `Ctrl+Shift+O` for a local override:

- Up/Down selects a section.
- Enter or Space expands or collapses it.
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
/glance-ui settings working-detail auto
```

The persisted file uses this shape:

```json
{
  "enabled": true,
  "workingDetailMode": "auto"
}
```

Unknown or invalid values are ignored. Direct file edits require an extension or session reload.

Settings default to `~/.pi/agent/glance-ui.json`. Set `PI_GLANCE_UI_CONFIG` to choose another path. The file is replaced atomically and created with mode `0600` on platforms that support POSIX file modes.

Disabling compact rendering with `/glance-ui off` immediately restores native Pi presentation for existing and new transcript components, including Markdown, user messages, the footer, Thinking, tools, artifacts, and errors. Re-enable it with `/glance-ui on`; no reload is required.

## Other presentation changes

While installed, Glance UI also:

- removes extra vertical padding around user messages;
- aligns the footer with the transcript and editor;
- renders Markdown headings without source `#` markers;
- renders ordinary fenced code without decorative gutters;
- presents displayed custom messages as expandable artifacts;
- presents runtime warnings and errors with a semantic title and readable body.

## Compatibility

Version 0.1.0 requires:

- `@earendil-works/pi-coding-agent` 0.80.6
- `@earendil-works/pi-tui` 0.80.6

Glance UI wraps public built-in tool definitions, but some presentation features require private Pi renderer hooks. Private paths can change between Pi releases.

Compatibility probes run during `session_start`. If a private hook is unavailable, Glance UI warns instead of failing the session. Private prototype installation is transactional: a failed installer or probe restores every property descriptor captured earlier in that attempt, while compatible public tool rendering remains available.

For implementation details and upgrade checks, see the [Architecture and Maintenance Guide](architecture.md).

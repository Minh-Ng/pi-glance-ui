# Pi Glance UI

A [Pi](https://pi.dev) extension that makes long coding transcripts easier to scan while keeping complete tool detail available.

![Pi Glance UI showing compact Thinking and grouped actions](media/screenshot.png)

<sub>The screenshot uses synthetic prompts, paths, commands, and output.</sub>

## What it changes

- Formats the latest visible Thinking prose as a compact tree.
- Groups recent actions into `Plan`, `Implement`, `Verify`, and other activity phases.
- Shows the command, path, query, or other useful argument for each action.
- Keeps complete tool output and artifact text available through expansion.
- Uses Pi's native expanded renderer for built-in tools, including terminal images.
- Tightens transcript spacing and simplifies Markdown headings and fenced code blocks.
- Probes private renderer compatibility at startup and warns when optional layout features are unavailable.

Glance UI changes transcript presentation only. It does not change how tools execute or what Pi stores in a session. Pi's public extension API supports custom tool rendering but not replacement of native transcript renderers, so the remaining presentation features use guarded, in-memory compatibility patches. See [Why private patches exist](docs/architecture.md#why-private-patches-exist).

## Requirements

- Node.js 22.19.0 or newer
- `@earendil-works/pi-coding-agent` 0.80.6
- `@earendil-works/pi-tui` 0.80.6

## Install

```bash
pi install git:github.com/Minh-Ng/pi-glance-ui@v0.1.0
```

Reload Pi after installation. Compact rendering is enabled by default; no Pi fork or manual source patch is required.

## Everyday controls

| Control | Action |
| --- | --- |
| `Ctrl+O` | Toggle full detail for Thinking, completed tools, and artifacts |
| `Ctrl+T` | Show or hide Thinking |
| `/sections` or `Ctrl+Shift+O` | Choose one section to expand or collapse |
| `/glance-ui` | Show current settings and valid values |
| `/glance-ui on` | Enable compact transcript sections |
| `/glance-ui off` | Restore Pi's native transcript presentation immediately |

In the section navigator, use Up/Down to select, Enter or Space to toggle, and Escape to close.

Running tools use `auto` detail by default: the bottom-most running tool stays compact and completed output follows `Ctrl+O`. Other modes are covered in the [Power User Guide](docs/power-user-guide.md#running-tools).

Settings are saved to `~/.pi/agent/glance-ui.json`.

## Troubleshooting

- **Need one hidden result?** Open `/sections` and expand that action group.
- **Want Pi's original presentation?** Run `/glance-ui off`. Existing and new transcript components switch immediately; `/glance-ui on` restores compact rendering.
- **See “layout extras unavailable”?** A private renderer compatibility probe failed. The private layout transaction was rolled back; public compact tool summaries remain available where compatible.
- **Setting was not saved?** Check that `~/.pi/agent` is writable. Glance UI reports when a change is session-only.

## Power users

See the [Power User Guide](docs/power-user-guide.md) for grouping rules, running-tool modes, section behavior, settings, and compatibility details.

Maintainers can consult the [Architecture and Maintenance Guide](docs/architecture.md).

## License

[MIT](LICENSE)

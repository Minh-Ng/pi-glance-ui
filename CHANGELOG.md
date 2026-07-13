# Changelog

All notable changes to Pi Glance UI will be documented here.

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

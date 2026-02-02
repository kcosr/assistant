# Pi-Mono SDK Integration Notes (Pi Provider)

> Deprecated: superseded by `docs/design/pi-sdk-provider.md`.

This file is retained for historical context only. The current implementation:

- Uses the Pi SDK (`@mariozechner/pi-ai`) for in-process chat under provider id `pi`.
- Removes `openai` / `openai-compatible` from assistant chat providers (Pi handles upstream).
- Keeps CLI providers (`claude-cli`, `codex-cli`, `pi-cli`) unchanged.

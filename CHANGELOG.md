# Changelog

Every release is a tag `vX.Y.Z` with `codex-spend.mjs` and `SHA256SUMS` attached.

## [1.0.0] - 2026-10-28

First release.

- Reads the session logs the Codex CLI writes to `~/.codex/sessions/**/rollout-*.jsonl` and `~/.codex/archived_sessions` (or `CODEX_HOME`) on this computer and prints what the same tokens would cost at
  OpenAI's API list prices: today, the last 7 and 30 days, all time, and by model.
- Prices as of 2026-10-28, with their sources in the file (`PRICES_AS_OF`, `PRICE_SOURCES`).
- `--json` for the same numbers as JSON. No network calls, nothing written, no dependencies.

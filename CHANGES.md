# Changes from upstream

Baseline: [OpenHealthForAll/open-health](https://github.com/OpenHealthForAll/open-health)
@ `095fdc7` (2026-01-06). License: AGPL-3.0 (retained).

## Document parsing
- Docling replaced by direct image-model parsing: uploaded PDFs are rasterized page by
  page and parsed by an Anthropic vision model with structured output and retries
  (`src/lib/health-data/parser/vision/anthropic.ts`). Docling container removed.
- LangChain `top_p`/`top_k` `-1` fix applied at build time (breaks the Anthropic API).

## Dashboard
- Weight card: merged weight history, latest + delta, interactive 30-point SVG
  sparkline with real axes and hover tooltips.
- Sleep card: 30-point history with axis gridlines and tooltips.
- Quick access connect/sync buttons for the wearable integrations.

## Integrations
- `whoop-sync/` service: WHOOP + Withings OAuth flows and daily merge-based sync
  (dedupe by date, newest first). Self-hosting setup docs describe how to create
  your own WHOOP/Withings developer apps.

## Fixes
- Model listing accepts current Claude models (upstream filter only matched
  `claude-3-5`/`claude-3-7`).
- Default model selection on chat-room creation.
- Login screen simplified; chat and source screens extended for the new data types
  (`WHOOP_DATA`, `WITHINGS_DATA`, `WEIGHT_HISTORY`, `MEDICATIONS`).

## Infrastructure
- `docker-compose.yml`: database and app bound to 127.0.0.1, Docling service removed,
  secrets via environment variables only (`.env.example` provided).
- All configuration externalized; no credentials, personal names, domains or server
  paths in the tree (verified by automated scan before every push).

## Configuration
- `DEFAULT_CHAT_MODEL` selects the model for new consultations (default `claude-opus-5-5`).
- Builds are reproducible: the image installs from the lockfile (`npm ci`).

## Notes
- Language packs are upstream's (de/en/es/fr/ja/ko/ru/uk/ur/zh); the new components
  are English-only for now. Internationalizing them is on the roadmap.
- Upstream's maintenance state: last release v0.2.0 (2025-02-21).

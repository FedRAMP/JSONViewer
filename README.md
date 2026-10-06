# FedRAMP Document Viewer

A small, read-only web app that opens a FedRAMP 20x JSON file (SDR, COP, Ongoing Certification Report, Incident Report, and the rest of the [fedramp/schemas](https://github.com/fedramp/schemas) catalog — see `src/config.js`) and renders it as a formatted, human-readable document.

## Quick start

```bash
bun install
bun run dev        # http://localhost:5174
```

Click **Open JSON File** (or drag a file onto the page). The document type is detected from the file's top-level keys; if the guess is wrong, pick the right one from the **Document type** dropdown and the page re-renders.

Switch to **Agency** in the toolbar to browse `public/AgencyControlGuidance.controls.merged.json`: every NIST control (grouped by family) with its agency actions, FedRAMP guidance, and notes per part, plus each FedRAMP requirement (FRR) and Key Security Indicator (KSI) that the FRMR rules map to that control, with its force and statement.

## How it works

- On startup, every schema in `SCHEMA_CATALOG` is fetched (local `public/` copy first, falling back to GitHub raw), its cross-file `$ref`s into the common-definitions schema are inlined, and the requirement-ID / NIST-control-ID enums are patched from `public/fedramp-consolidated-rules.json` so IDs render alongside their human-readable titles.
- `src/utils/detectSchema.js` scores each schema against the loaded data (matched keys, minus unknown keys, minus missing required keys) and picks the best.
- `src/utils/htmlPreview.js`'s `buildPreviewHtml(schema, data)` walks the schema recursively and emits a standalone HTML page (collapsible sections, Markdown via `marked`, enum titles, formatted dates/links).
- The result is shown in an `<iframe sandbox="">` — the empty sandbox blocks all scripting, since the content comes from an untrusted file.

Everything runs in the browser; files never leave the machine.

## Commands

```bash
bun run sync         # pull schemas + FRMR rules into public/
bun run sync:clean   # purge public/fedramp-*.json first, then sync
bun run sync:titles  # rebuild public/nist-800-53-rev5-control-titles.json from NIST's OSCAL catalog (part of sync)
bun run build        # production bundle → dist/
bun run test         # Vitest unit tests (renderer, detection, $ref inlining, enum patching)
bun run test:e2e     # Playwright (first run: bunx playwright install chromium)
bun run test:all     # both
```

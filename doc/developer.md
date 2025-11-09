# SID Flow Developer Guide

Designed for contributors maintaining or extending the SID Flow toolchain.

---

## 1. Environment

- **Bun** `>= 1.1.10`
- **Node.js** (optional) for editor tooling, but Bun drives scripts and tests.
- **`7zip-min`** ships with the repo; no system-level 7-Zip install required.
- **Host audio player** (`ffplay` preferred; `aplay` works on ALSA systems) for PCM output from the WASM playback harness.

Install dependencies once: `bun install`.

> `bun run build` now runs `bun install --frozen-lockfile` automatically, so vectordb, `7zip-min`, and other runtime dependencies are always present before compilation. As long as `sidplayfp` is on your PATH, a clean checkout can run `bun run build` followed by `bun run test` without extra setup.

---

## 2. Configuration

`./.sidflow.json` controls runtime paths:

| Key | Purpose |
| --- | --- |
| `hvscPath` | Mirrors the HVSC tree produced by `sidflow fetch`. |
| `wavCachePath` | Receives rendered WAV files. |
| `tagsPath` | Stores manual and automatic tag files. |
| `sidplayPath` | (Deprecated) Legacy sidplayfp override. Ignored by interactive CLIs. |
| `threads` | Worker pool size (`0` = auto). |
| `classificationDepth` | Folder depth for `auto-tags.json` aggregation. |

Validate edits with `bun run validate:config`.

---

## 3. Workspace Commands

| Command | Result |
| --- | --- |
| `bun run build` | Install dependencies (frozen-lockfile) and compile all packages with project references. |
| `bun run test` | Build then run the Bun test suite with coverage (≥90% enforced). |
| `bun run test:e2e` | Run end-to-end integration test with real SID files. |
| `bun run validate:config` | Smoke-test the active configuration file. |
| `./scripts/sidflow-fetch` | Run the fetch CLI with Bun hidden behind a repo-local shim. |
| `./scripts/sidflow-rate` | Launch the interactive rating CLI (TTY required). |
| `bun run fetch:sample` | Spin up a local mirror and run the `sidflow fetch` CLI end-to-end (used in CI). |
| `bun run classify:sample` | Execute the end-to-end classification sample, including metadata extraction and auto-tag heuristics. |

CI mirrors these steps before uploading coverage to Codecov.

---

## 4. Packages at a Glance

| Package | Responsibility |
| --- | --- |
| `@sidflow/common` | Shared config loader, deterministic JSON serializer, logging, filesystem helpers. |
| `@sidflow/fetch` | HVSC sync logic and CLI (`./scripts/sidflow-fetch`). |
| `@sidflow/rate` | Rating session planner (`sidflow-rate` CLI). |
| `@sidflow/classify` | Classification planner (feature extraction + ML pipeline scheduled for Phase 4). |

All packages share `tsconfig.base.json` and strict TypeScript settings; avoid introducing `any`.

---

## 5. Coding Standards

- Keep all reusable logic inside `@sidflow/common` to prevent duplication.
- Prefer small, composable functions; add concise comments only where intent is non-obvious.
- Use `fs/promises` for filesystem access and bubble detailed errors.
- Reuse the shared `retry` helper for transient network or IO operations instead of hand-rolling loops.
- Serialize JSON with `stringifyDeterministic` for stable output.
- Treat `ffplay`/`aplay` as the only native dependencies; the WASM `SidPlaybackHarness` streams PCM into whichever player is detected.

---

## 6. Developing CLIs

- The fetch CLI is live; run `./scripts/sidflow-fetch --help` to inspect options.
- The rating CLI requires a TTY; run `./scripts/sidflow-rate --help` for controls and flags.
- Both `sidflow-play` and `sidflow-rate` rely on the shared WASM `SidPlaybackHarness`; ensure your development machine has `ffplay` or `aplay` to hear audio while iterating.
- Upcoming CLIs for tagging and classification should follow the same pattern: parse args in a dedicated `cli.ts`, expose a testable `run*Cli` function, and guard the executable entry point with `import.meta.main`.
- Keep option parsing minimal and dependency-free; write focused tests similar to `packages/sidflow-fetch/test/cli.test.ts`.

---

## 7. Testing Notes

- Use Bun’s native test runner (`bun:test`).
- Mock filesystem/network interactions with temporary directories and fetch stubs; see `packages/sidflow-fetch/test` for patterns.
- Coverage reports print uncovered lines—address these before sending PRs.
- Remember to restore any monkey-patched globals (e.g., `fetch`, `process.stdout.write`) during tests.

---

## 8. Workspace

```text
workspace/
  hvsc/          # HVSC mirror maintained by fetch CLI
  wav-cache/     # WAV renders and audio features (future phases)
  tags/          # Manual and auto-generated tags
hvsc-version.json  # Version manifest stored alongside hvscPath

The entire `workspace/` directory is git-ignored; keep long-lived local mirrors and experiments there without touching version control.
```

Generated content can be reproduced; avoid committing large artefacts unless explicitly required.

---

## 9. Test Data

The `test-data/` directory contains sample SID files from HVSC Update #83 for end-to-end testing:

```text
test-data/
└── C64Music/
    └── MUSICIANS/
        ├── Test_Artist/
        │   ├── test1.sid
        │   └── test2.sid
        └── Another_Artist/
            └── test3.sid
```

These SID files are committed to the repository and used by the end-to-end test (`bun run test:e2e`) to validate the complete SIDFlow pipeline including:

- WAV cache building
- Feature extraction
- Classification and rating prediction
- Playlist generation
- Playback flow

The test SID files are minimal valid PSID v2 files created for testing purposes. To use real SID files from HVSC Update #83:

1. Download `HVSC_Update_83.7z` from <https://hvsc.brona.dk/HVSC/>
2. Extract 3 SID files with their folder hierarchy
3. Replace the files in `test-data/C64Music/MUSICIANS/`

See `test-data/README.md` for detailed instructions.

---

## 10. Pull Request Checklist

- `bun run build`
- `bun run test`
- `bun run test:e2e`
- `bun run validate:config`
- Ensure new features have accompanying tests and keep coverage ≥90%.
- Update `README.md` or `doc/developer.md` when behaviour changes.

Happy hacking! 🎶

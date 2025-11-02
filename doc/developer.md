# SID Flow Developer Guide

Designed for contributors maintaining or extending the SID Flow toolchain.

---

## 1. Environment

- **Bun** `>= 1.1.10`
- **Node.js** (optional) for editor tooling, but Bun drives scripts and tests.
- **7-Zip** (`7z`) accessible on the system path.
- **sidplayfp** for audio playback; ensure the binary path matches the default in `.sidflow.json` or override per CLI.

Install dependencies once: `bun install`.

---

## 2. Configuration

`./.sidflow.json` controls runtime paths:

| Key | Purpose |
| --- | --- |
| `hvscPath` | Mirrors the HVSC tree produced by `sidflow fetch`. |
| `wavCachePath` | Receives rendered WAV files. |
| `tagsPath` | Stores manual and automatic tag files. |
| `sidplayPath` | Default path to `sidplayfp`. |
| `threads` | Worker pool size (`0` = auto). |
| `classificationDepth` | Folder depth for `auto-tags.json` aggregation. |

Validate edits with `bun run validate:config`.

---

## 3. Workspace Commands

| Command | Result |
| --- | --- |
| `bun run build` | Compile all packages with project references. |
| `bun run test` | Build then run the Bun test suite with coverage (≥90% enforced). |
| `bun run validate:config` | Smoke-test the active configuration file. |

CI mirrors these steps before uploading coverage to Codecov.

---

## 4. Packages at a Glance

| Package | Responsibility |
| --- | --- |
| `@sidflow/common` | Shared config loader, deterministic JSON serializer, logging, filesystem helpers. |
| `@sidflow/fetch` | HVSC sync logic and CLI (`bun packages/sidflow-fetch/src/cli.ts`). |
| `@sidflow/tag` | Tagging session planner (interactive CLI landing in Phase 3). |
| `@sidflow/classify` | Classification planner (feature extraction + ML pipeline scheduled for Phase 4). |

All packages share `tsconfig.base.json` and strict TypeScript settings; avoid introducing `any`.

---

## 5. Coding Standards

- Keep all reusable logic inside `@sidflow/common` to prevent duplication.
- Prefer small, composable functions; add concise comments only where intent is non-obvious.
- Use `fs/promises` for filesystem access and bubble detailed errors.
- Reuse the shared `retry` helper for transient network or IO operations instead of hand-rolling loops.
- Serialize JSON with `stringifyDeterministic` for stable output.
- Treat `sidplayfp` as a user-supplied dependency—surface helpful errors if it is missing.

---

## 6. Developing CLIs

- The fetch CLI is live; run `bun packages/sidflow-fetch/src/cli.ts --help` to inspect options.
- Upcoming CLIs for tagging and classification should follow the same pattern: parse args in a dedicated `cli.ts`, expose a testable `run*Cli` function, and guard the executable entry point with `import.meta.main`.
- Keep option parsing minimal and dependency-free; write focused tests similar to `packages/sidflow-fetch/test/cli.test.ts`.

---

## 7. Testing Notes

- Use Bun’s native test runner (`bun:test`).
- Mock filesystem/network interactions with temporary directories and fetch stubs; see `packages/sidflow-fetch/test` for patterns.
- Coverage reports print uncovered lines—address these before sending PRs.
- Remember to restore any monkey-patched globals (e.g., `fetch`, `process.stdout.write`) during tests.

---

## 8. Data Locations

```text
data/
  hvsc/          # HVSC mirror maintained by fetch CLI
  wav-cache/     # WAV renders and audio features (future phases)
  tags/          # Manual and auto-generated tags
hvsc-version.json  # Version manifest stored alongside hvscPath
```

Generated content can be reproduced; avoid committing large artefacts unless explicitly required.

---

## 9. Pull Request Checklist

- `bun run build`
- `bun run test`
- `bun run validate:config`
- Ensure new features have accompanying tests and keep coverage ≥90%.
- Update `README.md` or `doc/developer.md` when behaviour changes.

Happy hacking! 🎶

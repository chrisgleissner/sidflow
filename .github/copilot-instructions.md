# SIDFlow Copilot Guardrails

- Use strict TypeScript with explicit types; avoid `any` and prefer small, composable functions.
- Share cross-cutting logic through `@sidflow/common`; never duplicate configuration, logging, or serialization helpers elsewhere.
- Read `.sidflow.json` via the shared loader and respect flag overrides like `--sidplay` for all CLIs.
- Handle filesystem and process interactions with `fs/promises` and robust error reporting.
- Serialize JSON with deterministic ordering using `stringifyDeterministic` to keep diffs clean.
- Cover new logic with tests first; keep line coverage ≥90% and ensure CI stays green with Codecov enforced.
- Treat `sidplayfp` as a configurable dependency and guard against missing binaries in CLI UX.

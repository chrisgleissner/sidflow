# HVSC Classification Stall Prompt Reset

## Current facts from 2026-03-28 research

1. The current branch still contains live fail-open classification behavior.
   - `packages/sidflow-classify/src/index.ts` still converts render and feature-extraction failures into metadata-only records with `sidFeatureVariant: "unavailable"`.
   - `packages/sidflow-classify/src/sid-native-features.ts` still logs `continuing with WAV-only features`.
2. The current tests still normalize that degraded behavior as success.
   - `packages/sidflow-classify/test/high-risk-render-failure.test.ts` asserts that forced render failures still yield full record coverage with unavailable SID-native features.
   - `packages/sidflow-classify/test/render-timeout.test.ts` asserts metadata-only output when rendering or feature extraction fails.
3. The real CLI hang is reproducible today on the checked-in Mario 2SID file.
   - Command pattern used: `/usr/bin/time -v scripts/run-with-timeout.sh 45 -- ./scripts/sidflow-classify --config <temp-config> --force-rebuild --sid-path-prefix GAMES/S-Z/Super_Mario_Bros_64_2SID.sid`
   - Result: timeout after 45s, 100% CPU, max RSS about 292 MB.
   - Partial artifacts: metadata sidecar and telemetry `.events.jsonl` only; no WAV and no `.trace.jsonl`.
   - Last structured event: `render_start` for queue index `0`, `songIndex=1`.
4. The relevant checked-in stress asset already exists in `packages/sidflow-classify/test/super-mario-stress.test.ts`, and the real render loop / pool seams are `packages/sidflow-classify/src/render/wav-renderer.ts` and `packages/sidflow-classify/src/render/wasm-render-pool.ts`.
5. The CLI wrapper is `./scripts/sidflow-classify` and it is a Bash script. Use `./scripts/sidflow-classify` or `bash scripts/sidflow-classify`, not `bun ./scripts/sidflow-classify`.

## Roadmap

### 1. Stabilize the debugging loop

- Use `scripts/run-with-timeout.sh` for every classify/export command that could hang.
- Prefix long runs with `/usr/bin/time -v` so CPU and RSS are captured automatically.
- Preserve evidence under a repo-local directory such as `tmp/classify-stall/<timestamp>/`; do not rely on ephemeral terminal scrollback.
- Append every experiment to `WORKLOG.md` before moving on.

### 2. Reproduce first, with a falsifiable hypothesis

- Start with the real CLI Mario repro at `threads=1`.
- Capture:
  - exact command
  - timeout budget
  - expected signal
  - actual last structured event
  - artifact list
  - CPU / RSS / thread evidence
- Treat "timed out with repeated render heartbeats" as a valid data point, not as a reason to rerun blindly.

### 3. Localize the seam with a decision tree

- Compare direct renderer vs worker-pool path.
- Compare `captureTrace: false` vs `captureTrace: true`.
- Compare the failing Mario subtune against one normal control SID.
- Instrument only the stage boundaries needed to choose between:
  - hang inside `renderCycles(...)`
  - hang in trace extraction / buffering
  - hang in sidecar writes / flush
  - hang in worker message delivery / recycle
  - hang caused by subtune selection or multi-SID addressing

### 4. Make the agent impossible to leave in a blind stall

- If two runs produce the same symptom without narrowing the cause, stop rerunning and add instrumentation first.
- If no new structured event appears for 10s on a bounded repro, inspect partial artifacts immediately and record the state.
- If current telemetry is insufficient, add a small repo-local debug helper under `scripts/` or extend structured JSONL logs; do not rely on an interactive terminal session remaining attached.

### 5. Fix root cause, then remove the masking behavior

- Implement the smallest fix that resolves the diagnosed seam.
- Only after the root cause is understood, replace the fail-open behavior and update the tests that currently enshrine it.
- Do not paper over the issue with blanket timeout increases or extra retries unless a measurement proves the current bound is wrong.

### 6. Validate in escalating tiers

- Targeted unit/integration tests for the exact seam.
- Real Mario CLI repro must now complete or fail explicitly with a precise diagnostic.
- Checked-in high-risk fixture set.
- `packages/sidflow-classify/test/super-mario-stress.test.ts`.
- Bounded HVSC subset.
- Only then the authoritative full command: `bash scripts/run-similarity-export.sh --mode local --full-rerun true`.

## Work log rules

Record every experiment in `WORKLOG.md` with this structure:

| ID | Hypothesis | Command | Timeout | Expected falsifier | Result | Artifacts | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |

Hard rules:

- No rerun of the same command without a changed hypothesis, code path, or instrumentation set.
- No unbounded classify/export session.
- No "it seems hung" conclusions without the last event, the artifact list, and the timeout outcome.
- No claim of success while metadata-only fallback tests or code paths remain in the strict classify path.

## Replacement prompt

```text
ROLE
You are a senior systems engineer debugging a real hang in SIDFlow's WASM classification pipeline. Obey AGENTS.md and the repo docs exactly, including the requirements to read/update PLANS.md and append evidence to WORKLOG.md.

OBJECTIVE
Eliminate the indefinite classification stall on complex SID songs, starting with the live Mario 2SID repro under the real classify CLI, then scale the fix through the checked-in high-risk fixtures, the existing stress harness, a bounded HVSC subset, and finally the full authoritative workflow.

KNOWN FACTS YOU MUST START FROM
1. The current branch still has fail-open behavior in the classify path:
   - packages/sidflow-classify/src/index.ts still turns render or feature-extraction failures into metadata-only records.
   - packages/sidflow-classify/src/sid-native-features.ts still logs "continuing with WAV-only features".
2. The current tests still bless that degraded behavior:
   - packages/sidflow-classify/test/high-risk-render-failure.test.ts
   - packages/sidflow-classify/test/render-timeout.test.ts
3. A real bounded repro exists today:
   - `/usr/bin/time -v scripts/run-with-timeout.sh 45 -- ./scripts/sidflow-classify --config <temp-config> --force-rebuild --sid-path-prefix GAMES/S-Z/Super_Mario_Bros_64_2SID.sid`
   - It times out after 45s at 100% CPU.
   - Only the metadata sidecar and `.events.jsonl` exist afterward.
   - The last structured event is `render_start` for queue index 0 / subtune 1.
4. Mario metadata worth keeping in mind:
   - PSID v3
   - 37 songs
   - secondSIDAddress `$D420`
5. The likely diagnostic seams are:
   - packages/sidflow-classify/src/render/wav-renderer.ts
   - packages/sidflow-classify/src/render/wasm-render-pool.ts
   - subtune selection / multi-SID setup before the render loop
6. The CLI wrapper is `./scripts/sidflow-classify` (a Bash script). Do not invoke it as `bun ./scripts/sidflow-classify`.

NON-NEGOTIABLE OPERATING RULES
1. Never run an unbounded classify or export command. Wrap every potentially hanging run in `scripts/run-with-timeout.sh`, and use `/usr/bin/time -v` for long runs.
2. Preserve artifacts under a repo-local folder such as `tmp/classify-stall/<timestamp>/`.
3. Append every experiment to WORKLOG.md with: hypothesis, exact command, timeout, expected falsifier, actual result, artifact paths, and next action.
4. If two runs produce the same symptom without narrowing the cause, stop rerunning and add instrumentation first.
5. Do not touch full HVSC until the Mario repro, the checked-in high-risk set, and the existing stress harness are all green.
6. Do not hide the issue with blanket timeout increases, retries, or metadata-only/WAV-only fallbacks.

PHASE 0 - ORIENT AND RECORD
1. Read AGENTS.md, PLANS.md, README.md, doc/developer.md, doc/technical-reference.md, and any relevant `doc/plans/` entries.
2. Add or update the active task in PLANS.md.
3. Start a WORKLOG.md experiment table for this investigation.

PHASE 1 - REPRODUCE THE LIVE HANG
1. Create a repo-local temp config with:
   - `sidPath` pointing at `test-data/C64Music`
   - isolated audio/tag/classified output directories
   - `threads: 1`
2. Run the exact Mario CLI repro with a hard timeout.
3. Capture:
   - timeout status
   - `/usr/bin/time -v` output
   - telemetry `.events.jsonl`
   - partial artifact list
   - last structured event
4. Do not change code before this bounded repro exists in WORKLOG.md.

PHASE 2 - LOCALIZE THE SEAM WITH CONTROLLED EXPERIMENTS
Use the smallest experiment ladder that can separate the root cause:
1. Direct renderer vs worker-pool path.
2. `captureTrace: false` vs `captureTrace: true`.
3. Mario subtune 1 vs one known-good control SID.
4. If needed, Mario subtune 1 direct render helper vs full classify orchestration.

For each run, record what outcome would falsify your current hypothesis.

PHASE 3 - ADD ONLY THE INSTRUMENTATION YOU NEED
Instrument structured events, not ad-hoc print spam.
Required data when instrumenting:
1. sid path
2. song index / subtune
3. worker id
4. stage name
5. elapsed ms
6. render iterations / collected samples
7. trace event count and flush count
8. queue depth / busy worker count
9. worker recycle / terminate reason

Priority milestones:
1. before and after SID load
2. before and after subtune selection
3. before first `renderCycles(...)`
4. periodic render-loop progress milestones
5. before and after trace sidecar header / batch / footer writes
6. worker message send / receive / recycle

If existing logging cannot capture this cleanly, add a small helper script under `scripts/` and document it.

PHASE 4 - FIX THE ROOT CAUSE
Implement the smallest coherent fix that makes the failing seam behave correctly.
Examples of acceptable fix classes:
1. correct subtune selection or multi-SID setup
2. prevent render-loop livelock
3. bound or flush trace capture correctly
4. fix worker completion / recycle behavior
5. fix message delivery or await discipline

Examples of unacceptable fake fixes:
1. globally raising timeouts without evidence
2. adding retries without diagnosis
3. preserving metadata-only or WAV-only success paths in the strict classify flow

PHASE 5 - REMOVE THE MASKING CONTRACT
Once the root cause is fixed, update the current tests and code paths that normalize degraded success:
1. packages/sidflow-classify/test/high-risk-render-failure.test.ts
2. packages/sidflow-classify/test/render-timeout.test.ts
3. any remaining strict-path metadata-only or WAV-only fallback code

Replace them with tests that enforce:
1. bounded forward progress
2. deterministic trace-sidecar handling
3. explicit fatal behavior when strict prerequisites are missing

PHASE 6 - VALIDATE IN TIERS
Validation order is mandatory:
1. targeted tests for the changed seam
2. real Mario CLI repro under timeout wrapper
3. checked-in high-risk fixtures
4. `packages/sidflow-classify/test/super-mario-stress.test.ts`
5. bounded HVSC subset
6. full authoritative workflow:
   `bash scripts/run-similarity-export.sh --mode local --full-rerun true`

REPO VALIDATION RULES
1. Before declaring completion, run:
   - `bun run build`
   - relevant targeted tests
   - `bun run test` three consecutive times
2. Per AGENTS.md, do not claim completion without literal output showing `0 fail` across all three full test runs.

OUTPUT RULES
Your updates must stay evidence-first.
After each substantial step, record:
1. What changed
2. What hypothesis it tested
3. What the exact outcome was
4. What you will do next based on that outcome

FIRST ACTION
Create the bounded Mario repro in a repo-local temp directory, capture the timeout/evidence in WORKLOG.md, and do not edit code until that evidence exists.
```

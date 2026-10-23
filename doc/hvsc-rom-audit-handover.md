# SIDFlow HVSC ROM audit — implementation and adversarial-review handover

You are taking over an unfinished task in `/home/chris/dev/c64/sidflow`.
Review the current implementation independently, improve it, validate it, and
carry the original task through to completion. Do not merely endorse the previous
LLM's work or stop after producing another plan.

## Mandatory model routing

The user explicitly requires:

- **Opus 5.5** as architect and for important decisions: the correctness model,
  causal arguments, native/WASM qualification, compatibility semantics, evidence
  interpretation, production contract, adversarial review, and rollout approval.
- **Sonnet 5.5** for implementation, ordinary investigation, test execution,
  mechanical fixes, data generation, and routine validation.

Use those exact models where the host supports model selection or delegation.
Have Opus 5.5 independently challenge Sonnet's implementation and the previous
LLM's assumptions before approving expansion. Verify the actual model settings;
do not claim to have used these models if you have not. If the host cannot expose
them, state that limitation explicitly rather than silently substituting models
for the architectural role. This prompt authorizes the architect/executor
collaboration needed to honor the user's model routing.

## Immediate user constraints: hardening before expansion

The latest substantive user instruction is:

> Also, before you start rendering all songs, ensure to adversarially review any
> findings against a small test corpus and totally harden our analysis approach.
> Only roll out to more than 5% of all HVSC songs once this hardening is done, so
> we do not waste time by having to re-analyse after having found bugs

Treat this as a release gate, not a suggestion. Conservatively apply BOTH limits:

- At most **4,393 distinct HVSC subtunes** before hardening approval.
- At most **3,057 distinct HVSC files** before hardening approval.

The denominator is verified HVSC 85: **61,157 files / 87,868 subtunes**.
Count unique identities across prior pilot runs and relevant control/integration
renders, not independently per output directory or per invocation. Re-rendering
a previously counted subtune must not create an extra unique identity, but do not
forget uncommitted/in-flight work when enforcing the ceiling.

The user also challenged low CPU utilization. Use the machine's **8 logical CPUs**
effectively where appropriate. Six native workers ran well alongside the mostly
single-core real-HVSC integration test. Avoid competing with timing-sensitive
throughput unit tests. Do not claim effective utilization without measurements.
The user explicitly accepted lower utilization while testing/hardening the method.

**Do not launch the previously contemplated unlimited background census yet.**
The coordinators were stopped for this hardening review. No broad audit is running
at handover. Re-check the process list before starting anything.

## Repository state and instructions

At handover:

- Branch: `main`.
- HEAD: `a605279955b0c0c01f80d6528c0a75131fdea62f`.
- All implementation changes are **uncommitted**.
- The worktree was clean at the beginning of the previous LLM's work.
- Historical branch/HEAD statements near the top of `PLANS.md` describe older
  research; do not mistake them for the current checkout.

Read `AGENTS.md`, reopen `PLANS.md`, and read the required overview/developer/
technical-reference documents. Preserve and update the active task near the end
of `PLANS.md`, especially its latest adversarial-pilot section. Some earlier
checkboxes and validation statements predate the hardening changes and are too
optimistic for the current source.

Repository rules include:

- Full tests must pass **three consecutive times** before declaring the complete
  implementation finished. Paste literal terminal evidence showing `0 fail`.
- Fix failures, including pre-existing failures. Do not skip or weaken assertions.
- Use repository maintenance/build/test scripts; do not manage services or Docker
  with ad-hoc commands.
- Reuse common utilities and deterministic JSON serialization.
- Every catch must log or rethrow; avoid new `any` types.
- Do not commit ROMs, HVSC SID binaries, PCM, or other copyrighted binary inputs.
- Do not modify C64 Commander.
- Do not add a competing audit framework or unrelated dependencies/refactors.

## Original objective

Complete, correct and productionize the existing HVSC ROM-dependency research.
Deliver all of these within SIDFlow:

1. An improved parallel, checkpointed/resumable ROM audit using the target engine's
   exact sources and all eight KERNAL/BASIC/CHARGEN configurations.
2. A complete per-subtune machine-readable research catalogue, including unknown
   and coverage-limited results, while preserving existing Markdown research.
3. A compact deterministic production deny list derived exclusively from that
   catalogue, with versioned corpus/engine/ROM/method provenance.
4. A reusable tested offline eligibility lookup by content identity, one-based
   subtune, available-ROM mask and compatible engine identity.
5. Full documented-composition coverage or explicitly unresolved coverage; delayed
   dependencies must not escape because an introduction initially looks identical.
6. Regression, native/WASM parity, sanitizer, checkpoint, completeness,
   deterministic-publication and exhaustive projection-consistency tests.
7. C64 Commander integration documentation, without modifying that repository.
8. Full available-corpus execution after hardening, or precise remaining-work
   counts and preserved checkpoints if it genuinely cannot finish.

Strict policy: compatible allows; incompatible and unknown deny. Missing entries,
unsupported catalogue/engine identities and inadequate evidence must fail closed.
Do not equate header declarations, observed reads, execution dependency, changed
SID writes, PCM differences, incorrect music, bounded compatibility and unresolved
compatibility. A full-ROM render is an operational reference, not a historical or
artistic fidelity certificate. Silence is not automatically failure. A finite
successful render does not prove perpetual independence.

## Inputs and existing evidence

Available locally:

- HVSC 85: `workspace/hvsc/C64Music` (fetched through `bash scripts/sidflow-fetch`).
- ROMs: `workspace/roms`; authentic copies also exist in `/home/chris/dev/c64/roms`.
- Pinned target package:
  `packages/sidflow-classify/node_modules/libsidplayfp-wasm`, version **1.0.1**,
  containing libsidplayfp **3.0.2** and `dist/complete-source.tar.gz`.
- Native build: `workspace/rom-audit-native/render`.
- ASAN build: `workspace/rom-audit-native-asan/render`.
- Prior pilot/checkpoints: `workspace/rom-audit-v2`.
- An original pre-hardening native binary was preserved at
  `workspace/rom-audit-v2/renderer-original`.

Verified complete release corpus SHA-256:

`4b66fe03e72e18155ee4e14a0a7fd3f2c4de2ed1a467296156d5642e716f132e`

All raw MD5/path/song-count entries matched `Songlengths.md5` and the SID headers.
All release length tokens were positive parseable durations. Required horizons
ranged from 10 to 2,031.332 seconds, totaling approximately 10,176,145.245
subtune-seconds before multiplying by nine renders per subtune.

Historical research is under:

- `doc/research/hvsc-rom-requirements.md`
- `doc/research/hvsc-rom-validation.md`
- `doc/research/hvsc-rom-notable.md`
- `doc/research/hvsc-rom-catalogue/` (original detail pages and `results.json`)

The old completed audit had windows: 82,637 at 2s; 5,153 at 10s; 45 at 30s;
33 at 60s. Its adaptive runner did not extend identical/PCM-only introductions.
Great Giana Sisters #1 first diverged at about 2.083375s. `analysis.ts`'s historical
thresholds tolerate max(32, 2%) write-count suffix differences and 5,000 cycles of
relative drift; keep these diagnostic, never production evidence.

The old SIDLite overflow is real: large scheduler pulls overflowed the engine's
20ms buffer. **Retain the safe 256-event pull.** Do not reintroduce 16,000/20,000
pulls. The existing ASAN/Justincase regression infrastructure must remain.

## Actual pilot scope and publication lag

At the last check:

- `workspace/rom-audit-v2/execution.jsonl`: **1,653 distinct subtunes / 370 files**.
- That is 13,224 measured mask outcomes; 86,215 subtunes / 689,720 mask outcomes
  remain unmeasured in that pilot's audit checkpoint.
- A conservative known union of those audit rows, the real 300-file integration
  subset, recorded parity cases and the Justincase regression is **2,004 subtunes
  / 663 files**. Other test-fixture renders should be reviewed before filling the
  remaining pilot allowance. Both known counts are still below 5%.
- The maintained experimental publication at
  `doc/research/hvsc-rom-catalogue/v2/` is an OLDER snapshot: **763 measured** and
  87,105 pending. Do not report its counts as the latest checkpoint coverage.
- `workspace/rom-audit-v2/published/` may be newer than the maintained snapshot.
- Methodology 3 publication under `doc/research/hvsc-rom-catalogue/v3/` **does not
  exist yet**. The new exhaustive test currently expects it.

Experimental v2 publication contains every subtune as JSONL/gzip, with unmeasured
experiments null/unknown. Its strict lookup allowed only 2 subtunes with full ROMs;
all 87,868 were denied without ROMs. Those are eligibility counts, not proof that
all remaining tunes are incompatible. Existing v2 publication/lookup semantics
are being superseded and must not be shipped as production-ready.

## What has been implemented, subject to independent review

Retained the existing runner/build/hooks/publication infrastructure and legacy
research labels. New or modified code includes:

- `scripts/rom-audit/audit.ts`: dynamic native worker queue; full-length scheduling;
  checkpoints; progress/throughput; explicit pending inventory; pilot/full flags.
- `scripts/rom-audit/render.cpp`: all eight masks, repeat reference; sequential
  variants retain only reference plus one variant; exact timed divergence;
  read counters; trace truncation flag; opt-in parity evidence files; newly added
  immutable hex SID payload protocol.
- `scripts/rom-audit/apply-basic-read-hook.py`: expanded from BASIC to all three
  mapped CPU system-ROM banks. Includes instruction fetches; does not distinguish
  them from data reads or implement instruction-level CPU-state tracing.
- `scripts/rom-audit/analysis.ts`: additional measurement fields; old labels retained.
- `scripts/rom-audit/methodology.ts`: version 3 policy, explicit protocol,
  integer-millisecond horizons, exact-write checks, three states and matrix checks.
- `scripts/rom-audit/checkpoint.ts`: preserve/requeue torn final JSONL records;
  duplicate/interior damage fails. Adversarially review recovery semantics.
- `scripts/rom-audit/inputs.ts`: strict positional release-index join; publication
  verifies release documents/horizon tokens; `readVerifiedSid` checks immutable bytes.
- `scripts/rom-audit/rollout.ts`: 5% pilot queue, historical-scope scan, corpus lock,
  source-bound hardening certificate predicate. This is NOT finished hardening.
- `scripts/rom-audit/publish-production.ts`, dispatched from `publish.ts`:
  complete inventory, deterministic gzip JSONL, deterministic projection, checksums,
  provenance and exhaustive lookup consistency.
- `scripts/rom-audit/verify-native.ts`: direct sample-by-sample PCM and absolute
  timed-write comparison using temporary native evidence, replacing hash-only
  qualification. Certificates now bind measurement/reference identities. Latest
  unvalidated edits add immutable inputs and before/after engine-asset hashes.
- `scripts/rom-audit/fixtures.ts`: synthetic delayed KERNAL/BASIC/CHARGEN/combined
  dependency PSIDs. Current delay is 300 PAL frames (~6s), observed at 2s vs 8s.
- `scripts/rom-audit/native-regression.ts`: original PAL/NTSC/busy-loop/Justincase
  checks plus those delayed fixtures across masks.
- `packages/sidflow-common/src/rom-eligibility.ts`: new bounded offline lookup.
  Latest format is `sidflow-rom-deny-2`, method `rom-audit-3`, tuple
  `[compatibleByte, incompatibleByte, maxPlaybackMs]`. It rejects expired evidence
  and exposes `maxPlaybackSeconds`; older formats fail closed.
- `packages/sidflow-common/test/rom-eligibility.test.ts`
- `packages/sidflow-common/test/rom-audit-adversarial.test.ts`
- `packages/sidflow-common/test/rom-audit-fixtures.ts`
- `packages/sidflow-common/src/index.ts`: exports the lookup/types/method constant.

Documentation additions/edits include `doc/research/hvsc-rom-production.md`, notices
in the old reports/index, `doc/developer.md`, and `PLANS.md`. Much of the prose
still describes methodology 2 and must be reconciled with the final design.

ROM masks: **KERNAL=1, BASIC=2, CHARGEN=4**. Mask 7 is the full reference.
Missing KERNAL invokes the engine's synthetic interrupt shim. Null BASIC/CHARGEN
setters leave bank memory untouched; experiments explicitly zero missing BASIC and
CHARGEN. Fresh players prevent stale banks. This normalization must be part of the
consumer's engine contract, not assumed equivalent to arbitrary null-bank behavior.
The pinned VIC implementation does not fetch actual character graphics memory;
CHARGEN instrumentation currently describes mapped CPU access.

No causal bank-skipping optimization is enabled in the new matrix. The historical
zero-BASIC-read optimization proved only a bounded same-KERNAL-state equivalence.
Do not reintroduce shortcuts without explicit proof obligations and adversarial
regressions. Native trace storage caps at 2,000,000 events; truncation must prevent
qualification. PCM is still buffered, not streamed. Assess long-duration resource
bounds honestly; a 3,600s render pair can use hundreds of MB per worker.

## Critical unfinished work / known issues

Review these with Opus 5.5 before further rollout. This is not an exhaustive list;
find additional weaknesses independently.

1. **Current TypeScript does not pass.** The most recent strict check reports:

   ```text
   scripts/rom-audit/audit.ts(117,27): error TS18047: 'signal' is possibly 'null'.
   scripts/rom-audit/audit.ts(117,34): error TS2339: Property 'removeEventListener' does not exist on type 'Signals'.
     Property 'removeEventListener' does not exist on type '"SIGABRT"'.
   ```

   The child `exit` callback parameter `(code, signal)` shadows the outer
   `AbortSignal`. Rename it and review cancellation/error cleanup thoroughly.

2. **Native binaries are stale relative to the latest source.** The normal binary
   was built after adding exact parity dumps but BEFORE the immutable hex payload
   changes. ASAN is older still. Rebuild both through `build-native.sh` before
   treating new-protocol results as valid. Existing stamp checking does not yet
   enforce freshness at audit/verification startup. Consider enforcing it.

3. **`scripts/rom-audit/harden.ts` is missing.** It is already named in
   `HARDENING_SOURCES`, so full-rollout source identity computation cannot succeed
   until this is implemented. No completed hardening certificate exists. Design a
   reproducible validator that only emits a matching certificate after adversarial,
   exact-parity, sanitizer and three full-suite checks really pass. Detect source
   changes during qualification. Do not handwrite a fake passed certificate.

4. **The 5% gate needs review/improvement.** `pilotHistory` scans completed audit
   checkpoints and normalizes paths; it does not yet account for all integration/
   control renders, nor reserve in-flight identities durably before assignment.
   A crash can leave rendered-but-uncommitted identities uncounted. Consider a
   corpus-scoped append-only reservation ledger, atomically recorded/fsynced before
   sending jobs, with conservative torn-record recovery and historical import.
   Corpus locks are partly implemented; audit stale-lock, ownership, concurrent
   launch and crash behavior. Do not build a competing audit framework.

5. **Immutable input/provenance work is incomplete.** SID bytes are now read and
   checksum-verified by the parent, then sent as `hex:` payloads. Test the C++
   decoder, malformed/trailing protocol fields, path-vs-payload equivalence, and a
   payload whose label path was changed/deleted. Native workers still reopen ROMs
   from directories and execute the build-path binary: consider private per-run
   immutable ROM/binary snapshots from the exact buffers hashed into the manifest.
   Otherwise ROM changes or a rebuild between verification and worker launch can
   invalidate provenance. Avoid adding crypto dependencies unnecessarily.

6. **Exact parity is partly validated, latest edits are not.** A 104-control exact
   comparison passed after the initial dump implementation, but before subsequent
   immutable-input/asset-stamp edits and forthcoming rebuilds. Re-run. Native/WASM
   error parity needs careful review: an empty/failed WASM render may still have
   trace events needing drainage. Do not certify failure parity by merely observing
   two error strings or discarding incomplete evidence.

7. **Current exact-case qualification is very conservative.** Only certificates
   for the identical SHA/subtune/mask/duration and measured outcome qualify. This
   avoids overclaiming but may leave almost the entire catalogue unknown even after
   all native renders. Opus must review a defensible broader qualification model
   or direct WASM fallback. Do not loosen it just to improve allow counts.

8. **Finite-window production semantics need architectural approval.** The new
   lookup returns a deadline and rejects elapsed time at/after it. Decide whether
   this adequately satisfies complete-composition eligibility and how consumers
   must stop/restart. Do not authorize indefinite loops from finite evidence.
   Document that ROM-mask changes concern fresh executions, not arbitrary ROM
   replacement mid-execution. C64 Commander remains unmodified.

9. **Expand delayed testing beyond a short synthetic example.** Proposed, not yet
   implemented: parameterize the frame counter to trigger around 70s and observe
   75s, with analogous KERNAL/BASIC/CHARGEN cases. Exercise long introductions,
   silence, sparse SFX, combined-only effects, non-default subtunes, multi-SID,
   incorrect header assumptions, unknown lengths and loop uncertainty. Current
   6s/8s fixtures do detect the old 2s selection bug, but are not the whole review.

10. **No methodology 3 maintained dataset exists.** Create the new complete
    inventory/publication after the schema settles, even while most rows are
    pending. `rom-eligibility.test.ts` now expects `.../catalogue/v3/manifest.json`
    and will fail until generated. Do not point it back at an obsolete artifact
    merely to make tests green. Review v2 preservation/supersession and reconcile
    docs, schema/version identities, manifest fields and public exports.

11. **Review metadata/protocol validation independently.** New tests cover forged
    horizons, changed release documents, stale outcomes, hash-only certificates,
    shifted masks/aliases, contradictory equality, malformed divergences, mutation
    after lookup creation, obsolete formats and invalid input checksums. Add
    genuinely independent controls and counterexamples, not implementation mirrors.

12. **Clean up test-generated worktree noise carefully.** Tracked
    `station-analysis/*` files were regenerated by real integration tests; they
    were clean initially and should normally be restored after final testing.
    `test-workspace-phase/` is also untracked test residue (8 entries at handover).
    Inspect before removing. Do not discard actual implementation or user work.

## Validation evidence — distinguish epochs

Do not cite earlier successful runs as validation of the latest hardening source.

- Empty-workspace baseline `bun run test` passed; its existing real-HVSC integration
  test was skipped because the corpus was absent.
- Downloading HVSC activated that integration test and exposed missing spectral
  contrast for Super Mario #31/#35. The extractor discarded every band if one
  Essentia coefficient was singular. A small fix retains valid measured bands,
  plus a regression. Actual #31 then produced finite contrast. No health assertion
  was weakened and no integration test was skipped. Opus should review this
  necessary pre-existing-failure fix; it is the only extra production-code area.
- Three full pre-final-hardening runs passed 2,899 tests, 0 fail, 0 skip:

  ```text
  Full suite run 1: exit 0; 2899 pass; 0 fail; 0 skip; 491.203s
  Full suite run 2: exit 0; 2899 pass; 0 fail; 0 skip; 488.928s
  Full suite run 3: exit 0; 2899 pass; 0 fail; 0 skip; 497.219s
  ```

  Evidence: `/tmp/sidflow-v2-suite-attestation.txt`,
  `/tmp/sidflow-v2-verified-test-{1,2,3}.log`.
- Integer-millisecond arithmetic fixed **576** floating-point duration/protocol
  round-trip mismatches. All original 763 measured durations stayed identical.
  A subsequent validation sequence began; its first completed run passed:

  ```text
  Full suite run 1: exit 0; 2899 pass; 0 fail; 0 skip; 539.249s
  ```

  See `/tmp/sidflow-v2-final-attestation.txt` and
  `/tmp/sidflow-v2-final-fixed-*.log`. The sequence was stopped for the user's
  new adversarial-hardening requirement; inspect the logs rather than assuming
  all three completed.
- Original expanded hash/count parity: 104 controls passed, including all eight
  masks, six historical cases, four delayed fixtures, Giana at 60s and two
  documented-horizon cases (23s and 24.3s).
- Initial direct exact parity: 104 controls passed;
  `/tmp/sidflow-v3-exact-parity.log`,
  `workspace/rom-audit-v3-parity.json`. These predate the latest protocol edits.
- Earlier ASAN regressions passed PAL, NTSC, busy-loop, actual Justincase and four
  delayed dependency masks: `/tmp/sidflow-asan-regression-v2.log`.
- Latest small adversarial run: **14 pass, 0 fail, 52 expect calls** in
  `/tmp/sidflow-v3-adversarial.log`. This does not replace current strict checking,
  sanitizer/parity requalification or three complete final-source suite runs.

Performance evidence:

- First two corpus passes: 55 rows / 205.526s and 708 rows / 181.051s; differing
  duration distributions, so do not call the rate difference an optimization win.
- Two concurrent native passes added 442 and 448 rows; about 3.64 and 3.70 new
  subtunes/s during rendering. End-to-end times approximately 134s each.
- `workspace/rom-audit-v2/utilization-validation.json` records per-core busy time
  from `/proc/stat`: approximately 77–90% across all eight logical CPUs during
  concurrent native work and the real-HVSC test. Native workers individually
  used roughly 96–99% of one logical CPU.
- A 23s BASIC matrix benchmark used 4.25s wall / 4.08s user and 6,480 KiB peak RSS.
  This is not a long-render memory bound.
- Approximately 72 hours was an extrapolation for full native rendering at the
  measured six-worker rate, not a completed measurement or an environmental
  blocker. Prior short scheduling budgets were chosen, not forced by the host.

## Recommended takeover sequence

1. Read instructions, inspect all diffs and current processes; preserve inputs,
   checkpoints and old validated research. Do not launch a >5% run.
2. Route the architecture/adversarial review to **Opus 5.5**. Have it inspect actual
   source and challenge these notes. Record decisions/findings in `PLANS.md` and a
   maintained adversarial-review document. Sonnet implements concrete fixes.
3. Fix compilation and complete immutable inputs/provenance, structural validation,
   bounded consumer contract, durable rollout accounting and the hardening runner.
   Challenge whether current design choices meet the original goal.
4. Freeze the analysis design for a small curated corpus. Include genuine PSID,
   RSID/BASIC, multi-SID (2/3), non-default songs, quiet/sparse cases, Giana,
   Justincase and delayed synthetic cases beyond 60s. Use full required horizons
   for real pilot compositions where feasible; never claim a prefix is complete.
5. Build native and ASAN versions from the exact target package. Exercise all
   eight masks and repeat controls. Run direct exact parity on the small corpus;
   investigate mismatches or retain unknown, never rationalize them away.
6. Produce the current complete-inventory research dataset and deterministic
   bounded deny list. Test every published decision, every mask, provenance
   mismatch, unknown/missing/expired eligibility and checkpoint resume.
7. Run current focused/adversarial/sanitizer/parity checks and three consecutive
   clean full repository suites. Use cores effectively during appropriate phases.
   Revert unrelated generated test reports after validation, not real fixes.
8. Have Opus approve the evidence and proof obligations, then generate a real,
   source/engine-bound hardening certificate. Only then expand past 5%.
9. Execute/resume the complete HVSC corpus with the existing parallel architecture.
   Add sensible progress, throughput and resource monitoring; avoid redundant
   renders. Reuse measurements only when their coverage and provenance remain
   valid. Keep unknowns explicit and record exact outstanding work.
10. Update docs and plans; provide the final required report with coverage,
    dependency/eligibility counts per mask, no-ROM denied count, dataset paths,
    provenance, actual test output, runtime/core measurements and limitations.
    Do not fabricate completion. Do not modify C64 Commander.

## Useful commands (review current state before executing)

```sh
cd /home/chris/dev/c64/sidflow

git status --short
bunx tsc --noEmit --strict --module ESNext --moduleResolution bundler \
  --target ES2022 --types bun-types --skipLibCheck \
  --allowImportingTsExtensions scripts/rom-audit/*.ts

bash scripts/rom-audit/build-native.sh
ROM_AUDIT_SANITIZE=1 bash scripts/rom-audit/build-native.sh

bun test packages/sidflow-common/test/rom-audit-adversarial.test.ts
bun test packages/sidflow-common/test/rom-audit.test.ts \
  packages/sidflow-common/test/rom-eligibility.test.ts

bun scripts/rom-audit/native-regression.ts \
  workspace/rom-audit-native-asan/render workspace/roms workspace/hvsc/C64Music

# Exact parity interface; recheck after completing hardening.
bun scripts/rom-audit/verify-native.ts workspace/hvsc/C64Music workspace/roms \
  workspace/rom-audit-v3/parity.json [extra-cases.json]

# PILOT ONLY; choose a reviewed small selection and fresh compatible output.
# Current source must compile, native binaries must be rebuilt, and provenance
# checks must pass before this is meaningful.
bun scripts/rom-audit/audit.ts --hvsc workspace/hvsc/C64Music \
  --roms workspace/roms --out workspace/rom-audit-v3 \
  --workers 6 --seconds 10 --rollout pilot --selection reviewed-pilot.json

bun scripts/rom-audit/publish.ts --production workspace/rom-audit-v3 \
  doc/research/hvsc-rom-catalogue/v3

bun run build
bun run test  # three consecutive complete clean runs required for final source
```

Do not execute a `--rollout full` command until the hardening workflow and its
certificate are implemented, adversarially reviewed and actually passed.

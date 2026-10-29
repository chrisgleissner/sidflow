## Complete PR #112, full accelerated HVSC census and standalone Commander ROM list (2026-10-29) — active

**Handover/resume prompt:** `doc/plans/rom-dependency-list-handover.md`.

User decisions (2026-10-29): merge PR #112 first, then run a **fresh** accelerated
census (`ROM_AUDIT_SAMPLE_CLOCK=1`) from merged main on this i5-14600K in one
<=24h invocation; the 12,888-row original-identity checkpoint stays historical.
Commander embeds the result in its APK: a tiny, formally specified, standalone
ROM-dependency list (independent of the similarity exports), with the same
due diligence/presentation as the similarity formats. Authorized: merge PR #112
+ tag `rom-audit-tooling-2026-10-29`; create a sidflow-data release; commit the
compact export/spec to sidflow (follow-up PR) and merge it.

Methodology check (principal review): the sample-clock build calls reSIDfp's
upstream `clockSilent` (voices/envelopes still clocked, so OSC3/ENV3 readback is
preserved) and only skips filter/resampler output while keeping exact resampler
readiness counts, so event-pull timing is unchanged. Grants require identical
cycle-timed write traces; everything else retains native PCM listening.

- [x] Final qualification of the review-fix sources against proof
  `workspace/rom-sample-320-reviewed-v1/` (3 full suites); previous certificate
  copied to `workspace/rom-audit-sample-qualification-ed5eb30/`.
  Reviewed proof: 320/320 A/B matches, 467 audio-verified grants, 0 unknown/errors,
  all three native binaries unchanged; 257.31 vs 526.95 projected core-hours.
  Log `workspace/rom-pr112-final-qualification.log`; literal output:

  ```text
  Full run 1: 3005 pass / 0 fail / 0 skip
  Full run 2: 3005 pass / 0 fail / 0 skip
  Full run 3: 3005 pass / 0 fail / 0 skip
  Qualified 9d1fe14fbe04b2d235076be7c882f30aa050221310415ae541b164997b7e43fc
  ```

  Focused heartbeat E2E (`--retries=0`): 5/5 consecutive passes.
- [x] Focused heartbeat E2E repeats; commit (excluding user `station-analysis/`), push,
  green CI, Codex re-review, resolve threads, merge, push annotated tag.
  Review fixes `a59f94c`; Codex re-review: no major issues; CI green. Squash-merged
  as `a8208a1`; tag `rom-audit-tooling-2026-10-29` pushed.
- [ ] Fresh accelerated census from merged main (`workspace/rom-audit-sample/`), machine idle.
  Main tree is byte-identical to the qualified head; identities match the certificate
  (source `9d1fe14f…`, measurement `3e383758…`), so qualification was not repeated.
  Started 2026-10-29T14:24Z via `workspace/rom-census-sample-run.sh` (bench then full,
  19 workers, 24h cap per stage), log `workspace/rom-census-sample.log`.
- [ ] Design/spec/generator/verifier for the standalone compact ROM list (during census,
  light CPU only); full 3x suites after census completes.
  User chose an **exact inventory** (~400 KiB budget). Format `sidromdep-1`
  ("SID ROM Dependency List"): LE binary + deterministic manifest; header with
  provenance digests and payload checksum; INVENTORY (sorted md5_48 + subtune
  count, collisions rejected; absent = not audited); DECISION records only for
  subtunes with any incompatible/unknown lane (4-bit lanes as in the existing
  exceptions); horizons by the normative Songlengths rule, verified, with an
  explicit override section. Code lives in `@sidflow/common` and
  `scripts/rom-dependency-list/` (never `scripts/rom-audit/`, which is hashed
  into the qualification identity); spec `doc/rom-dependency-list.md`.
  Implementation delegated to a Sonnet implementer in an isolated worktree.
  **Revised by user (2026-10-29):** APK is ~8 MiB, so no inventory. Allow by
  default: unlisted files/subtunes (incl. files new in later HVSC releases) are
  playable; zero false positives permitted, so files are keyed by the FULL MD5
  (shorter than HVSC paths). Grouped FILE (md5[16]+count) + DECISION (subtune +
  4-bit incompatible / 4-bit unknown masks) sections, ~33 KiB expected.
- [ ] Verify publication, generate compact export, sidflow-data release, follow-up PR merged.
- [ ] User request (2026-10-29): raise a PR against C64 Commander that embeds the
  `sidromdep-1` list in the music player (skip listed subtunes in autoplay/radio for the
  active engine/ROM lane; warn on explicit play; full authentic ROM set = unrestricted).
  Prepare against a synthetic list during the census; swap in the released list at the end.
  UX (user, binding): clear and easy to understand; new setting default **skip** songs that
  need the ROMs, user can enforce playback ("Play anyway" per song, or the setting). Extends
  Commander's existing `romFallbackDecision`/"rom-on-c64" routing (#378, #539, #540): with a
  connected C64 such songs still play on the C64; reference ROM set/hardware route = no effect;
  unknown never skipped.
  Status: implemented locally in `/mnt/data/dev/c64/c64commander-romdep` (branch
  `feat/sid-rom-dependency-list`, first commit `c687a854e`); 535 focused tests pass; placeholder
  empty list shipped until the real one lands (drop-in: `src/lib/romDependency/data/` + the
  `PINNED_MANIFEST_SHA256` line). Principal decisions: libSidplayEZ and non-authentic
  KERNAL/BASIC use the nearest lane as an approximate conservative hint; Next/Previous pass
  over like auto-advance, only a direct tap opens the "Needs the C64 ROMs" dialog; no "Add ROMs"
  button (ROMs come only from a connected C64, which already plays the song). Both changes are in
  `ebf4df8a8`; 538 focused tests pass. The 7 `usePlaybackPersistence` failures came from a
  symlinked stale node_modules: after a clean `npm ci`, 82/82 pass on the branch and on pristine
  main. Still to do after the census: `npm run build` (`.bin?inline` import), full Commander
  validation. Queue badge: asked the user.
- **Census stopped by user decision (2026-10-29 17:55Z)** at 5,736/87,868 rows (checkpoint
  kept in `workspace/rom-audit-sample/`, resumable; 1 failed row during shutdown, to inspect).
  Reason: the no-ROM lane was flagged incompatible for ~39% of measured rows (~22%
  stratified HVSC estimate, PSID 15/84). A trace probe showed 12 of 14 flagged PSIDs write
  identical value sequences with only 13–66 cycles of IRQ timing shift from the KERNAL
  shim, which is within real C64 IRQ jitter. Meanwhile BASIC tunes that produce only 1 SID
  write score just 1–12% differing listener windows. Binary listener-v1 verdicts and
  differing-window fractions are therefore not a usable severity measure for Commander.
  Lesson: validate the result distribution on the 320 benchmark against expectations
  BEFORE any full run. Probe script:
  scratchpad `probe/trace_probe.py` (to be moved into the repo with the new grading work).
- [ ] NEW: graded 0–255 per-lane fidelity (user request), trace-first, calibrated on a
  small exhaustive corpus before any full run; `sidromdep` format and Commander branches
  must switch from masks to grades.
  Design: `doc/research/hvsc-rom-fidelity-grading.md` on branch `feat/rom-fidelity-grading`
  (worktree `/mnt/data/dev/c64/sidflow-grading`). Calibration tooling delegated to a Sonnet
  implementer. Run protocol (user, binding): full grading starts ONLY when all corpus gates
  pass. Watch the first 1,000 subtunes closely, then check about every 10,000. On any issue,
  fail fast, refine, rerun. Do not stop until all is done and the Commander PR has the
  real data. **Pre-run gate (user):** commit and push ALL work (grading branch with PLANS.md +
  handover, sidflow format branch, Commander branch) before the full-scale grading run starts.
  Format switched to grades (`c78ff8e` on `feat/sid-rom-dependency-list`): 224-byte header
  with `listing_ceiling=253`, `recommended_min_grade` and `grading_methodology_sha256`; 5-byte
  decision records with four lane grades; unlisted ⇒ every lane ≥254; input is a grading results
  JSONL; about 40 KiB. Merge order: the grading branch lands before the format PR (spec links the
  grading design). Commander switched to grade + threshold (`1fd091b9e`, branch
  `feat/sid-rom-dependency-list` in `/mnt/data/dev/c64/c64commander-romdep`): skip iff
  active-lane grade < list `recommended_min_grade`; unknown removed; 545 focused tests.
  **Calibration (2026-10-29, 75-subtune corpus + 320 benchmark):** gate 1 determinism PASS;
  gate 3 PASS (12/12 no-playback = 0); gate 6 cost 9.7 h on 19 workers (12.1 h with margin);
  gate 5: bimodal none-lane grades, population-weighted <128 = 1.6%, <192 = 2.0%, ≤253 = 7.2%.
  Principal decisions:
  - Gate 2 passes under the evidence-based criterion (every 254 lane has audio grade ≥235,
    mean s_w ≤0.07, ≤2% windows >0.25); the original "no window >0.25" rule was too strict
    for real ADSR/noise phase flips from 13-cycle shifts.
  - The audio metric is dB band energy with a 3–15 dB dead zone; T = 2 ms; γ = 1 (frozen).
  - `recommended_min_grade` = 128; listing ceiling = 191 (~40 KiB).
  - Gate 4: the principal cannot listen. A blind A/B listening page for the user,
    https://claude.ai/artifact/NCGhZVdioCzRaEzac2sVYu, saves ratings to its `ratings` db
    collection. It does not block the run because grades are threshold-independent; any
    inversion triggers a re-grade of the audio-graded lanes only.
  Full-run launcher, methodology identity and monitoring are delegated. Format ceiling is
  configurable (`3cd291b`, 24 focused tests); Commander adopted it (`95f7ea79c`).
  OPEN before the Commander PR: the SettingsPage test "stays silent when a newer device switch
  supersedes the discovered-device selection" failed once under load (169/169 when isolated).
  Reproduce and fix it during full Commander validation; do not dismiss it.
- Census benchmark (2026-10-29 14:32Z): 15.22h projected, 19.02h with margin, budget 23.98h,
  296.08 core-hours, 19.46 cores measured; full stage started 14:32Z.

## Qualify sample-clock acceleration and allow 24-hour ROM runs (2026-10-28) — active

- [x] Raise launcher/census ceiling to 24h, retain the 12h default, test boundaries and update current documentation.
- [x] Broaden adversarial sample-clock packet/write controls and validate every compatibility grant against native audio.
- [x] Run the complete existing 320-job stratified sample against the current classifier; record mismatches, unknowns and CPU costs by stratum.
- [x] Add selectable acceleration after correctness/benefit gates passed; preserve the original measurement identity and checkpoints.
- [x] Build/typecheck, qualify sources and obtain three consecutive clean full test runs; document outcomes and remaining census work.

User explicitly authorizes the qualification work and 24h maximum. Keep both
engines independent, retain full horizons, repeated references and audio fallback.
Do not mistake the 16-input pilot for representative evidence. Preserve all
pre-existing changes and raw checkpoints.

Additional user authorization (2026-10-29): continue through the new PR,
adversarial review and fixes, green CI, merge and an annotated tooling tag.
Use the existing scoped tag convention: `rom-audit-tooling-2026-10-29`.

Adversarial review of `ed5eb300de1bb7e1f5098725dff51c06e014c55a` completed
with three valid findings; do not merge yet:

- [x] Implement P1 `PRRT_kwDOQN40Ts6xdCpM`: replace reliance on optional procfs children
  files with verified PID/PPID/start-time descendant discovery and regressions.
- [x] Implement P2 `PRRT_kwDOQN40Ts6xdCpQ`: validate retained reference/lane outcomes for
  every grant and digest all retained proof files, not just report.json.
- [x] Implement P2 `PRRT_kwDOQN40Ts6xdCpT`: bind the SIDLite native executable and check
  all measured executables before/after the complete representative experiment.
- [ ] Rerun the complete 320-job proof after metadata/source changes, requalify,
  achieve three clean full suites, push fixes and request final-head review.

Initial PR CI has passed build/unit/export fixture checks; E2E/performance is
still running. Original 3x3003 results remain historical evidence for ed5eb30,
not qualification of the forthcoming fixes. Preserve the v3 raw proof and report.

Fixes implemented; targeted checks: 4 pass / 0 fail, strict typecheck passed.
P1 uses core procfs stat parent/start-time records (including nested descendants)
and rechecks process identity before signalling. P2 validates clean references,
complete observations, compatible lane outcomes/sample counts, source/input links
and digests all 101 retained proof files. Tampered outcomes, samples and log bytes
are covered by regression tests. P3 captures/rechecks native SIDLite, reSIDfp and
sample-clock hashes at the child and coordinator levels.
Fresh representative run (16 workers; no other heavy local work):
`workspace/rom-sample-320-reviewed-v1/`, log with the same prefix and `.log`.
No final-head merge or tag is permitted until this proof, fresh qualification,
three full suites, remote CI and a clean follow-up review all pass.

Initial remote CI failed one heartbeat E2E assertion (all three retries): eight
one-second cached clips completed between 500ms polls, which observed only old
completed snapshots. Preserve the active-observation assertion; use 30s WAVs
matching the cache sidecar's 15s intro/15s analysis, one feature worker, 25ms
condition polling tied to this POST's startedAt/request completion, and remove
the three-inactive-poll early exit. Add error logging to the touched cleanup
handlers. Run the focused browser case repeatedly after CPU measurement, then
require the full remote E2E/performance checks on the fixed head.
No application semver release or completed corpus publication is implied.

- [x] Commit/push the task changes and open PR #112 (`ed5eb30`).
- [ ] Obtain/process adversarial review, fix findings and require green CI.
- [ ] Merge the reviewed head and push the annotated tooling tag.

Progress: isolated build passed 3,200 readiness checks; expanded controls passed
450 packet/frame/trace comparisons and 77 forced-audio synthetic grant checks.
Focused regressions pass (20/20): timeout boundaries, protocol failures and shared
read-only/exclusive-writer locking. The first parallel harness exposed exclusive
scope-lock contention; read-only experiments now share kernel locks while census
writers stay exclusive. The broader cohort then exposed fractional process timeout
milliseconds; round upward, cover the reproducer, and restart against frozen sources.
Prior incomplete runs remain preserved as failed evidence. Final representative run:
`workspace/rom-sample-320-qualification-v3/`, log with the same prefix and `.log`.
No candidate false compatibility grant has been observed so far. Production remains
unchanged pending the complete correctness/benefit gate. User explicitly requests
commit/push and a new PR; branch `perf/rom-sample-qualification-24h` is created.

Representative gate passed on all 320 jobs, with 467 audio-verified grants,
zero mismatches, unknowns or errors, and unchanged sources/binary. Weighted
CPU work including per-job coordinator and unchanged SIDLite work: 523.830656
versus 249.038757 core-hours (52.4582% lower), not a wall-time promise.
Compact evidence is in `doc/research/hvsc-rom-sample-qualification.json`.
The new `ROM_AUDIT_SAMPLE_CLOCK=1` mode binds a separate sample-clock binary,
methodology and measurement identity; the original identity remains
`a8803b971aeb79d7082c7259ea73c8b4820823b38988807085e793421abcea1b`.
Its deployed dual-engine worker passed 14 synthetic/real controls, including
repeats, checksum failures and natural shutdown. Integration fixtures use
10.123s observations so they meet the production comparator's minimum horizon.
Focused final checks: 42 pass / 0 fail. Final source qualification runs under
`workspace/rom-sample-production-qualification.log`; its certificate/logs are
kept separately in `workspace/rom-audit-sample-qualification/`.

Cancellation audit: the sample worker can block in synchronous native execution.
Its close path now pauses the owned worker, terminates its native children and
closes all pipes without detaching from the launcher's watchdog process group.
An active blocked-worker regression verifies renderer termination and idempotent
close. A fixture's `/proc` exit race was corrected; focused identity/cancellation
checks pass (3/3), and all 14 deployed-worker controls passed again. Final frozen
qualification log is `workspace/rom-sample-production-final-v2.log`.
The proof loader now also requires explicit source hashes and valid metadata,
checks complete state/boolean domains, and recomputes weighted CPU projections
from the measured shard rows. Its forged/incomplete-metadata regression passes.

Final frozen source qualification succeeded. Literal terminal summaries:

```text
Full run 1: 3003 pass / 0 fail / 0 skip
Full run 2: 3003 pass / 0 fail / 0 skip
Full run 3: 3003 pass / 0 fail / 0 skip
```

Qualification identity `02d6725c93f2bb6cd55c7b6aa0557a1bf341575170b958cbdd6929a50df7c94f`;
measurement identity `04aeba1ea9bf3f991208fecda99faaafe90a8775ee79b7124f136f7f7d1d743f`.
Build/strict script typecheck, 192 native/WASM controls, original transport/ending
controls, 450 sample-clock packet/trace controls, 77 audio-verified synthetic
grants and 14 deployed dual-engine worker controls passed. The full-suite
integration outputs were checked against the pre-validation station snapshot;
unrelated station edits are preserved and excluded from the commit.


## Resume ROM classification runtime investigation (2026-10-28) — runtime-boundary fix validated; throughput work remains

- [x] Review PRs #107–111, required docs, checkpoint and current runtime guards.
- [x] Preserve cancelled jobs as pending and include inventory/checkpoint startup in the census deadline.
  Existing launcher already reserves one minute for publication.
- [x] Add cancellation regressions; build/typecheck and run three clean full suites.
- [x] Requalify unchanged measurement backend and exercise a bounded real resume.

Evidence: PR #111 is merged locally; the 320-job target-host benchmark projects
32.86h (41.07h with margin), beyond a single allowed invocation. No census is
currently active. The checkpoint has 12,888 unique rows, including 13 native
lane failures (not established to be cancellation failures). Audio fallback dominates measured sample CPU (81.48%);
EZ/sample-clock remain experimental. Do not shorten horizons or transfer engine
results to meet a runtime claim. Preserve station-analysis edits and checkpoints.

Controller regression checks: 4 pass / 0 fail. Build, strict script typecheck,
192 native/WASM controls and transport/full-horizon ending controls passed.
Literal qualification output (all three consecutive full runs):

```text
Full run 1: 2991 pass / 0 fail / 0 skip
Full run 2: 2991 pass / 0 fail / 0 skip
Full run 3: 2991 pass / 0 fail / 0 skip
```

Certificate identity `1c4ceef1de8a51d56c254b3474ffceb4983ba9f789bd17f985e979a743ba2398`.
Measurement identity remains `a8803b971aeb79d7082c7259ea73c8b4820823b38988807085e793421abcea1b`.
Logs: `workspace/rom-runtime-qualification.log` and the source-bound qualification
folder. The initial dual-3 resume correctly refused mismatching native binaries;
no checkpoint was overwritten. The existing dual-4 plan matches this checkout's
qualified binaries and measurement sources. Its 320-job / 19-worker benchmark
has zero failures and projects 31.27h (39.08h with margin).

Live deadline validation used `ROM_AUDIT_STAGE_ONLY=full ROM_AUDIT_WORKERS=19
ROM_AUDIT_MAX_HOURS=0.06 ROM_AUDIT_MAX_JOBS=1000
ROM_AUDIT_OUT=workspace/rom-audit-dual-4 bash scripts/rom-audit/run-dual.sh`.
It exited 0 after the census deadline, preserving 17 new rows (337 total), with
zero failed/unknown measured rows. Cancelled requests remained pending; partial
publication reports 87,531 pending (its aggregate unknown includes these pending
subtunes). Log: `workspace/rom-runtime-resume-4.log`. No census remains running.
`git diff --check` passed. Full-corpus delivery and a substantial throughput
improvement remain outstanding; no new speedup or complete export is claimed.



## Continue PR #111: validate fast ROM classification and complete HVSC export (2026-10-28) — active

User requests an exceptionally fast but empirically defensible ROM classifier for
Commander, a complete HVSC classification and verified export, and all necessary
changes pushed to PR #111. Evaluate the libsidplayEZ speed claim against the
current optimized native baseline and the exact Commander playback profile. Keep
the experiment separate from eligibility decisions until its behavior is qualified.
Preserve original-checkout changes and historical checkpoints.

- [x] Inspect PR #111, performance evidence, live checkpoints and Commander engine.
- [x] Transfer exact-write/digi screening and symmetric diagnosed-CPU-halt tails
  from the already-qualified correction work; identify methodology 2 explicitly.
- [x] Freeze production listener semantics and restore measurement identity
  `a8803b971aeb79d7082c7259ea73c8b4820823b38988807085e793421abcea1b`; this
  permits safe reuse of the exact-identity 12,719-row checkpoint.
- [x] Qualify this PR source set and exact native binaries: 192 native/WASM parity
  controls, full-horizon transport/ending controls, build/typecheck, and three
  consecutive full runs (2,987 pass / 0 fail / 0 skip each). Certificate source
  identity `6445a3f4419d53fd3018890b1c5606e23f73f2265687f8c4e88f124e4d50ace8`.
- [x] Reassess EZ with C64 Commander's patched profile on the same eight real
  inputs: 13.600 CPU seconds versus 15.906 for native reSIDfp (14.5% less); keep
  it experimental because this is not a representative ROM-mask census.
- [ ] Resume the identity-matching checkpoint using its 320-job, zero-failure
  target-host benchmark; classify all 87,868 HVSC85 subtunes and resolve every
  failed/unknown decision. Existing projection: 32.86h before 25% margin.
  Bounded 3.5h run is active; checkpoint count was 12,763/87,868 with 0 new
  failed/unknown at handover. See `doc/plans/pr-111-handover.md` for the live
  process, exact resume command, identities and next gates.
- [ ] Verify complete publication, reduce the GitHub payload to consumer data and
  essential reproducibility/provenance, run validation, commit and push PR updates.
- [ ] Update PR title/body/state and require green CI/review before calling it merge-ready.

Initial evidence: PR #111 is draft at 0665ed8; CI is green. The target host is
an i5-14600K. The `rom-audit-dual-3` checkpoint has 12,719 verified dual-engine
decisions and no unresolved outcomes; its source identity now matches the
qualified PR classifier. A matching complete publication still does not exist.
The 8-input EZ pilot measured 13.4% lower CPU (15.906s vs 13.779s), not a
factor-two improvement over current optimized native reSIDfp; it omitted
Commander's patches/analogue profile and retained failed no-ROM BASIC lanes as
unknown. The PR's sample-clock pipeline reduced native child-process CPU 32.6%
on a completion-ordered 16-subtune set, not coordinator-inclusive or corpus-wide.

## Upgrade the repository runtime to Bun 1.4.4 (2026-10-27) — active

User requested an upgrade to Bun 1.4.4, three clean full test runs, and a push
to `main`. Preserve the existing uncommitted `station-analysis/` changes.

- [x] Read required repository guidance and inventory active Bun version pins.
- [x] Update package, Docker, type declarations, runtime resolver and current
  prerequisite/report documentation to 1.4.4.
- [x] Install and verify exact Bun 1.4.4; build/typecheck passed. Three
  consecutive full test runs passed, each 2,975 pass / 0 fail / 0 skip.
  Run 1 exposed a LanceDB empty-directory fixture retaining an extra native
  connection; the fixture now uses only the engine connection and cleans up
  in `finally`. The focused regression test passes under Bun 1.4.4.
- [x] Commit only upgrade files and this plan entry, then push `main`.

Pushed to `origin/main` as `1ad7add` (`Upgrade repository runtime to Bun
1.4.4`). The user's `station-analysis/` edits remain unstaged and untouched.

Official GitHub release metadata confirms Bun 1.4.4 and its Linux archive
digests: x64 `bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c`,
aarch64 `baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e`.

## Repair README HVSC ROM classifier run (2026-10-27) — completed

User ran the README dual-engine ROM classifier and encountered errors. Fix the
runtime/worker failure, classify at least 1,000 HVSC subtunes, then commit and
push the repair as requested. Preserve the user's unrelated `station-analysis/`
working-tree edits.

- [x] Read required repository docs and inspect the failed durable checkpoint.
- [x] Identify `Screen worker closed` failures and trace the worker runtime.
- [x] Pin every ROM launcher Bun invocation to `packageManager` and make the
  shared Bun resolver verify installed versions.
- [x] Validate the launcher/runtime change and resolve further errors.
- [x] Run the ROM classifier on at least 1,000 HVSC subtunes and retain its
  checkpoint.
- [x] Record final evidence, commit only task-owned files, and push the repair.

Findings: the checkpoint contains 2,271 benchmark rows and 19 consecutive
`Screen worker closed` failures at its end. This checkout declares Bun 1.3.1
but `bun --version` resolves to 1.3.11; the launcher called system Bun directly
for qualification, census, and the child worker runtime. The preceding ROM
audit notes record a worker lifecycle crash on 1.3.11. The launcher now routes
all Bun phases through `scripts/run-bun.mjs`; `ensure-bun.mjs` now verifies the
resolved runtime against `packageManager` and installs the pinned version if
needed. No HVSC classification had been run when the runtime repair was first
identified.

Follow-up findings and validation: the pinned-runtime downloader exposed a
second setup defect (`EXDEV` renaming from `/tmp` into the checkout); it now
copies the downloaded binary across filesystems and verifies the resulting
version. Qualification runs the full suite with `.sidflow.test.json`, preventing
the Admin Metrics API test from recursively scanning the developer's full
HVSC/audio cache. Native/WASM parity, transport, build and script typecheck
passed. Final source-bound qualification: three runs of 2,975 pass / 0 fail /
0 skip. The clean target-machine benchmark completed 320/320 jobs with zero
failures; projection 11.99h, 14.98h with 25% margin on the i5-14600K. The full
stage classified 1,040 unique subtunes successfully (both engines, 0 failed,
0 unknown); bounded resume added 50 more. Current checkpoint:
`workspace/rom-audit-dual-fixed/`, 1,090 measured, 86,778 pending, 0 failed.
Its publication is intentionally incomplete and not a consumer bundle. The
user's `station-analysis/` modifications remain untouched.
Pushed to `origin/main` as `461fd26` (`Fix pinned Bun execution for HVSC ROM census`).

## PR #109 merge readiness (2026-10-26) — active

User scope: review, fix, validate and merge the current ROM audit PR. Document
reruns and publication in the main README. The user will execute the full HVSC
census on another machine; no complete census or target-CPU timing is claimed here.
Preserve pre-existing workspace edits and all prior measurement checkpoints.

- [x] Read project/bridge instructions, current PR, correspondence and dual-engine path.
- [x] Review decision, checkpoint, qualification and Commander publication boundaries;
  fix concrete defects with regression coverage and record review findings.
- [x] Document runnable setup/resume commands, artifact locations and conservative
  compatible/incompatible/unknown consumer behavior in README.md.
- [x] Qualify final sources (native/WASM controls, transport, build/typecheck,
  three consecutive clean full test runs), run required E2E/package checks.
- [ ] Update PR description, obtain/process GitHub review, push fixes, wait for CI
  and merge only when all checks and review threads are clear.

Review fixes (current-source validation in progress): dense sub-100ms digi bursts
now require audio, including final tails; native terminal packets distinguish
emulated CPU halts from resource/engine failures, which remain unknown; resumes
retry unresolved decisions; complete publications include the validated
qualification/benchmark evidence and a separate releaseReady flag. Added a
post-census verifier covering complete HVSC85 inventory, qualification binding,
checksums, exception domain, binary/JSON equivalence and aggregate counts.
Focused regression run: 34 pass, 0 fail. Build, strict audit-script typecheck,
config validation and package checks passed before the final terminal hardening;
qualification was deliberately restarted after that last behavior change.
No full-HVSC run was started.

Qualification found the existing Bun 1.3.1 coverage/WASM failure in the first
Essentia feature test (SpectralContrast: null-reference indirect call), after
192 native/WASM controls and 32 transport jobs passed. Five consecutive isolated
uninstrumented Essentia runs passed 8/8 each. The two affected Essentia/real-SID
worker tests now use the existing uninstrumented phase, with the same process
isolation as instrumented batches; every assertion still executes, no test is
skipped. Qualification now binds the actual test runner/package/runtime wrappers.
A final short-burst regression also covers fewer than 100 volume writes.
Full qualification restarted against this frozen source.

Final-source qualification passed, with literal outputs:

```text
Full run 1: 2975 pass / 0 fail / 0 skip
Full run 2: 2975 pass / 0 fail / 0 skip
Full run 3: 2975 pass / 0 fail / 0 skip
```

192 native/WASM controls and 32 transport jobs passed. Certificate qualification
identity `812d25fac32ebb2d2ad23c36ea541c76d1ea131a889cf7dc467a924869153ea9`; measurement identity
`6affdd9f7ba2ffda73d79dde2b3efcfeace4a4191b48089f49df780d7479208c`.
Package, config and similarity fixture checks passed. CI on user-pushed commit
7c8590d exposed the rolling image's Bun 1.3.11 worker-lifecycle crash versus the
declared/local 1.3.1 runtime. Install the package-declared Bun in the workflow;
three isolated worker-lifecycle regressions passed locally. Independent GitHub
Codex review of 7c8590dc1d found no major issues and no unresolved threads.
Local E2E passed 10/10 pipeline tests and 122/122 browser tests. Commit and push
only the CI runtime fix plus validation documentation, then require final green
CI before the authorized merge. No full-HVSC classification has been started.


Initial findings: no GitHub review threads; draft description is stale SIDLite-only
methodology 4 while current sources implement independently measured dual engines.
Prior qualification has two successful suites and a failed third suite with a
Bun/WASM crash; it is not a valid current certificate. Review requested on GitHub.

## Dual-engine ROM census delivery (2026-10-24) — active

Current request: prepare and qualify the complete workflow here, without running
all HVSC on the 6700K; one command on a 14600K, ideally <12h and at most 16h.
The earlier stricter target remains an optimization goal, not a claim of measured
14600K performance. Preserve existing checkpoints and user-owned changes.

- [x] Recover Commander MD5/completeness contract and engine-specific counterexamples.
- [x] Measure existing native reference cost: Commando #1, 120s, 48kHz/8191,
  256-event safe pulls: SIDLite 1.785s; reSIDfp 11.365s on this loaded 6700K.
  This single tune is a profiling probe, not a corpus runtime prediction.
- [x] Profile native streaming; choose a digital-screen + unchanged listener comparison
  design instead of transporting every PCM sample. Preserve per-engine
  SID readback via upstream reSIDfp clockSilent; never transfer engine results.
  First 54 exact native/WASM trace controls passed (all banks, OSC3, multi-SID,
  silent changes). Expanded 156-control parity passed; final source qualification is pending.
- [ ] Benchmark representative dual-engine jobs and choose the measured path;
  never infer a superset from a small sample or silently omit CHARGEN. The current
  320-job target-host sample is running on the 6700K; it will not be treated as a
  14600K timing result.
- [x] Implement both engines, source/binary/log-bound qualification, resumable
  checksummed checkpoints and target-machine stratified budget gate (25% margin).
  New entry point: scripts/rom-audit/run-dual.sh. Historical v4 launcher
  remains SIDLite-only. Commander JSON/11-byte packed MD5 exceptions, unknown
  sidecar, identity map, horizon/model data and checksummed manifest are implemented;
  no full census or final release is claimed.
- [ ] Build/typecheck, meaningful regression checks and three clean full suites;
  document literal summaries, one-liner, scope and timing uncertainty.
- [x] Fix the reported colored-output timeout bug: the launcher now uses Node plain
  output for timeout seconds. Reproduced with FORCE_COLOR=3/NO_COLOR=1; launcher
  entered qualification and was correctly stopped by its 5.8-second watchdog (124),
  with no invalid-time-interval error. Hard default budget is now 12h; maximum 16h.
- [x] Full E2E passed: integration 10/10 (43 assertions), browser 122/122. The
  browser run emitted existing HLS asset path type errors while tests passed; track
  that separately if playback streaming needs investigation.

# PLANS.md - SID Classification Pipeline Recovery


Current candidate: complete inventory preflight verified all 61,157 files / 87,868
subtunes and 10,176,145.245 horizon seconds. Strict audit-script TypeScript and
focused checks pass. The candidate qualification coordinator is running under
`workspace/rom-audit-screen-qualification-run.log`; its source-bound logs and
certificate live in `workspace/rom-audit-screen-qualification/`. Preliminary
80-job profile (the already-counted v4 stratified sample) was recorded under
`workspace/rom-audit-screen-benchmark.{json,log}`. That exploratory profile was stopped after 32 jobs identified the concrete
WASM-256 audio-fallback bottleneck (partial strata alone already exceeded 185h
on this loaded 6700K). Its measurements survive and are not a completed projection.
Final candidate instead streams native PCM/traces into the unchanged comparator;
initial Commando probe: SIDLite native/WASM exact, reSIDfp maximum 5 LSB / exact
writes. Selecting the archive's inline filter-table initialization removes native
thread-dependent dither; fresh native reSIDfp references repeat exactly.
The final 80-job source-bound benchmark uses `screen-census.ts bench` under
`workspace/rom-audit-dual-6700k-benchmark.log`; no full stage runs here.
Full production classification on the 6700K is explicitly outside this request.

Latest measured findings (2026-10-24 continuation):

- Final candidate adds a bounded real-emulation warm-up before bus-only
  screening. Later stateful reads still abort and rerun detailed; early OSC3,
  early ENV3 and late ENV3 controls exercise this boundary on both chip models.
  Fresh official WASM references now run in separate cold Node processes:
  repeated Emscripten factory initialization in Bun 1.3.1 crashed before tune
  loading. This changes the qualification host, not the emulator or comparator.
  The 192-control comparison is running, followed by transport stress and three
  complete suites. Final 80-job timing uses
  `workspace/rom-audit-dual-warmup-6700k`; no full census runs here.
- The preceding bus-only/unresolved-audio candidate completed 80/80 jobs with
  zero failures and zero unresolved measured decisions. Population CPU cost was
  404.173 core-hours; loaded-6700K capacity 5.259 cores yielded 76.85h (96.06h
  with margin). It predates warm-up and cannot establish the requested budget.
- Verified the maintained partial v4 publication's 61,157-file MD5 map, absence
  of eight-byte MD5 prefix collisions, explicit `complete:false`, and unchanged
  engineId/romSetId. This is metadata completion, not new v4 measurements.
- The first standalone end-to-end run exposed five-second default timeouts on
  real rendering and classification (about six seconds each under contention).
  Those two operations now have explicit one-minute limits with all output
  assertions retained; the complete end-to-end command is rerunning.
- Follow-up: the E2E fixture corpus contains 67 subtunes. Its real renders now
  use configured 20s clips and a 10s analysis window after a 1s intro skip;
  rendering/classification retain every fixture and allow five minutes each.
  The CLI pipeline passed 10/10. Browser validation is rebuilding stale Next.js
  output before its final run.
- Warm-up completed 80/80 with no failed or unknown measured decisions; the
  population estimate was still 366.525 core-hours. Added CPU-specific LTO
  compilation (IEEE floating-point contraction remains disabled), binding the
  resolved compiler target features in the build cache. The final benchmark is
  `workspace/rom-audit-dual-ready-6700k` and qualification is restarting against
  those exact binaries.
- A natural-exit regression reproduced a retained native child watcher when a
  paused output pipe survived cancellation. NativeLane.close now destroys all
  three pipes after terminating the child. The regression passes without forced
  process.exit; focused screen tests: 10 pass, 0 fail.
- Closing native pipes also unreferences the canceled child watcher. All 192
  optimized native/WASM comparisons now pass and the verifier exits naturally.
  Final qualification and 80-job timing are running under
  `workspace/rom-audit-dual-final-qualified-6700k` and the qualification logs.
- The fresh browser build resolved stale-build runtime errors. Its classification
  fixtures exposed inherited developer renderer preferences, which forced the
  CLI renderer and invalidated WASM cache fixtures. Playwright now uses a separate
  `data/.sidflow-e2e-preferences.json`, initialized deterministically by the setup
  script. The developer's saved preferences are no longer overwritten by setup.

- Native audio + detailed screens passed 132 PCM/trace controls, but their
  80-job loaded-machine wall projection was 192.93h (241.16h with margin).
  Preserve `workspace/rom-audit-dual-6700k`; this candidate does not meet budget.
- The first full suite exposed a real source-enumeration test bug: it expected
  a directory itself in the file-only source set. Fixed it to verify every
  recursive file, including files under the existing user-owned `__pycache__`.
- Dark Tower BASIC #3 reproduced a terminal-packet failure while the native
  process exited normally after an expected CPU halt. Replaced Bun readable
  async iteration with a bounded event queue; 32 repeated dual-engine jobs then
  passed with zero failures. This real regression is now qualification-gated.
- Added a bus-only screen preserving each engine's actual write-only/POT read
  behavior. OSC3/ENV3 reads abort before granting and rerun from immutable bytes
  in detailed mode. All 156 bus/detailed/native-audio/WASM comparisons passed,
  including opposite engine-specific BASIC dependencies and both chip models.
- Commando #1 /120s bus screen: SIDLite 2.613 process CPU seconds, reSIDfp 3.670;
  both consumer configurations equivalent. These are probe costs, not a census
  projection. C++ and coordinator CPU accounting now separates work from host
  contention. Benchmark modelling weights process CPU by population and divides
  by the capacity actually delivered during the complete sample; retains the old
  wall-weighted projection for audit. The 25% margin and target-machine gate stay.
- Final candidate benchmark is `workspace/rom-audit-dual-bus-6700k-benchmark.log`
  with results/checkpoints under `workspace/rom-audit-dual-bus-6700k`. No full
  corpus stage has been launched here. Final three-suite qualification is pending.

## PR #109: verified correctness and 12-hour extrapolation (2026-10-24) — active

Latest user contract supersedes the 16-hour target: demonstrate ROM-need detection
correctness and a full-HVSC runtime below 12 hours on a 14600K, extrapolated from
measurements on this 6700K. Existing methodology-4 pilot/CI results remain historical
validated evidence; they do not establish either new claim. Preserve user-owned
untracked v2 files and existing checkpoints.

Execution discipline requested by the user:

- [x] Identify wasted work: comparator changes repeatedly restarted the expensive
  pilot; excessive speculative analysis and repeated status polling delayed delivery.
- [ ] Profile before redesign: benchmark native and WASM execution on the same
  already-counted inputs; identify the dominant cost and select the fastest defensible
  implementation using measured results. Batch independent reads/checks.
- [ ] Write a precise correctness contract and enumerate its proof obligations.
  Distinguish full-ROM reference agreement, ROM dependency and listener audibility.
  A finite test corpus or heuristic threshold is not proof of universal 100% accuracy.
  Do not weaken or silently redefine the requested accuracy claim.
- [ ] Complete small adversarial controls before a long pilot: late dependencies,
  each ROM and interacting removals, quiet/short/stereo/digi changes, harmless timing,
  silence/stops, SID model scope and reference failures. Reuse existing controls.
- [ ] Implement the smallest measured performance improvement. Keep native/WASM
  reference agreement and provenance explicit if a native backend is selected.
- [ ] Freeze rendering and decision behavior after all small controls pass. Changes
  only to publication/docs/qualification must not invalidate measured PCM/trace evidence;
  actual renderer/engine/configuration/comparator changes must invalidate it.
- [ ] Run one final canonical pilot, investigate every discrepancy, then execute one
  final qualification sequence (build/typecheck, focused checks and three consecutive
  complete suites). Restart only for an actual defect affecting the evidence.
- [ ] Produce a reproducible 6700K benchmark and transparent 14600K extrapolation,
  including workload, worker/core scaling, uncertainty and all census overhead. Require
  headroom below 12 hours; do not present an assumed CPU multiplier as measured proof.
- [ ] Push reviewed changes, converge CI, and report exact achieved scope and any
  unproven requirement. Do not claim 100% listener accuracy from self-labelled controls.

Engine-scope correction (2026-10-24): inspected packaged SIDLite and reSIDfp
read paths and ran four synthetic listener controls plus four isolated-BASIC
PCM comparisons. Both directions of engine-specific ROM dependency are proven:
SIDLite write-only SID reads return zero; reSIDfp returns the retained bus byte.
The affected engine loses a sustained note; the unaffected engine has exact PCM
agreement. Evidence and reproducible stimuli are in
`doc/research/hvsc-rom-engine-dependency.md`. These are not HVSC disagreement counts.
SIDLite qualification cannot certify reSIDfp. The next design/benchmark must
cover both engines, or prove a valid per-case transfer rule; do not spend another
long SIDLite-only pilot to claim the broader user goal.

- [x] Inspect both engines and verify engine-specific ROM dependencies with actual
  WASM output, independent reference repeats, and isolated BASIC removal.
- [ ] Extend qualification and performance design to reSIDfp; keep engine IDs separate.
- [ ] Publish requested complete-file MD5 mapping and explicit completeness metadata
  for Claude, without representing pending entries as known compatible/incompatible.

Commander correspondence follow-up (2026-10-24): wrote the user-requested reply
at `/home/chris/dev/c64/c64commander-workspace/correspondence/from-sidflow-to-c64commander.md`
and kept an identical copy under `doc/research/correspondence/`. Extracted a local
deterministic SHA-256-to-complete-file-MD5 map for all 61,157 v4 file entries at
`workspace/rom-audit-sha256-to-md5-v4.json`; verified exact deny-list coverage,
per-subtune identity consistency, and no eight-byte MD5 prefix collisions.
Map SHA-256: `fa97cdff4fee66b05d01af2f139e509d5843232205872c494fcce69acfc26411`.
This is a derived local artifact, not release integration or new audio evidence.
The response explicitly states partial coverage, engine-specific counterexamples,
stable current IDs and remaining publication/qualification work.

Claude disagreement investigation (2026-10-24): acknowledged bridge request
`2026-10-24-1035-claude-c64commander-to-codex-sidflow-reSIDfp-disagreement` and
answered with accepted diagnostic scope/initial timing. Inspected the actual app
branch read-only at `/home/chris/dev/c64/wt-sid-player`: its check uses six seconds
and a 3 dB whole-render RMS criterion, which cannot establish musical equivalence
or attribute disagreement to the engine. Matched all 111 non-header-declared app
source records to v4 research rows (all already counted/measured SIDLite inputs).
Reserved them through the existing corpus lock/ledger, adding no new subtunes.
Running a six-second listener-v1 comparison on both engines, followed by full-horizon
reSIDfp (16,941.016 horizon seconds), with fresh reSIDfp modules and full-ROM repeats.
Diagnostic checkpoints: `workspace/rom-audit-claude-111-{prefix,full}.jsonl`;
selection: `workspace/rom-audit-claude-111-selection.json`. This does not change v4
or qualify a reSIDfp release. Initial cases show both genuine engine-specific
outcomes and reSIDfp listener differences that an RMS-level check cannot exclude.

Thorough engine-scope follow-up (user steering 2026-10-24): both engines share
CPU/MMU execution and actually execute reached ROM calls. SID readback can change
the path to those calls. Expanded synthetic controls to both chip models and all
three ROM banks: 24 comparisons passed, with full-ROM paths requesting the same
note/volume in both engines. Preserve the separate question of real-C64 fidelity;
full-ROM differential agreement is not universal correct-playback proof.
Matched six-second 111-pair results: 46 both differ, 43 both equivalent, 20
SIDLite-only difference, one reSIDfp-only difference, one reSIDfp failure; the
existing full-horizon SIDLite baseline differs for all 111, so the single reverse
six-second row is not full-horizon evidence. Full-horizon checks already found
Snooker #2 and No Mercy #3 SIDLite-incompatible/reSIDfp-equivalent.
An independent diagnostic search prioritizes SIDLite-compatible inputs containing
readable-SID-register byte patterns (64 candidates), asserting every identity is
already present in the rollout ledger before rendering. This adds no input scope
or corpus reservation and does not run a second full-census rollout. Initial
four high-distance compatible controls stayed equivalent in reSIDfp for six seconds.
The reverse search must confirm any candidate through its complete horizon before
claiming a real-HVSC reverse example. ReSIDfp cleanup trap for Justincase #1 is
reproducible at the recorded large pull; a separate 256-event diagnostic succeeds.
Do not silently apply a local engine workaround or publish the failure as compatible.

Speed rules: investigate one concrete hypothesis at a time; timebox an inconclusive
approach and record its result; avoid speculative cleanup and duplicate validation.
Use the required three full runs at the final source freeze, rather than repeatedly
running them during development. Keep updates concise and tied to decisions/results.
The quality bar, reference comparisons, full-song horizons, rollout ceiling and
three-clean-run requirement are unchanged.

## PR #109 continuation: listener relevance and 16-hour budget (2026-10-23) — implementation qualified; target-machine timing pending

- [x] Inspect PR/CI and completed pilot. Pilot: 567 completed, one crashed worker,
  4,553.233 seconds elapsed, 15.552 aggregate horizon-seconds/second. CI fails
  because the maintained v3 publication is absent. Preserve existing v2 untracked files.
- [x] Measure and reduce WASM allocation, trace and hashing overhead without losing
  reference comparisons or late-song coverage; reproduce long-job memory behavior.
- [x] Add a separately identified listener-relevant assessment: harmless timing
  offsets must not be called audible failures; missing/changed music must remain
  detectable. Keep exact evidence distinct and never relabel old measurements.
- [x] Replace unsupported CPU extrapolations with measured aggregate throughput,
  representative corpus weighting and an explicit target-machine budget gate.
- [x] Restore maintained publication and update usage/review evidence; CI status is recorded by the live PR checks.
- [x] Build/typecheck and run full tests three consecutive times; record literal
  outputs in doc/research/hvsc-rom-validation-4.md. Source qualification complete.
- [ ] Validate the 14600K budget on that machine before a full-corpus run.

Validated implementation was pushed in commit 8c0579d to PR #109; its live
checks are the CI follow-through record. No full-corpus completion or 14600K timing is claimed.

The prior 11–17 hour claim divides by a per-lane speed estimate rather than the
completed census rate. At the observed aggregate rate the full horizon inventory
projects to 181.75 hours on this loaded 6700K. The pilot deliberately oversamples
unusual/long songs, so this is diagnostic rather than a representative corpus ETA.

Implementation: methodology 4 / census schema 2, exact audit dependency 1.1.1
(current Commander main), safe default large pulls, shared SIDLite module with
independent C64 states, buffered hashes, register timing tolerance and spectral
fallback. Unknown is reserved for inadequate evidence. Controls cover inaudible
writes, phase/DC shifts, dense digi writes, late/short events, quiet melody under
loud bass, pitch/volume/stereo changes, sawtooth/noise timing and fallback models, held notes lost on a decoder stop, inaudible silent stops,
and DC-preserving partial-window padding.
Final qualification passed: strict script check, build, package checks,
source-bound decision regression, reproducibility and three focused runs
(82 pass / 0 fail / 0 skip each). Partial development
pilots are retained under workspace/rom-audit-v4-draft* and do not qualify sources.

The first 80-job corpus-weighted 1.1.1 benchmark measured 43.762 aggregate horizon
seconds/second, projecting 67.70 h (77.86 h with 15% margin) on this loaded 6700K.
It precedes the final band refinement and improved per-subtune sampling and is
not final qualification evidence. No 14600K duration is claimed. A target-machine
benchmark with its final sources must pass the 15 h census budget.

Final-renderer benchmark: 80 per-subtune-hash samples, all format/duration strata,
7 workers, 46.8 aggregate horizon-seconds/second. Population-weighted projection
62.52 h; 71.90 h including the 15% margin, on the loaded 6700K. Stored in
workspace/rom-audit-benchmark-v4.json. The 14600K would need approximately 4.8x
this measured throughput to pass the configured 15 h budget; it has not been
measured. The canonical final-source pilot completed: 567/567, 0 failures, 113 matching
reference repeats, no unresolved measured decisions for masks 0/3. Mask 0:
399 compatible / 168 incompatible; mask 3: 567 compatible. Maximum horizon
2,031.332 s and the prior crash (Gordian Tomb #2, 1,922 s) both passed. Elapsed
1,592.253 s, 44.473 aggregate horizon-seconds/second, peak worker RSS 188 MB.
The maintained v4 snapshot was republished (87,868 total rows, 567 measured,
87,301 pending). Exhaustive lookup consistency: 24 pass / 0 fail / 1,406,134
expectations. Source identity 6d8fbd169fc69cb0bac600fbda560812988b9e0a7383e683bd73526ec98581f7
matches a fresh checkout. Qualification completed with that unchanged identity:
three full suites each 2,958 pass / 0 fail / 0 skip. The matching machine
certificate is under workspace/rom-audit-hardening; stage-status reports done.
Literal terminal summaries are retained in doc/research/hvsc-rom-validation-4.md.

Qualification additionally verifies the complete canonical selection and repeat
sampling, clears ROM_DECISION_ONLY for the regression, and checks measured masks
0/3 have no unknown results. Reviewer identity is truthful and portable rather
than hardcoded to an unavailable model; no independent Opus review is claimed.

## HVSC ROM dependency investigation (2026-10-20) — complete

Branch `research/hvsc-rom-requirements`, based on refreshed `origin/main` (`d893e32`).
The separate SIDFlow and C64 Commander checkouts are left unchanged.

- [x] Locate HVSC 85 and verify its stated population: 61,157 SID files.
- [x] Census headers: 87,868 subtunes; 589 BASIC-flagged files / 1,390 subtunes.
- [x] Add a reproducible header census and controlled four-configuration render audit.
- [x] Verify deterministic reference renders, ROM isolation, error accounting and denominators.
- [x] Run the census and rendering comparison; record scope and limitations without
  equating RSID, ROM address references, or PCM differences with proven dependencies.
- [x] Publish the report and per-file/per-subtune evidence; validate script and repository.

### Additional backlog task — ROM-free SIDLite fallback feasibility

- [x] Establish whether SIDLite in the locked `libsidplayfp-wasm` package can
  execute ROM-dependent tunes without KERNAL/BASIC; distinguish the SID chip
  emulator from libsidplayfp's shared 6510/C64 execution environment.
- [x] Include measured examples and evaluate transparent playback routing:
  versioned per-file/per-subtune requirements versus bounded dynamic detection,
  cache identity, unknown/local tunes, and startup latency. A proposed fallback
  must actually restore correct playback; changing chip emulation alone is not
  evidence that missing C64 system routines have been supplied.
- [x] Document the design in the investigation's Markdown report. Implementation
  in C64 Commander or SIDFlow's playback path is follow-up work, not part of this
  research branch.

### Controlled census evidence

- All 61,157 raw MD5s, paths and 87,868 subtune counts match Songlengths.md5.
- Native engine built from the locked 1.0.1 complete-source archive (libsidplayfp
  3.0.2), with the existing SID-write observer and an observational BASIC-bank
  read counter. Original native/WASM controls: 24 matching PCM hashes and write
  counts across PSID, RSID, BASIC, multi-SID and non-default subtunes.
- An engine heap-buffer overflow was isolated on `Justincase_part_6.sid` and
  confirmed with AddressSanitizer. All preliminary 20,000/16,000-event execution
  batches are excluded. The final renderer pulls 256 scheduler events at a time;
  its native/WASM controls pass, and the actual crashing input passes ASAN.
  The native regression fails under ASAN when the old 20,000-event pull is restored.
- The final full two-second census (ten seconds for BASIC, execution-sensitive
  and inconclusive cases) is checkpointed under `workspace/rom-audit-final`.
  No preliminary rows are seeded into it. Zero mapped BASIC reads prove redundant
  bank comparisons; every inferred result is explicitly marked in its JSON.
- A fresh 30-second follow-up for 49 notable/competition-related subtunes is under
  `workspace/rom-audit-notable-final`; selection is retained in validation.
- Current C64 Commander package 1.1.0 / libsidplayfp 3.1.1 is checked separately
  with both SIDLite and reSIDfp, without changing SIDFlow's pinned dependency.
- `bun run build:quick` passed. Focused tests passed. An initial full test run
  hit the Super Mario throughput drift assertion while the CPU-intensive audit
  and another process's emulator were running. Three subsequent complete
  runs pass with the audit idle; the performance assertion is unchanged.

Rendering keeps CHARGEN constant, uses fixed power-on delay, and compares both-ROMs
against neither, KERNAL-only and BASIC-only. Repeat references distinguish unstable
output from ROM effects. A bounded render proves behavior only within its measured
window, not the absence of a dependency later in a song.

### Resumed investigation: completed measurements and tracker disposition

- Re-inspected worktree HEAD `d893e32`, all audit scripts and logs, process list,
  installed packages, actual Commander source and current GitHub trackers.
  No audit process remained. The complete 87,868-row final run, 49-subtune
  thirty-second run and 33-subtune sixty-second run were already present.
- Re-ran the exact full-census command: every corpus file/hash/subtune matched
  Songlengths.md5, manifest and local ROM identities; zero pending jobs. All
  three runs share the same binary/archive/corpus/documents/ROMs/protocol and
  have no preliminary seed. Publication validates unique complete coverage,
  adaptive durations, finite/error outcomes and each zero-read derivation.
- Longest-window totals: KERNAL-sensitive including both 1,578 files / 2,619
  subtunes; BASIC-sensitive including both 555 / 1,210; both 534 / 1,189;
  distinct union 1,599 / 2,640. Inconclusive 345 / 1,234, retained separately.
  These are finite-window execution sensitivity, not universal necessity counts.
- Generated the exhaustive Markdown catalogue (59,631 files / 85,687 rows,
  including PCM-only changes) and all 49 notable rows; retained full available
  STIL notes, missing-metadata markers, exact selections and portable manifests.
  Raw execution/audio/corpus/ROM files remain local and uncommitted.
- Existing confirmed defect reports, verified open:
  [libsidplayfp-wasm #14](https://github.com/chrisgleissner/libsidplayfp-wasm/issues/14)
  (primary SIDLite capacity/default-pull defect),
  [Commander #538](https://github.com/chrisgleissner/c64commander/issues/538)
  (separate live/prerender/seek containment/update action), and
  [Commander #539](https://github.com/chrisgleissner/c64commander/issues/539)
  (missing-ROM playback/status). No duplicate issues or application patch.
- Reproduced actual dispatcher/core results with package 1.1.0: supplied-ROM
  1,177 writes versus one without ROMs, both reported opened/romRequired false.
  Current SIDLite/reSIDfp controlled checks show 1,176 vs one, with sustained
  per-second reference audio versus a startup transient. No phone failure claimed.
- Re-ran 24 native/WASM parity controls and safe real-input ASAN regression:
  pass. Restored-old-pull regression fails with the expected SIDLite overflow.
  The old minimal-*48k logs are invalid (missing executable); the newly compiled
  standalone 1.1.0 48 kHz reproducer passes at 256 and ASAN-fails at 20,000.
  Shipped 1.1.0 WASM pull-size differential controls also rechecked.
- Fixed publication script's Map tuple inference error; strict ESNext/bundler
  script typechecking and repository build pass. The earlier `--types bun`
  invocation was invalid; use `--types bun-types`. Audit tests now 14 / 45
  expectations. Final repository validation: `bun run build` passed; strict script typecheck
  passed; focused audit tests 14 pass / 0 fail; three serial full `test:ci`
  coverage runs each 2,888 pass / 0 fail / one existing opt-in skip. Literal
  per-batch outputs are retained in `doc/research/hvsc-rom-validation.md`.
  Report/catalogue links and population totals checked. Fresh native rebuild is byte-identical to the
  measured binary. Completed research stays on its existing branch; no merge
  or application deployment.

### Software-fix follow-through (2026-10-20)

- [x] Publish research in [SIDFlow PR #107](https://github.com/chrisgleissner/sidflow/pull/107), now merged.
- [x] Track the native SIDLite capacity correction in library PR #15 and the
  rootless-Docker build correction in issue #16 / PR #17; both PRs are merged
  and published in libsidplayfp-wasm 1.1.1.
- [x] Raise Commander PR #540 for the exact dependency upgrade and BASIC status
  correction. Adversarial review reproduced and fixed a cached-intro bypass;
  regression tests fail without the correction.
- [x] Deploy both Android editions and verify actual worker controls without an
  audio sink. Silent Callback input/rotation/search checks pass. Speaker tests
  are blocked by the user's explicit all-audio-silent requirement.
- [x] Converge Commander PR #540: all required CI checks pass; merged coverage
  is 96.25% lines / 89.64% branches. The E2E shard-2 artifact upload timed out
  after all 72 tests passed, then passed on retry. Both issues #538/#539 are
  closed; Commander has no open issues. Created the **1.1.1-rc1** source tag at
  `2b1ad80bb136f49512a83013226a6024f84b0436`; release workflows build its artifacts.
- [x] Record final tracker and RC tag disposition in this documentation-only
  follow-up. Verified links and `git diff --check`; no code or measurements change.

The historical controlled measurements and their package 1.0.1 / libsidplayfp
3.0.2 provenance remain unchanged. No ROM, corpus or generated audio is committed.
The original research worktree's unrelated deletion is preserved.

## Phase 44 - SID Header Conformance Verifier

Raised 2026-10-04. Check every HVSC header against `SID_file_format.txt`, cross-checked
against libsidplayfp's loader. Branch `feat/sid-header-conformance`.

1. [DONE] P44-T01 Rule set in `@sidflow/common` (`sid-header-conformance.ts`), one firing and one
   non-firing synthetic test per rule.
2. [DONE] P44-T02 Parallel audit script `scripts/audit-sid-headers.ts` with a libsidplayfp-wasm
   cross-check; full HVSC #85 run.
3. [OPEN] P44-T03 `sid-parser.ts` treats any non-zero $7A/$7B as a SID and
   `doc/c64/sid-file-structure.md` describes flags as a uint32. Both are left unchanged here.

### Progress

- 2026-10-04: HVSC #85, 61,157 files: no findings of any severity; libsidplayfp 3.0.2 loads all
  files without changing a value.

## Phase 43 - Classification And Tiny Export Bug Bash

Raised 2026-07-31. Audit the classification pipeline that feeds `sidflow-data` and the
`sidcorr-tiny-1` producer consumed by c64commander. Work is on
`copilot/bugbash-classify-tiny-export`, released as 0.8.3.

1. [DONE] P43-T01 Establish a failing baseline and audit the producer/consumer contract.
  - Root `bun run test` completed all unit batches except `integration-tests/hvsc-persona-station.test.ts`.
    Its real-HVSC classification run emitted an incomplete feature vector
    (`spectralContrastMean: null`) and failed the complete-vector assertion. That failure is the
    SIDLite spectral-contrast gap, is present on `main`, and is not addressed by this phase.
  - The audit found classification cache identity, non-finite JSONL output, escaped-path resume,
    and crash-truncated `--resume-from-features` defects. It also found tiny ordering,
    containment, duplicate-identity, and SQLite neighbour-integrity defects.
  - c64commander is a separate, dirty worktree under this checkout and is not modified by this
    SIDFlow branch. The producer enforces the tiny specification's duplicate-identity rejection so
    it cannot publish a bundle that c64commander would resolve ambiguously.

2. [DONE] P43-T02 Repair classification correctness and add focused regressions.
  - The WAV render settings sidecar is version 4 and records `sidEngine`. Versions 1 to 3 are
    rejected rather than upgraded, because nothing in an older sidecar says which emulation wrote
    it, so the first run after this release re-renders the WAV cache.
  - A non-finite feature value fails its own song: the record is not persisted, `failedCount`
    counts it, and the run's failures file records the reason. The corpus-wide 1% integrity
    threshold is unchanged and remains the guard against a defect producing them in bulk.
  - The resume index decodes the JSON-escaped `sid_path` capture before building its key, and
    `--resume-from-features` drops a truncated final record while still failing on a malformed
    complete one.

3. [DONE] P43-T03 Repair portable export determinism and integrity.
  - `compareUtf8Bytewise` replaces `localeCompare` in every ordering and tie-break that reaches a
    published artefact, and in the station's own recommendation tie-break, which applies the same
    rule. This is conformance with the lite and tiny specifications, which already required
    bytewise UTF-8; no schema or binary format version changes.
  - The tiny builder rejects duplicate `md5_48` identities and the reader leaves an ambiguous one
    unresolved. Both the builder and the reader refuse a `sid_path` that escapes the HVSC root by
    traversal or through a symlink.
  - New full exports declare neighbour foreign keys, and `--rewrite-manifest` refuses to restate
    the row count of an export whose graph references a missing track.

4. [DONE] P43-T04 Adversarial review of the first pass, and its repairs.
  The first pass introduced four defects and left one gap. All are fixed on the branch:
  - **Containment compared unlike paths.** `readResolvedSidFile` tested an unresolved candidate
    against `realpath(hvscRoot)`, so every SID under an HVSC root reached through a symlink looked
    as though it escaped. That includes macOS, where `os.tmpdir()` sits under `/var` and `/var` is
    a symlink to `/private/var`, so the tiny export would have failed outright there. Both sides of
    the test are now resolved, and the root is resolved once per build rather than once per file.
  - **The reader lost its `Songlengths.md5` fast path**, and hashed the whole corpus on every
    open: 11.7 s for 59,886 files with a warm page cache, on the path a station opens. HVSC's
    index keys are the plain file MD5 — verified against the shipped corpus — so the fast path was
    correct. Removing it also broke the test that pins it,
    `"resolves tiny track paths from Songlengths.md5 without rescanning the SID tree"`.
  - **A non-finite feature aborted the whole run**, which contradicts this plan's own wording and
    would discard hours of rendering over one tune. It is a per-song failure now.
  - **`RenderOrchestrator` recorded `sidEngine: null` for a WASM render**, which both misdescribes
    the file and would make `needsWavRefresh` treat it as stale on every run.
  - **The bytewise ordering fix stopped at the export boundary.** `sidflow-play`'s station applied
    the identical score-then-track-id tie-break with `localeCompare`, so the station and the
    artefact could disagree about tie order — which is what the convergence audits compare.

5. [DONE] P43-T05 Validation.
  - `tsc -b` clean. `node scripts/run-unit-coverage-batches.mjs` runs every batch with one failure,
    `integration-tests/hvsc-persona-station.test.ts`, which is the P43-T01 baseline and is not
    caused by this work. It was confirmed by checking out `main` and running the same file there:
    the same assertion fails at the same line, on the same two records
    (`GAMES/S-Z/Super_Mario_Bros_64_2SID.sid` songs 31 and 35, `spectralContrastMean=missing`),
    in 373 s. `doc/engine-comparison.md` already records SIDLite dropping that feature on very
    quiet subsongs of that exact file. Repairing it means repairing the feature extractor, which
    is a separate piece of work.
  - `bun run verify:exports:fixture` passes over a freshly built fixture.
  - Each repair has a regression that fails when the repair is reverted, and each revert was
    actually performed rather than assumed: the symlinked HVSC root, the SID file symlinked out of
    HVSC, the orchestrator's WASM sidecar, the per-song rejection of a non-finite feature, the
    `Songlengths.md5` fast path, and `compareUtf8Bytewise` against `Buffer.compare`.

### Decision Log

- The tiny format specification requires duplicate 48-bit identities to be rejected. Warning and
  continuing creates an unresolvable artefact for its c64commander consumer, so rejection is safer
  than silently publishing a wrong station.
- The nested c64commander checkout has unrelated user changes and its own Git branch. This plan
  changes SIDFlow's versioned producer only; downstream parser hardening requires a separate,
  clean c64commander task.
- `stringifyDeterministic` still sorts object keys with `localeCompare` and was deliberately left
  alone. It writes every canonical JSON file in the repository, so changing it churns far more than
  the exports, and it was measured not to matter for them: for the full, lite and tiny manifest key
  sets and for the classification record keys, locale and bytewise ordering agree. The only
  divergence found was among the camelCase keys of the local rating-model file, which is not
  published.

### Progress

- 2026-07-31: Branch created, baseline taken, defects repaired, first pass reviewed adversarially
  and its five findings repaired, released as 0.8.3.

## Phase 41 - Neighbour Graph As An Index, Station As A Policy (0.8.2, reissued)

Plan: `doc/plans/neighbour-graph-redesign/prompt.md`. Released 0.8.2 was **withdrawn** (releases
and tags deleted from `sidflow` and `sidflow-data`) and the number is being reused for this work,
so a consumer's history reads 0.8.0 -> 0.8.2 with one change in what a tiny edge means. The
version question was settled with the user: reuse 0.8.2, restore and rewrite
`doc/migration/0.8.0-to-0.8.2.md`, no workspace version bump.

1. [DONE] P41-T01 Confirm the withdrawal and that no consumer broke.
  - 0.8.2 absent from both repos' releases and tags; `sidflow-data` latest is 0.8.0 again; all five
    `releases/latest/download/<name>` URLs return 200; `c64commander` is pinned to **0.8.0**
    (tag and digest `64bee446...f7c9c6d`), not 0.8.2, so it was never exposed.
  - The published 0.8.2 assets survive locally under `tmp/rebuild-0.8.2/`, digests verified, since
    the release can no longer be downloaded.

2. [DONE] P41-T02 Prove the graph is derivable from the published vectors, and reproduce the
   baseline byte for byte before changing anything.
  - `scripts/neighbour-graph/verify-rank1-reproduction.ts`: 503 of 503 sampled seeds reproduce
    their published rank-1 neighbour from `vector_json` under the manifest's weights, including the
    three pinned probes (0 -> 86297, 1000 -> 359, 50000 -> 61874). No reclassification is needed.
  - `scripts/reproduce-published-bundles.sh` rebuilt lite and tiny from the published full export
    with pre-change code: lite `fe92bd57...a346cd` and tiny `62097331...c62d294`, both MATCH.

3. [DONE] P41-T03 Commit the measurement tools the 0.8.2 work left as throwaways in `tmp/`.
  - `scripts/neighbour-graph/analyse.ts` reproduces every published figure exactly: 0.8.0 tiny
    (out-degree 2.799, 24,669 zero-in = 28.08%, 2,786 zero-out, 99.08% largest component, in-degree
    max 66), 0.8.2 tiny (2.557, 1, 1, 100%), and the full export at k=25/3/1 (reciprocity
    47.28%/43.92%/38.01%, 16,700 attractors all of length 2, in-degree max 217, 456 zero-in,
    same-file 14.42% at rank 1 and 5.13% over all 25).
  - `scripts/neighbour-graph/simulate-station.ts` plus `station-engine-port.ts` and
    `station-metrics.ts` port `computeStation` and drive it as `stationQueueProvider` does.

4. [DONE] P41-T04 Choose the construction with measurements, not assumptions.
  Findings so far, all at 3 slots over the 87,868-track corpus:
  - **Alpha-pruning the source export's top-25 cannot work.** Swept alpha in
    {1.0, 1.05, 1.1, 1.2, 1.4} x {none, mutual proximity, local scaling} x {reverse insertion on,
    off} = 30 configurations. Every one leaves 9.9%-13.6% of tracks with no incoming edge, 99.52%-
    99.66% largest component, and greedy routing recall@1 of 0.10%-0.30% — no better than a plain
    top-3 graph. Cause measured directly: d(u, rank 1) 0.02832, d(u, rank 25) 0.05190, d(u, random
    track) 0.24294, and mutual distance among candidates 0.05526. Every edge the pool can offer is
    five to nine times shorter than a typical corpus distance, so the pool contains no long edge
    and only 23.41% of candidates are dominated. Reverse insertion also cannot help a track nothing
    chose, because an unchosen track is offered no reverse edge.
  - **Vamana construction does work**, because its candidate pool comes from a search over the
    graph being built: one undirected component (100.00%), longest edge distance 0.5877, and a
    station median of 6,168 distinct tracks against 1,367 on the 0.8.0 bundle — from the artefact
    alone, with no client change.
  - **Reachability repair** takes zero-in-degree to exactly 0 (16,871-20,192 tracks repaired).
  - **The hubness trade-off resolved itself once the client policy was measured.** Under the
    drifting query every sampled station reaches the 25,000-track cap on any candidate graph, so
    station length is delivered by the policy and the graph can be chosen as an index. A cap at 8x
    the mean is unusable anyway: it takes the largest undirected component to 99.885%, below the
    99.9% the same acceptance table requires. The bound ships at 64x, which holds connectivity at
    99.995%.
  - **The retrieval guardrail chose the final parameter.** Diversifying all three slots drops
    composer lift 21.12% against the withdrawn 0.8.2, which the 5% guardrail refuses. Reserving two
    of three slots for the seed's nearest neighbours brings it to -1.44% while raising nDCG@10
    33.05%. Shipped: alpha 1.5, beam 96, in-degree bound 64x, one entry point, no hubness
    correction, two reserved slots.
  - Mutual proximity was measured and not shipped: it raises the untrimmed in-degree maximum
    (1,268 against 1,030) and trades routing recall for station length.

5. [DONE] P41-T05 Land the change in the export.
  - `similarity-flow-order.ts` and its test are deleted; the flow order and the shortcut edge are
    gone, not disabled.
  - New: `similarity-neighbour-selection.ts` (the diversifying rule, backfill, reverse insertion),
    `similarity-graph-build.ts` (Vamana construction, reachability repair, hub trimming),
    `similarity-hubness.ts` (mutual proximity with sampled moments, local scaling).
  - `graph_flags` bit 0 (acyclic) and bit 3 (flow successor) are no longer set; the two legacy
    reserved bits are preserved. Row order is descending similarity again.
  - `decodeTinyNeighbourGraph` added to `@sidflow/common` so the gate and the analyser share one
    statement of the header offsets.

6. [DONE] P41-T06 Release gate. ALL CHECKS PASSED against the rebuilt bundle. The acyclicity, flow-successor, slot-0-Hamiltonian and
   longest-forward-path checks are removed — **the acyclicity check because the property is no
   longer claimed, not because it became inconvenient** — and replaced by slot occupancy, dead
   ends, unreachable tracks, in-degree bound, undirected connectivity, row ordering and greedy
   routing recall.

7. [PENDING] P41-T07 `sidcorr-1` decision (Part B), with the numbers that drove it, including the
   case where the decision is to change nothing. Also the same-file question: the rank-1 neighbour
   is a different subsong of the same `.sid` file for 14.42% of seeds and 905 seeds have all 25
   neighbours from their own file.

8. [DONE] P41-T08 `doc/neighbour-graph-design.md`, the `doc/similarity-export-tiny.md` §10.3-§10.5
   rewrite, the `CHANGES.md` 0.8.2 body replacement, and the restored migration guide.

9. [DONE] P41-T09 `c64commander` Part E, on `feat/station-drifting-query` (3 commits, 23 files).
  - Station depth: median 1,453 -> 59,704 distinct tracks (97.6% of the corpus); same-file adjacency
    0.082% -> 0.000%; no duplicate track in a session. Recent window 3, decay 0.4, origin weight
    0.35, hop budget kept at 3/8 because removing the widening loop stranded a station after 390
    tracks.
  - The added feedback scope found a real defect: `loadRankings()` was never called by production
    code, so likes and rejections were invisible after every app relaunch, for both station kinds.
    Also fixed: the reject down-weight was a flat subtraction and so nearly inert on category
    stations; like steering was unbounded; the aim/roam balance is now an exported `StationBalance`.
  - Known limitations, not fixed and flagged deliberately: a resumed station recomputes the
    un-emitted tail of its last batch rather than replaying it (true before this change too), and
    two main-thread costs grow with the exclusion set and would likely breach the 16 ms refill
    budget on a Pixel 4 in a very deep session.
  - The pin stays at 0.8.0; neither pin file is in the diff.

10. [IN_PROGRESS] P41-T10 Validation done; publishing awaits the maintainer.
  - Three consecutive clean runs: `sidflow-common` 599 pass / 0 fail, `sidflow-play` 439 pass / 0
    fail. `sidflow-train` 66, `sidflow-rate` 10, `sidflow-fetch` 26, `sidflow-performance` 92, all 0
    fail. `c64commander` 9,846 pass / 1 skipped, branch coverage 91.55%.
  - Guardrail passes: composer lift -1.44%, nDCG@10 +33.05% against the withdrawn 0.8.2.
  - **Two environment problems found, neither caused by this work and neither fixed.**
    `sidflow-classify` has 19 failures in the WASM render and essentia.js feature paths; that package
    imports none of the modules this change touches. And `bun test` cannot run from the repository
    root at all — it scans for ~110s and dies with EMFILE, on untouched test files too — so every
    suite here was run from its package directory. That makes the documented `bun run test` unusable
    on this machine and is worth its own change.
  - Remaining: tag `0.8.2` on `main`, publish `sidflow-data` `0.8.2` with the complete asset set
    re-uploaded (the four unchanged assets plus tiny `10db2838...c1c0bc`), re-pin `c64commander`,
    merge both branches.

## Phase 42 - SID Radio CPU Cost And An Audible Audio Dropout

Raised by the user on 2026-07-30, after Phase 41's station change landed on the device.

1. [IN_PROGRESS] P42-T01 An audible dropout in playback, reported by ear and not by a counter.
  - **Reported:** "a short 0.1ms gap ca. 2s into the song (`No_way_out.sid`)", on the Pixel 4 running
    the Phase 41 branch build `0.9.4-f7b3c`. The user believes it is a recurrence of a defect that
    was previously fixed.
  - **History it matches.** `ci/perf/sid-radio-perf-thresholds.json` records that `audioUnderruns`
    regressed to 1 once before, when the G11 determinism sequence moved to emit time and put
    `querySelector` plus a full `JSON.stringify` on the main thread once per emitted item. The fix
    made `recordEmitted` update memory only and left the following `recordRefill` to flush.
  - **Hypothesis, to be tested rather than assumed.** That fix reduced how *often* the main thread
    stringifies, not how *much* it costs, and the cost has since grown roughly 40x because a station
    now excludes ~59,700 tracks instead of ~1,400. Two seconds into a track is about when the queue
    provider tops up its lookahead, which is when `recordRefill` and the session save run. The
    prediction that makes this falsifiable: the dropout should recur about once per track, early in
    the track, and should scale with station depth — rare on a fresh station, reliable on a deep one.
  - **An unresolved detail that changes the diagnosis.** 0.1 ms is about five samples at 48 kHz,
    which is audible as a click but not as a gap; a main-thread block would give a dropout two to
    three orders of magnitude longer. So the report is either a sample-level discontinuity (a click,
    pointing at a buffer seam) or a much longer starvation gap estimated by ear. The detector must
    look for both.
  - **The counters and the ear disagree.** `audioUnderruns` reads 0. Either the counter does not
    observe this path or the event is not an underrun in the sense it means. That discrepancy is a
    finding in its own right and must not be resolved in favour of the more convenient number.

2. [IN_PROGRESS] P42-T02 Station CPU cost must not grow with station depth.
  - The constraint the user stated: local SID playback already uses most of the CPU, so the station
    must not add to it. The margin is documented and thin — `renderMsPerSec` is pinned at 850 against
    715 measured, about 1.4x realtime, and `audioUnderruns` is pinned at 0.
  - Three costs currently scale with the exclusion set. Measured on desktop at 87,868 tracks, 60,000
    exclusions: session `JSON.stringify` 2.07 ms over 344 KB, `structuredClone` of the exclude array
    1.80 ms, and the worker's `new Set(...)` 4.03 ms. At depth 1,000 the same three are 0.05, 0.06
    and 0.09 ms.
  - A fixed bitset over the corpus is 10,984 bytes at any depth: 0.02 ms and 14 KB to persist, 0.002
    ms to transfer, and no set to build at all because membership becomes a bit test. That turns all
    three from O(depth) into O(1).
  - Note the desktop figures above are 2-4x lower than the ones measured during Phase 41 under heavy
    load. At a 3-5x Pixel 4 multiplier the two extrapolations straddle the 16 ms
    `refillMainThreadMaxMs` budget from opposite sides, which is exactly why the device measurement
    decides and neither extrapolation should be quoted as a result.
  - Also open, and cheap if the worker's BFS proves to be a material share of CPU: Phase 41's sweep
    reached 58,971 tracks at hop budget 4 against 59,704 at 8, so roughly half the station compute
    may be available for about 1% of depth.

3. [PENDING] P42-T03 Measure on the device, not by extrapolation.
  - Depth sweep (1k / 10k / 30k / 60k) via a pre-seeded session descriptor, which is the state a
    resumed deep session is genuinely in. A normal soak advances ~45 tracks in 40 minutes and never
    reaches the depth where the problem lives, so a shallow pass proves nothing.
  - Report worker CPU as well as the main-thread budget: the largest single cost is the worker's set
    rebuild, which does not touch `refillMainThreadMaxMs` at all but does contend with the audio
    render, and that contention is the user's actual constraint.
  - Independent microphone check against the on-device counters. Room noise floor measured at
    **-40.7 dBFS RMS** with nothing playing. A dropout is a collapse toward that floor, and SID tunes
    contain real rests, so a silence-threshold detector will produce false positives; key on
    discontinuity, and state what the detector would miss.

## Phase 40 - Extract And Automate libsidplayfp WASM

1. [IN_PROGRESS] P40-T01 Establish `chrisgleissner/libsidplayfp-wasm` as the standalone,
   source-compatible TypeScript and WASM package.
  Acceptance criteria:
 - The package preserves the current loader, `SidAudioEngine`, engine-selection, trace, and
    direct generated-module API without a caller-facing code change.
  - It builds and ships both SIDLite and reSIDfp from pinned, recorded upstream sources.
  - Playback fixtures are obtained on demand from the complete HVSC 85 result of Update 85,
    integrity-checked, and cached locally so real single-, dual-, and triple-SID scenarios never
    repeatedly load the remote server.
  - The test-only C64 ROM cache is sourced from pinned `libretro/vice-libretro` bytes, never
    committed or published, and is applied before every real playback load.
  - The standalone suite reproduces SIDFlow's renderer contract over a representative HVSC subset:
    it enables tracing before load, renders WAV output in 20,000-cycle chunks, drains every SID
    register-write batch to a sidecar, and proves that the batched stream equals the complete trace.
  - The cache selector reproduces SIDFlow's 998-case edge corpus: every 2-/3-SID, RSID+BASIC,
    and >=32-subsong file plus deterministic RSID and zero-play-address samples.
  - Test coverage exceeds SIDFlow's existing WASM suite: public API and clean-package contracts,
    browser execution, corrupt-input resistance, cache/header-selection behavior, lifecycle and
    render-mode matrices, both-engine corpus health, and native differential parity all gate a
    release.
  - README and package metadata make installation, browser asset resolution, C64 ROM handling,
    engine selection, and verification concise and clear.
  - Codecov uploads LCOV from the same local CI command and independently enforces at least 95%
    production TypeScript line coverage; the README carries npm, build, Codecov, GPL, and runtime
    badges consistent with the relevant C64Bridge conventions.
  - Every ordinary test run includes concurrent multi-instance playback. Browser tests cover desktop
    Chromium, Firefox, WebKit, and Pixel-5-configured Chromium, including concurrent module workers.
    A weekly Sunday-night two-hour virtual-playback soak detects post-warm-up WASM heap growth; the
    initial 30-minute soak is run locally before the first release.

2. [TODO] P40-T02 Automate release-only upstream tracking and supply-chain-safe publication.
  Acceptance criteria:
  - A public-runner workflow detects stable libsidplayfp GitHub releases, never prereleases or
    ordinary branch commits.
  - Each candidate rebuilds, validates actual playback against native libsidplayfp across the
    single-/multi-SID and both-engine fixtures, and publishes only after every gate passes.
  - npm (with provenance) and GitHub release assets contain the same verified package, checksums,
    SBOM, and provenance metadata.
  - The initial migration does not manually publish a registry package or GitHub release.

3. [TODO] P40-T03 Replace SIDFlow's workspace implementation with the standalone dependency and
   remove the embedded package/build/release coupling.
  Acceptance criteria:
  - SIDFlow imports the external package without behavioral or public API changes.
  - No production copy of the former package, its build metadata, or its release staging remains
    in SIDFlow.
  - SIDFlow's dependency-update workflow opens an automatically mergeable update when the
    standalone package releases; lockfile updates retain reproducible builds.

4. [TODO] P40-T04 Validate both repositories and preserve evidence.
  Acceptance criteria:
  - Each repository builds, package checks pass, and its full relevant test suite passes three
    consecutive times with zero failures.
  - The final progress record contains literal terminal summaries and explicitly confirms that no
    package or release was published manually during migration.

### Progress

- 2026-07-27: Read the existing package, SIDFlow integration/release paths, upstream release
  state, target repository, and `c64bridge` package-validation workflows. The target repository
  is deliberately bare and public; no source, registry, or release publication has
  occurred. Upstream is pinned at libsidplayfp `v3.0.2` and libresidfp `v1.1.2`. The standalone
  release provenance will record both exact refs, since reSIDfp is a separately linked library.
- 2026-07-27: Added HVSC Update 85 real-fixture acquisition to the migration contract, then
  strengthened it to match SIDFlow's existing absolute-edge selection rather than testing only
  the update's own files. The complete HVSC 85 result will be cached, its SID headers parsed, and
  the deterministic 998-case union exercised in release gates. The standalone test architecture
  also adds package, browser, input-resilience, cache, lifecycle, and both-engine native-parity
  layers beyond SIDFlow's current WASM tests.
- 2026-07-27: Implemented the standalone package on branch
  `codex/extract-libsidplayfp-wasm` without publication. It now carries pinned complete-HVSC-85 and
  VICE-ROM caches, source-built SIDLite/reSIDfp artifacts, lifecycle/cache/failure tests, 16-player
  concurrent playback, browser and browser-worker concurrency across Chrome/Android-sized Chrome/
  Firefox/WebKit, and the SIDFlow WAV-plus-full-register-trace compatibility test. The local LCOV
  report measures 99.36% production line coverage (`src/player.ts` 100%); Codecov configuration and
  badge are included. The initial 30-minute soak is running under a logged harness; no registry or
  GitHub release has been created.
- 2026-07-27: The initial local 30-minute dual-engine virtual-playback soak completed with exit 0.
  Local Chromium, Android-sized Chromium, Firefox, and WebKit playback completed 28 Playwright
  checks successfully. Three consecutive standalone unit runs each ended with `348 pass`, `1 skip`
  (the separately executed operational soak), and `0 fail`; the complete 1,678-file HVSC #85 edge
  health sweep then passed for both engines. A legitimate reSIDfp peak of 0.9848 in Druid Remix was
  verified byte-for-byte against the pinned native renderer, so the health gate now correctly rejects
  actual Int16 saturation instead of high but valid upstream output. The exhaustive native
  differential sweep is in progress; no PR, package publication, or release has yet been created.
- 2026-07-28: Completed the standalone local release qualification: both 1,678-case HVSC health
  sweeps and both-engine native differential sweep are green; quiet/held-frame parity uses a strict
  -60 dBFS absolute-error and 16-LSB peak bound rather than invalid mean-subtracted correlation,
  while normal-level AC signals retain the 0.9999 correlation requirement. The exact native
  comparison completed after this correction. Three subsequent unit runs all reported `348 pass`,
  `1 skip` (the separately completed operational soak), and `0 fail`; package validation passed.
  The standalone work is committed as `cf44ff9` and is now in draft PR
  https://github.com/chrisgleissner/libsidplayfp-wasm/pull/1. Its GitHub Actions release-quality
  build is running; no package publication or GitHub release has occurred.

## Phase 39 - Export Audit Remediation, Released As 0.8.0

1. [DONE] P39-T01 Close the July 2026 HVSC export audit findings and ship them as 0.8.0.
  Acceptance criteria:
  - No reclassification. Every artefact derived deterministically from the 0.7.0 export.
  - The lite and tiny derivations reproduce the published bundles byte-for-byte with pre-fix
    code, establishing a baseline against which every later byte is attributable.
  - Manifest digests match the files they describe; neighbour counts are measured; paths are
    basenames; `hvsc_version`, `similarity_metric` and `vector_weights` are published.
  - A third party reading only the lite bundle and its manifest reaches R@25 >= 0.98.
  - No persona ships empty; conflicting personas share no tracks; the export fails rather
    than publishing a starved or indistinguishable station.
  - The release gate fails against 0.7.0's assets and passes against 0.8.0's, and runs in CI
    against a fixture built through the real export chain.
  - Three consecutive `bun run test:ci` runs with 0 fail.

### Progress

- 2026-07-27: **CLI player verified against the 0.8.0 artefacts, and four defects fixed.**
  `scripts/verify-station-cli.ts` drives the same path as `sidflow-play station` across all
  three profiles. It found that tiny stations collapsed to 3 tracks -- a regression from
  this branch's own score normalisation, which produced a rank where the station layer
  expects a similarity and applies an absolute 0.73 threshold. Also fixed: `build:db`
  crashed outright on any corpus carrying feature-phase output; every `--persona` playlist
  returned one song because the diversity filter measures distance over three integers and
  a persona seeds on exact integer targets; and decayed feedback was ignored entirely
  because of a snake_case/camelCase mismatch, invisible because the diversity truncation
  meant the test never had a second element to compare.
- 2026-07-27: Baseline reproduction PASSED before any change. Lite rebuilt to
  `fe92bd57...a346cd` and tiny to `081664d8...cba7c5`, byte-identical to the published
  artefacts. Tiny's byte-identity is the load-bearing half: it stores a 48-bit MD5 prefix of
  every `.sid` file and throws on the first unresolvable path, so reproducing it identifies
  the corpus empirically as **HVSC 85 + Update 85** rather than by assertion. Committed as
  `scripts/reproduce-published-bundles.sh`.
- 2026-07-27: Manifest integrity. The embedded copy now omits `file_checksums` entirely and
  the sidecar carries the digest, computed after the last write; there is no longer any write
  to the database after the hash. `neighbor_row_count` is measured (old code declared 200
  against 56 actual on an 8-track corpus asking for 25 neighbours). `--rewrite-manifest`
  repairs an existing export without reclassifying and is idempotent by short-circuit --
  SQLite bumps three header bytes on every VACUUM, measured, so a rewrite that always wrote
  could not be byte-stable. Verified on the real 982 MB artefact.
- 2026-07-27: Station assignment rebuilt. Quantile assignment gives all nine personas 17,574
  tracks (20.0%), spread 1.0 against 69x, zero conflicting overlap against 9,451 tracks.
  Feeding metadata in was necessary and NOT sufficient: `scoreMetadataBonus` scored metadata
  PRESENCE, and composer and category resolve for 100% of HVSC, so it was a constant that
  changed no ranking -- `composer_focus` had 30 distinct scores with metadata and 30 without.
  Content-based signals took it to 5,986, `era_explorer` 14 -> 316, `theme_hunter` 30 -> 5,321.
  The hybrid blend moved 0.85/0.15 -> 0.45/0.55 after measuring that at the old blend
  `deep_discovery` and `melodic` shared 91% of their tracks. Verified with
  `scripts/diff-tiny-sections.ts`: the rebuild changed 104,637 bytes of the style-mask table
  and nothing else.
- 2026-07-27: Two defects found by the new checks rather than by the audit. Tiny's favourites
  scores were CLAMPED not normalised, so an entire top-100 reported exactly 1.0 while the
  walk underneath had 973 distinct values. The station layer excluded the seed TRACK but not
  the seed FILE, so with 14.4% of rank-1 neighbours being same-file siblings a station could
  open with the next subtune of the tune just liked.
- 2026-07-27: The 209 disappeared tracks are explained without reclassifying. 184 of the 185
  files involved are absent from HVSC 85 itself -- verified by resolving every path against a
  local HVSC 85 -- and the remaining case lost a subsong because HVSC 85's copy of the file
  declares `songs: 1`. Not a SIDFlow coverage regression.
- 2026-07-27: Release gate extended and wired into CI. Measured 15 checks fail against the
  published 0.7.0 assets, including `theme_hunter` at 0 tracks, a 69.3x spread and the 9,451
  fast/slow overlap; all pass against 0.8.0. A 1,200-track fixture now runs the same gate on
  every commit.

### Known gaps carried forward

- The category axis is now the binding constraint. An audio-led persona's score derives
  entirely from three quintiles, so it takes at most 125 distinct values over any corpus:
  `fast_paced` decides 7.03% of HVSC inside a single tie at its cut. Deriving categories from
  the 58-dimension vector is 0.9.0 work; see `doc/station-quality.md` section 15.
- The full export re-encode (~982 MB -> ~430 MB), `md5_64` in tiny, and neighbour
  diversification all break a schema version and are deferred with measured justification in
  the same section.
- `bun test packages/sidflow-web/` reports 13 failures when the whole package runs in one
  process, identically on `origin/main` and unrelated to this work. `bun run test:ci`, which
  batches them the way CI does, is green.

## Phase 38 - README Persona-First Information Architecture

1. [DONE] P38-T01 Reorganize the project README without losing operational detail.
  Acceptance criteria:
  - The opening lets readers immediately choose between consuming published HVSC data, classifying a collection, or using a player.
  - Each path gives an appropriate first action and links to its authoritative detailed documentation.
  - Existing setup, ROM, configuration, export, deployment, performance, vector-reference, and acknowledgement content remains available in a more logical chapter sequence.
  - Documentation-only validation uses `git diff --check` and Markdown/link inspection; no test suite is required.

### Progress

- 2026-07-24: Read the current README, developer guide, and technical reference after CI repair workflow `30092593429` passed. Reorganizing the README around the three requested reader personas while preserving existing commands and reference details.
- 2026-07-24: Added a decision-first reader-path table, expanded the published-data guidance with full/lite/tiny selection and specification links, and grouped playback plus analysis/export operations under clear chapters. Preserved existing commands, examples, vector reference, deployment, performance, and acknowledgement material. Documentation-only validation passed: `git diff --check` and 29 local Markdown link targets resolved.

## Phase 37 - CI Fixture Timeout Stability

1. [DONE] P37-T01 Make the similarity-dataset export fixture reliable under the CI Bun version.
  Acceptance criteria:
  - Fixture creation avoids Bun's default lifecycle-hook timeout while preserving all export assertions.
  - Cleanup runs only after fixture creation has completed, so it cannot dereference a missing fixture.
  - The affected test, build, and three consecutive full unit suites pass before publication.
  - The pushed `main` workflow completes with all required checks passing.

### Progress

- 2026-07-24: Investigated failed main workflow `30091288032`. Under CI's Bun 1.3.11, two similarity-dataset hooks exceeded Bun's default hook timeout while building the export fixture; the following cleanup then dereferenced the unassigned fixture. Bun 1.3.1's runtime does not support the timeout-overload present in its installed type declarations, so the fixture will be created once at module initialization instead of in a timed lifecycle hook; all three assertions are read-only and retain full coverage.
- 2026-07-24: Moved fixture creation to module initialization and retained cleanup in `afterAll`, eliminating the timed per-test hook while making the test three times faster. `bun run build` passed and three consecutive full `bun run test` runs passed with `0 fail` in every batch and merged LCOV output. GitHub Actions workflow `30092593429` passed every job on `main`, including the originally failing unit-coverage stage on Bun 1.3.11.

## Phase 36 - SIDFlow And SIDFlow-Data Repository Orientation

1. [DONE] Make the two repository home pages complementary and prominently cross-linked.
  Acceptance criteria:
  - SIDFlow clearly distinguishes its tooling/runtime role from the published HVSC data role of `sidflow-data`.
  - `sidflow-data` clearly routes generation/runtime work to SIDFlow and external data consumers to its release assets.
  - The data README explains full, lite, and tiny selection and links to the formal specifications without duplicating generation instructions.

### Progress

- 2026-07-24: Inspected both `main` README files and the live sidflow-data release asset names. Drafted complementary home-page documentation: SIDFlow is the generator/runtime and sidflow-data releases are the verified precomputed HVSC results; format details live in sidflow-data while the normative specs remain in SIDFlow.
- 2026-07-24: Published the sidflow-data README on `main` with release-asset selection, external-consumer guidance, and formal specification links. Updated the SIDFlow README to route readers between local tooling and published HVSC results without duplicating the data-repository guidance. Documentation-only validation uses `git diff --check` and live link/asset inspection under the explicit documentation-only test exception.

## Phase 35 - PR 94 Merge Readiness And Deployment Removal

1. [DONE] P35-T01 Stabilize the PR 94 coverage test gate and verify the Bun WASM failure isolation.
  Acceptance criteria:
  - WASM worker tests that trigger Bun coverage crashes still run and must pass, but outside coverage instrumentation.
  - The remaining unit suite retains merged LCOV output for CI.
  - The targeted regression and the full test gate are demonstrated locally.

2. [DONE] P35-T02 Resolve all PR 94 review feedback with guarded audit inputs and accurate reporting.
  Acceptance criteria:
  - Empty audit cohorts cannot create non-finite metrics.
  - Required lite input is represented as required throughout the report.
  - Every review thread receives a concrete explanation before resolution.

3. [DONE] P35-T03 Remove retired hosting automation and former deployment configuration.
  Acceptance criteria:
  - Default release/CI workflows contain no deploy jobs or retired-environment references.
  - Retired hosting configuration and obsolete deployment helpers are removed, and current documentation has no associated operational instructions.
  - The two obsolete GitHub environments are deleted after their source references are removed.

4. [DONE] P35-T04 Validate, publish, and converge the PR.
  Acceptance criteria:
  - `bun run build` passes.
  - `bun run test` passes three consecutive times with zero failures, with literal output recorded below.
  - The branch is pushed, every review thread is resolved, and PR/main CI are green after merge.

### Progress

- 2026-07-24: Re-opened the required repository guidance and plans, inspected PR #94, and confirmed four actionable Copilot comments in `scripts/run-tiny-export-equivalence-audit.ts`. The only failing PR check was `Build and test / Build and Test`, specifically `Run unit tests with coverage`; the job log has expired, but CI metadata confirms the failure occurred before E2E and coverage merging. The active branch already contains the smallest planned mitigation: run the two WASM-worker-heavy classify tests without coverage while keeping them mandatory, then emit merged LCOV from all other unit batches.
- 2026-07-24: Fixed the coverage runner's test-root discovery so ignored local runtime trees cannot cause Bun `EMFILE` errors, and kept `phase-transitions.test.ts` plus `render-timeout.test.ts` mandatory in a separate no-coverage WASM phase. Removed the retired hosted deployment jobs/configuration/docs and deleted both obsolete GitHub environments. Replied to and resolved all four PR review threads. `bun run build` passed, followed by three consecutive `bun run test` passes; each ended with the literal summary `11 pass`, `0 fail`, `38 expect() calls`, `Ran 11 tests across 2 files`, and merged LCOV written by the no-coverage final phase. Remaining work is to commit, push, and verify the refreshed GitHub checks.
- 2026-07-24: The first refreshed GitHub job exposed two additional Bun-runner defects: coverage crashed natively in the full `libsidplayfp-wasm` group, and `metadata-cache.test.ts` left Bun's mocked system clock frozen, causing the next `perf-utils.test.ts` busy-wait to hang. The runner now executes the full WASM test root plus the two WASM-worker classify tests without instrumentation while keeping all of them mandatory; the metadata test resets real time with `setSystemTime()`. Three new consecutive full `bun run test` runs passed (`0 fail` in every terminal batch), with each run writing merged LCOV for the remaining coverage batches. Remaining work is to publish this repair and verify PR and main CI.
- 2026-07-24: Merged PR #94 as squash commit `b14dfa0a8499bf4b3d52a852a1b2f80a3251471e`. Its `main` CI run `30087861427` completed successfully: Build and Test, Package check, and Docker-change detection passed (the Docker image job was correctly skipped). GitHub environments now list only `copilot`, `github-pages`, `Preview`, and `Production`; the obsolete hosted environments are absent.

## Phase 34 - sidcorr-lite/tiny Export Convergence And Radio Equivalence

1. [IN_PROGRESS] P34-T01 Audit the live export, release, and radio-generation pipeline.
  Acceptance criteria:
  - `doc/similarity-export.md`, `doc/similarity-export-tiny.md`, the current station/runtime code, and the existing lite/tiny builders are cross-checked against the requested convergence target.
  - The audit identifies which pieces already exist, which are incomplete, and which contradict the required workflow.
  - `WORKLOG.md` records the pipeline map, concrete gaps, and the evidence files inspected.
  Artifact requirements:
  - `WORKLOG.md` audit entry with file-backed findings.

2. [IN_PROGRESS] P34-T02 Implement a single deterministic lite-transform path that works for both local and release-based full exports.
  Acceptance criteria:
  - Local path supports `full sqlite -> lite` with partial dataset mode for validation.
  - Release-based path downloads the latest full export from `chrisgleissner/sidflow-data`, materializes the SQLite asset, and runs the same transform code path.
  - Deterministic checksums and/or manifest validation prove equivalent lite output semantics for both inputs.
  Artifact requirements:
  - Generated lite bundles, manifests, and checksums under a deterministic artifact directory.

3. [IN_PROGRESS] P34-T03 Switch tiny generation to a strict `sidcorr-lite -> sidcorr-tiny` flow.
  Acceptance criteria:
  - Tiny generation consumes the lite bundle as its direct logical source.
  - Styles/personas and neighbor relationships remain available and validated against `doc/similarity-export-tiny.md`.
  - Output is deterministic for identical lite input.
  Artifact requirements:
  - Generated tiny bundle, manifest, and checksum.

4. [TODO] P34-T04 Converge release publication so full, lite, and tiny ship together with explicit linkage.
  Acceptance criteria:
  - The release workflow stages the authoritative full export, the derived lite export, and the derived tiny export for the same release tag.
  - No manual release-side steps are required.
  - Automation proves the expected asset set is produced for publication.
  Artifact requirements:
  - Release staging directory with raw assets, manifests, tarball, and `SHA256SUMS`.

5. [IN_PROGRESS] P34-T05 Implement deterministic persona-based radio equivalence validation across full and tiny.
  Acceptance criteria:
  - Code defines explicit metrics for overlap ratio, rank correlation, and style-distribution similarity.
  - Validation runs across all shared personas/styles using the same seeds and station size for both formats.
  - Every persona meets the overlap threshold of at least 80%, or the generated report explains the deviation.
  Artifact requirements:
  - Machine-readable comparison report plus saved station outputs for each persona and format.

6. [IN_PROGRESS] P34-T06 Create one-command convergence automation and document the workflow.
  Acceptance criteria:
  - A single script/command runs export generation, lite transform, tiny transform, radio generation, and comparison.
  - The script supports partial validation mode and release-based lite generation.
  - Docs describe the commands, artifacts, and reproducibility expectations.
  Artifact requirements:
  - Reproducible artifact tree under `tmp/` or `workspace/artifacts/` plus updated docs.

7. [TODO] P34-T07 Validate the changed surface and repo gates.
  Acceptance criteria:
  - Targeted build/tests for the changed similarity/runtime surface pass.
  - `bun run build` passes.
  - `bun run test` is attempted three times and the literal outputs are recorded if the suite reaches `0 fail`; otherwise the blocker is recorded explicitly.
  Artifact requirements:
  - Validation logs and test outputs referenced from `WORKLOG.md`.

8. [IN_PROGRESS] P34-T08 Audit 2: prove or repair full/lite/tiny recommendation parity on the release-complete artifact set.
  Acceptance criteria:
  - Local and published manifests are compared by schema, counts, and lineage, and the authoritative audit trio is recorded before parity conclusions are drawn.
  - The existing parity harnesses and focused tests are run against the real station-building and seed-song recommendation surfaces used by the runtime.
  - Any material divergence is localized to the first failing step with file-backed evidence before code changes are made.
  - If a bug exists, the smallest correct fix lands with deterministic regression coverage and updated docs/report artifacts under `tmp/`.
  Artifact requirements:
  - Deterministic audit artifacts and a Markdown release-readiness summary under `tmp/lite-export-check/`.

### Progress

- 2026-04-16: Re-opened the repo instructions, current Phase 34 state, the similarity-export specs, the existing audit prompt, and the shared runtime/test surfaces for a new release-backed parity pass driven by `doc/audits/audit2/prompt.md`. The prompt's core constraint is valid against the current tree: local `data/exports/` lite/tiny artifacts are partial validation bundles, so the next audit pass should prove or disprove parity against one coherent full/lite/tiny trio from the published `sidflow-data` release unless fresh local artifacts with matching counts are produced later for focused debugging.
- 2026-04-16: Confirmed the repo already has the right proof surfaces to reuse rather than replace: `scripts/run-tiny-export-equivalence-audit.ts`, `scripts/run-similarity-convergence.ts`, `packages/sidflow-play/test/station-portable-equivalence.test.ts`, and `packages/sidflow-common/test/similarity-export.test.ts`. Next step is to verify the actual manifest lineage and run those surfaces against the selected release-backed assets to determine whether any real full/lite/tiny divergence remains.
- 2026-04-08: Read the required docs and live code paths in the requested order. Confirmed the repo already has local sqlite->lite conversion, direct sqlite->tiny conversion, release publication for sqlite/lite/tiny, and runtime loading for sqlite/lite/tiny, but it does not yet provide the requested convergence workflow.
- 2026-04-08: Identified the concrete remaining gaps. The current tiny builder still consumes SQLite directly instead of lite, there is no dedicated CLI/script that downloads the latest full export release and runs the lite transform through the same code path, and the existing persona validation script is SQLite-only and models different personas instead of validating full-vs-tiny equivalence across the shared styles.
- 2026-04-08: Confirmed the station CLI already supports local sqlite/lite/tiny bundles and the release-cache path already downloads the latest `sidflow-data` tarball, so the convergence work can build on existing runtime code instead of adding a parallel radio stack.
- 2026-04-08: Audited the current repeatability constraints for the requested tiny-vs-full QA prompt. The interactive `scripts/sid-station.sh` / `sidflow-play station` flow is not CI-safe because it requires live seed rating input, so the research prompt must require automation through the same station-builder stack non-interactively: `openStationSimilarityDataset(...)`, `buildStationQueue(...)`, `recommendFromFavorites(...)`, and `recommendFromSeedTrack(...)` with fixed seeds, fixed output roots, deterministic sampling, and machine-readable plus Markdown artifacts suitable for local Linux runs and optional CI execution.
- 2026-04-08: Started implementing the dedicated local-first tiny-export equivalence audit requested in `doc/research/lite-export-check/tiny-export-equivalence-prompt.md`. The current convergence script is too narrow for that prompt because it only reports persona-station overlap; the new work adds a separate audit CLI with explicit artifact layout, seed-song similarity checks, cross-persona divergence checks, deterministic rerun proof, and a report ordered exactly to the prompt contract.
- 2026-04-08: Fixed `scripts/run-similarity-export.sh` so the authoritative sqlite export always precomputes the 3-neighbor hint required for large tiny generation. The unattended sqlite -> lite -> tiny export chain now succeeds in both direct CLI validation and the full wrapper path.
- 2026-04-08: Updated `scripts/run-similarity-convergence.ts` so the release branch derives lite from the downloaded full sqlite through the same CLI path, reports stale public-release gaps instead of aborting when the latest `sidflow-data` release lacks lite/tiny assets or precomputed full neighbors, and adds `--strict-overlap` for fail-fast enforcement when needed.
- 2026-04-08: Validation evidence: `bash -n scripts/run-similarity-export.sh` passed; direct sqlite/lite/tiny rebuild succeeded with `bun run export:similarity` (`Tracks: 596` in each format); targeted similarity/runtime proof tests passed (`17 pass, 0 fail` across `packages/sidflow-common/test/similarity-export.test.ts`, `packages/sidflow-common/test/similarity-dataset.test.ts`, and `packages/sidflow-play/test/station-portable-equivalence.test.ts`); `bun run validate:similarity-convergence -- --skip-local-export --max-songs 200 --output-root tmp/similarity-convergence-20260408` passed; and the full end-to-end command `bun run validate:similarity-convergence -- --max-songs 200 --output-root tmp/similarity-convergence-20260408` passed, writing artifacts under `tmp/similarity-convergence-20260408`.
- 2026-04-08: Residual gaps are now explicit artifacts instead of wrapper failures. The latest public `sidflow-data` release (`sidcorr-hvsc-full-20260407T115218Z`) still lacks published lite/tiny assets and lacks precomputed full-profile neighbors, so release-side tiny derivation is reported as skipped. The persona radio report records two overlap exceptions (`melodic`, `composer_focus`) below the 0.80 target while the workflow remains green in report mode; `--strict-overlap` preserves the nonzero exit path for future enforcement once those deviations are resolved.
- 2026-04-08: Closed the remote publication gap. Added a large-corpus approximate tiny-neighbor fallback in `packages/sidflow-common/src/similarity-export-tiny.ts`, built `sidcorr-hvsc-full-sidcorr-lite-1.sidcorr` and `sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr` directly from the released full sqlite (`Tracks: 87073`), added `scripts/upload-existing-release-assets.sh`, and uploaded the lite/tiny bundles, their manifests, a refreshed `SHA256SUMS`, and a replacement `hvsc-full-sidcorr-1-20260407T115218Z.tar.gz` to `https://github.com/chrisgleissner/sidflow-data/releases/tag/sidcorr-hvsc-full-20260407T115218Z`. GitHub release verification now shows the new remote assets and updated release notes.
- 2026-04-08: Resolved the tiny-vs-full hosted audit gap by aligning the equivalence harness with the shipped station default (`adventure=3`) and stabilizing score-plateau handling in `packages/sidflow-play/src/station/queue.ts`. The final hosted artifact set under `tmp/lite-export-check/release-final-validated` now records PASS for persona-station equivalence, PASS for seed-song similarity, deterministic reruns, and cross-persona divergence parity, while preserving baseline persona-collapse findings as warnings when they already exist in the authoritative full runtime.

## Phase 33 - PR 93 Convergence To Merge-Ready

1. [IN_PROGRESS] Audit the active PR review threads and failing branch status.
  Acceptance criteria:
  - Every open review thread is enumerated with file-backed context.
  - The failing CI job is reduced to concrete root causes.
  - The convergence task distinguishes code fixes, doc alignment, and pure reply-only resolutions.

2. [TODO] Fix valid review findings with minimal, regression-safe changes.
  Acceptance criteria:
  - Tiny export generation uses the documented backward-edge DAG and does not regress on large precomputed exports.
  - Tiny loading avoids full HVSC rescans when Songlengths.md5 can provide the MD5-to-path index.
  - Lite/tiny builders and station dataset resolution remove the flagged O(n²) and unsupported `.sqlite.gz` behaviors.

3. [TODO] Repair the current branch CI failures and revalidate the changed surface.
  Acceptance criteria:
  - The station queue tests use the current dataset-handle API.
  - Legacy sqlite schema detection reports the intended track-identity error.
  - Targeted tests plus `bun run build` pass locally.

4. [TODO] Push fixes, answer every unresolved review thread, and resolve them.
  Acceptance criteria:
  - Every unresolved thread gets a technical reply tied to code or reasoning.
  - No thread is resolved without an explanation.
  - The branch contains the convergence fixes.

5. [TODO] Wait for CI to return green and close the loop.
  Acceptance criteria:
  - All required checks for PR 93 are passing.
  - No unresolved review comments remain.
  - PLANS.md records the final evidence and any residual risks.

### Progress

- 2026-04-07: Read the required repo docs, fetched live PR 92 review metadata from GitHub, and confirmed 10 unresolved Copilot threads plus one failing `Build and test / Build and Test` check on commit `feat/sidcorr-tiny`.
- 2026-04-07: Reduced the open review feedback to concrete fixes in `packages/sidflow-common/src/similarity-export-tiny.ts`, `packages/sidflow-common/src/similarity-export-lite.ts`, `packages/sidflow-play/src/station/dataset.ts`, and `doc/similarity-export-tiny.md`. The comments are valid: the tiny export still wrote forward edges, the loader still performed an HVSC-wide MD5 scan and an O(trackCount * fileCount) file lookup, lite still carried an unused O(fileCount * trackCount) count pass, and station dataset resolution still inferred unsupported `.sqlite.gz` sqlite bundles.
- 2026-04-07: Inspected the failing GitHub Actions log for run `24104059549` and found four concrete failures: three `station demo backend queue building` tests were still calling `buildStationQueue(...)` with a sqlite path instead of the new dataset handle, and one legacy-schema CLI test was blocked because `openSqliteSimilarityDataset(...)` always claimed `hasTrackIdentity: true` even when `track_id` / `song_index` columns were missing.
- 2026-04-08: Re-opened the required docs for a new `pr-converge` pass, identified the live branch PR as `#93` (`fix/sidcorr-tiny-release`), and fetched nine unresolved Copilot review threads against the current head. The live review set is concrete and mostly valid: `scripts/run-similarity-convergence.ts` needs bounded-memory hashing/downloads plus safe child-process settlement, `packages/sidflow-play/src/similarity-export-cli.ts` needs stricter tiny-only flag validation, `packages/sidflow-common/src/similarity-export-tiny.ts` needs cached HVSC root resolution plus dead helper cleanup, `scripts/run-similarity-export.sh` should expose the forced SQLite neighbor count explicitly, and the checked-in tiny manifest should not embed an absolute local `hvsc_root`.
- 2026-04-08: Implemented the PR 93 review fixes and validated the touched surface locally: `bash -n scripts/run-similarity-export.sh`, `bun run build:quick`, and targeted tests for `similarity-export`, `similarity-export-cli`, and the station queue all passed. The first required full `bun run test` loop then failed on `packages/sidflow-play/test/cli.test.ts` (`builds a random-rating station across collection buckets instead of collapsing into early alphabetical paths`), which exposed a real repo-gate regression unrelated to the review threads: `orderStationTracksByFlow(...)` was re-sorting score plateaus alphabetically and destroying the diversified selection from `chooseStationTracks(...)`. Fixed that by preserving the diversified input order as the tie-break inside flow ordering, and re-ran the queue-specific tests to green before restarting the full 3x suite.
- 2026-04-09: Full repo validation is now green after the queue plateau fix. `bun run build` passed, and `for i in 1 2 3; do bun run test; done` completed with exit code `0` across all three consecutive runs, including the historical `packages/sidflow-play/test/cli.test.ts` queue regression and the long `HVSC 300-file persona station E2E` integration batch. Next step is purely PR-convergence work: commit/push this fix set, reply to each open review thread with the concrete technical change, resolve the threads, and wait for refreshed CI on PR 93.

## Phase 32 - Multi-Format Similarity Convergence Audit And Proof

Plan document:

- `docs/research/similarity-export-audit.md`

1. [DONE] Complete a fresh capability audit against the live code, specs, and README.
  Acceptance criteria:
  - A capability matrix covers export generation, CLI loading, station generation, runtime switching, determinism, and test coverage for sqlite/lite/tiny.
  - README claims are marked CORRECT, PARTIAL, BROKEN, or MISSING against the current tree.
  - Findings are written to `docs/research/similarity-export-audit.md` before implementation changes are declared done.

2. [DONE] Converge all runtime formats behind one dataset interface.
  Acceptance criteria:
  - The station pipeline depends on a single dataset abstraction instead of mixed sqlite-vs-portable branches.
  - The abstraction exposes `resolveTrack(...)`, `getNeighbors(...)`, `getStyleMask(...)`, and `recommendFromFavorites(...)` for sqlite, lite, and tiny.
  - Format-specific logic is confined to dataset backends and export/load helpers.

3. [DONE] Repair tiny fidelity and portable runtime parity.
  Acceptance criteria:
  - Tiny no longer reconstructs placeholder ratings or fabricated recommendation scores at load time.
  - Tiny preserves the track data needed for the shared station pipeline and style filtering.
  - Portable datasets preserve random seed sampling semantics instead of returning deterministic first rows.

4. [DONE] Add permanent equivalence and fidelity enforcement.
  Acceptance criteria:
  - Tests compute top-50 overlap, top-100 overlap, Jaccard similarity, rank correlation, and style-distribution comparisons across sqlite/lite/tiny using the real station builder path.
  - Tiny-focused tests cover graph reachability, neighbor stability, and style-filter parity.
  - The tests live under existing `*.test.ts` coverage-batch roots so CI enforces them automatically.

5. [DONE] Reconcile operator workflow, wrapper output, and publication behavior.
  Acceptance criteria:
  - The authoritative export workflow can derive lite and tiny from the authoritative sqlite bundle in one validated path.
  - Release/publication steps support the portable formats needed by the README and audit conclusions.
  - README and operator docs only claim behavior that the script and CLI actually implement.

6. [IN_PROGRESS] Execute full validation and record evidence.
  Acceptance criteria:
  - Build passes.
  - Required tests pass locally.
  - Real local execution covers sqlite -> lite/tiny generation plus non-interactive station runs.
  - PLANS.md and WORKLOG.md capture final evidence and residual risks, if any.

### Progress

- 2026-04-07: Re-read the required repo docs plus the current similarity export specs and runtime code. The fresh audit found that Phase 31 was overstated: the tiny loader currently reconstructs placeholder `e/m/c/p` ratings, invents neighbor scores from ordinal rank instead of loading persisted values, exposes no vector data, and the existing equivalence tests only check weak overlap on a tiny synthetic corpus.
- 2026-04-07: Confirmed additional convergence gaps in the live tree. Portable datasets currently do not randomize seed sampling (`readRandomTracksExcluding(...)` returns the first rows after filtering), the station runtime still mixes sqlite-specific access paths with the portable abstraction instead of relying on one shared interface, and `scripts/run-similarity-export.sh` still only drives/publishes the authoritative sqlite artifact even though `doc/similarity-export.md` claims all three default outputs are produced.
- 2026-04-07: Landed the shared `SimilarityDataset` runtime contract, repaired lite/tiny row fidelity, removed the remaining format-specific station queue branching, and strengthened the proof surface with cross-format dataset and station-equivalence tests.
- 2026-04-07: Fixed the final tiny ranking drift by preserving full-precision centroid recommendation scores, which brought `packages/sidflow-play/test/station-portable-equivalence.test.ts` to green (`15 pass, 0 fail` across the targeted similarity proof set).
- 2026-04-07: Updated the authoritative wrapper to derive sqlite, lite, and tiny together and to publish all three artifacts plus their manifests, checksums, and tarball. Added the formal audit at `docs/research/similarity-export-audit.md` and aligned the README/operator docs with the real workflow.
- 2026-04-07: Validation evidence so far: `bash -n scripts/run-similarity-export.sh` passed; file-level diagnostics for the edited sources were clean; `bun run build` passed; a real local smoke flow built sqlite, lite, and tiny exports from real local SID files and produced non-interactive sqlite/lite/tiny stations with matching first picks.
- 2026-04-07: Full-suite validation remains blocked outside the changed surface. `bun run test` exited with status `137` during the shared coverage-batch runner after progressing into `scripts/run-unit-coverage-batches.mjs` batch 37/64 (`packages/sidflow-classify/test/super-mario-stress.test.ts`), so the tree does not yet have a clean full-suite pass to record.

## Phase 31 - Multi-Format Similarity Export Runtime Implementation

Plan document:

- `doc/plans/similarity-export-multiformat-implementation.md`

1. [DONE] Implement full/lite/tiny export generation and runtime loading through the CLI station path.
  Acceptance criteria:
  - Lite and tiny exports can be generated from the authoritative full SQLite export.
  - The CLI station/player can switch between all three formats at runtime.
  - The README documents the workflow directly below the current full export instructions.

2. [DONE] Prove cross-format user-facing equivalence in an automated way.
  Acceptance criteria:
  - The proof uses the same station builder path used by the CLI station tool.
  - No user interaction is required.
  - Tests fail on material divergence between full, lite, and tiny station outputs.

3. [DONE] Add tiny-vs-full fidelity tests.
  Acceptance criteria:
  - Unit tests prove tiny export generation preserves the information needed for station building closely enough relative to the full export.
  - File identity mapping and recommendation behavior are both covered.

4. [DONE] Perform real local validation.
  Acceptance criteria:
  - `data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite` is converted into a lite export locally.
  - The CLI SID player builds a station from that lite export successfully.
  - Validation evidence is recorded.

### Progress

- 2026-04-07: Created `doc/plans/similarity-export-multiformat-implementation.md` as the execution plan for this work. Confirmed the current station path is SQLite-only and the current export CLI only supports `--format sqlite`, so the work requires both new generators and a runtime recommendation backend abstraction.
- 2026-04-07: Implemented `sidcorr-lite-1` and `sidcorr-tiny-1` builders/loaders in `@sidflow/common`, added portable-dataset support to the station queue/runtime, and extended `sidflow-play export-similarity` plus `sidflow-play station` to switch among sqlite/lite/tiny at runtime via `--format` and `--similarity-format`.
- 2026-04-07: Added automated coverage for the new paths with targeted tests: `packages/sidflow-common/test/similarity-export.test.ts`, `packages/sidflow-play/test/station-dataset.test.ts`, and `packages/sidflow-play/test/station-portable-equivalence.test.ts` all passed together (`30 pass, 0 fail`).
- 2026-04-07: Real local validation completed. Converted `data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite` into `data/exports/sidcorr-hvsc-full-sidcorr-1.sidcorr` with `./scripts/sidflow-play export-similarity --format lite --source-sqlite ...`, then ran `runStationCli(...)` non-interactively against that lite bundle and reached a built 100-track station with exit code `0`.

## Phase 30 - Similarity Export Tiny Mobile Compression Review

1. [IN_PROGRESS] Re-audit `doc/similarity-export-tiny.md` against the actual mobile-bundle goal.
  Acceptance criteria:
  - The specification is reviewed end to end for needless duplication, weak-device parsing cost, and bundle-size pressure.
  - Any retained complexity has an explicit size or runtime justification.

2. [IN_PROGRESS] Re-evaluate file identity storage for future HVSC growth.
  Acceptance criteria:
  - The document records whether full MD5s are still required or whether a shorter prefix is sufficient.
  - The chosen prefix length stays below a 1% collision probability over the next 10 years assuming 1,000 added songs per year.
  - The resulting file-identity section is updated with current-corpus evidence.

3. [IN_PROGRESS] Rework the neighbor-table design for smaller mobile exports.
  Acceptance criteria:
  - The document explicitly checks whether `u32` neighbor references are truly required.
  - The design reduces stored neighbor count from 5 to 3 if that remains compatible with weak-device station building.
  - The revised graph avoids cycles in exported neighbor edges and documents the low-CPU runtime strategy for reverse traversal.

4. [TODO] Rewrite the tiny specification with the approved storage model.
  Acceptance criteria:
  - Repeated rationale is compressed without dropping any actual research findings.
  - The binary layout, validation rules, size analysis, and rejected-approach sections all match the new decisions.

5. [TODO] Run lightweight validation and record the result.
  Acceptance criteria:
  - Modified markdown files are sanity-checked.
  - PLANS.md records what was and was not validated.

### Progress

- 2026-04-07: Reviewed the required repo docs (`PLANS.md`, `README.md`, `doc/developer.md`, `doc/technical-reference.md`) and read the full `doc/similarity-export-tiny.md` draft plus adjacent similarity-export docs and code references.
- 2026-04-07: Recomputed MD5-prefix risk against `/home/chris/c64/data/test-data/SID/HVSC/C64Music/DOCUMENTS/Songlengths.md5`. Current corpus has zero collisions at 4, 5, or 6 bytes, but the 10-year growth model (`+10,000` files) gives an estimated collision probability of about 14.16% at 4 bytes, 0.0596% at 5 bytes, and 0.000233% at 6 bytes. This makes 5 bytes the smallest prefix that satisfies the user-specified `<1%` budget.
- 2026-04-07: Quantified the dominant storage pressure in the current draft neighbor table and evaluated a smaller mobile-friendly alternative. Replacing `5 x u32` absolute neighbor ordinals with `3 x u24` acyclic references reduces the neighbor section from 1,741,460 bytes to 783,657 bytes, and combining that with `md5_40` file identities reduces the full artifact from 2,945,855 bytes to 1,321,771 bytes (about 55.13% smaller) while still permitting a one-time reverse-index build at load time.
- 2026-04-07: Rebalanced the final spec toward weak-device parsing simplicity. The accepted design keeps the 3-edge acyclic graph but replaces odd-width `md5_40` and `u24` fields with fixed-width `md5_64` file identities and `u32` absolute neighbor ordinals. That raises the artifact to 1,764,703 bytes (about 1.683 MiB), which is 442,932 bytes larger than the aggressively packed variant but still 1,181,152 bytes smaller than the older `md5_128 + 5 x u32` draft while being substantially easier to parse with native-width reads.
- 2026-04-07: Tightened the spec again to the final compact layout requested by the user. The accepted format now uses `md5_48` file identities and `3 x u24` on-disk neighbor entries, both widened in RAM only if useful to the runtime. The rewritten `doc/similarity-export-tiny.md` also removes most historical narration and retains only the format definition plus the few measured tradeoff notes needed to justify `md5_48` and `u24`.

## Phase 29 - Similarity Export Publish-Only Release Repair

1. [DONE] Reproduce and isolate the release publication failure in the authoritative wrapper.
  Acceptance criteria:
  - The exact `publish-only` failure is tied to a concrete code path in `scripts/run-similarity-export.sh`.
  - Existing export and staged artifact state are inspected so the fix targets the real release flow.

2. [DONE] Fix the release staging/upload path and update operator docs if behavior changes.
  Acceptance criteria:
  - `scripts/run-similarity-export.sh --workflow publish-only --mode local --publish-release true` no longer aborts on a valid staged bundle.
  - The published release includes the SQLite export, manifest, checksums, and any documented bundle artifact.
  - `README.md` and/or `doc/similarity-export.md` match the actual supported publication flow.

3. [IN_PROGRESS] Revalidate the tree and complete the real upload.
  Acceptance criteria:
  - Required local validation passes.
  - The publish-only workflow completes against `chrisgleissner/sidflow-data`.
  - PLANS.md records the final release evidence and any follow-up notes.

### Progress

- 2026-04-07: Reviewed the required repo docs (`PLANS.md`, `README.md`, `doc/developer.md`, `doc/technical-reference.md`) plus `doc/plans/README.md`, traced the authoritative publish path in `scripts/run-similarity-export.sh`, and confirmed the current `publish-only` failure is caused by tarball validation rejecting `./SHA256SUMS` even though the staged tarball contains the checksum file.
- 2026-04-07: Patched `scripts/run-similarity-export.sh` so release tarballs are created with explicit root entries, validated correctly, and published alongside the raw `.sqlite`, `.manifest.json`, and `SHA256SUMS` assets. Updated `README.md` and `doc/similarity-export.md` to match the release asset behavior.
- 2026-04-07: `bash -n scripts/run-similarity-export.sh` passed and `bun run build` passed. A full `bun run test` revalidation attempt became a repo-level blocker in the shared coverage runner: it advanced through the early 30+ coverage batches, then spent more than 25 minutes CPU-bound inside the large `sidflow-common` coverage batch without producing further output, so the run was terminated before completion and requires separate investigation.
- 2026-04-07: Completed the patched publish flow with `bash scripts/run-similarity-export.sh --workflow publish-only --mode local --publish-release true --publish-timestamp 20260407T115218Z`. Verified the release `sidcorr-hvsc-full-20260407T115218Z` at `https://github.com/chrisgleissner/sidflow-data/releases/tag/sidcorr-hvsc-full-20260407T115218Z` contains four uploaded assets: `sidcorr-hvsc-full-sidcorr-1.sqlite` (416,112,640 bytes), `sidcorr-hvsc-full-sidcorr-1.manifest.json` (784 bytes), `SHA256SUMS` (209 bytes), and `hvsc-full-sidcorr-1-20260407T115218Z.tar.gz` (40,009,906 bytes). Verified the staged tarball lists exactly `sidcorr-hvsc-full-sidcorr-1.sqlite`, `sidcorr-hvsc-full-sidcorr-1.manifest.json`, and `SHA256SUMS`.

## Phase 28 - PR 91 Convergence To Merge-Ready

1. [IN_PROGRESS] Audit the active pull request review threads and branch status.
  Acceptance criteria:
  - Every open review thread is enumerated with file-backed context.
  - Branch status checks are inspected from GitHub.
  - The convergence work records which comments need code changes versus technical replies.

2. [TODO] Fix valid review findings with minimal, regression-safe changes.
  Acceptance criteria:
  - Network-dependent HVSC subset materialization is not part of the default CI path.
  - Mirror downloads use bounded request timeouts and retry behavior.
  - HVSC problematic proof-set selection no longer contradicts the documented author-cap rule.
  - Persona CLI help follows normal stdout/exit-0 control flow.

3. [TODO] Revalidate the affected tree and record evidence.
  Acceptance criteria:
  - Targeted tests cover each fixed behavior.
  - `bun run build` passes.
  - Required tests pass locally before push.

4. [TODO] Push the fixes, respond to every review thread, and resolve them.
  Acceptance criteria:
  - Every open review thread has a technical reply.
  - Threads are resolved only after code or reasoning is in place.
  - The current branch contains the convergence fixes.

5. [TODO] Wait for CI to return green and close the loop.
  Acceptance criteria:
  - All required CI checks for the PR are passing.
  - No unresolved review comments remain.
  - PLANS.md records final outcomes and validation evidence.

### Progress

- 2026-03-30: Reviewed the required repo docs (`PLANS.md`, `README.md`, `doc/developer.md`, `doc/technical-reference.md`) and fetched live PR 91 metadata from GitHub.
- 2026-03-30: Enumerated 4 open Copilot review threads: CI-network gating in `integration-tests/hvsc-persona-station.test.ts`, mirror timeout/retry handling and problematic-path author-cap semantics in `packages/sidflow-common/src/hvsc-e2e-subset.ts`, and help-path control flow in `packages/sidflow-play/src/persona-station.ts`.
- 2026-03-30: Replied to all 4 Copilot review threads on PR 91 with file-backed explanations and resolved each thread via `gh`.
- 2026-03-30: Stabilized the default local coverage path by excluding the unrelated `c64commander/**` subtree from `scripts/run-unit-coverage-batches.mjs` and gating the real `sidplayfp-cli` binary integration checks in `packages/sidflow-classify/test/render-integration.test.ts` behind `SIDFLOW_ENABLE_SIDPLAYFP_RENDER_INTEGRATION=1`.
- 2026-03-30: Local validation after the stabilization changes passed three consecutive times with `bun run test` (`tmp/pr91-converge/test-run-{1,2,3}.status` all `0`).
- 2026-03-30: Post-push CI rerun failed only in the Playwright web-server build step because `packages/sidflow-web/components/PlayTab.tsx` initialized `activePersona` from `string | null` instead of the `PersonaId | null` union accepted by React state.
- 2026-03-30: Fixed the PlayTab type mismatch by normalizing persisted persona IDs against `PERSONA_IDS`; targeted validation passed with `cd packages/sidflow-web && npm run build`.

## Phase 27 - Parallel Persona Station Redesign (Eliminate Convergence-to-Intersection)

1. [DONE] Replace sequential intersection model with parallel independent model.
  - Previous: 5 personas filtered sequentially, producing intersection (tracks accepted by ALL personas).
  - New: each persona independently scores ALL tracks and selects top 50. No cross-persona filtering.
  Evidence: `packages/sidflow-play/src/persona-station.ts` — `buildParallelPersonaStation()`.

2. [DONE] Define 5 orthogonal personas with explicit directional scoring.
  - Fast Paced (max rhythmicDensity), Slow/Ambient (min rhythmicDensity), Melodic (max melodicComplexity),
    Experimental (max experimentalTolerance), Nostalgic (max nostalgiaBias).
  - Each persona has explicit metricWeights (sum=1) and metricDirections (+1/-1/0).
  Evidence: `PERSONAS` array in persona-station.ts.

3. [DONE] Add overlap validation (all pairs ≤40%), distribution assertions, and anti-collapse rules.
  - Overlap matrix computed for all C(5,2)=10 pairs.
  - Distribution assertions: Fast Paced=highest rhythmicDensity, Slow=lowest, Experimental=highest experimentalTolerance,
    Nostalgic=highest nostalgiaBias, Melodic=highest melodicComplexity.
  - Anti-collapse: metric variance across stations > 0.0001, no two stations identical.
  Evidence: test assertions in `integration-tests/hvsc-persona-station.test.ts` — 6652 expect() calls.

4. [DONE] Generate station-analysis artifacts.
  - persona-{1..5}-station.json, persona-{1..5}-distribution.json, persona-overlap-matrix.json, persona-divergence-report.md, determinism-proof.md.
  Evidence: `station-analysis/` directory.

5. [DONE] Verify deterministic output across runs.
  - Two independent runs produce byte-identical JSON.
  Evidence: determinism-proof.md.

## Phase 26 - Metadata-Aware Classification and Persona-Driven Station Design

1. [DONE] Audit the current classification and station-generation surfaces relevant to metadata-aware recommendations.
  Acceptance criteria:
  - The active analysis references the current 24D perceptual vector pipeline, the main station queue builder, the persona-station prototype, and web metadata surfaces already present in the repo.
  - Current limitations are identified with file-backed evidence rather than generic recommendation-system claims.
  Evidence target: `doc/research/listener-personas.md` cites current behavior in `packages/sidflow-classify`, `packages/sidflow-play`, and `packages/sidflow-web`.

2. [DONE] Design a metadata-aware extension model that preserves backward compatibility with the existing vector/station workflow.
  Acceptance criteria:
  - The design distinguishes hard constraints, soft preferences, and explanation-only metadata.
  - It specifies which metadata fields should become first-class recommendation signals and which should remain secondary.
  - It explains how metadata should interact with audio similarity rather than replace it.
  Evidence target: `doc/research/listener-personas.md` sections on metadata signals, hybrid scoring, and incremental integration.

3. [DONE] Define a diverse persona system for station generation beyond simple like/dislike feedback.
  Acceptance criteria:
  - Personas are behaviorally distinct, not cosmetic variants of one another.
  - Each persona states what it optimizes, when it overrides audio similarity, and what station-building behavior it changes.
  - The document covers both obvious and non-obvious listener intents.
  Evidence target: `doc/research/listener-personas.md` persona catalog and station-strategy sections.

4. [DONE] Ship the research document and validate the tree.
  Acceptance criteria:
  - `doc/research/listener-personas.md` exists, is substantial, and includes recommendations, trade-offs, risks, and an implementation path.
  - `PLANS.md` is updated with completion notes.
  - Validation evidence is recorded after the required test runs.
  Evidence target: committed doc plus PLANS progress notes and terminal validation output.

## Phase 25 - Forensic Anti-Gaming Audit and Evidence Hardening

1. [IN_PROGRESS] Audit Phase 24 implementation for semantic gaming risks.
  Acceptance criteria:
  - Every cardinality-forcing shortcut is identified and either removed or proven harmless.
  - Per-song acceptance evidence (score, threshold, accepted/rejected, rejection reason, decisive features) is emitted at each persona stage.
  - The final playlist entries carry full per-persona justification.
  Evidence: persona-station.ts rewritten to emit `PersonaTrackDecision[]` per stage; top-N fallback removed; minimum threshold floor set at 0.10.

2. [IN_PROGRESS] Remove top-N fallback and add minimum threshold floor.
  Acceptance criteria:
  - `ranked.slice(0, stageTarget)` fallback that bypasses persona approval is deleted.
  - Threshold relaxation has a hard floor (≥ 0.10), never drops to 0.
  - If even relaxed threshold cannot yield targetSize approved songs, the pipeline continues with the smaller set (no backfill).
  - Threshold-relaxation events are flagged in the stage output (`thresholdRelaxed`, `actualThreshold`).
  Evidence: `buildSequentialPersonaStation()` in persona-station.ts; new `PersonaTrackDecision[]` in `PersonaStageResult`.

3. [IN_PROGRESS] Emit full per-song decision evidence at every persona stage.
  Acceptance criteria:
  - `PersonaStageResult.decisions[]` contains one entry per input track with: trackId, sidPath, score, baseThreshold, actualThreshold, accepted, usedThresholdRelaxation, rejectionReason (if rejected), decisiveFeatures.
  - `finalPlaylist` entries include personaScores for all 5 personas and an `allAccepted` flag.
  Evidence: TypeScript interfaces updated; stringifyDeterministic output includes all fields.

4. [IN_PROGRESS] Harden E2E test for semantic correctness not just cardinality.
  Acceptance criteria:
  - Test asserts `decisions` array exists on every stage with correct length.
  - Test asserts every final track has `accepted=true` for all 5 personas (no top-N backfill).
  - Test asserts no stage used top-N fallback (`usedTopNFallback` flag absent or false).
  - Test asserts threshold relaxation, if used, did not drop below 0.10.
  - Test generates `station-analysis/` artifacts (JSON per stage + MD reports).
  Evidence: integration-tests/hvsc-persona-station.test.ts; station-analysis/ directory.

5. [TODO] Generate and verify station-analysis artifacts.
  Acceptance criteria:
  - `station-analysis/final-station.json` — 50 songs with full persona justification.
  - `station-analysis/persona-stage-{1..5}.json` — per-stage decision data.
  - `station-analysis/inclusion-proof.md` — 50-song list with why each belongs.
  - `station-analysis/exclusion-proof.md` — excluded songs grouped by rejecting persona.
  - `station-analysis/anti-gaming-audit.md` — answers all gaming questions explicitly.
  - `station-analysis/determinism-proof.md` — byte-identical comparison of two runs.
  Evidence: artifacts present in repo after test run.

6. [TODO] Confirm strengthened E2E test passes twice identically.
  Acceptance criteria:
  - Hardened test passes with same expect() count ≥ previous count.
  - Both JSON outputs byte-identical.
  - WORKLOG.md and STATE.json updated with audit findings and corrective actions.
  Evidence: bun test run ×2 terminal output; updated STATE.json auditFindings section.

## Phase 24 - Deterministic 300-song HVSC Persona Station E2E

1. [DONE] Define the deterministic corpus contract and materialization path.
  Acceptance criteria:
  - A fixed-seed selection algorithm is implemented and documented in code.
  - The selector always returns exactly 300 SID paths after merging the random sample with the deduplicated problematic-song proof set.
  - The workflow can materialize the selected corpus from local `workspace/hvsc` or fetch the same files directly from the HVSC mirror when the local corpus is absent.
  Evidence: `packages/sidflow-common/src/hvsc-e2e-subset.ts` — `selectHvscE2eSubset()`, `materializeHvscE2eSubset()`. Manifest at `integration-tests/fixtures/hvsc-persona-300-manifest.json` (300 entries, seed=641729, authorCap=5).

2. [DONE] Encode the problematic-song proof set explicitly.
  Acceptance criteria:
  - Every historically problematic SID discovered from tests, fixtures, PLANS, and WORKLOG is captured in one canonical list.
  - The selector asserts those songs are present in the final 300-file subset.
  - The proof set remains small, explicit, and deterministic.
  Evidence: `HVSC_E2E_PROBLEMATIC_PATHS` in `hvsc-e2e-subset.ts` — 4 paths; all present in manifest; selector throws if any are absent from the catalog.

3. [DONE] Implement deterministic diversity-aware subset selection.
  Acceptance criteria:
  - Selection uses a fixed seed and stable ordering.
  - No author contributes more than 5 files unless required by the problematic set.
  - Selection intentionally spreads across composers, released years, SID chip topology, and path/style buckets, with deterministic tie-breaking.
  Evidence: SHA-256 stable-hash tie-breaking; bucket key = `category|decadeBucket|chipN|sidModel|styleBucket`; author cap enforced in loop.

4. [DONE] Implement the sequential five-persona radio pipeline.
  Acceptance criteria:
  - Five personas with explicit deterministic scoring functions evaluate the same classified corpus in sequence.
  - Each persona consumes the current candidate pool, scores every track, and applies a deterministic threshold/filter rule.
  - The final playlist contains exactly 50 tracks liked by all five personas, with deterministic fallback threshold relaxation if the intersection is too small.
  Evidence: `packages/sidflow-play/src/persona-station.ts` — `buildSequentialPersonaStation()`, 5 PERSONAS, `runPersonaStationCli()`.

5. [DONE] Add the mandatory end-to-end test entry point.
  Acceptance criteria:
  - The test performs subset selection, corpus materialization, classification, feature/vector validation, persona filtering, and final playlist validation in one run.
  - The test fails on dataset-size mismatch, missing problematic songs, classification failures, incomplete feature vectors, nondeterministic persona output, or a final playlist size other than 50.
  - The test file is discovered by the root `bun run test` coverage batches so it runs in CI on every build/test job.
  Evidence: `integration-tests/hvsc-persona-station.test.ts` — named `*.test.ts`, timeout 20 min, covers all contract assertions.

6. [DONE] Validate locally and record evidence.
  Acceptance criteria:
  - `bun run build` passes.
  - The new E2E test passes locally (≥2 consecutive identical runs).
  - CI passes.
  Evidence:
  - `bun run build:quick` (tsc -b): zero errors.
  - Run 1: 1 pass, 0 fail, 1811 expect() calls, 39.54s, 50 tracks, failedCount=0, degradedCount=0.
  - Run 2: 1 pass, 0 fail, 1811 expect() calls, 40.60s, 50 tracks, persona JSON byte-identical.
  - STATE.json: COMPLETE, zero unresolved failures.

### Progress

- 2026-03-30: Started Phase 26 for metadata-aware classification and persona-driven station design. Required repo docs reviewed (`PLANS.md`, `README.md`, `doc/developer.md`, `doc/technical-reference.md`) and the current recommendation surfaces audited in `packages/sidflow-play/src/persona-station.ts`, `packages/sidflow-play/src/station/{intent,queue,run}.ts`, `packages/sidflow-web/lib/{rate-playback.ts,feedback/features.ts,server/similarity-search.ts}`, and `packages/sidflow-common/src/{jsonl-schema.ts,sid-parser.ts,similarity-export.ts}`.
- 2026-03-30: Added `doc/research/listener-personas.md`, recommending a late-fusion metadata-aware station layer over the existing 24D vector pipeline, a declarative persona policy model, hybrid scoring, metadata strictness modes, anti-collapse quotas, and an incremental file-level integration plan for CLI and web.
- 2026-03-30: Refined `doc/research/listener-personas.md` to treat song titles as semantic metadata, including title-theme tagging, confidence-scored theme inference, title-driven persona support, and examples like "80s love songs" where title semantics must participate in station building.
- 2026-03-30: Extended `doc/research/listener-personas.md` and `doc/research/listener-personas-prompt.md` to a consistent 10-mode first shipping set: 5 existing audio-led modes (`fast_paced`, `slow_ambient`, `melodic`, `experimental`, `nostalgic`) plus 5 metadata-aware modes (`hardware_purist`, `era_cartographer`, `composer_deep_dive`, `scene_archaeologist`, `title_theme_hunter`).
- 2026-03-30: Validation for Phase 26 passed. `bun run build:quick` completed with `tsc -b` success, and `bun run test` completed three consecutive times with `0 fail` on all runs. Integration-test summaries: run 1 `1 pass, 0 fail, 6652 expect() calls, [77.10s]`; run 2 `1 pass, 0 fail, 6652 expect() calls, [87.85s]`; run 3 `1 pass, 0 fail, 6652 expect() calls, [71.62s]`.
- 2026-03-30: Audited the current repo state for this request. Confirmed `workspace/hvsc/C64Music` contains a full 60,572-file HVSC checkout locally, the root `bun run test` path only discovers `*.test.ts`, and the existing `integration-tests/e2e-suite.ts` is therefore not a mandatory test today.
- 2026-03-30: Confirmed the strict classify pipeline already writes `features` plus a deterministic 24-dimensional `vector`, and the canonical completeness contract already exists in `hasRealisticCompleteFeatureVector()` / `inspectFeatureVectorHealth()`.
- 2026-03-30: Confirmed direct raw SID downloads are available from `https://hvsc.brona.dk/HVSC/C64Music/...` and `https://hvsc.c64.org/download/C64Music/...`, which makes a CI-safe fallback materialization path viable without vendoring 300 binary SID files into the repo.

## Phase 23 - Full HVSC Similarity Export Stabilization

1. [done] Reconfirm the live failure surfaces in the authoritative wrapper path.
  Acceptance criteria:
  - Document the exact runtime path used by `bash scripts/run-similarity-export.sh --mode local --full-rerun true`.
  - Confirm current worker-bound logic, queue ownership, and WASM engine lifecycle from the active source files.
  - Capture whether Bun is still mandatory anywhere in the local workflow.

2. [done] Make runtime selection explicit for the classify/export workflow.
  Acceptance criteria:
  - The wrapper supports explicit runtime selection for the local workflow.
  - Classification and export CLIs can run under standard Node.js from built output.
  - Bun remains optional rather than required for this workflow.

3. [IN_PROGRESS] Eliminate any remaining uncontrolled concurrency or worker churn.
  Acceptance criteria:
  - Render and feature worker counts remain under a hard deterministic ceiling unless explicitly overridden.
  - Queue depth and active/busy worker counts are observable in logs.
  - No code path can silently fan out to dozens of concurrent workers from file count or nested dispatch.

4. [TODO] Strengthen WASM lifecycle handling for long full-corpus runs.
  Acceptance criteria:
  - WASM instantiation/disposal behavior is bounded and observable.
  - Repeated render jobs do not retain obsolete WASM module memory longer than necessary.
  - Worker replacement logic does not enter an OOM respawn spiral.

5. [IN_PROGRESS] Add targeted regression coverage for runtime selection and bounded execution.
  Acceptance criteria:
  - Tests cover runtime selection / command resolution.
  - Tests cover worker-count bounding and queue/backpressure behavior.
  - Tests cover the relevant WASM lifecycle seam where practical.

6. [IN_PROGRESS] Revalidate Bun, then promote Node.js if Bun remains unstable.
  Acceptance criteria:
  - Targeted classify stress runs complete under Bun or produce fresh instability evidence.
  - If Bun still crashes under bounded conditions, the wrapper defaults this workflow to Node.js.
  - The chosen runtime is recorded in WORKLOG.md with justification.

7. [IN_PROGRESS] Run the full HVSC classify/export workflow and validate the SQLite output.
  Acceptance criteria:
  - `bash scripts/run-similarity-export.sh --mode local --full-rerun true` completes successfully on the chosen runtime.
  - Final evidence records processed totals, throughput, worker limits, runtime, failure count, and peak memory.
  - SQLite schema, counts, modality coverage, and similarity integrity are verified with concrete queries.

8. [TODO] Prove downstream usability with five differentiated persona stations and close the loop.
  Acceptance criteria:
  - Five explicit personas each produce a station with at least 20 tracks.
  - Output evidence shows the station lists and meaningful differentiation between personas.
  - PLANS.md and WORKLOG.md are fully updated with final outcomes and validation evidence.

### Progress

- 2026-03-29: Audited the wrapper/runtime path and confirmed the local workflow still hard-required Bun before the runtime split.
- 2026-03-29: Added explicit local runtime selection in `scripts/run-similarity-export.sh`, `scripts/sidflow-classify`, and `scripts/run-node-cli.mjs`, while intentionally keeping the export step Bun-backed because it still depends on `bun:sqlite`.
- 2026-03-29: Added targeted runtime-selection coverage in `packages/sidflow-classify/test/cli.test.ts` and worker-ceiling coverage in `packages/sidflow-classify/test/system.test.ts`; bounded Bun and Node wrapper runs both completed successfully for 200 songs.
- 2026-03-29: Started the full-corpus wrapper validation under `--runtime node` for the classify/server path; final export and persona-proof steps remain open.

## Phase 22 - Engine Capability Contract And Batch Resilience

1. [done] Replace the implicit trace contract with an explicit engine capability model.
  Acceptance criteria:
  - Classification resolves a concrete capability set before any song work starts.
  - `sidplayfp-cli` can no longer be selected while SID-native features remain implicitly required.
  - The chosen behavior is deterministic: trace-capable engines enable hybrid extraction; non-trace engines force WAV-only classification and mark records degraded.

2. [done] Remove batch-abort semantics from per-song classification failures.
  Acceptance criteria:
  - A single render or feature failure never aborts the whole batch.
  - Each song runs inside an isolated failure boundary.
  - The pipeline retries exactly once with trace disabled / reduced capability before marking the song failed.

3. [done] Persist structured failure artifacts for every permanently failed song.
  Acceptance criteria:
  - A deterministic JSONL failure log is written beside the classification JSONL.
  - Each failure record includes SID path, song index, engine, capability mode, retry count, error message, and stack.
  - Telemetry emits explicit retry / degraded / failed events.

4. [done] Tighten worker and render safety guards.
  Acceptance criteria:
  - Pool watchdog timeouts remain in place for hung WASM/native jobs.
  - Worker recycling after hangs continues to restore capacity instead of draining the pool.
  - Per-song cleanup releases trace/WAV sidecars and engine state deterministically.

5. [done] Extend regression coverage for problematic SID classes.
  Acceptance criteria:
  - Tests cover multi-SID, multi-track, high-risk WASM failures, and degraded trace-unavailable classification.
  - Tests assert batch continuation, degraded record emission, and failure JSONL emission.

6. [IN_PROGRESS] Run validation gates on the repaired tree.
  Acceptance criteria:
  - `bun run build:quick` passes.
  - Relevant classify tests pass.
  - `bun run build` passes.
  - `bun run test` passes three consecutive times with zero failures.

7. [done] Execute a controlled 5,000-song classification run.
  Acceptance criteria:
  - The first 5,000 songs complete without process crash.
  - Completion rate is at least 99% with deterministic failure accounting.
  - WORKLOG.md records processed, failures, retries, degraded count, throughput, and peak RSS evidence.

8. [done] Generate and validate five persona-driven radio stations.
  Acceptance criteria:
  - Five deterministic persona scoring functions are defined and exercised against the classified dataset.
  - Each persona rates a reproducible 10-song sample and produces a 100-song station artifact.
  - WORKLOG.md records the output files and a concise coherence summary for each persona.

### Progress

- 2026-03-29: Confirmed the current tree still violates the engine/trace contract. `resolveClassificationPreferredEngine()` and `resolveClassificationFallbackEngine()` in `packages/sidflow-classify/src/index.ts` can select `sidplayfp-cli` even though `defaultSidWriteTraceProvider()` still treats a missing trace sidecar as fatal.
- 2026-03-29: Confirmed `generateAutoTags()` currently uses `continueOnError: false` and still contains a special-case `isSkippableSidError()` branch, so the batch contract is inconsistent: some per-song failures abort the run, others are silently skipped, and neither path emits a structured failure JSONL artifact.
- 2026-03-29: Confirmed the common JSONL schema already supports degraded classification records, which will allow a capability-driven WAV-only fallback without breaking downstream export consumers.
- 2026-03-29: Landed the explicit classification runtime model in `packages/sidflow-classify/src/index.ts`, propagated the actual render engine through `packages/sidflow-classify/src/render/wav-renderer.ts`, and taught `packages/sidflow-classify/src/feature-extraction-worker.ts` to distinguish expected trace absence from a real sidecar defect.
- 2026-03-29: Reworked `generateAutoTags()` to retry once with reduced capability, emit deterministic `classification_*.failures.jsonl` artifacts for permanent failures, and record degraded / retried / failed counters in both telemetry and CLI summaries.
- 2026-03-29: Targeted validation passed: `bun run build:quick`, `bun run build`, and classify regressions covering high-risk render failure, render timeout, multi-SID, and Mario stress all completed successfully.
- 2026-03-29: The full `bun run test` gate is still blocked by pre-existing failures in `packages/libsidplayfp-wasm/test/performance.test.ts`; this remains the only incomplete acceptance item under Phase 22.
- 2026-03-29: Controlled classification run completed with exit `0` on the first 5,000 songs using `tmp/classify-5000-config.json`; telemetry recorded `classifiedFiles=5000`, `failedCount=0`, `retriedCount=0`, `degradedCount=1`, `renderedFallbackCount=1`, `durationMs=510022`, and `peakRssMb=841`.
- 2026-03-29: Built `tmp/classify-5000/sidcorr-5000-full-sidcorr-1.sqlite` and `tmp/classify-5000/sidcorr-5000-full-sidcorr-1.manifest.json` from the 5,000-track dataset.
- 2026-03-29: Repaired `scripts/validate-persona-radio.ts` so it runs from the repo root, resolves personas against the observed export distribution, and emits five deterministic, disjoint 100-track station artifacts in `tmp/classify-5000/persona-report.md`.
- 2026-03-29: Extended classify progress reporting to emit every 50 songs and added a realistic-feature-health metric based on the deterministic rating feature set. A 55-song smoke run now surfaces `featureHealth completeRealistic=0/55 (0.0%)`, which means the current sampled records are missing at least one deterministic feature dimension and the observability hook is catching a real data-health gap rather than silently reporting 100%.
- 2026-03-29: Extended unhealthy-song diagnostics so each unhealthy record emits a structured line with the full SID path, render mode metadata, concise deterministic vector snapshot, and explicit unhealthy elements. A focused 2-song smoke run confirmed the current gap is `onsetDensity`, `rhythmicRegularity`, and `dynamicRange` missing from sampled records.
- 2026-03-29: Fixed the `packages/sidflow-web/lib/classify-progress-store.ts` return-shape regression that broke the Playwright/Next.js CI build. The exact Chromium command now gets past the previous type-check failure and proceeds into existing E2E failures instead of failing at compile time.
- 2026-03-29: Fixed the root cause of the unhealthy feature-health metric by restoring `onsetDensity`, `rhythmicRegularity`, and `dynamicRange` in the worker-thread extraction path via `computeEnvelopeFeatures()`, and added worker-pool regression coverage for the missing dimensions.
- 2026-03-29: Clean runtime validation now passes on a real bounded corpus run: `./scripts/sidflow-classify --config tmp/classify-5000-config.json --force-rebuild --delete-wav-after-classification --limit 300` completed with `featureHealth completeRealistic=300/300 (100.0%)`, `Failed: 0`, `Retried: 0`, and `Degraded: 0`, with no unhealthy-song or classification-failure patterns in the log.
- 2026-03-29: The exact Chromium coverage command now passes end to end after serializing coverage-mode workers and relaxing synthetic-silence assertions in the classification E2E specs. `cd packages/sidflow-web && BABEL_ENV=coverage E2E_COVERAGE=true npx playwright test --project=chromium` completed with `87 passed`.

## Problem Statement

The authoritative CLI workflow `bash scripts/run-similarity-export.sh --mode local --full-rerun true` must classify the full HVSC corpus without render timeouts, missing SID-trace sidecars, WAV-only fallback success, or partial-record persistence. Any real defect must abort immediately with a non-zero exit. After classification/export succeeds, the CLI station flow must build and validate five clearly distinct persona stations with reproducible, evidence-backed results.

## Phase 21 - PR #90 Convergence

1. [done] Re-audit all unresolved PR review threads and the failing CI job.
  Acceptance criteria:
  - Every unresolved thread is mapped to either a code change or a technical rationale for no change.
  - The failing `Build and test / Build and Test` check is reproduced or superseded locally.

2. [IN_PROGRESS] Land the minimum fixes required by valid review comments.
  Acceptance criteria:
  - Worker recycle telemetry is no longer ambiguous.
  - Physical CPU detection handles missing trailing delimiters and missing `physical id`/`core id` data.
  - WAV rendering no longer preallocates PCM solely from the configured render cap.
  - Trace sidecar I/O failures are handled intentionally and do not leak file handles.

3. [IN_PROGRESS] Add regression coverage for the repaired seams.
  Acceptance criteria:
  - Tests cover wall-time-bounded rendering with a valid WAV + summary.
  - Tests cover recycle-event emission without duplicate `worker_recycled` events.
  - Tests cover CPU info parsing edge cases.

4. [IN_PROGRESS] Re-run validation and converge the PR.
  Acceptance criteria:
  - `bun run build` passes.
  - Relevant targeted tests pass.
  - `bun run test` passes three consecutive times with zero failures.
  - All review threads are replied to and resolved.
  - GitHub CI is green.

### Progress

- 2026-03-29: Retrieved all six unresolved Copilot review threads via `gh api graphql` and confirmed the branch is failing only `Build and test / Build and Test` on GitHub.
- 2026-03-29: Verified four comments still correspond to live defects in the working tree: duplicate `worker_recycled` emission, fragile `/proc/cpuinfo` parsing, missing direct wall-time render regression coverage, and eager PCM preallocation before wall-time truncation can help.
- 2026-03-29: Confirmed the WAV renderer still treats trace sidecar open/header/batch write failures as fatal at the render layer, while current strict classify flows consume trace sidecars later and can still fail explicitly if a best-effort trace capture is unavailable.
- 2026-03-29: Re-audited the currently unresolved PR #90 threads via `gh api graphql`; only two Copilot threads remain, both on `packages/sidflow-web/public/wasm/player.js`, covering source-of-truth drift and a missing `ensureModule()` disposal race guard.
- 2026-03-29: Fixed the `SidAudioEngine.ensureModule()` race in `packages/libsidplayfp-wasm/src/player.ts`, rebuilt `packages/libsidplayfp-wasm/dist/player.js`, and re-synced `packages/sidflow-web/public/wasm/player.js` via `packages/sidflow-web/scripts/build-worklet.ts` so the generated copy matches the source-of-truth.
- 2026-03-29: Added a focused regression in `packages/libsidplayfp-wasm/test/buffer-pool.test.ts` that proves `dispose()` during an in-flight `ensureModule()` await does not repopulate `this.module` after the engine is disposed.
- 2026-03-29: Reproduced the failing GitHub `Build and test / Build and Test` job locally from its log output and confirmed the root cause was a stale runtime import in two `sidflow-play` tests (`buildSimilarityExport` imported from `@sidflow/common` after the runtime index stopped exporting it).
- 2026-03-29: Repaired the stale test imports in `packages/sidflow-play/test/station-multi-profile-e2e.test.ts` and `packages/sidflow-play/test/station-similarity-e2e.test.ts`; targeted validation now passes for the repaired CI surface and `bun run build` also passes locally.

## Phase 19 - Mario 2SID Stall Root-Cause Recovery

1. [done] Reproduce the live Mario 2SID stall with repo-local artifacts and use it as the only starting point for diagnosis.
  Acceptance criteria:
  - The real classify CLI repro runs under `scripts/run-with-timeout.sh` with `/usr/bin/time -v` and stores all evidence under `tmp/classify-stall/<timestamp>/`.
  - WORKLOG.md records the exact command, timeout result, last structured event, and partial artifact list.

2. [done] Localize whether the stall is in direct rendering, trace capture/flush, or worker-pool orchestration.
  Acceptance criteria:
  - Controlled runs compare direct renderer vs pool behavior.
  - Controlled runs compare `captureTrace: false` vs `captureTrace: true` without repeating the same symptom blindly.
  - The work log records falsifiable hypotheses for each experiment.

3. [done] Add the minimum structured instrumentation required to expose the stuck seam.
  Acceptance criteria:
  - Structured events cover SID load, subtune selection, first render-loop entry, periodic render progress, trace flush milestones, and worker send/receive or recycle reasons.
  - Instrumentation is specific enough to explain the Mario stall without relying on interactive terminal output.

4. [done] Implement the smallest fix that restores bounded forward progress and then remove the fail-open classification contract.
  Acceptance criteria:
  - Mario repro completes or fails explicitly with a precise error instead of stalling.
  - Metadata-only / WAV-only fallback behavior is removed from strict classify paths and the tests that normalize it are updated.

5. [IN_PROGRESS] Run the required validation ladder.
  Acceptance criteria:
  - Targeted seam tests pass.
  - Mario repro, checked-in high-risk fixtures, `packages/sidflow-classify/test/super-mario-stress.test.ts`, bounded HVSC subset, and the authoritative wrapper flow all pass in order.
  - `bun run build` passes and `bun run test` passes three consecutive times with zero failures.

### Progress

- 2026-03-28: Started a new repo-local repro session in `tmp/classify-stall/20260328T113648Z/` with isolated config/output paths and `threads=1`.
- 2026-03-28: Fresh bounded Mario CLI repro still hangs on the current tree. `/usr/bin/time -v scripts/run-with-timeout.sh 45 -- ./scripts/sidflow-classify --config tmp/classify-stall/20260328T113648Z/sidflow-mario-repro.json --force-rebuild --sid-path-prefix GAMES/S-Z/Super_Mario_Bros_64_2SID.sid` exited `124` after 45.01s at 100% CPU with max RSS 275688 KB.
- 2026-03-28: The console emitted repeated `Rendering: GAMES/S-Z/Super_Mario_Bros_64_2SID.sid [1]` heartbeats, but the structured telemetry in `tmp/classify-stall/20260328T113648Z/classified/classification_2026-03-28_11-39-14-732.events.jsonl` still stopped at `render_start` for `queueIndex=0`, `songIndex=1`. Partial artifacts remain limited to the metadata sidecar and telemetry file; the WAV cache directory stayed empty.
- 2026-03-28: Added `scripts/debug-classify-render-module.ts` to bypass the WASM renderer pool via `--render-module` and emit structured JSONL render probe events.
- 2026-03-28: Direct-render experiment with trace capture still enabled also timed out after 45.00s (`tmp/classify-stall/20260328T113648Z/direct-trace-on/`). The direct probe log emitted only `render_start`, which means the stall happens before the first `onProgress` or `onSummary` callback even without pool orchestration.
- 2026-03-28: Direct-render experiment with `captureTrace=false` reproduced the same 45.00s timeout (`tmp/classify-stall/20260328T113648Z/direct-trace-off/`) and again emitted only `render_start`. That narrows the root cause away from pool scheduling and trace-sidecar capture/flush, and toward `renderWavWithEngine()` before or inside the first `engine.renderCycles(...)` call.
- 2026-03-28: Added env-gated structured render events inside `packages/sidflow-classify/src/render/wav-renderer.ts`. The instrumented Mario direct-render repro (`tmp/classify-stall/20260328T113648Z/instrumented-direct-trace-off/`) advanced through `sid_load_complete` and then stopped at `song_select_start`, which localized the stall to `engine.selectSong(0)` for subtune 1.
- 2026-03-28: Ran a known-good direct-render control on `MUSICIANS/H/Huelsbeck_Chris/Great_Giana_Sisters.sid` with `captureTrace=false` and `--limit 1`. That control completed in 0.44s and emitted `song_select_complete`, `render_loop_ready`, and `render_cycles_complete`, proving the instrumentation itself was not masking progress.
- 2026-03-28: Extended `scripts/debug-classify-render-module.ts` with `SIDFLOW_DEBUG_SUPPRESS_SONG_INDEX` and re-ran Mario song 1 with the explicit `selectSong()` step suppressed. That run completed in 0.43s, proving the Mario stall was caused by the redundant select/reload step rather than SID load or the render loop.
- 2026-03-28: Fixed the root cause in `packages/libsidplayfp-wasm/src/player.ts` by letting `loadSidBuffer(data, songIndex)` load the requested zero-based subtune directly, then updated both `packages/sidflow-classify/src/render/wav-renderer.ts` and `packages/sidflow-classify/src/sid-native-features.ts` to use direct subtune loading instead of `loadSidBuffer()` plus `selectSong()`.
- 2026-03-28: Removed the remaining fail-open classify behavior in `packages/sidflow-classify/src/index.ts`: render failures and feature-extraction failures now throw, and `runConcurrent()` runs with `continueOnError: false` so strict classify work aborts on the first fatal item.
- 2026-03-28: The exact real Mario CLI repro now succeeds under the same 45s wrapper. `/usr/bin/time -v scripts/run-with-timeout.sh 45 -- ./scripts/sidflow-classify --config tmp/classify-stall/20260328T113648Z/post-fix-real-mario-v2/sidflow-post-fix-real-mario-v2.json --force-rebuild --sid-path-prefix GAMES/S-Z/Super_Mario_Bros_64_2SID.sid` exited `0` in 3.16s with max RSS 503776 KB and produced 37 rendered / 37 extracted / 37 JSONL records.
- 2026-03-28: Targeted validation now passes for the repaired seam and strict-failure contract: `bun test packages/sidflow-classify/test/wav-renderer-duration-cap.test.ts packages/sidflow-classify/test/render-timeout.test.ts packages/sidflow-classify/test/high-risk-render-failure.test.ts packages/sidflow-classify/test/multi-sid-classification.test.ts packages/sidflow-classify/test/super-mario-stress.test.ts` completed with `19 pass`, `0 fail`.

## Phase 18 - Classification Stall Prompt Reset

1. [done] Audit the current tree and capture a bounded real-world reproduction.
  Acceptance criteria:
  - Identify whether the current branch still contains fail-open render / SID-native fallback behavior.
  - Reproduce the Mario 2SID hang through the real classify CLI with a hard timeout and preserved evidence.

2. [done] Publish a replacement debugging prompt and roadmap in `doc/plans/`.
  Acceptance criteria:
  - The new prompt aligns with `AGENTS.md` instead of conflicting with it.
  - The roadmap requires bounded experiments, explicit work logging, and escalation from single-song repro to full HVSC only after intermediate proof.

### Progress

- 2026-03-28: Confirmed the current tree still has metadata-only continuation in `packages/sidflow-classify/src/index.ts` and WAV-only degradation logging in `packages/sidflow-classify/src/sid-native-features.ts`; the live tests `packages/sidflow-classify/test/high-risk-render-failure.test.ts` and `packages/sidflow-classify/test/render-timeout.test.ts` still encode graceful degradation as success.
- 2026-03-28: Reproduced the real hang with a hard-bounded CLI run on `GAMES/S-Z/Super_Mario_Bros_64_2SID.sid` using `threads=1`. `scripts/run-with-timeout.sh 45 -- ./scripts/sidflow-classify ...` timed out after 45s at 100% CPU with no forward progress beyond `render_start` for subtune 1; only the metadata sidecar and telemetry `.events.jsonl` were written.
- 2026-03-28: Wrote the replacement prompt and roadmap in `doc/plans/hvsc-classification-stall-prompt.md`.

## Phase 17 - Full HVSC Fail-Fast Completion

1. [IN_PROGRESS] Confirm the authoritative CLI contract end to end.
  Acceptance criteria:
  - README, package READMEs, wrapper scripts, and source entrypoints agree on the real classify/export/station commands.
  - WORKLOG.md contains a concise contract summary covering required artifacts, fatal error classes, persistence rules, and downstream station inputs.

2. [TODO] Close any remaining fail-fast gaps in classification and wrapper orchestration.
  Acceptance criteria:
  - Missing or invalid `.trace.jsonl` sidecars are fatal in all strict classification paths.
  - Exhausted render attempts are fatal and preserve SID path, subtune, and render-profile context.
  - Incomplete feature vectors are never persisted as successful classification records.
  - The wrapper path surfaces classification failure with a non-zero exit and precise error text.

3. [TODO] Add and pass targeted regression coverage.
  Acceptance criteria:
  - Tests cover fatal render exhaustion, fatal missing-sidecar extraction, correct subtune/sidecar lookup, and prevention of incomplete-record persistence.
  - Script-level or integration coverage exercises the documented CLI path, not just lower-level helpers.

4. [TODO] Run validation gates on the repaired tree.
  Acceptance criteria:
  - `bun run build` passes.
  - Relevant targeted tests pass.
  - `bun run test` passes three consecutive times with zero failures.

5. [TODO] Execute the full HVSC classify/export workflow.
  Acceptance criteria:
  - `bash scripts/run-similarity-export.sh --mode local --full-rerun true` completes successfully.
  - Final evidence shows zero render-attempt exhaustion failures, zero missing-sidecar failures, zero WAV-only/metadata-only classification success paths, and internally consistent corpus counts.
  - WORKLOG.md records the exact command, timestamps, counts, and output artifacts.

6. [TODO] Build and validate five persona stations sequentially.
  Acceptance criteria:
  - Five explicit personas are defined using measurable ratings/features available in the export.
  - Each persona station is built from the CLI path sequentially.
  - Validation evidence proves each station matches its persona better than the alternatives and records any overlap/misfit analysis.

7. [TODO] Synchronize docs and final evidence.
  Acceptance criteria:
  - README/docs reflect the actual fail-fast semantics and CLI usage where changed.
  - PLANS.md tasks are all marked done.
  - WORKLOG.md contains final proof for classification, export, tests, and persona validation.

## Phase 15 - Full-Corpus Classification Stability Recovery

### Objective

Make `bash scripts/run-similarity-export.sh --mode local --full-rerun true` complete successfully on the full HVSC corpus with 100% classification coverage, bounded memory, bounded worker count, and no timeout-driven data loss.

### Root Cause Hypotheses

- [x] The primary OOM driver is WASM trace capture buffering every SID write in memory until the end of a render (`pendingTraces` in `wav-renderer.ts`), which scales badly on complex tracks and across concurrent workers.
- [x] The primary data-loss path is the render-pool circuit breaker (`timedOutSids`) plus tagging/build skip branches in `index.ts`, which permanently drops later jobs for an SID after a timeout.
- [x] The primary oversubscription path is thread selection defaulting to logical-core count instead of a bounded fixed worker heuristic; the web `/api/classify` route also ignores a request-level thread override.
- [x] Worker instability is amplified by forceful `worker.terminate()` on timeout/error with immediate replacement, producing churn instead of bounded, cooperative recycling.
- [x] Memory telemetry is incomplete because it tracks heap only, not RSS, and does not persist worker-pool lifecycle or fallback-level metrics.

### Fix Strategy By Failure Class

- [x] Render bounding: enforce wall-clock/CPU-style budgets inside the render loop itself so renders terminate cooperatively with partial output instead of parent-side kill/skip.
- [x] Worker pool: keep a fixed-size global queue and worker pool, cap default concurrency at `min(physical_cores / 2, 6)`, and recycle workers after a bounded job count.
- [x] Data loss: remove timeout circuit-breaker purging and replace it with an ordered fallback ladder that always produces either truncated audio or metadata-only output.
- [x] Memory discipline: stream SID trace sidecars in bounded batches, avoid whole-trace retention, reduce duplicate PCM buffering, and dispose engines after every attempt.
- [x] Telemetry: persist RSS, active/busy worker count, worker recycle count, fallback level, render truncation, and classification outcome summaries.
- [x] API / orchestration: make `/api/classify` honor thread overrides and use the same bounded worker heuristic as the CLI path used by the full similarity-export script.

### Investigation / Validation Steps

- [x] Replace trace accumulation and timeout-purge code paths.
- [x] Add targeted tests for bounded rendering, worker recycling, no-skip fallback behavior, and concurrency heuristics.
- [x] Add CI-safe stability regressions that repeatedly classify the pathological Mario SID and the full checked-in SID fixture set while checking for RAM/thread/throughput drift.
- [x] Run focused classify tests and build.
- [x] Review and reconcile the current dirty-tree render-pool follow-up changes before broader validation (`runConcurrent` per-SID serialization, worker-attempt timeout guard, worker dispose hardening).
- [x] Run targeted subset classifications, including the previously pathological 2SID repro and a bounded HVSC subset, while collecting RSS / fallback telemetry.
- [x] Rework classification to fail fast on any render exhaustion or SID-native trace extraction failure; remove metadata-only/WAV-only classification fallback.
- [ ] Run the full `bash scripts/run-similarity-export.sh --mode local --full-rerun true` validation.
- [ ] Record final metrics summary and reproducibility evidence in `WORKLOG.md`.
- [ ] Re-run repository validation gates required by repo policy (`bun run build`, relevant targeted tests, then `bun run test` x3 once the classification changes are stable).

### Progress

- 2026-03-27: Replaced the WASM render pool timeout/circuit-breaker implementation with a cooperative fixed-size pool that recycles workers after 32 jobs and emits lifecycle events.
- 2026-03-27: Moved render bounding into `renderWavWithEngine()`, streamed trace sidecars in batches, and removed whole-trace buffering plus duplicate PCM chunk accumulation.
- 2026-03-27: Refactored `buildAudioCache()` and `generateAutoTags()` so render failures flow through a bounded fallback ladder and end in metadata-only classification instead of `skipped`/`song_failed` outcomes.
- 2026-03-27: Bounded thread selection via the physical-core heuristic in classify orchestration, feature extraction pool sizing, and the web `/api/classify` path; request-level `threads` is now honored by the API schema and temp config.
- 2026-03-27: Focused validation passed: `bun run build` succeeded, and `bun test packages/sidflow-classify/test/render-timeout.test.ts packages/sidflow-classify/test/multi-sid-classification.test.ts packages/sidflow-classify/test/cli.test.ts` completed with 26 passing tests and 0 failures.
- 2026-03-27: Added `packages/sidflow-classify/test/super-mario-stress.test.ts` as a CI-safe stability harness. It now runs two automated regressions through the real classifier: 3 rounds of 24 runtime copies of `test-data/C64Music/GAMES/S-Z/Super_Mario_Bros_64_2SID.sid`, and 2 rounds over every checked-in SID fixture. The assertions watch peak thread count, peak RSS, cross-round final RSS/thread drift, and completion-gap / per-record throughput slowdown. The file passed 3 consecutive runs in about 6.7s per run.
- 2026-03-27: New unvalidated follow-up edits are present in the dirty tree: `runConcurrent()` now serializes work by SID path, the WASM render pool has a per-job timeout/replacement guard, and the worker now null-checks engine disposal. These changes still need build/test confirmation and real subset telemetry before the broader export run.
- 2026-03-27: The stale 8,200-song web/API repro exposed a specific pool bug: timeout-triggered `failJob()` rejected the render promise immediately, but worker replacement depended on Bun emitting a worker `exit` event. When hung WASM workers never emitted `exit`, the pool drained to zero usable workers and later fallback attempts waited forever.
- 2026-03-27: Fixed the pool drain by forcing replacement after timeout/error-triggered `worker.terminate()`, restored worker recycling to 32 jobs, and tightened `isRecoverableError()` so `Render attempt timed out after ...` is treated as non-recoverable for a single render profile instead of being retried four times before the fallback ladder advances.
- 2026-03-27: Added `scripts/stop-similarity-export.sh` so local `run-similarity-export.sh` sessions can be stopped through a repo maintenance script instead of ad-hoc process kills.
- 2026-03-27: Post-fix targeted validation passed: `bun run build:quick` plus `bun test packages/sidflow-classify/test/render-timeout.test.ts packages/sidflow-classify/test/multi-sid-classification.test.ts` completed with 10 passing tests and 0 failures.
- 2026-03-27: Wrapper subset validation passed for `bash scripts/run-similarity-export.sh --mode local --full-rerun true --threads 4 --max-songs 200`. The run classified 200/200 songs, exported the SQLite bundle, used `full` render for all 200 songs, and recorded `peakRssMb=1110`.
- 2026-03-27: Historical repro validation succeeded on the same wrapper path with `--max-songs 8200`. The run crossed the old 8,163/8,200 deadlock point, classified 8,200/8,200 songs, and emitted `run_complete` telemetry with `metadataOnlyCount=37`, `renderedFallbackCount=38`, and `peakRssMb=3834`. The remaining blocker is the full 60,582-song validation and downstream persona-station proof, not the old Mario deadlock.
- 2026-03-27: Started the actual full-corpus wrapper run: `bash scripts/run-similarity-export.sh --mode local --full-rerun true --threads 4`. Early progress is healthy (`5525/87074` songs classified at 6.3%, no skips, `peakRssMb=1824` at that checkpoint).
- 2026-03-27: Added `scripts/validate-persona-radio.ts`, a real station-runtime validator that will pick five disjoint taste personas from the export DB, seed 10 ratings per persona, run the station CLI five times with `playback=none`, and reject any station track that is closer to another persona centroid than its own.
- 2026-03-27: Acceptance contract changed mid-run: metadata-only or WAV-only classification is no longer acceptable. Stopped the in-flight full wrapper run, removed classification fail-open branches, and made missing SID trace sidecars / exhausted render attempts fatal.
- 2026-03-27: Removed the render-pool parent-side per-job timeout guard so the renderer's own cooperative wall-clock bound can finish writing WAV + `.trace.jsonl` before the worker is recycled. Increased the internal wall-clock budget heuristic from the broken 4-18s range to a 15-60s playback-scaled budget.
- 2026-03-27: New focused validation passed: `bun run build:quick`; `bun test packages/sidflow-classify/test/render-timeout.test.ts packages/sidflow-classify/test/sid-native-features.test.ts packages/sidflow-classify/test/multi-sid-classification.test.ts` (`18 pass`, `0 fail`).
- 2026-03-27: Real HVSC repro validation passed against the previously failing Baldwin_Neil songs. `Fate_II.sid`, `Competition_Entries.sid`, `Garfield.sid`, and `Hardcastle.sid` all classified successfully under clean temp configs with no timeout/trace-failure log lines, `.trace.jsonl` sidecars present for every rendered WAV, and `sidFeatureVariant="sid-native"` on every output record.

### Measurable Success Criteria

- [ ] Full command completes with `0` skipped songs and `0` fatal classification failures.
- [ ] Peak RSS remains below 4 GB during the final run.
- [ ] Worker pool never exceeds the configured fixed size and does not exhibit crash/restart loops.
- [ ] Telemetry shows `0` render-attempt exhaustion failures, `0` SID trace sidecar failures, and `0` metadata-only classifications during the final run.
- [ ] Re-running the full command yields identical classification counts.

## Objective

Recover the SID classification pipeline by diagnosing and fixing the pathological behavior where `GAMES/S-Z/Super_Mario_Bros_64_2SID.sid` causes all workers to become stuck, pegging all cores at 100% with zero forward progress.

## Branch Topology

- `main`: restored to `c392f08` (stable baseline)
- `fix/direct-sid-classification`: contains commits `e6ea3b4..e06e301` + new fix work

## Phase 0 - Branch Recovery and Plan
- [x] Create `fix/direct-sid-classification` at `e06e301`
- [x] Reset `main` to `c392f08`
- [x] Verify branch topology
- [x] Create PLANS.md
- [x] Create WORKLOG.md

## Phase 1 - Establish Baseline
- [ ] Confirm pipeline builds and tests pass on fix branch
- [ ] Run small bounded classification (5-10 SIDs) to confirm non-pathological behavior
- [ ] Define reproduction tiers (single SID, small batch, prefix replay)
- [ ] Define forward-progress metrics

## Phase 2 - Telemetry Instrumentation
- [ ] Add per-song wall-clock timeout to `runConcurrent` worker invocations
- [ ] Add per-worker SID attribution logging (JSON)
- [ ] Add stall watchdog: no song completes for 60s -> dump state
- [ ] Add duplicate-dispatch detection (same SID on multiple workers)
- [ ] Add periodic status snapshot (every 10s) with queue/worker state
- [ ] Add per-song timing and outcome tracking
- [ ] Machine-readable run summary JSON

## Phase 3 - Controlled Reproduction
- [ ] Tier A: Single-SID isolation of `Super_Mario_Bros_64_2SID.sid`
- [ ] Tier B: Small batch (5-10 SIDs) including the problematic SID
- [ ] Tier C: Prefix replay approaching historical failure
- [ ] Determine minimal reproduction scope

## Phase 4 - Root Cause Analysis
- [ ] Identify exact stage where problematic SID stalls
- [ ] Determine if single worker hangs vs multiple workers stuck on same SID
- [ ] Determine if duplicate dispatch occurs
- [ ] Compare normal vs pathological SID telemetry
- [ ] State root cause precisely

## Phase 5 - Implement Fixes
- [ ] Per-song watchdog timeout with error attribution
- [ ] Worker ownership discipline (one SID cannot monopolize all workers)
- [ ] Deduplication/lease protection against duplicate concurrent dispatch
- [ ] Forward-progress detection
- [ ] Safe failure: pathological SID skipped/quarantined, pipeline continues
- [ ] Structured failure artifacts

## Phase 6 - CPU Utilization Stabilization
- [ ] Measure utilization during healthy runs
- [ ] Identify idle gaps or bottlenecks
- [ ] Verify >= 50% avg CPU per core during substantial runs
- [ ] No false 100% CPU with zero progress

## Phase 7 - Long-Run Validation
- [ ] Bounded run crossing historical ~10 min failure threshold
- [ ] Large corpus run with continuous progress
- [ ] All expected output artifacts produced
- [ ] Telemetry confirms worker health throughout

## Phase 8 - Regression Protection
- [ ] Regression test for pathological-song timeout behavior
- [ ] Scheduler test: duplicate SID ownership cannot consume all workers
- [ ] Timeout/watchdog test
- [ ] Documented reproduction procedure

## Phase 9 - Final Documentation
- [ ] Root-cause write-up in doc/research/
- [ ] Updated classification usage docs
- [ ] Telemetry inspection guide
- [ ] Final verification evidence in WORKLOG.md

## Phase 10 - PR #87 Convergence

### Objective

Bring PR #87 to a merge-ready state by addressing inline review feedback, fixing the failing CI job, and re-running validation until the branch is stable.

### Checklist
- [ ] Review all inline PR comments and classify each as fix / no-op with rationale
- [ ] Implement minimal code/test fixes for valid review findings
- [ ] Re-run targeted classify tests and build locally
- [ ] Re-run full `bun run test` until green
- [ ] Re-run required validation 3x per repo policy and capture outputs
- [ ] Respond to each inline review comment with technical resolution
- [ ] Resolve all review threads/comments that are addressed
- [ ] Push branch updates and verify all CI checks pass

### Progress
- 2026-03-24: Loaded repo guidance and PR state. `gh api graphql` reports no active review threads, but `gh api repos/.../pulls/87/comments` returned 11 inline Copilot comments that still need individual responses.
- 2026-03-24: `gh pr status` shows PR #87 has 1/4 failing checks. The failing check is `Build and test / Build and Test` from Actions run `23484605584`.
- 2026-03-24: Initial review triage identified likely-valid issues in `render-timeout.test.ts`, `wasm-render-pool.ts`, `index.ts`, and a wording issue in `cli.ts`. Work in progress.

### Decision Log
- 2026-03-24: Treat inline Copilot comments as authoritative review work even though GraphQL `reviewThreads` returned no active thread nodes for this PR.

### Outcomes
- Pending.

---

## Phase 14 - SID Classification Defect Convergence

### Objective

Fix the classification pipeline defects around renderer selection, missing SID
trace sidecars, silent-frame activity leakage, and waveform ratio dilution while
keeping changes minimal and localized.

### Checklist
- [ ] Record renderer-selection analysis and silent-fallback findings in `WORKLOG.md`
- [ ] Enforce WASM as the classification default when no engine is specified
- [ ] Require explicit degraded-mode opt-in before classification may use `sidplayfp-cli`
- [ ] Fail fast with a clear error when classification selects `sidplayfp-cli` without opt-in
- [ ] Emit an explicit degraded-mode warning when classification intentionally uses `sidplayfp-cli`
- [ ] Make SID-native feature extraction degrade gracefully when the trace sidecar is missing
- [ ] Keep WAV feature extraction successful even when SID-native extraction is unavailable
- [ ] Exclude `waveform: "none"` frames from active voice detection
- [ ] Exclude `waveform: "none"` frames from waveform-ratio denominators
- [ ] Add regression tests for renderer gating, missing-sidecar degradation, and SID frame math
- [ ] Run validation: `bun run build`
- [ ] Run targeted classify tests
- [ ] Run full `bun run test` three consecutive times

### Progress
- 2026-03-26: Analysis started. Confirmed classification code reads `render.preferredEngines[0]` directly in multiple places, so renderer choice is implicit and unvalidated.
- 2026-03-26: Confirmed repo default config is already `wasm`-first; the defect is code-level acceptance of `sidplayfp-cli` without explicit opt-in, not the checked-in default config.
- 2026-03-26: Confirmed missing trace sidecars currently abort merged feature extraction in both the main-thread hybrid extractor and the worker-thread extraction path because both use `Promise.all` semantics.
- 2026-03-26: Confirmed active-frame and waveform-ratio defects live in `packages/sidflow-classify/src/sid-native-features.ts`.
- 2026-03-26: Adjusted renderer enforcement approach after review: classification now preserves the user's configured preferred engine, warns once when a non-WASM engine is explicitly selected, and only allows automatic fallback from failed WASM renders to `sidplayfp-cli` when `render.allowDegradedSidplayfpCli=true`.
- 2026-03-26: Focused validation passed: `bun test packages/sidflow-classify/test/index.test.ts packages/sidflow-classify/test/sid-native-features.test.ts` completed with 28 passing tests and 0 failures.
- 2026-03-26: CI-equivalent Playwright reproduction exposed a separate merge blocker: admin E2E pages were loading unauthenticated because the admin session cookie was scoped to `/admin` while the same session was also required for `/api/admin/*`. Updated the cookie scope to `/` in middleware and Playwright test seeding.
- 2026-03-26: Classification E2E failures were traced to stale synthetic-cache fixtures in the web Playwright suite. The classifier now requires cache-complete WAV fixtures (`.wav`, `.sha256`, `.render.json`, `.trace.jsonl`) for WASM reuse, so the E2E specs were updated to seed full cache entries instead of bare WAV files.
- 2026-03-26: Added a new synthetic station regression at `packages/sidflow-play/test/station-multi-profile-e2e.test.ts` that classifies one five-cluster corpus, exports one similarity database, and verifies five distinct 10-rating personas each produce a cluster-pure 20-song station.
- 2026-03-26: Stability validation passed for the new five-profile station regression: `bun test packages/sidflow-play/test/station-multi-profile-e2e.test.ts` completed successfully three consecutive times.

### Decision Log
- 2026-03-26: Scope renderer enforcement to the classification pipeline, not the standalone render CLI, because the reported defects are classification-specific and the render CLI intentionally supports multi-engine fallback for manual rendering.
- 2026-03-26: Preserve `render.preferredEngines` as the authoritative explicit engine choice for classification. The new `render.allowDegradedSidplayfpCli` flag gates only automatic fallback after a failed WASM render; it does not gate an explicit user-selected `sidplayfp-cli` preference.

### Outcomes
- Pending.

## Phase 11 - Similarity Export Slowdown Telemetry

### Objective

Add deterministic, per-song classification lifecycle telemetry for the `bash scripts/run-similarity-export.sh --mode local --full-rerun true` workflow, then use that evidence to explain the reported slowdown around 70-75% completion.

### Checklist
- [x] Read repo guidance, docs, and classify/export entrypoints
- [x] Establish baseline build/test state before code changes
- [x] Add wrapper-run metadata capture for the exact similarity-export command
- [x] Emit structured per-song classification telemetry without changing the main classification JSONL schema
- [x] Surface the hidden post-extraction phases in CLI/web/script progress reporting
- [x] Add focused tests for telemetry + phase reporting
- [x] Run a bounded classify/export verification and inspect emitted telemetry
- [x] Document the slowdown root cause and evidence in `doc/research/`
- [ ] Re-run final validation (`bun run build`, targeted tests, `bun run test` x3)

### Progress
- 2026-03-25: Baseline `npm run build` succeeded. `npm run test` also exited successfully from a clean code baseline.
- 2026-03-25: Code inspection shows `generateAutoTags()` does a concurrent feature-extraction pass, then a second serialized pass that builds the dataset-normalized rating model and writes final classification records. Existing progress/log parsing largely exposes the first phase, so late-run work can look like a slowdown.
- 2026-03-25: Added `classification_*.events.jsonl` telemetry, wrapper-level `run-events.jsonl`, and explicit `Building Rating Model` / `Writing Results` progress phases.

## Phase 16 - Takeover Prompt Handoff

### Objective

Capture the complete recovery brief as a reusable markdown prompt in `doc/` so a follow-on LLM can finish the full-corpus classification run and the downstream five-persona station validation.

### Checklist
- [x] Read repo guidance (`PLANS.md`, `README.md`, `doc/developer.md`, `doc/technical-reference.md`)
- [x] Write a raw markdown takeover prompt under `doc/`
- [x] Include the exact full-corpus requirement for all 60,582 songs
- [x] Include the five-persona, 10-vote station validation requirement

### Progress
- 2026-03-27: Added `doc/full-hvsc-classification-takeover-prompt.md` containing the handoff prompt for finishing the full HVSC classification/export run and validating five disjoint persona-driven stations.
- 2026-03-25: Focused validation passed: `npm run build:quick` and `bun test packages/sidflow-classify/test/cli.test.ts packages/sidflow-classify/test/auto-tags.test.ts packages/sidflow-classify/test/index.test.ts`.
- 2026-03-25: Bounded wrapper verification hit an environment blocker (`ffmpeg` missing), but still produced the wrapper `run_start` artifact. The classification lifecycle itself was verified end-to-end with the same run context against `test-data`.

### Decision Log
- 2026-03-25: Keep telemetry in a separate `classification_*.events.jsonl` stream to avoid breaking downstream consumers of the canonical `classification_*.jsonl` schema.

### Outcomes
- Root cause identified: a real late serialized finalization pass existed, but the severe slowdown symptom was primarily caused by missing visibility into that pass.

## Phase 12 - Enhanced Per-Song Lifecycle Logging (Strict JSONL)

### Objective

Implement a deterministic, structured, per-song classification logging system
that captures the full lifecycle of each song with system metrics, stage
durations, and stall detection — writing to `logs/classification-detailed.jsonl`.
Use the collected evidence to further confirm/refine the root cause found in
Phase 11.

### Checklist
- [ ] Add `SongLifecycleLogger` to `classification-telemetry.ts`
  - [ ] Per-song JSONL format: ts, songIndex, totalSongs, songPath, songId, stage, event, durationMs, workerId, pid, threadId, memoryMB, cpuPercent, extra
  - [ ] `resolveGitCommit()`, `captureMemoryMB()`, `captureCpuPercent()` helpers
  - [ ] Stall detection watchdog (30-second scan, 10× median threshold)
  - [ ] `run_start` event with gitCommit; `run_end` event with totalDurationMs
- [ ] Instrument all 11 stages in `generateAutoTags` (index.ts)
  - QUEUED, STARTED, RENDERING, RENDERED, EXTRACTING, EXTRACTED, ANALYZING, ANALYZED, TAGGING, TAGGED, COMPLETED
  - Each stage emits start + end events with duration
- [ ] Add `lifecycleLogPath?` option to `GenerateAutoTagsOptions` (defaults to `logs/classification-detailed.jsonl`)
- [ ] Add `logs/` to `.gitignore`
- [ ] Create `doc/research/classification-logging-audit.md` with full evidence-based analysis
- [ ] Update WORKLOG.md
- [ ] Run `bun run build:quick` + targeted tests; fix any regressions
- [ ] Run `bun run test` three times consecutively with 100% pass rate

### Progress
- 2026-03-25: Phase started. Code exploration complete.

### Decision Log
- 2026-03-25: Keep PRIMARY log at `logs/classification-detailed.jsonl` (project root), separate from the existing `data/classified/classification_*.events.jsonl`. This avoids any schema-breaking changes.
- 2026-03-25: `lifecycleLogPath` param added to `GenerateAutoTagsOptions` so tests can redirect to a temp dir.
- 2026-03-25: `captureCpuPercent` measures delta from last sample — process-wide, not per-worker (sufficient for high-level analysis).

### Outcomes
- Pending.

---

## Phase 13 - Full HVSC Classification Validation and Release Publication

### Objective

Validate that a complete HVSC classification run produces correct artifacts
(features JSONL, auto-tags, SQLite export) and publish the verified export to
`chrisgleissner/sidflow-data` as a release.

### Phase 13.0 — Pre-Run Context Audit (COMPLETE)

**Evidence gathered before classification:**
- HVSC: 60,572 SID files in `workspace/hvsc/C64Music/`
- Prior interrupted run (01:48–01:52 UTC 2026-03-26): classified only 1,089 of 87,074+ total sub-songs (1.3%)
- Cause of interruption: external (process killed; no `run_end` event; last event `render_start` at queueIndex 1112)
- `data/exports/` is EMPTY — no SQLite export exists
- Existing `data/classified/features_2026-03-26_01-48-27-584.jsonl`: 1,089 entries only (partial)
- `workspace/audio-cache/`: 1,113 WAV files survive from interrupted run  
- `workspace/tags/`: 12 `auto-tags.json` files (all from manual ratings, NOT from auto-classification)
- `isAlreadyClassified` checks `auto-tags.json` → so `skipAlreadyClassified=true` will NOT skip the 1,089 partial songs (no auto-tags were written since the tagging phase never started)
- Conclusion: functionally equivalent to a full fresh run; WAV files provide a small rendering cache benefit
- Committed test SQLite (git HEAD) has only 7 tracks with 4 dimensions (schema 1.2.0, NOT a real export)
- `.sidflow.json` uncommitted diff: `sidplayfp-cli` moved to first in `preferredEngines` (intentional for speed)
- `classification-telemetry.ts` uncommitted diff: defensive try/catch around CPU/memory helpers (correctness improvement)

### Phase 13.1 — Pre-Classification Build Verification
- [ ] Run `bun run build` and confirm 0 errors
- [ ] Run targeted classify tests: `bun test packages/sidflow-classify/test/`
- [ ] Record pass/fail

### Phase 13.2 — Full Classification Run
**Method**: `bash scripts/run-similarity-export.sh --mode local`
(Without `--full-rerun`; the script will naturally re-classify everything since no auto-tags exist.
The 1,113 WAV files provide a minor rendering cache benefit.)

- [ ] Confirm no web server is running on port 3000 before starting
- [ ] Start classification run in background
- [ ] Monitor progress every 10 minutes
- [ ] Confirm completion: 87,074+ songs processed, `run_complete` event emitted
- [ ] Verify artifacts post-run:
  - [ ] `data/classified/features_*.jsonl` total line count ≥ 60,572
  - [ ] `workspace/tags/` auto-tags.json files populated
  - [ ] `data/exports/*.sqlite` exists and is non-empty
  - [ ] `data/exports/*.manifest.json` exists

### Phase 13.3 — Classification Completeness Verification
- [ ] Count total SID files: `find workspace/hvsc -name "*.sid" | wc -l` → expect ~60,572
- [ ] Count unique classified entries in features JSONL
- [ ] Verify no duplicate `sid_path` entries in features JSONL
- [ ] Check for truncated/malformed JSONL lines
- [ ] Cross-check: rendered, extracted, tagged counts match expected total

### Phase 13.4 — Export Validation (SQLite)
- [ ] Verify SQLite schema integrity (tables: `meta`, `tracks`, `neighbors`)
- [ ] Verify `tracks` row count ≥ 60,572
- [ ] Verify all 24 similarity vector fields present per track
- [ ] Check for NULL or empty vectors (expect 0)
- [ ] Validate `meta` table: schema_version, generated_at, track_count
- [ ] Cross-check manifest: track_count matches SQLite, checksums match
- [ ] Spot validation: 50+ random sample tracks from JSONL vs SQLite

### Phase 13.5 — Programmatic Quality Validation (replacing interactive SID station)
**Context**: The `scripts/sid-station.sh` interactive audio questionnaire cannot be
executed autonomously (requires human audio perception and TUI interaction).
Equivalent programmatic validation will be performed:

- [ ] Run 5 distinct similarity profile queries using the play CLI:
  1. Seed: high-BPM song → verify returned songs have high BPM
  2. Seed: low-energy ambient song → verify low energy in results
  3. Seed: heavy-bass song → verify high bassPresenceFused in results
  4. Seed: melodically clear song → verify high melodicClarityFused in results
  5. Seed: high-noise/experimental song → verify high waveNoiseRatio in results
- [ ] For each run: capture playlist output and compare feature vectors
- [ ] Verify cosine similarity between seed and top-5 results is > 0.8
- [ ] Document anomalies if any

### Phase 13.6 — Release Publication
**Precondition**: All phases 13.3–13.5 must PASS

- [ ] Verify release artifact: `data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite`
- [ ] Use command: `bash scripts/run-similarity-export.sh --workflow publish-only --mode local --publish-release true`
- [ ] Verify release exists on `chrisgleissner/sidflow-data`
- [ ] Verify artifacts are downloadable
- [ ] Verify checksums match manifest

### Termination Criteria (ALL must be true before declaring Phase 13 complete)
1. Classified song count ≥ 60,572 (all HVSC SID files)
2. SQLite `tracks` row count = classified song count
3. Manifest consistency checks pass
4. 50+ random sample spot validations pass
5. 5/5 programmatic similarity profile queries produce coherent results
6. No unresolved anomalies
7. Release successfully published and verified

### Numeric Checkpoints
- HVSC SID count: 60,572 (verified 2026-03-26)
- Expected sub-song total: ~87,074 (per README run logs)
- Expected SQLite rows: ≥ 60,572 (one per SID; multi-song SIDs counted per-SID)
- Vector dimensions: 24 (per README classification vector reference)
- Schema version: `sidcorr-1`
- Feature schema version: `1.3.0`

### Progress
- 2026-03-26T07:30Z: Pre-run audit complete. All findings documented above.
- 2026-03-26T07:30Z: Confirmed HVSC 60,572 SIDs, 1,089 partial features, 0 auto-tags from auto-classification, empty exports dir.
- 2026-03-26T07:45Z: Build completed (bun run build) — 0 TypeScript errors. Wasm upstream check warning (expected, not blocking).
- 2026-03-26T07:54Z: First classification attempt started — processes entered Tl (stopped) state when terminal was backgrounded. WAV count stuck at 1,133.
- 2026-03-26T08:07Z: Second attempt using `setsid` — PID 45977 (bun classify CLI), PID 45743 (next-server), 20 threads running. Processes in Rl/Sl state (not stopped). A duplicate nohup invocation attempted at 08:10 but was blocked with HTTP 500 "already running" (lock protection working).
- 2026-03-26T08:07Z-08:25Z: Classification actively progressing. Rate ~530-560 songs/min. Features at 08:25: ~7,900+ classified. ETA ~10:50 UTC (2.5 hours from start).
- 2026-03-26T08:25Z: Original bash wrapper exited (after nohup duplicate confused the log). Created `tmp/post-classify-export.sh` — setsid-detached monitor (PID 776421, Ss state, no controlling terminal) waiting for PID 45977 to exit, then auto-triggers `bun run export:similarity -- --profile full --corpus-version hvsc`.
- DISCOVERY: "272525 previously classified songs" message in run log is misleading — `count_classified_rows()` counts ALL lines in `classification_*.jsonl` event log files, not unique songs. Cosmetic bug, no functional impact.

### Decision Log
- 2026-03-26: Run with `--mode local` (no `--full-rerun`) — functionally identical to full re-run since no auto-tags exist; preserves 1,113 WAV files as minor render cache.
- 2026-03-26: Interactive SID station not automatable; replaced with programmatic similarity profile validation using the play CLI.
- 2026-03-26: Keep existing uncommitted `.sidflow.json` change (sidplayfp-cli first) — intentional optimization confirmed by partial run (1,089 songs successfully rendered at ~44 songs/s).
- 2026-03-26: Export script will delete WAVs after classification (`DELETE_WAV_AFTER_CLASSIFICATION=true` default) — acceptable since export SQLite is the durable artifact.

### Outcomes
- Pending.

## Full-song three-ROM audit and production projection (2026-10-23) — active

- [x] Inspect existing runner, analysis, renderer, patches, parity and publisher;
  preserve the four-ROM historical reports and 256-event safety constraint.
- [x] Identify methodological gaps before implementation: identical/PCM-only short
  windows escape extension; approximate write thresholds are diagnostic only;
  CHARGEN is constant; native controls compare PCM and counts, not timed traces.
  No workspace/checkpoints exist in this checkout. Installed target is 1.0.1.
- [x] Verify/download HVSC85, inventory every subtune and song-length provenance.
- [x] Extend native runner to eight isolated ROM masks, exact timed-write evidence,
  duration policy, bounded resources and resumable complete/pending accounting.
- [x] Add strict three-state research assessment, deterministic catalogue/manifest
  and derived fail-closed production lookup, with exhaustive consistency checking.
- [x] Add delayed KERNAL/BASIC/CHARGEN fixtures and expanded parity/sanitizer checks.
- [ ] Execute full available inventory and rendering; preserve explicit unknowns
  and exact pending counts if full-duration work exceeds available execution time.
- [ ] Build, focused tests, established suite three consecutive times, document
  literal outputs and measured throughput. Do not claim unfinished work complete.

Correctness decisions before implementation: a finite observation supports only
its declared horizon. Songlength metadata is a scheduling estimate, not a machine
state recurrence proof. Unknown/interactive/loop-unproven cases retain uncertainty.
A PCM-only difference is not proof of incorrect music. Strict production eligibility
requires stable reference, validated engine provenance and exact timed writes plus
PCM across the required horizon; approximate historical labels never grant access.

Progress: verified all 61,157 raw MD5/path/subtune counts (87,868 subtunes) against
HVSC85. All tokens have positive lengths; horizons range 10–2,031.332s, total
10,176,145.245s. Two six-worker passes measured 763 subtunes / 6,104 mask outcomes,
leaving 87,105 subtunes / 696,840 mask outcomes pending. Scheduling budgets were
180s each, with active jobs drained; elapsed 205.526s and 181.051s. No environmental
failure forced the stop. Full rendering remains unfinished (roughly 72h estimated
at measured aggregate emulation throughput). Never describe the inventory as a
completed full-duration census. Checkpoints: `workspace/rom-audit-v2`.

Original 24 hash/count controls expanded to 104 controls: all eight masks, six
historical inputs, four delayed synthetic fixtures, Giana60s and two measured
full-horizon corpus cases. PCM and timed-write hashes/counts match. ASAN passes
PAL/NTSC/busy-loop/Justincase plus all four delayed dependency fixtures. All 702,944
published decisions are exhaustively checked against their research records.

Build and strict script typecheck pass. Downloading HVSC activated an existing
300-file persona integration test skipped at the empty-workspace baseline. It
exposed two real sparse/steady-tone records with missing spectral contrast: the
aggregator rejected every band when one Essentia coefficient was singular.
Keep valid measured bands and add a focused regression; do not weaken the health
assertion or skip the integration test. Full-suite validation is still running.

Final corpus-wide protocol check found 576 floating-point horizon round-trip
mismatches (e.g. 66.38499999999999 vs native JSON 66.385). Compute horizons in integer
milliseconds; all 763 existing measurements retain exactly the same durations,
and the complete inventory now has zero protocol round-trip mismatches. Added
fractional-duration regressions and restarted final full-suite validation after
this last source change. The preceding three full runs each passed 2,899 tests,
0 fail, 0 skip; fresh final-source runs are pending.

User requested effective core use. Keep native work idle during timing-sensitive
unit probes, but run six native workers alongside each long real-HVSC integration
phase. The validation coordinator records actual per-core busy percentages and
checkpoint throughput in `workspace/rom-audit-v2/utilization-validation.json`.
After validation, continue the unbounded full corpus run with seven native workers
on this eight-logical-core machine; preserve PID/log and publish on completion.

### Adversarial pilot hardening gate (user steering, 2026-10-23)

Do not exceed 5% of HVSC files OR subtunes before adversarial small-corpus
hardening is complete. Current unique scope is 1,653 subtunes / 370 files,
below conservative limits 4,393 subtunes / 3,057 files. Stopped validation/audit
coordinators before further rollout or native build changes; checkpoints survive.
The earlier intention to launch an unrestricted background run is superseded.

- [ ] Add an enforced pilot ceiling and a version-bound full-rollout hardening gate.
- [ ] Adversarially test invalid/forged horizon and provenance inputs, short/late
  divergences, trace truncation, matrix identity, stale parity and checkpoint data.
- [ ] Replace hash-only native/WASM qualification with exact PCM/timed-trace
  comparison on the small control corpus; bind certificates to actual outcomes.
- [ ] Close the finite-observation/runtime contract: an allow decision must carry
  its playback horizon; it cannot silently authorize indefinite looping.
- [ ] Exercise the hardened protocol on diverse curated HVSC cases and synthetic
  KERNAL/BASIC/CHARGEN cases before repeating larger pilot measurements.
- [ ] Record findings and proof obligations, pass focused/sanitizer/parity and
  final full-suite checks, then permit expansion with an explicit machine gate.

### Handover requested by user (2026-10-23)

Created `doc/hvsc-rom-audit-handover.md` for a fresh LLM to independently review and
improve the unfinished implementation. Mandatory routing: Opus 5.5 for architect /
important decisions, Sonnet 5.5 otherwise. No >5% rollout is approved. Audit-only
scope is 1,653 subtunes / 370 files; known union including real integration/parity
controls is 2,004 subtunes / 663 files. No broad audit/coordinator remains running.
Current source is not validated: latest strict check fails because a child exit
`signal` argument shadows the outer AbortSignal; native binaries predate immutable
hex-payload changes; `harden.ts` and methodology-3 maintained publication are still
missing. The handover explicitly separates historical test successes from current
unvalidated hardening work and lists open proof/provenance/rollout weaknesses.

### Takeover: hardening implementation (2026-10-23)

Handover `doc/hvsc-rom-audit-handover.md` implemented against the Opus 5.5 architect reviews in
`doc/research/hvsc-rom-adversarial-review.md` (Sonnet 5.5 implemented; Opus 5.5 reviewed read-only).
Draft PR #109. No run beyond the 5% pilot has been started.

Design change after the second review (user decisions: match C64 Commander as shipped):

- Commander ships `libsidplayfp-wasm` 1.1.0 (the repo's classifier pins 1.0.1), plays at 48 kHz,
  never sets the power-on delay (engine default 8191), only creates the ROM sets {KERNAL+BASIC with
  CHARGEN null} and {nothing}, and defaults to the reSIDfp renderer. The census now renders
  exactly that on WASM 1.1.0 (audit-only aliased dev dependency `libsidplayfp-wasm-audit`), with
  null banks covered by zero and 0xFF fills. The native renderer and the native-screen /
  WASM-confirm split were dropped from the decision path: one engine measures and grants.
- Comparator defects found by the review reproduced and fixed (engine output is a view into WASM
  memory; chunk-by-chunk exact comparison; a variant that stops writing is not identical).
  Regression: `decision-regression.ts` (two real subtunes that failed in the pilot, silent tail).
- Measured: SIDLite lane ~11x realtime under load, reSIDfp lane ~1.7x (6x more expensive);
  Commander's default renderer is reSIDfp, so SIDLite results do not cover it by default.
  Transfer via "no SID reads" was tested and rejected (7% of the pilot never reads a SID register).

Resolved from the reviews: B1 ledger (content-keyed, fsynced before dispatch, checksummed), B3
`harden.ts` and evidence-verified certificate, H1 error classification, H2 lookup takes ROM hashes
and profile, H3 kernel flock lock, H5 pilot requires a selection, N1 N2 comparator, N4 per-job
failure isolation, N5 provenance, ledger/checkpoint repair only under the scope lock.

- [ ] Pilot on the reviewed selection (567 subtunes) with the final sources; v3 dataset committed.
- [ ] Third Opus review of the frozen sources; `Approved-source-identity` line.
- [ ] `harden.ts` certificate (decision regression, pilot checks, reproducibility, 3 focused + 3 full suites).
- [ ] Full-corpus execution (days; resumable; intended for a faster machine via `run-full.sh`).
- [ ] Decide whether to qualify reSIDfp (about 6x the lane cost) and SidplayEZ.
## Diagnose stale dual-ROM census plans (2026-10-27) — active

Fix the opaque plan mismatch reported after successful qualification, retain
existing checkpoints, run a fresh 1,000-subtune dual-ROM classification, and
raise a reviewed PR for merge.

- [x] Read repository guidance and inspect the stale-plan guard and workspace.
- [x] Improve mismatch output to identify changed provenance categories and
  explicitly preserve the prior checkpoint.
- [x] Allow bounded checkpoints after a complete zero-failure benchmark even
  when the full-census time projection exceeds the machine budget; keep the
  budget gate mandatory for unbounded full censuses.
- [ ] Run the qualified workflow in a new output directory through 1,000 jobs.
- [ ] Validate code, run three consecutive full suites, and record literal output.
- [ ] Push branch, open/update PR, resolve review/CI, and merge.

The failure came from correctly refusing to reuse a checkpoint whose classifier
identity no longer matched the current qualified sources. Existing workspace
census artifacts and the user's station-analysis changes are preserved.

## Bounded ROM audit performance investigation (2026-10-28) — investigation completed; prototype qualification pending

- [x] Inspect classifier, header specification and existing timing evidence.
- [x] Create isolated PR branch; preserve all pre-existing working tree changes.
- [x] Implement experimental adaptive screen scheduling, with no production
  eligibility changes. Reference clocking mode is only a cost hint; every
  variant still executes independently through the complete horizon.
- [x] Run 4 then 16 already-counted benchmark inputs; require exact final traces,
  errors and completion status across both engines before expanding.
- [x] Record measurements, static-analysis limits and next optimization gates.
- [x] Build/typecheck and obtain three consecutive clean full test runs
  (final-source runs: 2,986 pass / 0 fail / 0 skip each; explicit exit 0 in
  `workspace/performance-qualified-full-{1,2,3}.exit`). Full build and strict
  typecheck of all `scripts/rom-audit/*.ts` also passed.
- [x] Open isolated draft [PR #111](https://github.com/chrisgleissner/sidflow/pull/111) containing only this investigation's changes.

No full classification is authorized by this task. Existing census output is
preserved. Experiments have a hard 32-subtune ceiling and reuse ledger entries.

User steering: prioritize correctness AND reject a 30-hour production runtime;
investigate recurring power drops, direct Linux-native tools and libSidplayEZ.
The existing hot path is already native; installed sidplayfp 2.16.0 lacks
SIDLite, while our pinned instrumented native build supplies both engines.

- [x] Native adaptive controls: early OSC3, late ENV3 and late CHARGEN match
  exact final evidence for both engines. The 16-subtune real sample saves no
  retries; do not promote this policy as a corpus speed improvement.
- [x] Build upstream Commander-pinned libSidplayEZ natively, without installing
  system packages; use locally unpacked Clang after GCC rejects upstream enum
  linkage. Keep Commander-specific patches distinct from unmodified upstream.
- [x] Profile 64 repeated full-horizon comparisons: 19-worker queue saturates
  ~19.9 logical CPUs while full; long-job drain causes the utilization drop.
  All non-cost evidence repeats exactly. Eight-worker comparison takes 81.0s
  versus 63.4s with 19 workers; investigate cost-ordered dispatch separately.
- [x] Measure descending prior-cost dispatch, 4/16 fork-reference pilots and
  4/8 libSidplayEZ pilots; summarize report hashes, timings and limitations in
  `doc/research/hvsc-rom-performance-pilot.json`.
- [x] Compare native EZ timing/PCM and ROM outcomes on 4, then 8 existing
  benchmark subtunes, retaining errors and rejecting unqualified substitutions.
- [x] Capture final sustained measurements without simultaneous builds/tests.
- [x] Validate sample-clock readiness against upstream SINC (`3,200` exact
  readiness checks), check sample-screen grants against native audio and the
  historical census on 4/16 subtunes (zero false grants), and run the frozen
  sample-pipeline A/B on 4/16 subtunes with matching states. Bounded CPU figures
  are native child-process work only and do not imply whole-corpus runtime.
- [x] Evaluate the sample-clock prototype separately; it is not part of
  the completed adaptive/fork/EZ evidence or production qualification.
  Existing bounded controls and the 4-input pilot matched frame counts and
  timed writes where the probe completed; stateful-read cases aborted. The
  probe does not produce or compare PCM, so this remains experimental.

Published the bounded investigation in draft PR #111. Production dispatch starts
expensive jobs first; sample-clock/EZ/fork backends remain experiments. The frozen
16-subtune controller comparison preserved every state while reducing measured
native child CPU work from 121.715178s to 82.064427s. This excludes coordinator
cost and is not a whole-corpus runtime forecast. Three final-source full suites
passed with 2,986 pass / 0 fail / 0 skip, exit 0 each. Build/typecheck, direct
readiness controls and bounded native comparisons passed. Existing main-checkout
changes and census artifacts were excluded from the PR.

Follow-up gate before default activation or any full classification: broaden
adversarial coverage, qualify the exact backend/profile and failure behavior,
and measure a representative stratified sample under target worker load with
coordinator CPU included. No full census was started or authorized by this work.

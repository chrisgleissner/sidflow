# Handover: HVSC ROM census, `sidromdep-1` list and C64 Commander integration

Paste the prompt below into a fresh agent session started in `/mnt/data/dev/c64/sidflow`
to resume this work. Keep this file current; the live checklist is the top entry of
`PLANS.md` ("Complete PR #112, full accelerated HVSC census and standalone Commander ROM list").

---

## Resume prompt

You are the principal engineer continuing a multi-hour task in the SIDFlow repository
(`/mnt/data/dev/c64/sidflow`, i5-14600K, 20 threads). Read `AGENTS.md`, then the top entry of
`PLANS.md`, then this file. Use Sonnet implementers for well-scoped coding; keep research and
review yourself. Do not stop until all of the goals are met:

1. Merge the tooling into sidflow. **Done:** PR #112 squash-merged as `a8208a1`, tag
   `rom-audit-tooling-2026-10-29`.
2. Classify the whole of HVSC #85 (61,157 files / 87,868 subtunes) with the accelerated,
   qualified classifier.
3. Publish a tiny, formally specified, standalone **SID ROM Dependency List** (`sidromdep-1`)
   for C64 Commander's APK. Release it in `chrisgleissner/sidflow-data` and commit it to
   sidflow through a follow-up PR (format branch below), then merge that PR.
4. Raise and complete a PR against C64 Commander (`/mnt/data/dev/c64/c64commander`) that embeds
   the list in the music player.

### User decisions (binding)

- Merge first, then run a fresh accelerated census from merged main. The old 12,888-row checkpoint
  under the original identity stays historical; never combine checkpoints.
- The list is embedded in an APK of about 8 MiB, so keep it to tens of KiB. It is
  **allow-by-default**: anything unlisted is playable, including files new in later HVSC releases.
  **No false positives**, so key on the full 16-byte MD5 (shorter than HVSC paths). There is no
  inventory.
- It must be usable standalone, independent of the similarity exports, with the same due
  diligence and presentation as the similarity format specs.
- Authorized without further confirmation: merging PR #112 and pushing its tag (done), creating the
  sidflow-data release, committing the export to sidflow through a PR and merging it.
- Commander UX must be very clear:
  - A new setting, default **skip**, for songs that need the C64 ROMs. The user can force playback
    with "Play anyway" per song or by changing the setting.
  - Extend the existing `romFallbackDecision` / "rom-on-c64" routing from Commander #378, #539 and
    #540. With a connected C64, these songs still play on the C64.
  - With the reference ROM set, or when playing on real hardware, the list has no effect.
  - "Unknown" is never skipped.

### State at handover (2026-10-29 ~15:00Z)

- **Census:** running detached as `workspace/rom-census-sample-run.sh` (bench, then full; 19
  workers; `ROM_AUDIT_SAMPLE_CLOCK=1`; proof `workspace/rom-sample-320-reviewed-v1`; output
  `workspace/rom-audit-sample/`). Log: `workspace/rom-census-sample.log`.
  - Benchmark: 15.22h projected, 19.02h with margin, budget 23.98h.
  - The full stage started at 2026-10-29T14:32Z, so expect completion around 05:45–09:30Z on
    10-30. Do not run CPU-heavy work while it runs; use `nice -n 19` and focused tests only.
  - Identities: qualification/source `9d1fe14fbe04b2d235076be7c882f30aa050221310415ae541b164997b7e43fc`,
    measurement `3e383758b5486030449ad8d21f6feb617f19be8014b9c369afed0c3d83145ed3`. Certificate:
    `workspace/rom-audit-sample-qualification/certificate.json`.
  - Check progress with `tail workspace/rom-census-sample.log`, `wc -l workspace/rom-audit-sample/census.jsonl`
    and `pgrep -af rom-census-sample-run`.
  - If it stopped early (reboot or budget), resume with the same output directory. The checkpoint
    resumes and cancelled jobs stay pending:
    `ROM_AUDIT_SAMPLE_CLOCK=1 ROM_AUDIT_SAMPLE_PROOF=workspace/rom-sample-320-reviewed-v1 ROM_AUDIT_MAX_HOURS=24 ROM_AUDIT_WORKERS=19 ROM_AUDIT_OUT=workspace/rom-audit-sample ROM_AUDIT_STAGE_ONLY=full bash scripts/rom-audit/run-dual.sh`.
    First confirm that `git rev-parse HEAD` is `a8208a1` (or a tree-identical commit) and that the
    identities above still match.
  - Success looks like: `CENSUS EXIT 0`, verify-publication passing, `published/manifest.json`
    with `complete:true` and `releaseReady:true`, and zero unknown/failed.
- **Format branch:** `feat/sid-rom-dependency-list` (commits `f28314c`, `7b8c64d`), rebased on
  `a8208a1`, not pushed.
  - Worktree: `/mnt/data/dev/c64/sidflow/.claude/worktrees/agent-a369134729bfff09b`.
  - Spec: `doc/rom-dependency-list.md`.
  - Code: `packages/sidflow-common/src/rom-dependency-list.ts`, `scripts/rom-dependency-list/{bundle,generate,verify}.ts`.
  - Tests: `packages/sidflow-common/test/rom-dependency-list.test.ts` (18 focused tests pass).
  - Size: `192 + 17·files + 2·subtunes` bytes, about 32 KiB expected.
  - Never put this code under `scripts/rom-audit/` and never edit root `package.json` before the
    census ends: both are hashed into the qualification identity.
- **Commander branch:** `feat/sid-rom-dependency-list` in its own worktree,
  `/mnt/data/dev/c64/c64commander-romdep`, built by a Sonnet implementer against a synthetic list.
  Check `git -C /mnt/data/dev/c64/c64commander-romdep log --oneline -5` to see how far it got.
  The integration is implemented (see the PLANS.md entry for the decisions). Drop-in for the real list:
  replace `src/lib/romDependency/data/hvsc85-sidromdep-1.{bin,manifest.json}` and update
  `PINNED_MANIFEST_SHA256` in `src/lib/romDependency/embeddedRomDependencyList.ts`. Before the PR:
  run `npm ci`, run `npm run build` (the `?inline` .bin import has never been built), run the full
  validation. (Earlier `usePlaybackPersistence` failures were a stale symlinked node_modules; they pass after `npm ci`.)
- **User-owned edits:** never commit or alter the `station-analysis/` edits in the main checkout.
  E2E runs can delete `data/playback-sessions.json`; restore it with git checkout.

### PIVOT (2026-10-29 17:55Z): graded fidelity replaces binary verdicts

The accelerated census was STOPPED by user decision at 5,736 rows; the checkpoint is kept.
Binary listener verdicts flagged about 22% of HVSC as broken without ROMs, but most of those
were the same music re-timed by a few cycles. New design: one 0–255 grade per lane, trace-first,
calibrated on a small exhaustive corpus:
`/mnt/data/dev/c64/sidflow-grading/doc/research/hvsc-rom-fidelity-grading.md` (branch
`feat/rom-fidelity-grading`). Probe evidence: `workspace/rom-grade-probe/`.

Binding run protocol:
1. Full grading starts only after every corpus gate passes.
2. Watch the first 1,000 subtunes closely, then check about every 10,000.
3. On any issue: fail fast, refine, rerun.
4. Do not stop until done and the Commander PR has the real data.
5. Before the full-scale run starts, commit and push ALL branches (grading with PLANS.md and
   this handover, the sidflow format branch, the Commander branch).

The `sidromdep-1` format and the Commander branch must switch from 4-bit masks to grade bytes
plus a threshold; the remaining steps below still apply after that change.

### Remaining steps

1. When the census completes, run
   `bun scripts/rom-audit/verify-publication.ts workspace/rom-audit-sample/published`. Record
   counts, timing and identities in PLANS.md and `doc/research/hvsc-rom-dual-run.md`. Investigate
   any failed or unknown subtune and resolve it; do not paper over it.
2. In the format worktree, generate the list from the complete bundle:
   `bun scripts/rom-dependency-list/generate.ts …` with `--songlengths workspace/hvsc/C64Music/DOCUMENTS/Songlengths.md5`
   (check `--help`). Then run the verifier, which round-trips every subtune. Check the real size
   and incompatible counts against the earlier research (about 3% of subtunes).
3. Commit the generated `hvsc85-sidromdep-1.bin` and `.manifest.json`, plus the README and research
   updates, on the format branch. Run `bun run build`, then three consecutive full suites
   (`bun run test`) and paste the outputs. Push, open the PR, request `@codex review`, fix
   findings, get CI green and merge.
4. Create the sidflow-data release `rom-audit-hvsc85-YYYYMMDD` following README "Where results are
   published". Include the full verified bundle, the `sidromdep-1` bin, manifest and JSON, and an
   evidence tarball. Record the manifest SHA-256 in the notes.
5. In the Commander worktree:
   - Put in the real list and pin its SHA-256 and reference ROM hashes.
   - Run Commander's full validation as its AGENTS.md requires: lint, unit/coverage, browser
     tests, builds.
   - Push, open the PR (link the sidflow spec and release), get review and green CI.
   - Merge only if the user authorizes it; the original request was to raise the PR.
6. Mark the PLANS.md entry complete. Report to the user with links to both PRs, the release and
   the census summary.

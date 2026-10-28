# PR #111 handover: continue the complete HVSC ROM census

Resume the user's active request: make PR #111 merge-ready with exceptionally fast, scientifically defensible ROM classification for C64 Commander; empirically assess libsidplayEZ; classify all HVSC85 subtunes; verify and publish the consumer export; push all required changes. Do not stop at a partial census. Read `AGENTS.md` and the active entry at the top of `PLANS.md` first.

## Branch and changes already pushed

- PR: <https://github.com/chrisgleissner/sidflow/pull/111>
- Branch: `perf/rom-audit-adaptive-screen-pilot`
- Pushed head: `277a6bff0ba467a43fdb1cebedb00bd45f043267` (`Repair ROM screen endings and document EZ profiling`).
- Keep the PR as draft until the full verified publication exists. The original checkout has unrelated user edits in `station-analysis/`, web E2E tests and other files; do not stage or overwrite them.
- The pushed change carries methodology 2: exact timed-write screening, conservative dense-digi fallback, and symmetric finite silence tails only for diagnosed CPU illegal-instruction halts. Engine/resource/truncation failures remain unresolved. Production listener semantics were restored to the qualified comparator; the PR's sample-clock implementation remains experimental.

## Qualification and current evidence

- Measurement identity: `a8803b971aeb79d7082c7259ea73c8b4820823b38988807085e793421abcea1b`.
- Qualification identity: `6445a3f4419d53fd3018890b1c5606e23f73f2265687f8c4e88f124e4d50ace8`.
- Exact native binaries are bound in `workspace/rom-audit-screen-qualification/certificate.json`; qualification passed 192 native/WASM controls, full-horizon transport/ending controls, build, strict script typecheck and three full suites: 2,987 pass / 0 fail / 0 skip each.
- Target-machine sample: `workspace/rom-audit-dual-3/benchmark.json`, i5-14600K, 12 workers, 320 rows, zero benchmark failures. Projection is 32.86 hours before margin (41.07 hours with 25% margin). This projection is not a completion guarantee; the census has an expensive long-horizon tail.
- `workspace/rom-audit-dual-3/plan.json` matches the measurement identity and methodology 2. Its checksummed `census.jsonl` is the only checkpoint to resume for this source identity. At handover it contains 12,763/87,868 unique subtunes, all checksummed; the 44 newly added rows had zero failed and zero unknown decisions. Earlier checkpoints remain preserved and are not eligible for reuse.
- EZ was not dismissed: the exact C64 Commander patched `EzSession` profile rendered the same eight real reference inputs in 13.600 CPU seconds versus 15.906 for optimized native reSIDfp (14.5% less CPU, 1.17x). This remains a small speed-only pilot, without a representative no-ROM/KERNAL+BASIC matrix, and cannot supply eligibility data yet. Detailed limits and hashes are in `doc/research/hvsc-rom-performance-pilot.md` and `.json`.
- Sample-clock is also still experimental: 32.6% less native child CPU on a completion-ordered 16-subtune A/B set, excluding coordinator cost. Do not enable it in production without broad exact parity and representative validation.

## Census process already running

At handover, PID 74796 is the `timeout` wrapper for the bounded 3.5-hour run; its `screen-census.ts` child is PID 74895. It uses 12 workers, output `workspace/rom-audit-dual-3`, and the matching qualified certificate/benchmark. Check `ps` and the current checkpoint count before taking action. Do not start a second run against that output while this one is active. It was launched as:

```sh
ROM_AUDIT_STAGE_ONLY=full ROM_AUDIT_WORKERS=12 ROM_AUDIT_MAX_HOURS=3.5 \
ROM_AUDIT_MAX_JOBS=87868 ROM_AUDIT_OUT=workspace/rom-audit-dual-3 \
  bash scripts/rom-audit/run-dual.sh
```

The run is safely bounded and fsyncs each completed row. When it finishes or hits its watchdog, inspect its final output, count all checkpoint rows, validate failures/unknowns and resume with the same source/benchmark/worker settings. A later invocation may use up to 16 hours; keep `ROM_AUDIT_MAX_JOBS` set while the measured projection exceeds the per-invocation budget. Do not claim completion until `verify-publication.ts` accepts all 87,868 decisions and reports complete/releaseReady with zero pending, failures or unknowns.

## Next steps

1. Let the current run stop cleanly; read its final row count and aggregate states. Preserve its logs/checkpoint.
2. Recompute the actual runtime projection as representative census rows accrue, especially for the `300+` second horizon tail. Do not mistake the initial expensive cost-ordered prefix for the corpus mean.
3. Continue resumable bounded chunks on the same identity until all 87,868 subtunes are resolved. Investigate every new failed/unknown row; never recategorize an engine or reference failure as incompatible/compatible without evidence.
4. Run `node scripts/run-bun.mjs scripts/rom-audit/verify-publication.ts workspace/rom-audit-dual-3/published`; keep the complete bundle and minimum checksummed provenance needed by Commander. Do not commit HVSC, ROMs, native binaries, audio, raw census, or build artifacts.
5. Update `PLANS.md` and this handover with verified progress. Commit and push only task-owned files. Update PR #111, wait for green CI and review, and mark it ready only after the verified complete export exists.

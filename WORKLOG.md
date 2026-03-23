# WORKLOG.md

Append-only execution log for the 2026-03-23 single-pass SID extraction optimization task.

## 2026-03-23T11:31:24Z — Task start

### Recovery objective

- Replace the branch's partial hybrid trace integration with an authoritative single-pass contract: one LibSidPlayFP execution per SID render produces both the WAV and the SID trace sidecar, with no default second execution for trace capture.

### Recovery commands

```bash
git status --short --branch
git merge-base HEAD main
git diff --name-status main...HEAD
git diff --stat main...HEAD -- packages/libsidplayfp-wasm packages/sidflow-classify packages/sidflow-common README.md doc scripts
git diff --name-only main...HEAD -- packages/libsidplayfp-wasm packages/sidflow-classify packages/sidflow-common README.md doc scripts
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

### Files inspected

- `PLANS.md`
- `WORKLOG.md`
- `README.md`
- `doc/developer.md`
- `doc/technical-reference.md`
- `packages/libsidplayfp-wasm/src/player.ts`
- `packages/libsidplayfp-wasm/src/bindings/bindings.cpp`
- `packages/sidflow-classify/src/index.ts`
- `packages/sidflow-classify/src/render/wav-renderer.ts`
- `packages/sidflow-classify/src/sid-native-features.ts`
- `packages/sidflow-classify/src/feature-extraction-worker.ts`
- `packages/sidflow-classify/src/wav-render-settings.ts`
- `packages/sidflow-common/src/similarity-export.ts`
- `packages/sidflow-common/src/jsonl-schema.ts`

### Recovered findings

- The branch already added same-pass SID register tracing in `packages/libsidplayfp-wasm` and writes `${wavFile}.trace.json` during WAV rendering.
- The main classify path sets `captureTrace: true`, so fresh renders already produce WAV plus trace sidecar in one playback pass.
- The remaining architecture gap is cache and fallback behavior:
  - `packages/sidflow-classify/src/sid-native-features.ts` still rerenders from scratch when the trace sidecar is absent or corrupt.
  - `packages/sidflow-classify/src/feature-extraction-worker.ts` silently drops SID-native features when the sidecar is absent.
  - `packages/sidflow-classify/src/wav-render-settings.ts` does not record whether a cached WAV was rendered with trace capture.
- Export/schema surfaces already serialize merged `features_json` and the final vector; SQLite integrity work is primarily regression validation, not a new schema design.

### Recovery decisions

- `PLANS.md` was replaced wholesale because the previous active plan tracked unrelated work and was not authoritative for this task.
- The optimized path will enforce a stronger cache contract instead of keeping the second-render fallback alive by default.
- If backward compatibility for old WAV caches is needed, the cache should be rebuilt through the normal render pipeline, not backfilled by a second hidden playback pass.

### Recovery next step

- Implement render-sidecar metadata and cache invalidation rules, then remove the second-render fallback from SID-native extraction.

## 2026-03-23T12:06:43Z — Benchmark watchdog recovery and recovered run state

### Objective

- Resume the benchmarking phase without indefinite waiting by recovering the in-flight run state, enforcing a hard timeout policy, and switching the native comparison run to an actively monitored execution.

### Benchmark and validation commands

```bash
pgrep -af 'bun|sidplayfp|sidflow-classify|run-classify-sample|render' || true
find tmp/bench-single-pass-20260323 -maxdepth 3 -type f -printf '%TY-%Tm-%Td %TH:%TM:%TS %s %p\n' | sort
tail -n 40 tmp/bench-single-pass-20260323/wasm/classify.log
cat tmp/bench-single-pass-20260323/wasm/classify.elapsed_ms
cat tmp/bench-single-pass-20260323/wasm/classify.status
ls tmp/bench-single-pass-20260323/wasm/classified/*.jsonl | xargs wc -l
stat -c '%y' tmp/bench-single-pass-20260323/sidplayfp-cli/classify.log
stat -c '%s' tmp/bench-single-pass-20260323/sidplayfp-cli/classify.log
find tmp/bench-single-pass-20260323/sidplayfp-cli/audio-cache -name '*.wav' -size +0c | wc -l
find tmp/bench-single-pass-20260323/sidplayfp-cli/audio-cache -name '*.wav' -size 0c | wc -l
find tmp/bench-single-pass-20260323/sidplayfp-cli/tags -name '*.meta.json' | wc -l
cat tmp/bench-single-pass-20260323/wasm.sidflow.json
cat tmp/bench-single-pass-20260323/sidplayfp-cli.sidflow.json
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

### Benchmark and validation findings

- No active classify or sidplay benchmark PID was present when the recovery check ran, so the earlier sidplayfp-cli attempt was no longer executable/in flight and had to be treated as a terminated partial run.
- Recovered WASM benchmark result:
  - status: completed
  - songs processed: 200/200
  - total time: 65070 ms
  - per-song time: 325.35 ms/song
  - JSONL records: 200 classification records and 200 feature records
  - output root: `tmp/bench-single-pass-20260323/wasm`
- Recovered sidplayfp-cli partial state:
  - status: terminated partial
  - completed songs: 0 classified records written
  - elapsed time: approximately 3.08s based on first log timestamp `2026-03-23 11:50:44.564085` and last log mtime `2026-03-23 11:50:47.643100Z`
  - per-song time: not computable because no song completed classification end-to-end
  - partial artifacts: 197 metadata files, 8 zero-byte WAV placeholders, 0 non-empty WAV outputs, 0 classified JSONL files
  - log size: 1794 bytes
  - output root: `tmp/bench-single-pass-20260323/sidplayfp-cli`

### Benchmark and validation decisions

- Preserve the abandoned sidplayfp-cli partial run as evidence instead of overwriting it.
- Launch a fresh sidplayfp-cli rerun in a new output root with an explicit 10-minute wall-clock cap and 30-second progress checks.
- Use the same corpus and config shape as the recovered WASM/native configs: `workspace/hvsc`, `introSkipSec=20`, `maxClassifySec=20`, `maxRenderSec=45`, and `--limit 200 --sid-path-prefix C64Music/DEMOS`.

### Benchmark and validation next step

- Run the monitored sidplayfp-cli comparison benchmark, terminate it on timeout or stall, record full or partial metrics, then compare it directly against the completed WASM benchmark.

## 2026-03-23T12:14:56Z — Native rerun completed, comparison recorded, correctness validation started

### Commands run

```bash
node scripts/run-bun.mjs run packages/sidflow-classify/src/cli.ts \
  --config tmp/bench-single-pass-20260323/sidplayfp-cli-rerun.sidflow.json \
  --force-rebuild \
  --limit 200 \
  --sid-path-prefix C64Music/DEMOS

ls tmp/bench-single-pass-20260323/sidplayfp-cli-rerun/classified/*.jsonl | xargs wc -l
cat tmp/bench-single-pass-20260323/sidplayfp-cli-rerun/classify.status
cat tmp/bench-single-pass-20260323/sidplayfp-cli-rerun/classify.elapsed_ms
tail -n 40 tmp/bench-single-pass-20260323/sidplayfp-cli-rerun/classify.log

node scripts/run-bun.mjs run packages/sidflow-classify/src/cli.ts \
  --config tmp/bench-single-pass-20260323/wasm-validation.sidflow.json \
  --force-rebuild \
  --limit 10 \
  --sid-path-prefix C64Music/DEMOS/0-9

find tmp/bench-single-pass-20260323/wasm-validation/audio-cache -name '*.trace.jsonl' | wc -l
find tmp/bench-single-pass-20260323/wasm-validation/audio-cache -name '*.render.json' | wc -l
python - <<'PY'
import json
from pathlib import Path
from statistics import mean

repo = Path('/home/chris/dev/c64/sidflow')
wasm_path = repo / 'tmp/bench-single-pass-20260323/wasm/classified/classification_2026-03-23_11-49-26-303.jsonl'
native_path = repo / 'tmp/bench-single-pass-20260323/sidplayfp-cli-rerun/classified/classification_2026-03-23_12-07-53-011.jsonl'

def load_jsonl(path: Path):
    rows = []
    with path.open() as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows

wasm = load_jsonl(wasm_path)
native = load_jsonl(native_path)
wasm_by_key = {(row.get('sid_path'), row.get('song_index', 1)): row for row in wasm}
native_by_key = {(row.get('sid_path'), row.get('song_index', 1)): row for row in native}
shared = sorted(set(wasm_by_key) & set(native_by_key))

print('wasm_records', len(wasm))
print('native_records', len(native))
print('shared_records', len(shared))
print('wasm_only', len(set(wasm_by_key) - set(native_by_key)))
print('native_only', len(set(native_by_key) - set(wasm_by_key)))
print('wasm_sid_variant_count', sum(1 for key in shared if wasm_by_key[key].get('features', {}).get('sidFeatureVariant') == 'sid-native'))
print('wasm_sid_feature_field_count', sum(1 for key in shared if any(name.startswith('sid') for name in (wasm_by_key[key].get('features', {}) or {}))))
print('feature_versions', sorted({row.get('features', {}).get('featureSetVersion') for row in wasm + native if row.get('features', {}).get('featureSetVersion')}))
PY
```

### Findings

- The monitored `sidplayfp-cli` rerun completed within the policy window and never stalled.
- Watchdog snapshots showed steady forward progress at every 30-second check:
  - 30s: log 20498 bytes, 48 non-empty WAVs, log progress 40/200
  - 60s: log 39780 bytes, 87 non-empty WAVs, log progress 81/200
  - 90s: log 57188 bytes, 125 non-empty WAVs, log progress 116/200
  - 120s: log 77153 bytes, 165 non-empty WAVs, log progress 157/200
  - 150s: log 95115 bytes, 200 non-empty WAVs, log progress 195/200
- Final `sidplayfp-cli` benchmark result:
  - status: completed
  - songs processed: 200/200
  - total time: 220043 ms
  - per-song time: 1100.22 ms/song
  - JSONL records: 200 classification records and 200 feature records
  - output root: `tmp/bench-single-pass-20260323/sidplayfp-cli-rerun`
- Direct benchmark comparison:
  - WASM: 65070 ms total, 325.35 ms/song
  - sidplayfp-cli: 220043 ms total, 1100.22 ms/song
  - delta: sidplayfp-cli slower by 154973 ms total and 774.87 ms/song
  - ratio: sidplayfp-cli is 3.38x slower than WASM on this 200-song corpus
  - interval variance available for sidplayfp-cli only: throughput ranged from 35 to 41 songs per 30s interval, indicating a stable but render-bound slope rather than intermittent orchestration stalls
- Dominant measured bottleneck: playback/rendering, not JSONL writing or orchestration. Both engines used the same classify flow and output shape, but the native run spent substantially longer in the render/extract cycle while continuing to advance smoothly.
- Correctness validation branch was executed because the optimized WASM path materially outperformed the measured comparison baseline.
- Structural correctness checks passed for the two 200-song outputs:
  - both runs produced 200 records over the same `(sid_path, song_index)` keys
  - `featureSetVersion` was `1.3.0` in both runs
  - all 200 WASM records contained SID-native fields and `sidFeatureVariant: sid-native`
- Fresh cache-contract validation exposed a remaining regression on the current code path:
  - a fresh 10-song WASM validation run completed successfully in 23260 ms and emitted SID-native fields in JSONL output
  - however, the resulting cache contained `0` `.trace.jsonl` sidecars and `0` `.render.json` sidecars
  - this means the current correctness phase cannot yet certify the intended persisted single-pass cache contract, even though SID-native features are present in output records
- Follow-up source inspection narrowed the trace-sidecar half of that regression:
  - `packages/sidflow-classify/src/index.ts` currently removes `${job.wavPath}${SID_TRACE_EXTENSION}` immediately after feature extraction
  - the missing persisted `.trace.jsonl` sidecars are therefore at least partly caused by cleanup logic rather than a pure write failure
  - the missing `.render.json` sidecars remain unresolved and need a separate fix investigation

### Decisions

- Accept the completed `sidplayfp-cli` rerun as the comparison baseline for this benchmarking step.
- Choose branch A for the step-level next action because the optimized WASM path already shows a clear measured performance win over the comparison baseline.
- Continue correctness validation rather than adding another speculative performance change.
- Treat missing persisted `.trace.jsonl` / `.render.json` sidecars in the fresh WASM validation run as the next concrete defect to fix before calling the single-pass contract validated.

### Next step

- Investigate and fix why fresh WASM classify runs still omit persisted trace/render sidecars, then rerun the small WASM validation slice and proceed with broader correctness/export validation.

## 2026-03-23T12:31:28Z — Fixed 200-song rerun, SQLite export, and similarity playlist completed

### Commands run

```bash
node scripts/run-bun.mjs run packages/sidflow-classify/src/cli.ts \
  --config tmp/bench-single-pass-20260323/wasm-fixed-200.sidflow.json \
  --force-rebuild \
  --limit 200 \
  --sid-path-prefix C64Music/DEMOS

ls tmp/bench-single-pass-20260323/wasm-fixed-200/classified/*.jsonl | xargs wc -l
find tmp/bench-single-pass-20260323/wasm-fixed-200/audio-cache -name '*.trace.jsonl' | wc -l
find tmp/bench-single-pass-20260323/wasm-fixed-200/audio-cache -name '*.render.json' | wc -l
find tmp/bench-single-pass-20260323/wasm-fixed-200/audio-cache -name '*.wav' | wc -l
cat tmp/bench-single-pass-20260323/wasm-fixed-200/classify.status
cat tmp/bench-single-pass-20260323/wasm-fixed-200/classify.elapsed_ms
tail -n 40 tmp/bench-single-pass-20260323/wasm-fixed-200/classify.log

node scripts/run-bun.mjs run packages/sidflow-play/src/cli.ts export-similarity \
  --config tmp/bench-single-pass-20260323/wasm-fixed-200.sidflow.json \
  --output tmp/bench-single-pass-20260323/wasm-fixed-200/exports/sidcorr-wasm-fixed-200-full-sidcorr-1.sqlite \
  --profile full \
  --corpus-version wasm-fixed-200

bun run tmp/bench-single-pass-20260323/export-full-similarity.ts
bun run tmp/bench-single-pass-20260323/build-similar-playlist.ts \
  tmp/bench-single-pass-20260323/wasm-fixed-200/exports/sidcorr-wasm-fixed-200-full24-sidcorr-1.sqlite \
  sidcorr-wasm-fixed-200-full24-sidcorr-1
```

### Findings

- Fresh fixed WASM rerun completed successfully over the full 200-song target corpus.
- Corrected 200-song classify result:
  - status: completed
  - songs processed: 200/200
  - total time: 49702 ms
  - per-song time: 248.51 ms/song
  - JSONL records: 200 classification records and 200 feature records
  - persisted cache artifacts: 200 WAVs, 200 `.trace.jsonl` sidecars, 200 `.render.json` sidecars
  - output root: `tmp/bench-single-pass-20260323/wasm-fixed-200`
- Compared with the earlier recovered WASM benchmark (`65070 ms`), the corrected fixed-code rerun was faster by `15368 ms` on the same 200-song corpus while now preserving the expected sidecars.
- SQLite export validation succeeded twice:
  - CLI export produced a 4D legacy bundle with `200` tracks, `200` vectors, and `200` `features_json` rows.
  - Full-dimension export via `buildSimilarityExport(...)` produced a `sidcorr-1` bundle with `track_count: 200`, `vector_dimensions: 24`, `feature_schema_version: 1.3.0`, and checksum `193376310f720aa7181b2bb07ad31d6a75f9cd209aeaba0597c5d2b1f0ebbfdc`.
- Playlist generation from the full 24D SQLite export succeeded and produced a cohesive 10-song cluster under pairwise cosine similarity:
  - seed: `C64Music/DEMOS/A-F/Battle_Hymn_of_the_Republic_v1_BASIC.sid#1`
  - pairwise minimum similarity: `0.936783597639433`
  - pairwise average similarity: `0.9715301929564814`
  - pairwise maximum similarity: `0.9984339159614523`
  - playlist artifact: `tmp/bench-single-pass-20260323/wasm-fixed-200/exports/sidcorr-wasm-fixed-200-full24-sidcorr-1.playlist.json`
  - playlist report: `tmp/bench-single-pass-20260323/wasm-fixed-200/exports/sidcorr-wasm-fixed-200-full24-sidcorr-1.playlist-report.json`
- Full export vector diversity confirms the playlist was not built from the degenerate 4D projection:
  - vector length: `24`
  - distinct exported vectors: `200/200`

### Decisions

- Keep the CLI-driven 4D export as a compatibility check, but use the full-dimension export as the authoritative proof for playlist similarity because the legacy projection compressed the 200-track corpus down to only 8 distinct vectors.
- Treat the corrected 200-song rerun plus the 24D export as the end-to-end artifact set for this task.

### Next step

- Run the broader validation gate required by the repo (`bun run build`, then `bun run test` three consecutive times) before calling the branch fully complete.

## 2026-03-23T18:30:00Z — Performance investigation: classification throughput regression

### Context

Classification throughput has regressed from ~9 songs/s to ~6.5 songs/s. CPU utilization oscillates between 50% and 10%, averaging ~30% on a 20-core machine. This section documents the measurement-driven investigation.

### Environment

- 20 logical CPUs, Linux 6.17.0-19-generic, Bun 1.3.10
- 61,275 SID files in HVSC collection
- Config: introSkipSec=15, maxClassifySec=15, maxRenderSec=30, WASM engine, threads=0 (auto)

### Constant features finding (backlog)

Analyzed 500 records from `data/classified/features_2026-03-23_18-13-03-454.jsonl`:
- 8 SID features are always zero across all records (sidArpeggioActivity, sidFilterMotion, sidPwmActivity, sidRegisterMotion, sidRhythmicRegularity, sidSamplePlaybackActivity, sidSyncopation)
- Many more are quantized to simple fractions (0, 1/3, 1/2, 2/3, 1)
- Filed as backlog item in PLANS.md — separate from the throughput investigation

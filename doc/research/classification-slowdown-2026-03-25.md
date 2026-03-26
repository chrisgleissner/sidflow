# Classification Slowdown Investigation - 2026-03-25

## Summary

The reported slowdown near 70-75% completion was traced to a visibility gap in the classification pipeline rather than evidence of workers deadlocking mid-run.

`generateAutoTags()` already does two distinct phases:

1. a concurrent per-song render + feature-extraction pass
2. a second serialized pass that:
   - finalizes the dataset-normalized rating model
   - re-reads `features_*.jsonl`
   - computes final ratings/vectors
   - writes `classification_*.jsonl`

Before this change, the wrapper and web progress plumbing primarily surfaced the first phase (`Extracting Features`). That made the late serialized pass look like a stall even though the process was still doing CPU-bound work.

## Evidence

### Code path

- `packages/sidflow-classify/src/index.ts`
  - concurrent extraction happens inside `runConcurrent(...)`
  - after that completes, the code flushes `features_*.jsonl`, finalizes the deterministic rating model, then iterates every intermediate record again to emit final classification rows

### Bounded verification

A bounded classify run against the checked-in `test-data` corpus produced this lifecycle:

- `run_start`
- `song_queued`
- `song_start`
- `render_start` / `render_complete`
- `feature_extraction_start` / `feature_extraction_complete`
- `features_persisted`
- `rating_model_build_start` / `rating_model_build_complete`
- `song_complete`
- `run_complete`

The same run now prints explicit late phases:

- `Building Rating Model`
- `Writing Results`

That confirms the formerly hidden work after feature extraction.

## Root cause

The apparent slowdown came from two coupled issues:

1. **Real late serialized work**  
   Classification is not finished when feature extraction completes. The pipeline still has to build the normalized model and write final classification records for the full dataset.

2. **Insufficient lifecycle reporting**  
   The similarity-export wrapper and classify progress parser did not distinguish this post-extraction phase clearly enough, so operators saw CPU activity with little/no meaningful progress explanation.

## Changes made

- Added a separate per-song lifecycle telemetry stream:
  - `classification_<timestamp>.events.jsonl`
- Added wrapper-level run metadata logging:
  - `tmp/runtime/similarity-export/run-events.jsonl`
- Captured the top-level command context via environment passthrough so classification telemetry includes:
  - command
  - mode
  - fullRerun
  - cwd
- Surfaced explicit post-extraction phases in stdout/progress parsing:
  - `Building Rating Model`
  - `Writing Results`

## Operational note

The full `scripts/run-similarity-export.sh` wrapper could not be exercised to completion in this sandbox because `ffmpeg` is not installed. The wrapper-side `run_start` artifact was still verified, and the actual classification lifecycle was verified end-to-end with the same command context against `test-data`.

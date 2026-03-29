# Handover: skip-hole fix and post-classification completion

**Branch:** `fix/oome`  
**PR:** [#89 — Fix OOME during HVSC classification](https://github.com/chrisgleissner/sidflow/pull/89)  
**Date of handover:** 2026-03-29  

---

## What has been done

### Root cause found and fixed

`packages/sidflow-classify/src/index.ts` had a silent data-loss bug in `flushIntermediate()`.

When any job at queue index N fails with a WASM error (`isSkippableSidError`), the slot at key N is
never placed in `intermediateBuffer`. `flushIntermediate` starts from `nextIntermediateIndex = 0`
and advances only over contiguous filled slots. A gap at index 0 (or any earlier index) permanently
blocks every result behind it from being written to disk — producing 0 JSONL records even when
tens of thousands of songs were processed successfully.

**Three changes were made to `packages/sidflow-classify/src/index.ts`:**

1. Added `const skippedIntermediateIndices = new Set<number>();` near the `flushIntermediate`
   closure.
2. In `flushIntermediate`, at the top of its `while (true)` loop, added a secondary advance:
   ```typescript
   while (skippedIntermediateIndices.has(nextIntermediateIndex)) {
     skippedIntermediateIndices.delete(nextIntermediateIndex);
     nextIntermediateIndex += 1;
   }
   ```
3. At the `isSkippableSidError` early-return site, registered the skipped slot and triggered a
   flush before returning:
   ```typescript
   skippedIntermediateIndices.add(context.itemIndex);
   intermediateFlushChain = intermediateFlushChain.then(flushIntermediate);
   return;
   ```

### Regression test added

`packages/sidflow-classify/test/high-risk-render-failure.test.ts` received:

- A `silentWav()` helper (44-byte RIFF header, 0 samples) for lightweight render mocks.
- A new `describe` block: **"Skip-hole regression — songs after a WASM-skipped slot are still
  classified"** with one test:
  - Uses `sidPathPrefix: "MUSICIANS/G"` (present in `test-data/`).
  - Selective render mock: throws a WASM-signature error for `Garvalf/...` (alphabetically first →
    index 0), writes a silent WAV for `Greenlee_Michael/Foreign_Carols.sid` (index 1).
  - Asserts `result.jsonlRecordCount > 0` — would be 0 without the fix.
- Test result: **2 pass, 0 fail** (both the original high-risk test and the new regression test).

### HVSC full classification completed

`scripts/classify-hvsc.sh` was re-run after the fix. Outcome (log: `tmp/hvsc-classify-2.log`):

| Attempt | Phase             | Records   | Exit |
|---------|-------------------|-----------|------|
| 1       | salvage           | 5         | 0    |
| 1       | main classify     | **58,745**| 0    |

- **Files processed:** 88,045 (full corpus)
- **Skipped (already classified):** 29,300 (from prior sessions)
- **Newly classified:** 58,745
- **Total coverage:** 88,045 (29,300 + 58,745 = 100%)
- **JSONL artifact:** `data/classified/classification_2026-03-28_23-19-21-962.jsonl` (137 MB,
  58,745 lines)
- **Duration:** ~11 minutes
- **SIGILL / OOM:** none (warm WAV cache; 141,645 cached WAVs)

All previous JSONL files remain in `data/classified/`. `build:db` deduplicates by song key using
the latest record per song, so stale partials from the pre-fix crash runs will be superseded.

---

## What remains to be done

Work must proceed in the following strict order. Do not skip gates.

### Gate 1 — Full test suite × 3 (MANDATORY BEFORE ANYTHING ELSE)

Per `AGENTS.md` rules, 100 % pass rate on three consecutive runs is required. The targeted
classify tests already pass (2 pass, 0 fail confirmed). You must now run the full suite.

```bash
cd /home/chris/dev/c64/sidflow

for run in 1 2 3; do
  log="tmp/test-run-${run}-$(date +%Y%m%dT%H%M%S).log"
  scripts/run-with-timeout.sh 7200 -- bun run test > "$log" 2>&1
  status=$?
  echo "=== Run ${run} exit=${status} ==="
  tail -5 "$log"
  grep -E "^[[:space:]]+[0-9]+ (pass|fail)" "$log" | tail -3
  [[ $status -ne 0 ]] && { echo "STOP — run ${run} failed. Fix all failures before retrying."; break; }
done
```

**Acceptance:** All three runs exit 0 with a literal `0 fail` line in their tails. Paste the actual
tail of each log as evidence before declaring this gate done.

**Known environment caveat:** `scripts/run-bun.mjs` forces `SIDFLOW_MAX_THREADS=1` during
`bun test`. Thread-count-sensitive tests must account for this (see `WORKLOG.md` 2026-03-26
entry). Do not mistake a harness-forced thread count for a product bug.

**If any test fails:**
- Check whether it is a pre-existing failure (look at `WORKLOG.md` for the last known baseline).
- Fix it. Do not note it and move on. See the `AGENTS.md` non-negotiable rules.

---

### Gate 2 — Rebuild the LanceDB from the full classification corpus

The `data/sidflow.lance.manifest.json` and `data/model/` directory exist but were built from an
incomplete prior corpus. They must be rebuilt from all classification JSONL files now that the full
88,045-song corpus is in `data/classified/`.

```bash
cd /home/chris/dev/c64/sidflow
scripts/run-with-timeout.sh 3600 -- \
  /usr/bin/time -v \
  bun run build:db \
  > tmp/build-db-$(date +%Y%m%dT%H%M%S).log 2>&1
echo "exit=$?"
```

**What `build:db` does:** Reads all `data/classified/classification_*.jsonl` files, deduplicates
by song key (latest wins), merges any feedback JSONL from `data/feedback/`, builds a LanceDB
vector table in `data/model/`, and writes `data/sidflow.lance.manifest.json`.

**Acceptance:**
- Script exits 0.
- `data/sidflow.lance.manifest.json` is updated (mtime changes).
- Log reports the deduplication count, which should reflect an effective corpus close to 88,045
  unique songs (a small number of songs that appear in multiple JSONL files will be collapsed to
  their latest version).

**If it fails:** Read the log carefully. Common causes: missing config key, stale manifest from
wrong schema version, or LanceDB file-lock from a prior interrupted run. Use `bun run
validate:config` to check the config first.

---

### Gate 3 — Validate the five persona stations

This proves that the station runtime works correctly on the full real corpus.

```bash
cd /home/chris/dev/c64/sidflow

REPORT="tmp/persona-validation-$(date +%Y%m%dT%H%M%S).md"
scripts/run-with-timeout.sh 600 -- \
  /usr/bin/time -v \
  bun scripts/validate-persona-radio.ts \
    --config .sidflow.json \
    --station-size 100 \
    --report "$REPORT" \
  > "${REPORT%.md}.log" 2>&1
status=$?
echo "exit=$status"
cat "$REPORT"
```

The script requires no `--db` argument if the LanceDB manifest points to `data/model/` (via
`.sidflow.json`). If it requires a SQLite export bundle (see the help text), first run:

```bash
bun run export:similarity
```

to produce the SQLite export before running the persona validator.

**Five personas that must pass:**

| Persona ID         | Label           | Predicate (simplified)                     |
|--------------------|-----------------|--------------------------------------------|
| `pulse_chaser`     | Pulse Chaser    | energy ≥ 4 AND mood ≤ 2 AND complexity ≤ 2 |
| `dream_drifter`    | Dream Drifter   | mood ≥ 4 AND energy ≤ 2                    |
| `maze_architect`   | Maze Architect  | complexity ≥ 4 AND mood ≤ 2                |
| `anthem_driver`    | Anthem Driver   | energy ≥ 4 AND mood ≥ 4                    |
| `noir_cartographer`| Noir Cartographer | mood 3–4 AND complexity ≥ 3              |

**Acceptance per persona:**
- Full station size (100 tracks) produced.
- `contaminationCount === 0`.
- Cross-persona overlap = 0 for every pair.
- Own-persona similarity > nearest-other-persona similarity.

**If validation fails:**
- Check whether the LanceDB corpus has enough tracks per persona tag bucket. If the corpus is
  sparse in a bucket, increase `--station-size` only as a diagnostic step; the real fix is to
  verify that the classification JSONL contains the expected `e`, `m`, `c` values.
- Check whether the station runtime can read the export DB at the path `.sidflow.json` specifies.
- Do not adjust persona predicates to paper over classification quality gaps without documenting
  the gap explicitly.

---

### Gate 4 — Update PLANS.md and WORKLOG.md

After all gates above pass, update both files:

**PLANS.md:**
- Mark Phase 17 step 1 (confirm CLI contract) and step 5 (execute full HVSC classify/export) as
  `[done]`.
- Mark Phase 19 step 5 validation as `[done]`.
- Record the literal Gate 1 / Gate 2 / Gate 3 pass evidence in the Progress section.

**WORKLOG.md:**
- Add a dated entry (2026-03-29) recording:
  - The skip-hole root cause and fix summary.
  - The HVSC classify-2 run counts (88,045 covered, 1 attempt, 137 MB JSONL).
  - The test suite pass evidence (3 × 0 fail).
  - The build:db output artifact paths and deduplication count.
  - The persona validation report path and pass/fail per persona.

---

## Key files modified in this session

| File | Change |
|------|--------|
| `packages/sidflow-classify/src/index.ts` | Added `skippedIntermediateIndices` Set + advance loop in `flushIntermediate` + register-and-flush at WASM skip site |
| `packages/sidflow-classify/test/high-risk-render-failure.test.ts` | Added `silentWav()` helper + skip-hole regression test (describe block at EOF) |

No other files were modified. The `cli.ts` `--resume-from-features` flag and the `classify-hvsc.sh`
crash-retry wrapper are from the prior session and remain unchanged.

---

## Artifact inventory

```
data/classified/
  classification_2026-03-28_21-29-02-372.jsonl   29,094 lines  (Attempt 1 pre-crash)
  classification_2026-03-28_21-30-15-397.jsonl      991 lines  (Attempt 2 partial)
  classification_2026-03-28_21-38-59-997.jsonl   27,234 lines  (Attempt 3 salvage)
  classification_2026-03-28_21-53-39-699.jsonl   27,234 lines  (Attempt 4 salvage dup)
  classification_2026-03-28_22-50-09-480.jsonl        5 lines  (Attempt 4 salvage fix)
  classification_2026-03-28_23-19-07-322.jsonl        5 lines  (Attempt 1 salvage, new run)
  classification_2026-03-28_23-19-21-962.jsonl   58,745 lines  ← DEFINITIVE post-fix run
tmp/hvsc-classify-2.log                                        ← full classify log for new run
workspace/audio-cache/                                         ← 141,645 WAV + hash files
workspace/tags/                                                ← 452 auto-tags.json files
data/model/                                                    ← stale LanceDB (rebuild needed)
data/sidflow.lance.manifest.json                               ← stale manifest (rebuild needed)
```

---

## Anti-stall rules (inherited from hvsc-end-to-end-convergence-prompt.md)

1. Every long-running command must be wrapped in `scripts/run-with-timeout.sh` and stdout/stderr
   redirected to a file under `tmp/`.
2. Never rerun a command just because a terminal was cancelled. Read the log file first.
3. Never advance to the next gate until the current gate has produced literal pass evidence.
4. If the same failure recurs twice, stop and document the invariant before trying anything new.
5. `bun run test` forces `SIDFLOW_MAX_THREADS=1` via `run-bun.mjs`. Account for this in
   thread-sensitive tests before calling them product bugs.

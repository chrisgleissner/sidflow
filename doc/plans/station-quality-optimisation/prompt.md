# Station quality optimisation — continuation on a fast machine

Pick this up on the fast rig (i7-14600K, 64 GiB). Everything below is already
committed; nothing needs rebuilding except the corpus.

---

## Goal

Make SIDFlow's radio stations demonstrably better — both "songs similar to this
one" and category stations — and prove it with numbers that would survive
someone hostile reading them. This ships to tens of thousands of users, so a
claimed improvement that is really noise is worse than no improvement.

---

## What is already established (do not redo)

- **Both SID engines are fit for classification.** On a 500-file / 711-track
  systematic HVSC sample, neighbour quality is statistically indistinguishable
  (paired difference −0.0031, 95% CI [−0.0092, +0.0034]); SIDLite is 5.92x
  faster. See `doc/engine-comparison.md`.
- **The 24-dimension vector is intact and informative** — 17 dimensions needed
  for 90% of variance. It is no longer truncated to 4 (fixed in `3612959`).
- **The distance metric is not the bottleneck.** Weighted cosine 1.0999, raw
  Euclidean 1.0993, z-scored Euclidean 1.0991 on the spectral anchor — four
  different functions, no meaningful difference.
- **Similarity genuinely works**: neighbours share a composer 9.41% of the time
  against a 0.99% chance rate — **9.47x lift**.
- **Category stations are the weak half.** e/m/c use 3 of 5 levels with
  83% / 93% / 91% in a single bucket. A mood filter where 93% of tunes are "3"
  cannot build a distinctive station.

---

## Pre-registered protocol — do not renegotiate mid-run

This is the part that makes the result trustworthy. It was written before any
optimisation was run. Changing it after seeing results invalidates everything.

| | |
|---|---|
| **Split** | train / validation / test, **grouped by composer** so no composer spans slices |
| **Primary metric** | nDCG@10 on group retrieval (HVSC composer/production labels) |
| **Guardrails** | station diversity, rare-group (cold-start) nDCG — neither may regress >5% relative |
| **Selection** | on validation only |
| **Test set** | touched **exactly once**, at the very end |
| **Statistics** | paired bootstrap per candidate, **Holm-corrected** across every candidate tried |
| **Stopping rule** | 3 consecutive candidates failing to beat the incumbent on validation |
| **Success** | ≥20% relative gain in test nDCG@10, Holm-adjusted p<0.05, guardrails intact |

**If the headroom is not there, report that.** A truthful "no significant
improvement available from re-ranking; the real limit is X" is a good outcome.
The harness already enforces this: on the small 711-track corpus it correctly
refused to crown a candidate showing +212% because the adjusted p was 0.95.

---

## Step 1 — classify the full HVSC corpus

Accuracy is the priority and this is a one-time cost, so use **reSIDfp**, the
cycle-accurate reference. My own comparison found no measurable station-quality
difference from SIDLite, but reSIDfp removes the one known asymmetry (SIDLite has
been observed to drop `spectralContrastMean` on some very quiet subsongs) and
this corpus is the authoritative artefact many users will consume.

```bash
bun install --frozen-lockfile
bun run build
bun run roms:fetch            # C64 ROMs; verified against pinned SHA-256

# ~18-24 h on a 14600K. Run it under tmux/nohup.
SIDFLOW_SID_ENGINE=residfp bash scripts/sidflow-classify --force-rebuild

# Neighbours are needed by the analysis; --dims defaults to `auto` (24-dim).
bun run export:similarity -- --profile full --neighbors 25 \
  --corpus-version hvsc-full --output data/exports/hvsc-full.sqlite
```

Sanity-check before spending a day on it: run `--limit 500` first and confirm
`select render_engine, count(*) from tracks group by 1` says `residfp`, and that
the manifest reports `vector_dimensions: 24`.

**Do not mix engines within one corpus.** Features derive from rendered audio;
the export records a single `render_engine`.

---

## Step 2 — run the optimisation loop

Cheap: it operates on the already-exported vectors, no re-rendering. Seconds to
minutes per candidate.

```bash
bun run scripts/station-quality/optimise.ts \
  --db data/exports/hvsc-full.sqlite \
  --max-tracks 20000 \
  --json workspace/station-opt/optimisation.json
```

**Memory.** Each candidate builds a full pairwise distance matrix: `8n²` bytes,
with 2-3 live at once.

| tracks | per matrix | peak (approx) |
|---|---|---|
| 12,000 | 1.2 GB | ~4 GB |
| 20,000 | 3.2 GB | ~10 GB — recommended on 64 GiB |
| 30,000 | 7.2 GB | ~22 GB — possible, slower |
| 87,000 | 60 GB | **will not fit** |

Tuning on a 20k grouped subsample is not a compromise: the confidence intervals
depend on the number of *seeds*, not corpus size, and 20k gives intervals far
tighter than the effects being chased. The full 87k corpus is still what gets
exported and served — only this offline loop subsamples.

---

## Step 3 — techniques already implemented

In `scripts/station-quality/optimise.ts`, all evaluated automatically:

1. baseline (raw + weighted cosine — what ships today)
2. raw + Euclidean
3. z-score + Euclidean
4. rank-Gaussian + Euclidean
5. PCA whitening + Euclidean
6. rank-Gaussian + cosine
7. learned diagonal weights (coordinate ascent on train nDCG only)
8. **mutual proximity** — hubness correction, a documented pathology in music
   similarity where a few tracks become everyone's neighbour
9. **k-reciprocal re-ranking** (Zhong et al. 2017)
10. α-query expansion
11. rank-Gaussian + MP + k-reciprocal
12. learned weights + MP

Worth adding if headroom remains: MMR diversification at station-assembly time,
learned low-rank projection (regularised — a full matrix will overfit), and
per-dimension nonlinear transforms for the skewed features.

---

## Step 4 — the other half: category stations

Similarity stations work (9.47x lift). Category stations are limited by rating
collapse: 3 of 5 levels used, >90% in one bucket for mood and complexity.

The fix is calibration, not more features: map features to **corpus quantiles**
so all five levels are populated by construction, instead of clamped z-scores
that pile everything on the mean. Start at
`packages/sidflow-classify/src/deterministic-ratings.ts`. Success criterion:
roughly uniform level occupancy, and `ratingSpread` entropy near log2(5)=2.32
bits, without similarity nDCG regressing.

---

## Step 5 — deliverables

1. Winning configuration implemented in the product path, not just the script.
2. Regression test pinning the improvement so it cannot silently rot.
3. `doc/station-quality.md`: protocol, every candidate tried **including the
   failures**, test-set numbers with CIs, and honest limitations.
4. Regenerate and publish `sidflow-data` — the published exports still carry
   broken-engine audio *and* 4-dimension vectors, so none of this reaches users
   until they are rebuilt.

---

## Traps that have already cost time here

- **Do not evaluate on the test set until the end.** The harness keeps it
  separate; keep it that way.
- **Do not split by track.** Two tunes by one composer either side of the split
  leaks the label. `splitByGroup` handles this.
- **Exclude same-file subsongs** from retrieval. Retrieving another subsong of
  the tune already playing is trivially "same composer" and inflates every score.
  Already handled — do not remove it.
- **The spectral anchor is a proxy**, and a weak one: it measures spectral shape
  and cannot see melody or arrangement. It understated quality badly (ratio 1.09
  versus the composer test's 9.47x lift). Use it as a guardrail, not a target.
- **Re-running `bun run build` or the worklet build rewrites
  `packages/sidflow-web/public/wasm/`.** That is intentional; let it, and commit
  the result rather than hand-editing.

---

## Files

| Path | Purpose |
|---|---|
| `scripts/station-quality/metrics.ts` | Pre-registered metric definitions |
| `scripts/station-quality/harness.ts` | Grouped split, nDCG@k, paired bootstrap, Holm |
| `scripts/station-quality/optimise.ts` | The candidate loop |
| `scripts/engine-comparison/` | Engine study, reusable for re-validation |
| `doc/engine-comparison.md` | Findings from the engine comparison |

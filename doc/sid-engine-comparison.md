# Which SID emulation should the published corpus be rendered with?

**Status: pre-registered. Written and committed before any comparison result was
computed.** Sections 1-5 fix the question, the design, the endpoints and the decision
rule in advance. Section 6 is filled in afterwards and may not alter anything above it.

## 1. The question

SIDFlow can render with either of two emulations:

| Engine | What it is | Measured speed here |
|---|---|---|
| `residfp` | The cycle-accurate reference. The WASM build is checked against a natively compiled libsidplayfp in CI (`.github/workflows/engine-parity.yaml`). | ~1.7 tracks/s |
| `sidlite` | A faster approximation. No independent reference to check against. | ~10-12 tracks/s |

reSIDfp is by construction the more faithful reproduction of the hardware. That is not
the question. The question is narrower and empirical:

> Does the choice of emulation change SIDFlow's **classification** enough to change the
> stations a listener gets?

This matters because the difference in cost is large and certain — roughly 14 hours
against 2 for one pass over HVSC — while the difference in outcome is unknown.

## 2. Why the answer is not obvious in either direction

The 58-dimension similarity vector does not depend on the emulation uniformly:

| Group | Count | Derived from | Can the engine affect it? |
|---|---|---|---|
| Perceptual | 24 | The rendered WAV | **Yes** — directly |
| Tonal | 11 | The SID register write trace | No |
| Playroutine | 15 | The SID register write trace | No |
| Driver shape | 8 | The SID register write trace | No |

The register trace is produced by the 6502 and driver emulation and records what the
program *wrote to the chip*. It does not pass through the audio model at all, so those
34 dimensions are identical under both engines by construction, not by measurement.

This has a consequence the design must handle. An engine effect can only enter through
24 of 58 dimensions, and those 24 are the *weaker* half: the campaign in
[station-quality.md](station-quality.md) measured the 24-dimension vector at nDCG@10
0.2340 against 0.5392 for all 58. A test on the full vector could therefore return "no
difference" simply because the dimensions that carry most of the retrieval signal
cannot differ — which would be a true statement about the shipped system but a
misleading one about the engines.

So the WAV-derived subspace is tested **separately**, where an effect can actually
appear, and the full vector is tested as well because that is what ships.

## 3. Design

Paired. The same tracks, the same code, the same split, the same seeds — the engine is
the only thing that differs.

- **Corpus.** The 23,817 tracks that were classified with reSIDfp before that run was
  stopped, re-rendered with SIDLite. Comparison is on the intersection by
  `sid_path#song_index`.
- **Not a random sample.** Those tracks are a queue-order prefix of HVSC, not a random
  draw, so they over-represent whatever sorts early. This limits how far the result
  generalises to the rest of the collection and is reported as a limitation rather
  than argued away. It does not bias the *paired* contrast: both engines see exactly
  the same tracks.
- **Split.** `splitByGroup` by composer directory, identical partition for both
  engines, so no track is in train for one arm and test for the other.
- **Ratings.** The deterministic rating model is corpus-fitted, so it is fitted
  separately within each arm on that arm's train split. Fitting one model across both
  would leak one engine's distribution into the other's ratings.

## 4. Endpoints

**Co-primary** (the two that can trigger a decision):

1. nDCG@10, composer-grouped retrieval, held-out test split, **restricted to the 24
   WAV-derived dimensions**. This is where an engine effect can exist.
2. nDCG@10 on the **full 58-dimension shipped vector**. This is what listeners get.

**Secondary, mechanistic** — these explain a result, they do not decide it:

3. Per-dimension Spearman ρ between engines across the 24 WAV-derived dimensions.
4. Whole-vector cosine similarity between the two renderings of each track.

**Secondary, product-level:**

5. Agreement of the 1-5 energy/mood/complexity ratings: exact agreement and
   quadratic-weighted κ. Category stations are assembled from these, so a disagreement
   here reaches listeners even if retrieval is unchanged.

**Guardrails** — a win on a co-primary is void if either regresses by more than 5%
relative:

6. Cold-start nDCG@10 (seeds whose composer has ≤3 tracks).
7. Category-station mood entropy.

## 5. Decision rule

Fixed in advance:

> Adopt **reSIDfp** only if it wins a co-primary endpoint: the paired bootstrap
> difference (reSIDfp − SIDLite) is positive with p < 0.05 after Holm correction across
> the two co-primaries, **and** the point estimate is a relative gain of at least 1%,
> **and** neither guardrail regresses by more than 5% relative.
>
> Otherwise adopt **SIDLite**.

The asymmetry is deliberate and is the point of pre-registering. reSIDfp's cost is
certain and large; its benefit for *this task* is what is being tested. A null result
means the extra cost bought nothing measurable, so the default on a null is the cheaper
engine. Equally, a real gain of even 1% on station quality is worth 12 extra hours of
machine time on a corpus that is rendered once and then published, so the bar is set
low rather than at some conventional effect size.

Statistics follow the campaign: paired bootstrap over per-seed nDCG (10,000 resamples),
Holm-Bonferroni across the co-primary family, 95% CIs reported throughout.

## 6. Result

23,817 paired tracks, both arms at feature schema 1.5.0, identical split.

### Co-primary endpoints

| Endpoint | reSIDfp | SIDLite | Relative | 95% CI on difference | p | Holm p |
|---|---|---|---|---|---|---|
| nDCG@10, **24 WAV-derived dims** | 0.3221 | 0.3173 | **+1.49%** | [0.0002, 0.0094] | 0.0424 | **0.0848** |
| nDCG@10, **full 58-dim vector** | 0.5442 | 0.5421 | +0.40% | [−0.0005, 0.0049] | 0.1224 | 0.1224 |

### Guardrails

| | reSIDfp | SIDLite | Relative |
|---|---|---|---|
| Cold-start nDCG@10, 24 dims | 0.0615 | 0.0766 | **−19.71%** |
| Cold-start nDCG@10, 58 dims | 0.0550 | 0.0542 | +1.39% |

### Decision: **SIDLite**

Two independent reasons, either sufficient under the rule fixed in §5:

1. **Neither co-primary clears the bar.** The WAV-subspace gain of +1.49% is nominally
   significant at p=0.0424 but does not survive Holm correction across the two
   co-primaries (0.0848). On the full shipped vector the effect is +0.40% at p=0.1224.
2. **A guardrail fails, in reSIDfp's own strong subspace.** reSIDfp is 19.71% *worse*
   on cold-start retrieval over the 24 WAV dimensions — far past the 5% limit. That
   voids a co-primary win even if one had been established.

**The honest reading is not "no difference".** There is a small, directionally
consistent reSIDfp advantage exactly where theory predicts one: in the WAV-derived
subspace, the only place the audio model can act. It is roughly +1.5%, it is at the
edge of detectability with 23,817 paired tracks, and it shrinks to +0.4% in the vector
that actually ships because 34 of 58 dimensions are engine-identical by construction.

So the finding is that reSIDfp is *very slightly better at the thing it should be
better at*, and that this is diluted to near-nothing by the time it reaches a listener.
Against roughly 7x the wall-clock for a corpus pass, it does not pay.

### Why the effect is so diluted

| Group | Count | Engine can affect it | nDCG@10 alone |
|---|---|---|---|
| Perceptual (WAV) | 24 | Yes | 0.3221 / 0.3173 |
| Trace-derived | 34 | No | — |
| Combined | 58 | Partially | 0.5442 / 0.5421 |

The 24 WAV dimensions contribute 0.32 of the 0.54; the 34 trace dimensions supply the
rest and are byte-identical between engines. Any engine effect is therefore attenuated
roughly in proportion to how much of the signal it can touch.

### Mechanistic agreement

| | |
|---|---|
| Median per-dimension Spearman ρ, 24 WAV dims | **0.9896** |
| Weakest dimension | `inharmonicityWav` ρ 0.6198 |
| Next weakest | `rhythmicRegularityFused` 0.7852, `mfccResidual2` 0.8666 |
| Per-track cosine over the full 58-dim vector | p50 **0.9992**, p01 0.8887, min 0.3681 |

`inharmonicityWav` being the weakest replicates the earlier 500-file result (ρ 0.70
there) — it is a spectral roughness measure, so it is the dimension most exposed to
differences in the audio model. The `min 0.3681` matters: a median of 0.9992 does not
mean every track agrees, and a small number diverge substantially.

### Rating agreement, which category stations filter on

| Dimension | Exact | Within 1 | Quadratic-weighted κ |
|---|---|---|---|
| Energy | 55.1% | 94.7% | 0.8337 |
| Mood | 59.8% | 94.6% | 0.8226 |
| Complexity | 76.1% | 97.0% | 0.8897 |

This retires the argument that first motivated reSIDfp. The earlier Cohen's κ of
0.435–0.533 was computed on a collapsed 3-level distribution with over 90% of tracks in
one bucket, where κ deflates badly. Measured on the calibrated 5-level scale that now
ships, agreement is 0.82–0.89 — substantial by any conventional reading.

### The original argument for reSIDfp does not survive either

reSIDfp was first adopted because SIDLite was believed to drop `spectralContrastMean`,
one of the 24 raw inputs to the perceptual vector. Measured on these same paired tracks:

| | reSIDfp | SIDLite |
|---|---|---|
| `spectralContrastMean` missing | 54 (0.227%) | 51 (0.214%) |
| Affected under **both** engines | 21 | 21 |

reSIDfp drops it slightly more often. And because only 21 of ~54 affected tracks overlap,
the dropout follows marginal audio conditions in particular tunes rather than the
emulation. Missing values are imputed to the corpus mean, so no NaN reaches a vector.

### Limitations

- **The corpus is a queue-order prefix, not a random sample** of HVSC, as stated in §3.
  It over-represents whatever sorts early. This bounds generalisation to the rest of
  the collection; it does not bias the paired contrast, since both engines saw exactly
  the same 23,817 tracks.
- **Cold-start values here are far below the development corpus** (0.055 against
  0.2453 for 58 dimensions). That is a property of group structure, not of the engines:
  the development corpus was deliberately built group-uniform, while this prefix has
  many composers represented once. The cold-start guardrail is correspondingly noisier
  here, which is worth remembering when reading the −19.71%.
- **A defect in the analysis was found and fixed before these numbers were accepted.**
  The per-dimension section originally looked up the 24 perceptual dimension *names* as
  raw feature keys. Those dimensions are computed by `buildPerceptualVector` from
  several raw features each, so no such key exists, every lookup returned undefined,
  and the section reported `NaN` for all 24 while appearing to run. It now compares the
  built vector columns. The co-primary endpoints never used that path and are
  unaffected.

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

*To be completed after the measurement runs. Nothing above this line may be edited
once results are known.*

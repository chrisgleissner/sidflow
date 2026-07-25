# SID engine comparison: reSIDfp vs SIDLite

**Question.** SIDFlow ships two SID emulations. Are both suitable for classifying a
corpus, or is one materially worse? And how long does a full HVSC pass take?

**Answer.** On a 500-file / 711-track systematic sample of HVSC, the two engines are
**statistically indistinguishable** in the only measure that matters for stations —
how acoustically close the neighbours they propose actually are — while SIDLite is
**5.9x faster end to end**. SIDLite is the right default. reSIDfp remains the
cycle-accurate reference and stays one flag away.

Reproduce with:

```bash
bun run scripts/engine-comparison/select-corpus.ts 500
bash scripts/engine-comparison/run-comparison.sh
bun run scripts/engine-comparison/analyze.ts
```

---

## 1. What "accuracy" can honestly mean here

There is no labelled ground truth for *"these two SID tunes are similar"*. Any claim
of classification accuracy therefore has to be anchored to something external, and
the choice of anchor decides what the number is worth. Two are used here, kept
separate because they answer different questions:

**Anchor A — reSIDfp as reference.** reSIDfp is a cycle-accurate model of the MOS
6581/8580, validated in this repository against a native `libsidplayfp` build at the
same pinned refs (`.github/workflows/engine-parity.yaml`). Deviation from it is
*error*, not merely difference. But this makes reSIDfp trivially perfect by
construction, so **anchor A cannot rank the engines** — it can only quantify how far
SIDLite sits from the reference.

**Anchor B — an engine-independent acoustic anchor.** For every track a timbre
fingerprint is computed directly from the rendered WAV: energy in 12 log-spaced
bands from 40 Hz to 15 kHz, log-scaled and mean-removed so overall loudness drops
out and only spectral shape remains. It shares no code with the classification
pipeline, so it cannot rubber-stamp the features it is judging. **Anchor B carries
the recommendation**, because it privileges neither engine.

### The critical control

Anchor B is only meaningful if both engines are judged in **one** fingerprint space.
Scoring each engine against its own rendering would conflate two different things:

1. how good its feature vector is at picking similar tunes (a property of the
   classifier), and
2. how its audio happens to sound (a property of the emulation).

Only (1) is what we are trying to measure. So the reference (reSIDfp) audio is held
fixed as the measurement space, and **only the neighbour lists vary**. An earlier
draft of this analysis scored each engine in its own space and produced a
meaningless comparison.

---

## 2. Corpus

500 files selected by **systematic sampling**: every `.sid` path sorted
lexicographically, then sampled at a fixed stride (`i + 0.5` into each bucket). HVSC
is laid out `category/artist/tune`, so a sorted walk is already ordered by category
and then artist — a fixed stride therefore spreads the selection across every
category and a wide range of artists.

The method matters. Over-sampling pathological tunes would make SIDLite look worse
than it is in practice; hand-picking favourites would make it look better. A fixed
stride is decided **before** anything is measured and cannot be tuned afterwards.
There is no RNG: the same HVSC yields the same 500 files.

| Property | Value |
|---|---|
| HVSC corpus | 60,572 files |
| Selected | 500 files -> 711 tracks (subsongs, `classificationDepth: 3`) |
| Categories | MUSICIANS 463, DEMOS 25, GAMES 12 |
| Formats | PSID 470, RSID 30, of which RSID+BASIC 3 |
| Edge cases | 3x 2-SID, 8x >=8 subsongs |

The composition mirrors HVSC itself (MUSICIANS dominates). Multi-SID is
under-represented at 3 files because it *is* rare — 338 of 60,572, i.e. 0.56%, so
~2.8 expected. Multi-SID is covered exhaustively elsewhere: all 338 multi-SID tunes
plus 587 RSID+BASIC and 400 `playAddress=0` tunes were rendered through both engines
with **0 crashes and 0 render failures** (see `AGENTS.md`).

Both runs are sequential, never concurrent — the wall-clock times feed a throughput
ratio, and overlapping them would measure contention instead. Each engine gets its
own `classified/`, `audio-cache/` and `renders/` directory; sharing them would let
the second run reuse the first run's WAVs and compare an engine against itself.

---

## 3. Results

Measured on an Intel i7-6700K (4 cores / 8 threads), both engines at 24 vector
dimensions.

### 3.1 Feature completeness

A missing feature is a hard defect: it degrades every downstream decision for that
track regardless of how good the rest looks.

| Engine | Complete feature vectors |
|---|---|
| reSIDfp | 711 / 711 (100.0%) |
| SIDLite | 711 / 711 (100.0%) |

Neither engine dropped a single feature on this corpus. This is worth stating
plainly because SIDLite *has* been observed to drop `spectralContrastMean` on
specific very quiet subsongs of `Super_Mario_Bros_64_2SID` where reSIDfp does not.
That did not occur anywhere in a representative 711-track sample, so it is rare —
but it is real, and it is the one known asymmetry against SIDLite.

### 3.2 Rating agreement (anchor A)

Cohen's kappa, not raw agreement, because raw agreement is inflated when one class
dominates — and it does here, with ~90% of tracks rating 3.

| Dimension | Exact agreement | Cohen's kappa |
|---|---|---|
| energy | 85.5% | 0.530 (moderate) |
| mood | 94.8% | 0.617 (substantial) |
| complexity | 94.9% | 0.661 (substantial) |

Interpretation follows Landis & Koch (0.41-0.60 moderate, 0.61-0.80 substantial).
The engines mostly agree, and disagree most on energy — the dimension most sensitive
to level and spectral balance, which is exactly where SIDLite differs.

### 3.3 Neighbour-set agreement (anchor A)

For each seed, how many of reSIDfp's top-5 neighbours does SIDLite also propose?

**recall@5 = 69.8%**, 95% CI [68.4%, 71.3%], over 711 seeds.

So roughly **30% of station content would differ** between the engines. This is a
measure of *difference*, not of quality — it says nothing about which set is better.
That is what the next section is for.

### 3.4 Acoustic separation (anchor B)

Are the proposed neighbours actually closer-sounding than chance? Ratio of mean
random-pair distance to mean neighbour-pair distance, in the reference fingerprint
space. Above 1.0 means the engine finds genuinely closer tracks.

| Engine | Separation ratio | 95% CI | Cohen's d |
|---|---|---|---|
| reSIDfp | 1.0942 | [1.0783, 1.1187] | 0.213 |
| SIDLite | 1.0960 | [1.0714, 1.1163] | 0.216 |

The intervals overlap almost completely. The CI is a **bootstrap of the ratio of
means** (2,000 resamples, deterministic seed), not the mean of per-pair ratios —
`mean(R/dᵢ) ≠ R/mean(dᵢ)` by Jensen's inequality, and an earlier draft using the
latter produced an interval that did not contain its own point estimate.

### 3.5 Head-to-head, paired (the decisive test)

Both engines scored on **identical seeds** in the **same** reference audio space.
Paired, because using the same seeds removes between-tune variance and is far more
sensitive than comparing two independent means.

| Quantity | Value |
|---|---|
| Mean neighbour distance, reSIDfp | 0.5895 |
| Mean neighbour distance, SIDLite | 0.5863 |
| Difference (SIDLite − reSIDfp) | **−0.0031** |
| 95% CI of the difference | **[−0.0092, +0.0034]** |
| Distinguishable at 95%? | **No — the interval straddles zero** |
| SIDLite closer on | 202 / 446 seeds (45.3%) |

**This is the result the recommendation rests on.** The confidence interval contains
zero, so on the evidence available the two engines' neighbour quality cannot be
told apart. The point estimate marginally favours SIDLite, which should be read as
noise, not as SIDLite being better.

### 3.6 Speed

| Engine | 711 tracks | Ratio |
|---|---|---|
| reSIDfp | 2124.5 s | 5.92x |
| SIDLite | 359.0 s | 1.00x |

This is a whole-pipeline ratio and already includes the engine-**independent**
feature-extraction cost, so it is a realistic multiplier rather than a raw
render-speed ratio (measured separately at 6-13x).

---

## 4. Recommendation

**Use SIDLite for classification.** It is the shipped default.

The case: neighbour quality is statistically indistinguishable from the
cycle-accurate reference (§3.5), feature completeness is identical on a
representative corpus (§3.1), and it costs 5.9x less compute (§3.6). Paying 6x for a
difference that cannot be measured is not a good trade.

**Use reSIDfp when** you want the cycle-accurate reference: A/B fidelity work,
regenerating goldens, or an authoritative export where reproducing real hardware
matters more than throughput. One flag:

```bash
sidflow-classify --sid-engine residfp
SIDFLOW_SID_ENGINE=residfp bash scripts/run-similarity-export.sh --mode local
```

**Do not mix engines within one corpus.** Features derive from rendered audio, ~30%
of neighbours differ between engines (§3.3), and the export records a single
`render_engine` value.

### Honest limitations

- **The absolute separation ratio is only ~1.09 for both engines.** Neighbours are
  closer than chance, but not dramatically. That is a statement about the
  *classifier*, not about the engines — swapping engines will not improve it.
- **No ground truth.** Anchor B measures spectral-shape proximity, which is a proxy
  for perceived similarity, not the thing itself. It cannot say "these sound alike
  to a human".
- **One corpus, one machine, single runs.** The timing ratio is a single measurement
  per engine, not a distribution.
- **The known SIDLite gap** (§3.1) did not appear here but has been reproduced
  elsewhere; the mechanism is not yet understood.

---

## 5. How long does a full HVSC pass take?

### The stated 30-minute baseline is not reproducible with a correct engine

The README recorded ~30 minutes for a full HVSC classification on an i7-14600K. That
figure does not survive contact with the measurements above.

Scaling this machine's SIDLite result to the full corpus:

```
711 tracks in 359.0 s  ->  87,074 tracks in 12.2 h  (i7-6700K, 8 threads)
```

For a 14600K to do that in 30 minutes it would have to be **24.4x faster** than a
6700K. Realistic multithreaded gain for 4c/8t Skylake -> 14c/20t Raptor Lake is
roughly **3-4x**. 24x is not plausible.

The explanation is in the engine, not the hardware. The 30-minute figure predates the
WASM fixes, when the artifact was the **defective SIDLite build** — the one that
clipped, carried 0.12-0.27 DC, and could not render 3-SID tunes at all. It rendered
at **400-491x realtime**; the corrected SIDLite renders at **29-40x**, roughly 10-13x
slower, because it is now doing the work properly. Fold that in and the numbers
reconcile: the old build on that rig in 30 minutes implies the fixed build takes
~5.5 h there, i.e. ~2.2x faster than this machine — comfortably within the plausible
hardware range.

**The 30-minute number measured a broken engine going fast, not a fast engine.**

### Estimates for an i7-14600K

Scaled from measured per-track cost on this machine, assuming the 14600K is 3-4x
faster in multithreaded throughput and that per-track cost distribution holds (the
sample is systematic over the same corpus, and tracks-per-file matches: 1.42 here vs
1.44 across HVSC).

| Engine | This machine (i7-6700K) | Estimated i7-14600K |
|---|---|---|
| SIDLite | 12.2 h | **~3-4 h** |
| reSIDfp | 72.3 h | **~18-24 h** |

If instead you anchor on the stated 30-minute baseline and simply apply the measured
5.92x engine ratio, you get **~3.0 h** for reSIDfp — but that inherits the invalid
baseline and should not be used.

**Plan for roughly half a day of SIDLite, or a full day of reSIDfp**, on that rig.
Measure your own hardware first with `--max-songs 200` before committing to a full
pass.

---

## 6. Files

| Path | Purpose |
|---|---|
| `scripts/engine-comparison/select-corpus.ts` | Deterministic systematic sample of HVSC |
| `scripts/engine-comparison/run-comparison.sh` | Classifies the corpus once per engine, isolated and sequential, and times both |
| `scripts/engine-comparison/analyze.ts` | All metrics, bootstrap CIs, paired head-to-head |
| `scripts/engine-comparison/corpus-500.json` | The committed 500-file selection |
| `workspace/engine-comparison/results.json` | Full machine-readable results (git-ignored) |

The analysis re-runs standalone against existing output, so metrics can be added
without repeating the ~40 minutes of classification.

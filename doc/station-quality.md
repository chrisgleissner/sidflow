# Station quality: what was measured, what changed, and what is still limiting

This documents an optimisation campaign on SIDFlow's two station types — "songs
similar to this one" and category stations — run against a pre-registered
protocol. It reports every candidate tried, including the failures, and states
where the protocol itself turned out to be wrong.

The short version:

- **Station quality more than doubled.** nDCG@10 on held-out, composer-grouped data
  goes 0.2340 → 0.5392, **+130.4%** (p=0.0002), and cold-start retrieval more than
  doubles (0.1108 → 0.2453). The pre-registered success criterion asked for ≥20%.
- **Confirmed on 21,451 tracks that were never used for fitting** (§12), where the
  shipped configuration scores **0.5672** — better than on the corpus it was fitted to.
  On that slice the gain over the previous best configuration is **+69.1%**, not +130.4%,
  because the old 24-dimension baseline is much stronger there (0.3354). The honest
  headline is therefore a range: **roughly 64x better than what is published today, and
  70–130% better than the best configuration previously in the repository**, depending
  on corpus composition.
- **Where it came from**, roughly: playroutine features +93%, learned weights +24% on
  top of those, driver-shape detail +5.5%, pitch/texture +14.8%, and everything else —
  six representations, five re-rankings, hubness correction, a supervised metric —
  about +10% combined. The biggest lever was information nobody had extracted, not a
  better metric over information already present.
- **Almost all of it came from one idea nobody had tried**: describing the
  PLAYROUTINE rather than the sound. Composers reuse their player code, and its
  register-write pattern is effectively that tooling's signature. A single such
  dimension separates composers better than the entire 24-dimension vector did.

- **More than half of all stations played the same tune twice or more**, and the
  worst put 14 of 20 slots on one tune. No retrieval metric could see it, because
  nDCG excludes same-file siblings of the seed but not of each other. Fixed.
- **Category stations were broken and are now fixed, provably.** The 1-5 scale
  used 3 of its 5 levels with up to 94% of the collection on one level. It now
  uses all five at 20% each. This is a construction, not a tuning result.
- **The biggest similarity win is not an algorithm change.** The published export
  carries 4-dimensional vectors and scores nDCG@10 0.0048; the 24-dimensional
  vector already in the code scores 0.1803, roughly **38x higher**. Regenerating
  the exports dwarfs everything else in this document.
- **The pre-registered diversity guardrail was self-defeating** and is reported as
  such rather than quietly replaced.
- **Seven measurement and deployment defects were fixed** before any result was believed. Several
  fabricated signal from nothing.

---

## 1. Protocol

Pre-registered in `scripts/station-quality/metrics.ts` before any optimisation ran.

| | |
|---|---|
| **Split** | train / validation / test, grouped by composer so no composer spans slices |
| **Primary metric** | nDCG@10 on group retrieval (HVSC composer/production labels) |
| **Guardrails** | station diversity, rare-group (cold-start) nDCG — neither may regress >5% relative |
| **Selection** | validation only |
| **Test set** | touched exactly once, at the end |
| **Statistics** | paired bootstrap per candidate, Holm-corrected across every candidate tried |
| **Stopping rule** | 3 consecutive candidates failing to beat the incumbent |
| **Success** | ≥20% relative gain in test nDCG@10, Holm-adjusted p<0.05, guardrails intact |

### The ground truth, and its limits

There is no human-labelled "these SIDs are similar" set. The label used is HVSC's
own directory structure: `MUSICIANS/<letter>/<Composer>` and
`GAMES/<letter>/<Game>`. Two tunes by one composer usually share idiom,
arrangement habits and often a playroutine.

This is a proxy with known failure modes in both directions: composers vary their
style, so a same-composer miss is not necessarily an error, and composers imitate
each other, so a cross-composer hit may be perfectly good. Its virtue is being
**external to the features** — nothing in the classifier can see the directory
layout, so the classifier cannot game it. It is a floor on quality, not a ceiling.

Subsongs of the same file are excluded from every retrieval count. Retrieving
another subsong of the tune already playing is trivially "same composer" and would
inflate every score without producing a better station.

---

## 2. Seven defects found before trusting any number

These were all found by reading the harness and then asking it to do something it
had not been asked before — carry a dimension with no variance. None of them threw
an error; each one silently degrades or invents a measurement.

### 2.1 The cold-start guardrail measured nothing

The rare-group check passed a *filtered* array of seeds to `ndcgAtK`, which built
its label arrays from that filtered array — while the ranker it was given returned
indices into the *unfiltered* slice. Indices and labels lived in different spaces,
so each neighbour was scored against an unrelated track's group, and indices past
the end of the short array read `undefined`. The number was noise. `ndcgAtK` now
takes seed *indices*, leaving the retrievable population and the labels intact.

### 2.2 The tuning subsample excluded the largest tree entirely

Subsampling ordered groups alphabetically and took a prefix. Group names begin
with `DEMOS/`, `GAMES/` or `MUSICIANS/`, so a 20k-of-87k sample would have
contained all of DEMOS, part of GAMES, and **not one track from MUSICIANS** — the
tree holding 92.5% of the corpus and the strongest composer labels.

### 2.3 …and hashing it was not enough

Ordering by a salted FNV-1a hash still clustered by tree, because bare FNV-1a has
weak avalanche and HVSC group names share long common suffixes. Measured on an
HVSC-shaped corpus, the sampled DEMOS count stayed pinned at exactly 96 tracks
while the sample grew from 500 to 3000 — several hundred consecutive positions in
the "random" order contained no DEMOS group at all.

Adding a MurmurHash3 `fmix32` finaliser fixed it:

| | worst tree-share deviation |
|---|---|
| alphabetical prefix | **29.6pp** (MUSICIANS entirely absent) |
| bare FNV-1a order | 29.6pp → still severely clustered |
| FNV-1a + fmix32 | **1.4pp** |

`splitByGroup`'s own hash is deliberately untouched: it only takes
`hash % 10000`, which measures uniform per tree (50/25/25 within each of DEMOS,
GAMES and MUSICIANS), so it has no such defect.

The sampler also now stops at the first group that does not fit rather than
skipping it. Skipping only ever admits groups small enough to fit the remaining
space, so near the boundary it systematically prefers small groups and the
sample's group-size distribution drifts from the corpus's.

### 2.4 rank-Gaussian turned file order into signal

Tied values received *consecutive* ranks, broken by index. SID features are full
of exact ties — sample-playback activity, tritone weight and several waveform
ratios are zero for most of the corpus. Spreading one repeated value across the
whole quantile range **in track order** turns the corpus's arbitrary file ordering
into a gradient the distance function can see. A perfectly constant dimension
became a perfect ramp: pure fabricated signal. Now uses midranks, so each tie
group collapses to one value and a constant dimension contributes exactly nothing.

### 2.5 PCA whitening amplified rounding error into the dominant term

Whitening divides each component by the square root of its variance — that is the
point of it — but the directions past the true rank contain only deflation error,
and dividing those by their own magnitude is unbounded. The absolute cutoff (keep
while `λ ≥ 1e-9`, then divide by `√(λ + 1e-6)`) let them through:

| | components kept | mean pairwise distance |
|---|---|---|
| 24 informative dimensions | 24 | 6.90 |
| + 15 **constant** dimensions | **31** | **3539** |

The added dimensions carried no information whatsoever, so every bit of that
513x inflation was noise — and it silently changed which neighbours the candidate
proposed. A purely *relative* cutoff was not enough either, because deflation
error accumulates well above machine epsilon. Truncating against the **trace**,
which for z-scored input is the exactly known total variance, makes whitening
invariant to constant padding to 5e-15 and correctly drops collinear directions.

This was not academic. It had already distorted the search: adding all-zero tonal
dimensions moved "whitened + euclidean" from +48.5% to −57.8% on validation purely
through amplified noise, and whitening had won phase A and was steering every
later phase.

### 2.6 Similarity weighting switched itself off above 24 dimensions

`cosineSimilarity` applied its per-dimension weights only when the vector was
*exactly* 24 long, so the first added dimension would have silently turned station
similarity into plain unweighted cosine — an invisible change to the shipped
ranking, caused by the very work meant to improve it.

The eventual resolution is not "apply the weights more widely". Those weights were
hand-tuned against raw, differently-scaled values, and the 35-dimension vector is
rank-normalised before storage, so they describe nothing there — uniform weighting
measured better (§8.5). Weighting is now declared per vector width in a single
table, so adding a vector definition means *stating* its weighting rather than
inheriting whatever falls out of a length comparison.

### 2.7 A seventh problem, found only by trying to ship

Not a defect in the harness but in the assumption that the best-ranking
representation is deployable. The station applies an **absolute** minimum-similarity
threshold, and the tiny profile quantises each edge similarity into one byte; both
assume non-negative vectors on a scale where "similar" means roughly 0.9. The
best-scoring representation centres every dimension on zero. Measured consequence:
**0.0% of candidates clear the threshold anywhere in the corpus** — every station
would have collapsed. §8.5 has the full table and the resolution.

This one is worth naming separately because no amount of offline metric work would
have caught it. It surfaced as an end-to-end station asked for 20 tracks returning
14.

---

## 3. Engine choice: reSIDfp vs SIDLite

Re-measured on HVSC 85 with the current code, on the target machine, using the
committed 500-file systematic sample (`scripts/engine-comparison/`).

| | reSIDfp | SIDLite |
|---|---|---|
| Feature completeness | 710/710 (100%) | 710/710 (100%) |
| Acoustic separation ratio | 1.0971 [1.0706, 1.1077] | 1.0937 [1.0801, 1.1093] |
| Wall clock, 710 tracks | 340.1 s | 70.1 s (**4.85x**) |
| Neighbour recall@5 vs reSIDfp | — | 67.9% [66.4%, 69.0%] |
| Rating agreement (e / m / c), Cohen's κ | — | 0.528 / 0.435 / 0.533 |

Head-to-head on identical seeds in the reference audio space: mean neighbour
distance 0.5903 (reSIDfp) vs 0.5875 (SIDLite), difference **−0.0028 with 95% CI
[−0.0095, +0.0036]** — the interval straddles zero, so the two are
indistinguishable. This replicates the earlier finding (−0.0031 [−0.0092,
+0.0034]) almost exactly.

**The `spectralContrastMean` dropout that motivated reSIDfp did not occur.**
Feature completeness is 100% for both engines on this corpus.

The low rating κ initially looked like a reason to prefer reSIDfp, since ratings
are the category-station product. That argument was **withdrawn** after measuring
the continuous quantities behind the discrete levels: κ is computed on a
degenerate 3-level distribution with >90% of tracks in one bucket, where it is
known to deflate badly, and the underlying vectors agree closely.

| | |
|---|---|
| median per-dimension Spearman ρ between engines | **1.0000** |
| dimensions with ρ > 0.99 | 13 / 24 |
| per-track cosine(reSIDfp, SIDLite) | median **0.998**, p05 0.948 |

The split is exactly along the predicted line: the **13 register-trace dimensions
are engine-identical** (ρ ≈ 1.0), because they depend only on what the playroutine
wrote to the chip, not on the SID audio model. The 11 WAV-derived dimensions
differ, worst being inharmonicity at ρ = 0.70.

**Decision for the development corpus: reSIDfp**, for a narrower reason than
"maximum quality". At development-corpus scale it costs about 1.3 h, it is the
reference for the 11 WAV-derived dimensions, and using one engine throughout prevents
paired "old features vs new features" comparisons from being confounded by engine.
SIDLite is a *validated* fallback: 2.0 h instead of 9.5 h for a full pass.

**This section does not decide the engine for the PUBLISHED corpus**, and one number
above shows why it cannot. Neighbour recall@5 of 67.9% means roughly one in three of
the top five neighbours differs between engines — a large disagreement, and the
quantity a station is actually built from. But recall *against reSIDfp* presupposes
that reSIDfp's answer is the correct one, so it measures agreement, not quality. It
cannot say which set of neighbours is better.

Answering that needs a task-level endpoint with an external label, not an
agreement statistic. [sid-engine-comparison.md](sid-engine-comparison.md) pre-registers
one: composer-grouped nDCG@10 measured separately on the 24 WAV-derived dimensions
(where the engine can act at all) and on the full 58, paired on identical tracks with
the decision rule fixed before any result existed.

An aside worth recording: the classification pipeline does not scale past ~12
threads, and gets *slower* beyond it.

| threads | tracks/s |
|---|---|
| 6 (the default ceiling) | 10.01 |
| **12** | **12.26** |
| 16 | 10.97 |
| 20 | 9.59 |

`buildConcurrency` sizes the WASM renderer pool at N *and*
`getFeatureExtractionPool(resolvedThreads)` sizes the extraction pool at N, both
live simultaneously — so `SIDFLOW_MAX_THREADS=20` puts 40 worker threads on 20
cores. Fixing that properly means a single shared work pool, which was out of
scope here; 12 is the measured optimum as the code stands.

---

## 4. Category stations: from 3 levels to 5

This half of the product was broken, and the cause was structural rather than a
matter of tuning.

Each raw score is a weighted average of sigmoids of clamped z-scores. Reaching
level 1 or 5 requires several of those sigmoids to sit at a joint ~2.4σ extreme
*simultaneously*, and averaging independent terms concentrates the result on its
mean. No reweighting of the inputs escapes that — the discretisation itself has to
change.

Measured on 710 HVSC tracks:

| dimension | levels used | largest share | entropy |
|---|---|---|---|
| energy | 3 of 5 | 81.5% | 0.873 / 2.322 bits |
| mood | 3 of 5 | **93.8%** | **0.397 / 2.322 bits** |
| complexity | 3 of 5 | 90.7% | 0.532 / 2.322 bits |

A mood filter where 94% of the collection answers "3" cannot build a distinctive
station. Mood was carrying 17% of the information a five-level scale can hold.

Ratings are now assigned by where a raw score falls among **corpus quantiles**:

| dimension | after calibration | entropy |
|---|---|---|
| energy | 20.0 / 20.0 / 20.0 / 20.0 / 20.0 % | **2.322 / 2.322 bits** |
| mood | 20.0 / 20.0 / 20.0 / 20.0 / 20.0 % | **2.322 / 2.322 bits** |
| complexity | 20.0 / 20.0 / 20.0 / 20.0 / 20.0 % | **2.322 / 2.322 bits** |

Entropy reaches the theoretical maximum. Mood gains **5.85x** information.

The property that makes this safe is monotonicity: the mapping changes only
*where* the scale is cut, never which track is rated higher. Verified as **0
ordering inversions across 44,850 pairs**. Levels become corpus-relative
percentiles — "5" means the top fifth of this collection — which is the useful
reading for a radio station, because every category is guaranteed to have material
in it by construction.

**Consequences worth knowing.** Ratings are now corpus-relative, so the same tune
in a different corpus can receive a different level. For a batch-regenerated
published artifact that is fine and intended. Two degenerate cases are handled
explicitly: corpora below 50 tracks decline to calibrate and say so, and a
dimension with no spread at all declines individually rather than sending the
whole collection to level 1.

---

## 5. Pitch, key and harmony: new features from the register trace

The perceptual vector described rhythm, waveform mix, filter behaviour, voice
roles and envelopes — and nothing about pitch. No key, no mode, no melodic
interval content, no harmony. The one dimension that sounds like melody,
`sidMelodicClarity`, is a heuristic blend of voice-role and noise ratios that
never looks at a note.

Note pitch is not estimated from audio here, it is **read**: the SID oscillator
frequency is exactly `f = Fn · Fclk / 2²⁴`, so the register trace already captured
for the existing features yields the composer's literal notes — no pitch tracking,
no octave errors, no polyphony confusion, and no extra rendering cost.

36 features follow: a Krumhansl key and mode estimate with strength and stability,
a tonic-rotated pitch-class profile reduced to interpretable scale weights,
melodic interval statistics on the lead voice, harmonic interval-class content
between simultaneous voices, and note-duration statistics.

Everything tonal is **transposition invariant**, by rotating onto the estimated
tonic. Absolute key is nominal — C♯ is not "between" C and D in any sense a
Euclidean metric should believe, and the wrap from B to C would read as the largest
possible distance. What generalises is scale shape relative to its own tonic; a
test pins that a melody transposed by a fifth describes identically.

Sanity checks on real SIDs, which matter more than any golden value: median
diatonic ratio **0.957** and median key strength **0.909**. A key finder picking
at random would sit near 7/12 = 0.58.

### Coverage is 72%, and the other 28% is not a bug

| | share of corpus |
|---|---|
| analysable pitch content | **72.2%** |
| no oscillator activity at all (silent window, BASIC listings) | 16.1% |
| sample playback via the volume register (digi) | 5.6% |
| audible but no gated-oscillator note events | ~10.8% |

The last group was initially assumed to be recoverable by relaxing the gate
requirement. It is not. Those tracks show audible output (rms 0.021) with
essentially zero gate onsets (0.067 vs 7.6 for tonal tracks), which means the
sound comes from `$D418` digi playback or the release tail of notes gated before
the analysis window. Extracting "notes" from stale frequency registers would
**fabricate** pitch content that was never articulated, so they are correctly
reported as having none.

Because zeros here mean *absent* rather than *low*, a `sidTonalPresent` indicator
dimension is included. Without it the distance function cannot tell "no notes"
from "notes, but few of them in the scale" — completely different tracks that would
otherwise land on the same point, and a quarter of the corpus collapsing into one
spurious cluster is exactly what ruins a station.

---

## 6. The playroutine: describing the code, not the sound

This is where nearly all of the improvement came from, and it was the last thing
tried rather than the first.

### The reasoning that led here

Two measurements pointed the way. Adding more SPECTRAL dimensions bought almost
nothing — the learning curve moved 0.1791 to 0.1803 between 20 and 24 dimensions —
while adding PITCH, a genuinely different kind of information, was worth +14.8%. And
the strongest single result about *what* identifies a composer was that texture and
arrangement mattered while harmony did not.

Extrapolating both: the next thing to try is not a better metric over existing
features, nor more features of an existing kind, but a NEW KIND of information about
arrangement habit. The most habitual thing a composer does is reach for the same
player code. A playroutine leaves a signature in how it drives the chip — how many
writes per frame, which registers it favours and in what proportion, whether it runs
once or four times per frame, how regularly it fires. None of that is visible in the
rendered spectrum, and none of it in the register STATE the existing features
summarise; it lives in the *pattern of writes*, which the trace already records.

### What it is worth

| dimension | separability AUC |
|---|---|
| `sidWriteSpreadEntropy` | **0.7713** |
| `sidWritesPerFrame` | 0.7574 |
| `sidWriteShareControl` | 0.7498 |
| `sidWriteRateRegularity` | 0.7458 |
| `sidWriteShareFilter` | 0.7451 |
| … 10 more, weakest 0.5723 | |
| *(for comparison)* all 24 original dimensions together | 0.7229 |
| *(for comparison)* best pre-existing single feature | 0.689 |

**One playroutine dimension out-separates the entire vector the product shipped.**
All 15 candidates cleared the 0.57 selection threshold — the only feature group where
that happened; the weakest of them beats the median dimension of every other group.

### Held-out retrieval

| configuration | test nDCG@10 | vs today | cold start |
|---|---|---|---|
| shipped 24d, raw + weighted cosine | 0.2340 | — | 0.1108 |
| + 11 tonal, rank-normalised | 0.2686 | +14.8% | 0.1912 |
| **playroutine dimensions ALONE (15d)** | **0.4517** | **+93.0%** | 0.1592 |
| all 50 dimensions | 0.4112 | +75.7% | 0.2019 |
| all 50 with learned weights | 0.5109 | +118.4% | 0.2324 |
| all 50, wider weight search | 0.5390 | +130.3% | — |
| **all 58 with learned weights (SHIPPED)** | **0.5392** | **+130.4%** | **0.2453** |

95% CI on the difference [0.2623, 0.2917] at 50 dimensions, p=0.0002 throughout.

### A second round of driver detail

Because the first playroutine group paid so well, eight finer descriptors of the
driver's *shape* were added: where in the video frame it runs and how tightly it
holds that position, whether it rewrites unchanged values, how much of the register
file it touches, the order it walks registers in, and how it divides attention
between the three voices. Worth a further **+5.5%** on held-out retrieval
(0.5109 → 0.5392) and +5.6% on cold start, both at p=0.0002.

A fixed-raster interrupt driver and a main-loop driver look identical in the
spectrum and produce very different values here. So do a driver that blindly
restates its whole register set every frame and one that writes only what changed.
These are decisions made by a programmer, not by a composer, which is precisely why
they identify who wrote the tune.

### The weight search was itself a limit

The learned weights were fitted by coordinate ascent over a schedule that could not
reach beyond 2.11x. Ten of the fifty weights sat exactly at that ceiling, which is
the optimiser saying it wanted to go further. Widening the schedule and running two
passes cost nothing — no re-classification, no new features — and was worth
**another 12 percentage points** (+118.4% → +130.3%), leaving only one weight at the
ceiling and a range spanning 0 to 17.8. Some dimensions get weighted to zero, so the
search performs selection and weighting in one pass.

Worth noting as a general lesson: a hyperparameter search hitting its own bounds is a
finding, not a result. It was visible in the output the whole time.

Note that playroutine features alone (+93%) involve no selection against the test
set whatsoever — all 15 were kept by a train-only criterion — so this is not
selection optimism. The effect is also far too large for it: the confidence interval
on the difference is about a tenth of the effect.

### What this says about the campaign

Most of the effort here went into metrics: six representations, five re-rankings,
hubness correction, a supervised metric, learned weights. Together those were worth
perhaps 20 percentage points. One new *kind* of information was worth 93.

The lesson is not that metric work is useless — learned weights add 42.7 points on
top of the new features, and rank normalisation is what made the tonal features
usable at all. It is that the search was pointed in the less productive direction for
most of its duration, and the thing that found the real gain was asking what the data
contains that nobody had looked at yet.

### Honest caveat

Identifying a composer partly by their tooling is not the same as identifying music
that *sounds* similar. Two composers sharing a playroutine will look artificially
close, and one composer who switched tools mid-career will look artificially distant.
The composer label cannot distinguish those cases, so the +118% is a genuine
improvement against the stated metric while being a partial overstatement of
perceptual similarity. It is nevertheless the right thing to ship: shared tooling
correlates strongly with shared scene, era and idiom, which is most of what a
listener means by "more like this".

---

## 7. Export schema: dimensionality is already data-driven

Adding a musical property means adding dimensions, so the question was whether
each such addition is a format break. It is not. Nothing hard-codes the width:

| profile | how width is handled | cost of adding dimensions |
|---|---|---|
| `full` (SQLite) | derived from the widest stored vector, recorded in the manifest | no format change |
| `lite` | recorded in its own header; one codebook per dimension | no format change; +1 byte/dim/track |
| `tiny` | **never stores vectors** — reads them to build the neighbour graph, then discards | **0% size change** |

The `tiny` bundle is byte-identical at 24 and at 54 dimensions, comfortably inside
the 20% budget it was held to. `FEATURE_SCHEMA_VERSION` is bumped 1.3.0 → 1.4.0 as
a data label, which is the honest signal that the vector's meaning changed.
`packages/sidflow-common/test/similarity-export-dimensions.test.ts` pins all of
this so a reintroduced fixed width fails loudly instead of silently truncating.

---

## 8. What users are actually served today

Worth separating from everything else, because it is the largest single effect in
this document and it is not an algorithm improvement.

The published export carries `vector_dimensions: 4` — the legacy `[e, m, c, p]`
ratings vector — and **zero precomputed neighbours**, because the exports have not
been regenerated since the 24-dimension vector was restored.

| vector | separability AUC | nDCG@10 |
|---|---|---|
| legacy 4-dim (**published today**) | 0.6116 | **0.0048** |
| shipped 24-dim (in the code) | **0.7229** | **0.1803** |

Regenerating the published exports is worth roughly **38x** on the primary metric.
No re-ranking or feature result in this document comes close, and it requires no
algorithm change at all — only running the pipeline and publishing the output.

---

## 9. Similarity optimisation

### 9.1 What was searched

Six representations x five re-rankings x five feature sets is 150 combinations.
Holm-correcting across 150 would demand roughly a 30x smaller p-value than
correcting across five and would hide any effect this corpus can show, so the
search is sequential and greedy: best representation, then best feature set given
it, then best re-ranking, then learned weights, then a supervised metric. Around
twenty candidates per run, with the Holm family covering all of them.

Greedy search nearly cost the whole result. Under plain Euclidean, adding tonal
dimensions makes retrieval WORSE (nDCG@10 0.285 -> 0.279), so a purely greedy path
discards them at the feature-set stage and never tests them under a metric capable
of using them. It would have reported "pitch does not help" when what it had shown
is "equal weighting does not help" — different claims, and only one is true. The
best tonal feature set is therefore carried into the supervised phases alongside
the overall best.

### 9.2 Validation results (all candidates, both runs)

Relative to the shipped baseline, Holm-corrected across every candidate tried.
Every figure below is validation-only.

| candidate | nDCG@10 | vs baseline |
|---|---|---|
| baseline: shipped 24d, raw + weighted cosine | 0.2586 | — |
| shipped 24d, raw + euclidean | 0.2507 | −3.1% |
| shipped 24d, z-score + euclidean | 0.2732 | +5.7% |
| shipped 24d, whitened + euclidean | 0.2669 | +3.2% |
| shipped 24d, rank-gaussian + euclidean | 0.2839 | +9.8% |
| shipped 24d, rank-gaussian + cosine | 0.2849 | +10.2% |
| shipped 24d, rank-uniform + cosine | 0.2777 | +7.4% |
| **+ tonal selected (35d)**, rank-gaussian + cosine | **0.3073** | **+18.8%** |
| + tonal core (40d), rank-gaussian + cosine | 0.2816 | +8.9% |
| + tonal all (55d), rank-gaussian + cosine | 0.2793 | +8.0% |
| tonal only (31d), rank-gaussian + cosine | 0.1117 | −56.8% |
| + tonal selected, + mutual proximity | 0.3007 | +16.3% |
| + tonal selected, + k-reciprocal | 0.2972 | +14.9% |
| + tonal selected, + query expansion | 0.2939 | +13.7% |
| + tonal selected, + MP + k-reciprocal | 0.2847 | +10.1% |
| + tonal selected, + within-class whitening (0.5) | 0.3256 | +25.9% |
| + tonal selected, + within-class whitening (0.2) | 0.3310 | +28.0% |
| + tonal selected, + within-class whitening (0.1) | 0.3314 | +28.2% |
| **+ tonal selected, + learned diagonal weights** | **0.3582** | **+38.5%** |

Everything except "MP + k-reciprocal" on the first run reached Holm-adjusted
p<0.05. The re-rankings — mutual proximity, k-reciprocal, query expansion — all
scored BELOW the plain representation they were applied to. Hubness correction was
the single most promising technique on paper and it did not help here.

### 9.3 The pre-registered outcome

Selection picked the highest-scoring candidate that passed both guardrails, which
excluded the learned-weight and supervised-metric candidates because they lower
raw-neighbour-list diversity.

| | validation | test (touched once) |
|---|---|---|
| baseline | 0.2586 | 0.2340 |
| winner: + tonal selected, rank-gaussian + cosine | 0.3073 (+18.8%) | **0.2701 (+15.5%)** |
| 95% CI of the gain | — | [0.0266, 0.0453], p=0.0002 |
| diversity guardrail | 0.483 ≥ 0.482 | 0.520 vs 0.538 |
| cold-start guardrail | 0.1239 ≥ 0.0809 | **0.1762 vs 0.1108** |

**At this point in the campaign the pre-registered criterion was NOT met.** It
required ≥20% relative gain on test; the metric-and-pitch work delivered +15.5%.

That verdict is recorded rather than edited away, because it is what drove the next
step: a search that has plateaued at three quarters of its target is evidence that
the search is pointed the wrong way. Adding the playroutine features (§6) took the
same protocol to **+118.4%**, comfortably clearing the bar. The honest summary is
that the criterion was missed by metric optimisation and met by finding new
information.

### 9.4 The guardrail was the wrong instrument

The diversity guardrail is anti-correlated with the primary metric **by
construction**: retrieving the seed's composer better necessarily puts more of that
composer near the top of the list, so "distinct groups / station length" falls
exactly when nDCG rises. Every statistically significant candidate failed it, all
by small margins, and across the two runs it selected between candidates on
differences of 0.02 in diversity while discarding 10 points of nDCG.

Diversity belongs to station assembly, not to the ranking. With MMR assembling the
station from a wider candidate pool — using only distances, never the group labels,
so it is deployable rather than an evaluation trick — the conflict dissolves:

| | raw neighbour list | after MMR assembly |
|---|---|---|
| baseline diversity | 0.507 | 0.537 |
| best candidate's diversity | 0.457 (fails 0.482) | **0.533 (passes 0.510)** |

Under that guardrail the winner is `+ tonal selected, rank-gaussian + cosine,
within-class whitening (0.1)` at +28.2% on validation. **Its test performance was
deliberately not measured**, to avoid a third consultation of the test set. It is
reported as identified headroom, not as a confirmed result.

### 9.5 Deployability: why the best-ranking representation is not shippable

The best-ranking representation is not deployable, and this table is what decided
the normalisation used by the shipped 50-dimension configuration. (Figures here are
from before the playroutine features existed; the conclusion about normalisation is
unaffected by them.)

| configuration | test nDCG@10 | vs today | candidates above the station threshold (median / p05 / min) | deployable |
|---|---|---|---|---|
| 24d raw + weighted cosine (**ships today**) | 0.2340 | — | 80.7% / 9.5% / 4.8% | yes |
| 35d raw + uniform cosine | 0.2340 | **+0.0%** (p=0.9936) | 78.8% / 3.6% / 0.5% | yes |
| **35d rank-uniform + cosine** | **0.2686** | **+14.8%** (p=0.0002) | 79.8% / 8.4% / 2.1% | yes |
| 35d rank-gaussian + cosine | 0.2701 | +15.5% | **0.0% / 0.0% / 0.0%** | **no** |

Three things follow.

**Tonal features alone do nothing.** 35 raw dimensions instead of 24 scores +0.0%
with p=0.9936 — literally no change. The gain exists only in combination with rank
normalisation. "We added pitch features and retrieval improved" would have been the
wrong description of the mechanism.

**Rank-Gaussian would have broken every station.** It centres each dimension on
zero, so cosine spans [−1, 1], and the station applies an absolute 0.73
minimum-similarity threshold at its default adventure level. Measured: **0.0% of
candidates clear it, anywhere in the corpus.** The symptom that exposed this was an
end-to-end station asked for 20 tracks returning 14.

**Rank-uniform costs 0.7 points and keeps the product intact.** Threshold reach is
statistically indistinguishable from today, so the adventure control keeps the
behaviour it was tuned for, and no downstream threshold or the tiny profile's
one-byte similarity quantisation needs re-deriving.

### 9.6 Which tonal features earn their place

Only 11 of 31, selected by univariate separability on TRAIN only at a 0.57
threshold. All 31 concatenated made retrieval worse than none at all; the eleven
turned the same information into a gain.

| kept (AUC) | rejected (AUC) |
|---|---|
| polyphony mean **0.643** | diatonic ratio 0.566 |
| note duration mean **0.634** | harmony fourth 0.564 |
| note rate **0.623** | key stability 0.557 |
| tonal-content present **0.607** | melodic step ratio 0.548 |
| pitch-class entropy 0.597 | harmony minor third 0.553 |
| melodic mean interval 0.583 | melodic third ratio 0.539 |
| melodic range 0.578 | flat seventh weight 0.529 |
| note duration entropy 0.577 | minor third weight 0.521 |
| tonic weight 0.576 | major third weight 0.515 |
| melodic leap ratio 0.573 | tritone weight 0.514 |
| key strength 0.570 | **major/minor mode 0.507** |
| | melodic ascending ratio 0.501 |

The musically interesting result is what lost. **Major-versus-minor mode carries
essentially no information about who wrote a tune** — AUC 0.507 against a 0.500
floor — and neither do the specific chord colours. What identifies a composer is
TEXTURE: how many voices sound at once, how long notes are held, how fast they
arrive, and whether there is pitched content at all. Composers are recognisable by
their arrangement habits far more than by their harmonic palette.

Learned diagonal weights agree, independently: the largest weights went to filter
cutoff, sample playback, voice-role entropy, loudness and **polyphony mean**, with
most of the harmonic dimensions pushed to the floor of the search range.

### 9.7 A better feature set, found by optimising the objective directly

The shipped selection ranks each dimension's UNIVARIATE separability and keeps
those above a threshold. That criterion cannot see that two dimensions are
near-duplicates, nor that a dimension useless alone becomes useful beside another.
Greedy forward selection optimises the objective instead: start empty, repeatedly
add whichever dimension most improves nDCG@10, stop when nothing does. Selection on
TRAIN only, reported on validation, evaluated under the deployable configuration.

| configuration | validation nDCG@10 | vs shipped baseline |
|---|---|---|
| shipped 24d, raw + weighted cosine | 0.2586 | — |
| shipped 24d, rank-uniform | 0.2777 | +7.4% |
| shipped 35d (univariate selection), rank-uniform | 0.2972 | +14.9% |
| **forward-selected 21d, rank-uniform** | **0.3102** | **+20.0%** |

Better *and* smaller: 21 dimensions rather than 35, beating the univariate selection
by +0.0130 with 95% CI [0.0067, 0.0194], p=0.0002. It keeps 15 of the 24 perceptual
dimensions and 6 of the 31 tonal ones, so **nine of the dimensions the product has
always shipped do not earn their place either**.

The selection order makes the case against marginal statistics vividly:
`adsrPadRatioSid` is chosen FIRST despite having the worst univariate separability
of all 24 perceptual dimensions (AUC 0.5035, essentially chance). A criterion that
scores dimensions in isolation cannot represent that.

The six tonal dimensions that survive are, again, all texture: polyphony, note
duration mean and entropy, pitch-class entropy, note rate, and whether the tune has
pitched content at all. Every explicitly harmonic dimension — key, mode, chord
colour, melodic interval shape — is dropped.

**This is not shipped yet.** +20.0% is a validation figure and the test set had
already been consulted twice; confirming it there would carry selection optimism
this document could not bound. The full-corpus pass provides an independent holdout
and is the right place to settle it. Until then the test-confirmed 35-dimension
configuration is what ships.

### 9.8 Do the gains compose?

Forward selection and the supervised corrections work by suppressing dimensions
that carry no authorship signal, so it was possible the second would have nothing
left to do. Measured on validation, they compose sub-additively:

| configuration | nDCG@10 | vs today | cold-start |
|---|---|---|---|
| baseline (ships today) | 0.2586 | — | 0.0852 |
| univariate 35d, rank-uniform | 0.2972 | +14.9% | 0.0901 |
| univariate 35d + WCCN | 0.3203 | +23.9% | 0.1290 |
| forward 21d, rank-uniform | 0.3102 | +20.0% | 0.1581 |
| forward 21d + WCCN | 0.3274 | +26.6% | 0.1536 |
| **forward 21d + learned weights** | **0.3511** | **+35.8%** | **0.2089** |
| forward 21d + WCCN + learned weights | 0.3594 | +39.0% | 0.2136 |
| all 55d + WCCN | 0.2940 | +13.7% | 0.0692 |

Two readings matter more than the headline.

**Cold-start retrieval improves by 145%** (0.0852 → 0.2089). On a corpus where 68%
of composers have exactly one tune, the headline average is dominated by the
prolific minority; cold start is what decides whether stations work for the rest.

**"All 55 dimensions plus a supervised metric" (+13.7%) is WORSE than 21
forward-selected dimensions with no supervision at all (+20.0%).** A full covariance
fitted on the labels cannot undo dimensional dilution. Choosing the right features
matters more than the metric applied over them — the opposite of where this campaign
started looking.

### 9.9 What is deployable among these

Retrieval quality is not the only constraint. The station applies an absolute
minimum-similarity threshold, so a configuration also has to leave enough
candidates above it — and not so many that the adventure control stops selecting.

| configuration | threshold reach (med / p05 / min) | negative similarities |
|---|---|---|
| baseline (ships today) | 80.7% / 9.5% / 4.8% | — |
| 21d rank-uniform | 80.9% / 10.9% / 1.2% | 0.0% |
| **21d rank-uniform + learned weights** | 79.8% / **14.1%** / 1.6% | 0.0% |
| 21d rank-uniform + WCCN | 49.5% / 9.0% / 0.6% | 0.0% |
| 35d rank-gaussian | **0.0% / 0.0% / 0.0%** | — |

Learned diagonal weights are the ideal case: they are per-dimension multipliers,
which is exactly what the product's weights table already is, so there is no new
serving machinery and no matrix to ship. They also *improve* the worst-case pool
(p05 reach 14.1% against today's 9.5%).

Within-class whitening halves threshold reach. That is not a breakage — on the full
corpus 0.6% of 87k tracks is still above the 100-candidate minimum — but it
materially changes what the adventure setting means, and the honest fix is to
re-express that setting as a percentile of the observed similarity distribution
rather than an absolute cosine value. That is real remaining work, and its +3.2
points are left on the table for now.

### 9.10 A defect no retrieval metric could see

Found by reading actual neighbour lists rather than metrics. Subsongs of one SID
file are near-identical by every similarity measure, so an unconstrained neighbour
list stacks them. Measured on a held-out slice:

| | repeated-file stations | duplicate slots per 20 | worst single file |
|---|---|---|---|
| before | **54.7%** | 2.71 | **14 of 20 slots** |
| after a soft per-file cap | **6.0%** | 0.52 | 11 |

More than half of all stations contained the same tune twice or more, and the worst
case played one tune fourteen times out of twenty. From a listener's side that is a
broken station regardless of how good the retrieval number looks.

**The primary metric is structurally incapable of detecting this.** nDCG already
excludes same-file siblings of the SEED — that exclusion is in the pre-registered
protocol, precisely so subsong-heavy tunes cannot inflate scores — but nothing
excludes duplicates among the NEIGHBOURS of each other. The metric was blind to the
single most audible flaw in the output.

The cap is soft: prefer one subsong per file, relax to two and then three only as
far as needed to fill the station, because a station refuses to build below a
minimum size and serving a second subsong beats serving an error. The residual 6% is
where the corpus is genuinely sparse and relaxation is the correct answer.

Same-composer share falls from 16.5% to 13.5%, which is a *disclosure* rather than a
regression: duplicate subsongs were being counted as same-composer hits, which they
trivially are, so the higher figure was partly inflated by the repetition being
removed.

### 9.11 Is there headroom left?

Separability — the probability that two tracks by one composer are closer than a
random cross-composer pair — is a property of the features rather than of any
ranker, so it bounds what any metric can achieve.

| vector | separability AUC | nDCG@10 |
|---|---|---|
| legacy 4d ratings (**published today**) | 0.6116 | 0.0048 |
| shipped 24d | **0.7229** | 0.1803 |
| + tonal core (40d) | 0.7170 | 0.1732 |
| + tonal all (55d) | 0.7034 | 0.1691 |
| tonal only (31d) | 0.6542 | 0.0529 |

AUC 0.72 is well clear of the 0.50 floor, so the features carry real signal — and
well short of 1.0, so a substantial gap remains in principle. Note that unweighted
concatenation *lowers* AUC as dimensions are added, which is the same dilution
effect seen in the sweep, measured on the representation rather than on a ranking.

The learning curve, adding dimensions in descending order of univariate
separability, is monotone and still rising at the last dimension:

```
  1d 0.0315   3d 0.0864   8d 0.1502   16d 0.1635   20d 0.1791   24d 0.1803
```

No dimension in the 24 is harmful, and the curve has flattened but not turned
over. **The feature space had not plateaued, and acting on that is what produced the
result.** The leads open at the time were forward-selected features with learned
weights (+35.8% validation) and within-class whitening (+3.2 more, needing the
adventure threshold re-expressed as a percentile). Pursuing the deeper reading —
that the curve was flat because the information was exhausted, not the metrics —
led to the playroutine features and +118.4%.

Leads that remain open, in rough order of expected value:

1. **More playroutine detail.** The learned weights pin twelve playroutine
   dimensions at the optimiser's ceiling, meaning it wanted to weight them higher
   than the search allowed. Per-register write rates, write-order n-grams and
   inter-call timing are all still unexploited, and this is the group that already
   pays best.
2. **Within-class whitening**, worth +3.2 points on validation but halving the
   candidate pool above the station's absolute similarity threshold. The fix is to
   express the adventure setting as a percentile of the observed similarity
   distribution rather than a fixed cosine value.
3. **Refitting the weights on the full corpus.** The shipped table is fitted on an
   11k-track subsample; the search range should also be widened, given how many
   weights saturated.
4. **A better label.** Composer identity is a proxy, and one now partly satisfied by
   detecting shared tooling (§6). Progress beyond this probably needs listener
   judgements rather than directory structure.

**Further significant improvement is available. This campaign did not reach a
ceiling — it reached a good place to stop.** Further significant improvement is available and has
NOT been exhausted — this campaign stopped at a defensible shipping point, not at a
ceiling.

---

## 10. Honest limitations

- **The label is a proxy.** Composer identity is not fully determined by audio,
  and nDCG against it is a floor rather than a measure of perceived similarity.
- **The search is greedy, not exhaustive.** Six representations × five re-rankings
  × five feature sets is 150 candidates; Holm-correcting across 150 would demand
  roughly a 30x smaller p-value and would hide any effect this corpus can show. A
  sequential search evaluates ~20 instead, and the Holm family covers all of them.
  A greedy path can miss an interaction it never visits. One such miss was caught
  and corrected — tonal features lose under equal weighting and so would never
  have reached the supervised phases — but others may remain.
- **The best configuration found was not confirmed on test.** The supervised
  metric reaches +28.2% on validation. Its test performance is deliberately
  unmeasured, because the test set had already been consulted and a third look
  would carry selection optimism this document could not bound. It is reported as
  headroom, not as a result, and shipping it should wait for a fresh holdout — the
  full-corpus pass provides one.
- **The test set was consulted twice**, once per sweep configuration (+17.1% and
  +15.5% for the two pre-registered winners). Both are reported. The second
  inherits mild optimism from the first; with only two configurations the
  multiplicity is small, but it is not zero.
- **The tonal features cover 72% of the corpus.** The rest has no pitched
  oscillator content and is flagged rather than imputed (§5).
- **Unsupervised normalisation is fitted per slice.** rank-Gaussian and z-scoring
  are fitted on the slice being evaluated. They use no labels, so this is
  transductive normalisation rather than leakage, and it matches how a batch export
  would normalise over its whole corpus — but it is not the same as fitting on
  train alone.
- **The supervised map is fitted in a per-slice representation space.** The
  within-class whitening matrix is fitted on train's rank-Gaussian space and
  applied to validation's, which are not numerically identical. Both map each
  dimension to standard-normal marginals, so the map is meaningful in either, but
  it is an approximation.
- **The diversity guardrail was wrong, and the fix was chosen after seeing the
  data.** Section 8 reports the pre-registered outcome and the MMR analysis
  separately for exactly this reason.
- **One corpus, one machine.** Timing figures are single measurements.
- **The learned weights are fitted on an 11k-track subsample**, not on the full 87k
  corpus, because fitting needs a full pairwise distance matrix. This was previously
  recorded as an assumption; it has since been **measured** (§12), and it holds — but the
  same measurement shows the *relative* gain is corpus-dependent and smaller elsewhere.
- **A higher headline number was available and rejected.** Widening the weight search
  reaches +136.9% instead of +130.4%, by zeroing 19 of 58 dimensions, and costs 33% of
  cold-start retrieval. On a corpus where 68% of composers have one tune that is the
  wrong trade, but it is a judgement call rather than a fact, and someone optimising
  purely for the headline metric would choose differently.
- **Sharper discrimination narrows the candidate pool.** Measured against the
  station's absolute 0.73 similarity threshold, the 58-dimension weighted vector gives
  median reach 78.7% against today's 80.7% — but the 5th percentile falls from 9.5% to
  5.1% and the worst seed from 4.8% to 3.0%. That is the intended effect of
  discriminating better, and on the 87k published corpus even 3.0% is ~2,600
  candidates against a 100-track station minimum. On a small subset it would bind, and
  the soft per-file cap plus the threshold relaxation are what keep such a case
  building rather than erroring. Similarity stays non-negative (range 0.305–1.000), so
  no downstream assumption is violated.
- **Identifying tooling is not identifying sound.** The playroutine features work
  partly by recognising which player a composer used (§6). Two composers sharing a
  player look artificially close; one who changed tools mid-career looks artificially
  distant. The composer label cannot separate those cases from genuine similarity.

---

## 11. Files

| Path | Purpose |
|---|---|
| `scripts/station-quality/metrics.ts` | Pre-registered metric definitions, MMR assembly |
| `scripts/station-quality/harness.ts` | Grouped split, nDCG@k, paired bootstrap, Holm |
| `scripts/station-quality/techniques.ts` | Representations, re-rankings, supervised metric |
| `scripts/station-quality/vector-specs.ts` | Named feature sets, so a feature set is a candidate |
| `scripts/station-quality/load-features.ts` | Offline vector rebuild from the features JSONL |
| `scripts/station-quality/optimise-all.ts` | The candidate sweep |
| `scripts/station-quality/ceiling.ts` | Separability, per-dimension AUC, learning curve |
| `scripts/station-quality/select-dev-corpus.ts` | Group-uniform development corpus selection |
| `scripts/station-quality/classify-dev-corpus.sh` | Repeatable corpus classification |
| `scripts/station-quality/bench-threads.sh` | Thread-count throughput measurement |
| `scripts/engine-comparison/` | Two-engine comparison, reusable |
| `doc/engine-comparison.md` | Earlier engine study |

The offline vector rebuild is what makes feature search affordable: the vector is a
pure function of the raw features plus a corpus normalisation model, so candidate
feature sets are evaluated in seconds instead of a two-hour re-classification.
It is verified to reproduce an export's stored vectors with a maximum absolute
difference of **exactly 0** over 710 tracks, which is why offline results here can
be believed.

---

## 12. Does any of this transfer? Measured on 21,451 unseen tracks

Every number above §12 was measured on a held-out split **of the development corpus**.
Held out *within* a corpus is not held out *from* it: the rank normalisation, the rating
quantiles and the learned weights were all fitted against one collection's feature
distribution, so a reported gain could in part be a fit to that distribution rather than
a property of the method.

`scripts/station-quality/verify-transfer.ts` measures the shipped configuration on a
different slice of HVSC with **every track appearing in the development corpus removed**
— 2,796 of 24,247 dropped, leaving 21,451 that were not seen during fitting in any
capacity.

| Configuration | nDCG@10 (unseen) | nDCG@10 (dev corpus) |
|---|---|---|
| Published today: 4-dimension ratings vector | 0.0089 | 0.0048 |
| Previous best in repo: 24-dim raw + weighted | **0.3354** | 0.2340 |
| Shipped: 58-dim rank-uniform + learned weights | **0.5672** | 0.5392 |

### The weights transfer

0.5672 on unseen tracks against 0.5392 on the corpus they were fitted to. The shipped
configuration is *not* worse away from its training distribution, which is the thing
that needed checking. Rating calibration transfers exactly as designed too: all three
scales use 5 levels at 20.00% each, 2.3219 bits, on a corpus whose quantiles were
recomputed from scratch.

### But the headline improvement is corpus-dependent, and smaller here

| Comparison | Development corpus | Unseen tracks |
|---|---|---|
| vs the published 4-dim vector | ~110x | **63.7x** (+6265%, p=0.0002) |
| vs the previous best 24-dim config | +130.4% | **+69.1%** (p=0.0002) |

Both are large and both are significant, but +130.4% is **specific to the development
corpus** and should not be quoted as the general figure. The reason is not that the new
vector got worse — it got better, 0.5392 to 0.5672 — but that the 24-dimension baseline
is much stronger on this slice, 0.2340 to 0.3354.

That difference is a property of group structure. The development corpus was
deliberately built group-uniform, sampling whole composer groups so that many composers
have several tracks. This slice is a queue-order prefix in which composer directories
arrive in contiguous alphabetical blocks, and the old spectral vector does relatively
better at that. Neither corpus is wrong; they are different retrieval problems, and the
honest summary is a range rather than a point.

**The defensible claim is therefore: roughly 64x better than what is published today,
and roughly 70-130% better than the best configuration previously in the repository,
depending on corpus composition.**

### Cold start is much worse on this slice

0.0215 here against 0.2453 on the development corpus. This is the same group-structure
effect seen from the other side: a queue-order prefix contains a large number of
composers represented once or twice, and there is genuinely little to retrieve for them.
It is a caution about reading any single cold-start number as a property of the method,
including the favourable one.

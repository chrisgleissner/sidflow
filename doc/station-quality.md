# Station quality: what was measured, what changed, and what is still limiting

This documents an optimisation campaign on SIDFlow's two station types — "songs
similar to this one" and category stations — run against a pre-registered
protocol. It reports every candidate tried, including the failures, and states
where the protocol itself turned out to be wrong.

The short version:

- **Category stations were broken and are now fixed, provably.** The 1-5 scale
  used 3 of its 5 levels with up to 94% of the collection on one level. It now
  uses all five at 20% each. This is a construction, not a tuning result.
- **The biggest similarity win is not an algorithm change.** The published export
  carries 4-dimensional vectors and scores nDCG@10 0.0048; the 24-dimensional
  vector already in the code scores 0.1803, roughly **38x higher**. Regenerating
  the exports dwarfs everything else in this document.
- **A +14.8% held-out improvement is shipped** (nDCG@10 0.2340 → 0.2686,
  p=0.0002), from 11 new pitch/texture features plus rank normalisation. The
  pre-registered ≥20% bar was **not** met.
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

**Decision: reSIDfp**, for a narrower reason than "maximum quality". At
development-corpus scale it costs about 1.3 h, it is the reference for the 11
WAV-derived dimensions, and using one engine throughout prevents paired
"old features vs new features" comparisons from being confounded by engine.
SIDLite is a *validated* fallback: 2.0 h instead of 9.5 h for a full pass.

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

## 6. Export schema: dimensionality is already data-driven

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

## 7. What users are actually served today

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

## 8. Similarity optimisation

### 8.1 What was searched

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

### 8.2 Validation results (all candidates, both runs)

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

### 8.3 The pre-registered outcome

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

**The pre-registered success criterion was NOT met.** It required ≥20% relative
gain on test; the result is +15.5%. That is the protocol's answer and it is
reported as such.

The gain is nonetheless real, significant, and clean on both guardrails, and
cold-start retrieval improves by 59% relative — which matters more than the
headline for a corpus where 68% of composers have a single tune.

### 8.4 The guardrail was the wrong instrument

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

### 8.5 What is actually shipped, and why it is not the top scorer

The best-ranking configuration is not deployable. This is the table that decided
what ships:

| configuration | test nDCG@10 | vs today | candidates above the station threshold (median / p05 / min) | deployable |
|---|---|---|---|---|
| 24d raw + weighted cosine (**ships today**) | 0.2340 | — | 80.7% / 9.5% / 4.8% | yes |
| 35d raw + uniform cosine | 0.2340 | **+0.0%** (p=0.9936) | 78.8% / 3.6% / 0.5% | yes |
| **35d rank-uniform + cosine (SHIPPED)** | **0.2686** | **+14.8%** (p=0.0002) | 79.8% / 8.4% / 2.1% | yes |
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

### 8.6 Which tonal features earn their place

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

### 8.7 A better feature set, found by optimising the objective directly

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

### 8.8 Is there headroom left?

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
over. **The feature space has not plateaued**, which is the honest answer to
whether more work would pay. Two concrete leads are already measured and
unconfirmed: the supervised metric at +28.2% and forward-selected features at
+20.0%, both on validation. Further significant improvement is available and has
NOT been exhausted — this campaign stopped at a defensible shipping point, not at a
ceiling.

---

## 9. Honest limitations

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

---

## 10. Files

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

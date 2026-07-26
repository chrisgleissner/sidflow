# SID Features → Perceptual Tags → `c/e/m` (deterministic spec)

This document defines a deterministic, limited-claim mapping from a small set of Essentia-derived features to:

- perceptual tag scores in `[0, 1]`, then
- 3 ratings: `c` (complexity proxy), `e` (energy proxy), `m` (mood proxy; restricted).

The goal is not to “guess genre” or “understand melody”, but to produce stable, dataset-normalized signals that are useful for clustering/stations and for coarse browsing.

## A) Inputs (existing)

Use only these feature fields (as produced by the classifier):

- `bpm` (optionally gated by `confidence` if present)
- `rms`, `energy`
- `spectralCentroid`
- `spectralRolloff`
- `spectralFlatnessDb`
- `spectralEntropy`
- `spectralCrest`
- `spectralHfc`
- `zeroCrossingRate`

Rationale (high-level, limited-claim):

- Centroid/rolloff/HFC are standard descriptors of “brightness / high-frequency content”.
- ZCR/flatness/entropy/crest correlate with noisiness, transients, and spectral distribution.
- RMS/energy and tempo correlate more strongly with perceived arousal/activation than with valence.

## B) Dataset normalization

All feature normalization is computed per dataset/run.

For each feature $f$:

$$f_{norm} = clamp\left(\frac{f - \mu_f}{\sigma_f}, -3, +3\right)$$

Where:

- $\mu_f$ and $\sigma_f$ are computed across the dataset for the current `featureSetVersion` and `render_engine`.
- Features that are **missing**, **non-finite**, or have **degenerate variance** are treated as missing for that record.
- Features that are **constant-zero across the dataset** are excluded from the model.

Define:

$$sigmoid(x) = \frac{1}{1 + e^{-x}}$$

All tag scores are in `[0,1]`.

## C) Core perceptual tags

These tags are designed to be plausibly defensible with timbral + tempo features. They are not “semantic labels”.

### 1) `tempo_fast` (pace)

$$tempo\_fast = sigmoid(1.0 \cdot bpm_{norm})$$

If `confidence` is available, it gates the effect of BPM by scaling the normalized BPM term (low confidence => closer to `0.5`).

### 2) `bright` (spectral brightness)

$$bright = sigmoid(0.45\,centroid_{norm} + 0.35\,rolloff_{norm} + 0.20\,hfc_{norm})$$

### 3) `noisy` (noise-like vs tonal)

$$noisy = sigmoid(0.45\,flatnessDb_{norm} + 0.25\,zcr_{norm} + 0.30\,entropy_{norm})$$

### 4) `percussive` (transient / attack emphasis)

$$percussive = sigmoid(0.50\,crest_{norm} + 0.30\,zcr_{norm} + 0.20\,hfc_{norm})$$

### 5) `dynamic_loud` (activation from level)

$$dynamic\_loud = sigmoid(0.70\,rms_{norm} + 0.30\,energy_{norm})$$

### 6) `tonal_clarity` (inverse-noise proxy; NOT “melody”)

$$tonal\_clarity = 1 - noisy$$

This is **tonal vs noise-like**, not “melodic”. Without pitch/chroma/harmony features, “melodic” is not supportable.

### 7) `demo_like` (style heuristic)

This is explicitly a heuristic/style label, not a perceptual primitive.

To avoid logits, use a simple weighted sum:

$$demo\_like = clamp(0.40\,tempo\_fast + 0.35\,percussive + 0.25\,bright, 0, 1)$$

## D) Tag → rating mapping (`c/e/m`)

### `c` (complexity) — textural/rhythmic density proxy

$$c_{raw} = clamp(0.22\,percussive + 0.16\,tempo\_fast + 0.16\,bright + 0.10\,noisy + 0.20\,note\_density + 0.10\,polyphony + 0.06\,rhythmic\_vocabulary, 0, 1)$$

Interpretation: transient density, pace and brightness read as timbrally busy; note
density, simultaneous voices and the spread of note lengths measure the musical
density directly.

**Revised once pitch became observable.** The earlier form used only spectral and
rhythmic proxies, and measured against HVSC it had a Spearman correlation of
**−0.016 with note rate** and −0.019 with onset density: no relationship at all with
how many notes a tune contains, despite claiming to be a density proxy. It was
tracking spectral brightness instead (ρ 0.64 against both centroid and
zero-crossing rate). With note-level features from the register trace the claim is
now met — ρ 0.597 against note rate and 0.555 against polyphony — while the
spectral terms keep a reduced share, because timbral busyness is a genuine part of
perceived complexity.

### `e` (energy) — arousal/activation proxy

$$e_{raw} = clamp(0.40\,dynamic\_loud + 0.35\,tempo\_fast + 0.25\,percussive, 0, 1)$$

### `m` (mood) — smoothness plus a confidence-weighted valence term

$$m_{raw} = clamp(0.34\,tonal\_clarity + 0.19\,(1 - percussive) + 0.11\,(1 - bright) + 0.11\,(1 - dynamic\_loud) + 0.25\,valence, 0, 1)$$

$$valence = clamp(0.5 + (0.5 - minorness) \cdot confidence, 0, 1), \quad confidence = clamp(2(key\_strength - 0.5), 0, 1)$$

Interpretation:

- higher $m_{raw}$ = smoother / cleaner / more major-key
- lower $m_{raw}$ = more tense / harsh / more minor-key

**The restricted claim has been lifted.** This section previously stated that
valence could not be claimed because major/minor was not observable, and section F
below named the features that would unlock it. Those features now exist, derived
from the SID register trace, so the deferral no longer applies.

Valence is weighted by how confidently a key was found. A percussion-only or atonal
track has no valence to report, and asserting one from a meaningless key estimate
would be worse than abstaining — such tracks fall back to the smoothness terms
alone. The smoothness terms are retained rather than replaced: both contribute to
what a listener means by mood, and discarding a working signal to chase a new one
would be a poor trade.

Measured against HVSC, mood now correlates −0.322 with minorness and −0.351 with
minor-third content, in the expected direction, while retaining its harshness axis
(−0.661 against zero-crossing rate).

### Quantization

Ratings are in `[1..5]`, assigned by **corpus quantile** rather than by a linear map
of the raw score:

$$rating = 1 + \left|\{ q \in \{q_{20}, q_{40}, q_{60}, q_{80}\} : raw > q \}\right|$$

The earlier linear form, $round(1 + 4 \cdot raw)$, collapsed. Each raw score is a
weighted average of sigmoids of clamped z-scores, so reaching level 1 or 5 requires
several sigmoids at a joint ~2.4σ extreme simultaneously, and averaging concentrates
the result on its mean. Measured on HVSC: 3 of 5 levels ever used, up to 94% of the
collection on a single level, and mood carrying 0.397 of the 2.322 bits a five-level
scale can hold.

Quantile breakpoints populate all five levels by construction — measured 20% each,
entropy 2.322 of 2.322 bits — and the mapping is monotone, so it changes only where
the scale is cut and never which track is rated higher. Levels become
corpus-relative percentiles: "5" means the top fifth of this collection.

See doc/station-quality.md §4.

## E) What we explicitly do NOT claim

Do not claim:

- “melodic” (music-theory sense)
- happy/sad, major/minor, heroic, nostalgic (valence)

These require tonal/pitch/harmony cues or supervised labels.

## F) Feature additions that unlocked “melodic” and better mood — DONE

To support melodic and valence-like claims, this section asked for:

- pitch / predominant melody confidence — **added** (`sidMelodicClarity`, `sidKeyStrength`)
- chroma (HPCP) + key + mode (major/minor) — **added** (`sidKeyRoot`, `sidKeyMinorness`, tonic-rotated scale weights)
- harmonicity / inharmonicity / dissonance — **added** (harmonic interval-class content, `inharmonicity` already present)
- onset rate / spectral flux — **added** (`sidNoteRate`, `sidNoteDurationEntropy`; spectral flux already present)

All are read from the SID register trace rather than estimated from audio: the
oscillator frequency is exactly $f = F_n \cdot F_{clk} / 2^{24}$, so note pitch is
recovered rather than inferred. See doc/station-quality.md §5.

One finding worth recording, because it is counter-intuitive: major-versus-minor
mode is useless for identifying a COMPOSER (separability AUC 0.507 against a 0.500
floor) while being clearly useful for mood. Feature value is task-specific, and a
dimension dropped from the similarity vector can still belong in a rating.

## G) Implementation rules

- Deterministic; no randomness.
- Missing features are dropped and weights are renormalized.
- Store $\mu$/$\sigma$ per feature, per `featureSetVersion` and `render_engine`.
- Keep `demo_like` explicitly labeled as heuristic/style.

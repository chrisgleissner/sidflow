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

$$c_{raw} = clamp(0.35\,percussive + 0.25\,tempo\_fast + 0.25\,bright + 0.15\,(1 - tonal\_clarity), 0, 1)$$

Interpretation: more transient density + faster pace + brighter spectra + some noise-like content can read as “busier/denser” timbrally.

### `e` (energy) — arousal/activation proxy

$$e_{raw} = clamp(0.40\,dynamic\_loud + 0.35\,tempo\_fast + 0.25\,percussive, 0, 1)$$

### `m` (mood) — RESTRICTED CLAIM

With this feature set, we do **not** claim valence (happy/sad). We only attempt a coarse “smooth/clear vs tense/harsh” axis.

$$m_{raw} = clamp(0.45\,tonal\_clarity + 0.25\,(1 - percussive) + 0.15\,(1 - bright) + 0.15\,(1 - dynamic\_loud), 0, 1)$$

Interpretation:

- higher $m_{raw}$ = smoother / cleaner / less harsh
- lower $m_{raw}$ = more tense / harsh / driven

### Quantization

Ratings are in `[1..5]`:

$$rating = round(1 + 4 \cdot raw)$$

## E) What we explicitly do NOT claim

Do not claim:

- “melodic” (music-theory sense)
- happy/sad, major/minor, heroic, nostalgic (valence)

These require tonal/pitch/harmony cues or supervised labels.

## F) Minimal feature additions to unlock “melodic” and better mood (recommended)

To support melodic and valence-like claims, add at least:

- pitch / predominant melody confidence
- chroma (HPCP) + key + mode (major/minor)
- harmonicity / inharmonicity / dissonance
- onset rate / spectral flux

## G) Implementation rules

- Deterministic; no randomness.
- Missing features are dropped and weights are renormalized.
- Store $\mu$/$\sigma$ per feature, per `featureSetVersion` and `render_engine`.
- Keep `demo_like` explicitly labeled as heuristic/style.

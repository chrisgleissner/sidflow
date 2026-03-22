# SIDFlow Station & Similarity System — Full Audit and Redesign

**Date**: 2026-03-22
**Author**: Research audit (autonomous)
**Scope**: End-to-end analysis of SIDFlow's classification → similarity → station → feedback pipeline

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Pipeline Map](#2-pipeline-map)
3. [Root Cause Analysis](#3-root-cause-analysis)
4. [Perceptual Feature Gap Analysis](#4-perceptual-feature-gap-analysis)
5. [Offline Representation Strategy](#5-offline-representation-strategy)
6. [Similarity Model Redesign](#6-similarity-model-redesign)
7. [Cold-Start Improvement](#7-cold-start-improvement)
8. [User Feedback Model](#8-user-feedback-model)
9. [Controlled Randomness ("Adventure Factor")](#9-controlled-randomness-adventure-factor)
10. [Autonomous Self-Improvement Loop](#10-autonomous-self-improvement-loop)
11. [Safety of Self-Improvement](#11-safety-of-self-improvement)
12. [Target Architecture](#12-target-architecture)
13. [Validation Plan](#13-validation-plan)
14. [Implementation Roadmap](#14-implementation-roadmap)

---

## 1. Executive Summary

SIDFlow's current similarity system operates on a **4-dimensional rating vector** `[E, M, C, P]` (Energy, Mood, Complexity, Preference) where each dimension is an integer from 1–5. This representation is derived deterministically from ~10 audio features via sigmoid-weighted combinations and quantized to 5 levels.

**Core finding**: The system's perceptual coherence failures stem from three compounding problems:

1. **Extreme information bottleneck**: 35+ extracted features are crushed into 3 integer ratings (125 possible states), destroying perceptual distinctions
2. **Missing perceptual dimensions**: No rhythm structure, no timbral character, no temporal dynamics — features that define what makes two SID tunes "similar"
3. **Coarse quantization**: Integer 1–5 ratings with cosine similarity create large equivalence classes where perceptually different tracks are indistinguishable

The redesign retains the offline-heavy / runtime-light architecture while expanding the representation to a ~24D perceptual vector that preserves SID-specific distinctions.

---

## 2. Pipeline Map

### Current Data Flow

```
SID file
  │
  ├─ sidplayfp/WASM render ──► WAV (11025 Hz, 15s window)
  │
  ├─ Essentia.js extraction ──► ~35 features:
  │     time-domain: energy, rms, zeroCrossingRate
  │     spectral: centroid, rolloff, flatnessDb, crest, entropy, hfc
  │     MFCC: coefficients 1-5
  │     spectral contrast: 6 bands
  │     tempo: bpm, confidence, method
  │
  ├─ Dataset normalization ──► z-score per feature (μ/σ, 3σ clamp)
  │
  ├─ Sigmoid tag derivation ──► 7 tags [0,1]:
  │     tempo_fast, bright, noisy, percussive, dynamic_loud, tonal_clarity, demo_like
  │
  ├─ Rating quantization ──► c ∈ [1,5], e ∈ [1,5], m ∈ [1,5]
  │
  ├─ JSONL output ──► data/classified/classification_*.jsonl
  │
  └─ User preference (optional) ──► p ∈ [1,5]

Vector: [e, m, c, p] ──► SQLite/LanceDB
  │
  ├─ Station CLI: centroid of favorites → cosine similarity → bucket diversification → flow ordering
  ├─ Web API: LanceDB vector search → personalization boost → diversity filter
  └─ Export: precomputed neighbor table in SQLite
```

### Key Information Loss Points

| Stage | Input dims | Output dims | Loss |
|-------|-----------|-------------|------|
| Features → Tags | ~35 continuous | 7 continuous [0,1] | Moderate — weighted sums collapse orthogonal info |
| Tags → Ratings | 7 continuous | 3 integers [1,5] | **Severe** — 125 possible states for entire corpus |
| Ratings → Vector | 3 integers + 1 optional | 4D vector | Minimal — just assembly |
| Vector → Similarity | 4D continuous | scalar | Expected — distance metric |

**Critical bottleneck**: The Tags → Ratings quantization stage. A corpus of 50,000+ tracks is mapped to at most 125 distinct points in the similarity space (5³). With the preference dimension, this expands to 625 (5⁴), but P defaults to 3 for all unrated tracks, leaving the effective space at 125.

---

## 3. Root Cause Analysis

### Root Cause 1: Extreme Dimensionality Collapse (Critical)

**Evidence**: The similarity vector is `[E, M, C, P]` with integer values 1–5. Cosine similarity between `[3, 4, 3, 3]` and `[3, 4, 2, 3]` is 0.9986. Between `[3, 4, 3, 3]` and `[4, 4, 3, 3]` it is 0.9978. These tracks are functionally identical in the similarity space despite potentially being a slow ambient piece versus a driving game soundtrack.

**Calculation**: With 5 values per dimension and 3 effective dimensions (P defaults to 3), there are 5³ = 125 distinct vectors. For a corpus of ~50,000 tracks, each vector bucket contains ~400 tracks on average. Cosine similarity cannot distinguish tracks within the same bucket.

**Impact**: Stations contain tracks that happen to share the same coarse rating triple but have completely different perceptual character. A "dark ambient" station may include fast, aggressive tracks that happen to also score e=3, m=1, c=3.

### Root Cause 2: Missing Perceptual Dimensions

**Evidence**: The feature set captures spectral shape and energy but lacks:

| Missing Dimension | Why It Matters for SID | Current Coverage |
|---|---|---|
| **Rhythm pattern / groove** | SID music varies hugely in rhythmic complexity (straight 4/4 vs 6/8 vs arpeggio-driven pseudo-rhythm) | Only `bpm` (scalar) — no pattern info |
| **Temporal dynamics / structure** | Some SIDs have intro→verse→chorus arcs, others are static loops | None — single 15s window analyzed |
| **Arpeggio density** | Defines SID character — fast arpeggios read as metallic/harsh, slow as dreamy | Partially captured by ZCR/HFC but not disambiguated |
| **Voice count usage** | 1-voice minimalism vs full 3-voice composition | Not measured |
| **Pitch register** | Bass-heavy vs mid vs treble-dominant | Crudely captured by spectralCentroid |
| **Melodic vs non-melodic** | Acknowledged gap in feature-tag-rating-mapping.md | Not supported |
| **Filter sweep activity** | SID-specific; defines "wah" / "resonance" character | Not measured |

**Impact**: Two SID tracks can have identical spectral statistics but completely different character. Example: a fast arpeggio-driven demo track and a percussion-heavy game track may score identically on brightness, RMS, and ZCR, despite sounding nothing alike.

### Root Cause 3: Cold-Start Centroid Instability

**Evidence**: The station system requires 10 ratings minimum. With 10 ratings in a 4D integer space, the weighted centroid is extremely sensitive to individual rating variance:

- Given 10 tracks with ratings in [1,5], each track shifts the centroid by ±0.1 per dimension per unit.
- Rating one track a 5 vs a 4 shifts the "love weight" from 4x to 9x (2.25x multiplier), dominating the centroid.
- With only 3 "love" ratings (≥4), a single outlier can shift the centroid to a bucket that doesn't represent the user's intent.

**Mathematical demonstration**: User likes 3 dark tracks `[4,1,3,5]` and 1 upbeat track `[5,5,4,5]`. The 9x weighting of a single 5-rated upbeat track versus three 4-rated dark tracks (4x each):
- Dark centroid: `[4, 1, 3]` × 4 × 3 = `[48, 12, 36]`
- Upbeat contribution: `[5, 5, 4]` × 9 = `[45, 45, 36]`
- Weighted centroid: `[93/21, 57/21, 72/21]` = `[4.4, 2.7, 3.4]` — shifted heavily toward the upbeat outlier

The centroid no longer represents "dark" — it represents a midpoint that doesn't match either the dark tracks or the upbeat one, resulting in "mush" stations.

### Root Cause 4: Feedback System Not Connected (Structural)

**Evidence**: The web feedback sync endpoint (`POST /api/feedback/sync`) accepts payloads but does not persist them server-side. The client-side IndexedDB accumulates events that are never integrated back into the model. The training pipeline (`@sidflow/train`) exists but:

- Requires manual invocation
- Server-side sync is a stub
- No scheduled retraining mechanism exists
- No automated model promotion or rollback

**Impact**: The system cannot improve from user behavior. All recommendation quality comes from the initial deterministic classification, which has the bottleneck problems described above.

### Root Cause 5: No Outlier Rejection in Station Generation

**Evidence**: The `buildStationQueue` function in [`queue.ts`](../../packages/sidflow-play/src/station/queue.ts) filters candidates only by:
- Already-excluded track IDs (user dislikes ≤2)
- Minimum duration threshold
- Deduplication

There is no **minimum similarity threshold**. The function retrieves `limit * (3 + adventure)` recommendations from `recommendFromFavorites`, which returns results ranked by cosine similarity but accepts any score. With the coarse 4D integer space, tracks with cosine similarity > 0.99 but completely different perceptual character are included.

The web API's `similarity-search.ts` does have a configurable `minSimilarity` threshold (default 0.5), but the station CLI path does not apply one.

**Impact**: Station queues can contain "tail" tracks that scored well in cosine similarity due to the quantized vector space but are perceptual mismatches — this is the most common user-visible coherence failure.

---

## 4. Perceptual Feature Gap Analysis

### Current Feature Coverage

| Perceptual Dimension | Required? | Current State | Assessment |
|---|---|---|---|
| **Speed** (slow ↔ fast) | Yes | BPM + confidence | ✅ Adequate — BPM estimation works well for SID |
| **Energy** (calm ↔ intense) | Yes | RMS + energy + BPM | ⚠️ Partial — RMS/energy alone don't separate "loud but calm" from "quiet but intense" |
| **Mood** (dark ↔ bright) | Yes | Tonal clarity (inverse noise) | ❌ Inadequate — this measures noisiness, not emotional valence; acknowledged in `feature-tag-rating-mapping.md` |
| **Density** (sparse ↔ busy) | Yes | Percussive + bright + tempo | ⚠️ Partial — this heuristic conflates several properties |
| **Rhythm structure** | Yes | BPM only | ❌ Missing — no onset pattern, no beat regularity, no rhythmic complexity |
| **Timbral character** (harsh ↔ soft) | Yes | Spectral centroid/rolloff/crest | ⚠️ Partial — aggregate spectral shape, loses temporal evolution |
| **Atmosphere** (meditative ↔ aggressive) | Yes | Not directly modeled | ❌ Missing — would need combination of dynamics, rhythm, spectral evolution |
| **Danceability / momentum** | Yes | Not modeled | ❌ Missing — requires onset regularity, beat strength, tempo stability |

### SID-Specific Properties

| SID Property | Current Coverage | Extraction Feasibility |
|---|---|---|
| **Waveform type** (pulse, sawtooth, triangle, noise) | Indirectly via spectral shape | ✅ Can be directly detected from SID register dumps or spectral classification |
| **Arpeggio presence / rate** | Partially via ZCR/HFC | ✅ Can be detected via pitch modulation rate in short windows |
| **Filter usage / sweep** | Not measured | ✅ Detectable from spectral centroid temporal variance |
| **Voice count** | Not measured | ✅ Polyphony estimation from spectral peaks |
| **Pulse width modulation** | Not measured | ⚠️ Detectable but requires careful spectral analysis |
| **Ring modulation** | Not measured | ⚠️ Detectable via intermodulation products |

### Features That Can Be Extracted From Current WAV Pipeline

The following features require **no new infrastructure** — they can be computed from the same 11025 Hz WAV window currently analyzed:

1. **Onset rate** (onsets/sec): Number of note onsets per second → rhythm density
2. **Onset regularity** (std dev of inter-onset intervals / mean): → danceability, groove
3. **Spectral flux** (mean + std): Frame-to-frame spectral change → dynamics, transitions
4. **Spectral centroid variance** (temporal std over frames): → filter sweep activity, timbral modulation
5. **MFCC delta** (mean abs first derivative of MFCCs over frames): → timbral evolution rate
6. **Pitch salience** (Essentia `PitchSalience`): → melodic clarity vs noise/percussion
7. **Inharmonicity** (Essentia `Inharmonicity`): → timbral harshness
8. **Dissonance** (Essentia `Dissonance`): → consonance/dissonance → mood proxy
9. **Dynamic range** (max RMS - min RMS across frames): → compression / dynamics
10. **Low-frequency energy ratio** (energy below 250 Hz / total energy): → bass presence
11. **Beat strength** (Essentia `BeatTrackerDegara` beat magnitudes): → rhythmic emphasis

### Features Requiring SID Register Analysis (Optional Enhancement)

These require parsing the SID file directly rather than analyzing rendered audio, but provide much richer ground truth:

1. **Waveform usage histogram**: Distribution of pulse/saw/triangle/noise per voice
2. **Arpeggio detection**: Rapid pitch changes within single voice register
3. **Filter sweep rate**: Rate of change of filter cutoff register
4. **Active voice count over time**: How many voices are active simultaneously
5. **Pulse width modulation rate**: Rate of change of pulse width register

---

## 5. Offline Representation Strategy

### Design: Precomputed Perceptual Embedding Vector

Replace the 4D integer `[E, M, C, P]` vector with a **24D continuous perceptual vector** computed entirely offline.

#### Tier 1: Spectral Shape (8 dimensions)
Computed from existing Essentia features, retained as continuous values (not quantized):

| Dim | Name | Source | Range |
|-----|------|--------|-------|
| 0 | `brightness` | sigmoid(centroid_norm, rolloff_norm, hfc_norm) | [0, 1] |
| 1 | `noisiness` | sigmoid(flatness_norm, zcr_norm, entropy_norm) | [0, 1] |
| 2 | `percussiveness` | sigmoid(crest_norm, zcr_norm, hfc_norm) | [0, 1] |
| 3 | `loudness` | sigmoid(rms_norm, energy_norm) | [0, 1] |
| 4 | `bass_presence` | low_freq_energy_ratio | [0, 1] |
| 5 | `spectral_complexity` | mean(spectral_contrast[0:5]) normalized | [0, 1] |
| 6 | `harmonic_clarity` | pitch_salience or 1 - inharmonicity | [0, 1] |
| 7 | `dissonance` | Essentia dissonance or cross-harmonic ratio | [0, 1] |

#### Tier 2: Temporal Dynamics (6 dimensions)

| Dim | Name | Source | Range |
|-----|------|--------|-------|
| 8 | `tempo` | bpm normalized to [0,1] via (bpm - 60) / 140 | [0, 1] |
| 9 | `onset_density` | onsets/sec normalized | [0, 1] |
| 10 | `rhythmic_regularity` | 1 - (onset_ioi_std / onset_ioi_mean), clamped | [0, 1] |
| 11 | `spectral_flux_mean` | mean frame-to-frame spectral change | [0, 1] |
| 12 | `dynamic_range` | (max_rms - min_rms) / max_rms across frames | [0, 1] |
| 13 | `timbral_modulation` | std(spectral_centroid) over frames, normalized | [0, 1] |

#### Tier 3: Timbral Texture (5 dimensions)

| Dim | Name | Source | Range |
|-----|------|--------|-------|
| 14–18 | `mfcc_1` through `mfcc_5` | MFCC coefficients, z-normalized per dataset | ~[-1, 1] |

#### Tier 4: Derived Perceptual Axes (5 dimensions)

| Dim | Name | Formula | Meaning |
|-----|------|---------|---------|
| 19 | `energy_composite` | 0.35·loudness + 0.25·tempo + 0.20·onset_density + 0.20·percussiveness | Overall energy/arousal |
| 20 | `mood_proxy` | 0.35·harmonic_clarity + 0.25·(1-dissonance) + 0.20·(1-noisiness) + 0.20·(1-percussiveness) | Smooth/clear vs harsh/tense |
| 21 | `complexity_proxy` | 0.25·spectral_complexity + 0.25·onset_density + 0.25·timbral_modulation + 0.25·(1-rhythmic_regularity) | Textural/structural complexity |
| 22 | `danceability` | 0.40·rhythmic_regularity + 0.30·tempo + 0.30·percussiveness | Groove / rhythmic drive |
| 23 | `atmosphere` | 0.30·dynamic_range + 0.30·spectral_flux_mean + 0.20·(1-rhythmic_regularity) + 0.20·timbral_modulation | Static/meditative vs evolving/dramatic |

#### Backward Compatibility

The existing `c`, `e`, `m` integer ratings are preserved as derived values (quantized from dims 21, 19, 20 respectively) for:
- Legacy consumers
- Human-readable display
- Mood preset mapping

The preference dimension `p` is handled separately as a user-specific signal, not part of the content vector.

#### What Is Computed Offline vs Runtime

| Component | When | Cost |
|-----------|------|------|
| WAV rendering + feature extraction | Offline (classify) | ~2s per track |
| Per-track 24D vector computation | Offline (classify) | <1ms per track |
| Dataset normalization (μ/σ) | Offline (post-classify) | O(N) single pass |
| SQLite/LanceDB indexing | Offline (build-db/export) | O(N log N) |
| Vector similarity at runtime | Runtime | <1ms per query (cosine/L2 on 24D) |

**Runtime cost**: Cosine similarity on 24D float vectors is ~6x more computation than on 4D integer vectors, but still well under 1μs per comparison. For a full-corpus scan of 50K tracks, this is <50ms — entirely acceptable on commodity hardware.

---

## 6. Similarity Model Redesign

### Distance Metric

**Replace L2/cosine on integer vectors with weighted cosine similarity on continuous vectors.**

The 24D vector uses continuous [0,1] values, so cosine similarity naturally produces fine-grained distinctions. However, not all dimensions are equally important for perceptual coherence.

#### Dimension Weighting Strategy

Assign weights per dimension group to reflect perceptual salience:

```
Group               Dimensions    Weight per dim    Rationale
─────────────────────────────────────────────────────────────
Derived axes        19–23         1.5               Perceptual composites — strongest 
                                                    correlation to user intent
Temporal dynamics   8–13          1.2               Tempo/rhythm/dynamics are major 
                                                    perceptual differentiators
Spectral shape      0–7           1.0               Timbral fundamentals
MFCC texture        14–18         0.8               Lower-level timbral detail — 
                                                    important for fine distinctions, 
                                                    less salient for coarse matching
```

The weighted similarity computation becomes:

$$\text{sim}(a, b) = \frac{\sum_{i} w_i \cdot a_i \cdot b_i}{\sqrt{\sum_{i} w_i \cdot a_i^2} \cdot \sqrt{\sum_{i} w_i \cdot b_i^2}}$$

#### Feature Normalization

All dimensions are pre-normalized to approximately [0,1] or [-1,1] before vector storage. This prevents any single dimension from dominating the distance metric through scale differences. The normalization happens offline during classification and the parameters (μ, σ per feature) are stored in the export manifest.

#### Outlier Rejection Rules

1. **Minimum similarity threshold**: Station candidates must exceed `min_sim = 0.75` (configurable). The current station CLI has no threshold.

2. **Per-dimension deviation check**: Reject candidates where any single derived perceptual axis (dims 19–23) deviates by more than 0.3 from the seed/centroid value. This catches tracks that have high overall cosine similarity due to matching on low-salience dimensions but diverge on key perceptual axes.

3. **Adaptive threshold tightening**: For small stations (< 20 tracks), tighten min_sim to 0.82 to ensure high coherence. For large stations (> 50), relax to 0.70 to maintain diversity.

#### Anti-Dominance: No Single Feature Can Drive Similarity

The combination of:
- Continuous multi-dimensional representation (24D vs 4D integer)
- Dimensional weighting that distributes influence
- Per-dimension deviation checks

ensures that two tracks cannot be "similar" simply because they share BPM or energy. They must align across spectral, temporal, and derived perceptual axes simultaneously.

---

## 7. Cold-Start Improvement

### Problem Recap

With ~10 ratings in a coarse space, the centroid is unstable and sensitive to outliers. A single highly-rated outlier dominates due to the exponential weight mapping (rating 5 → weight 9x, rating 4 → weight 4x).

### Redesign: Robust Intent Inference

#### 1. Replace Exponential Weighting With Smoother Mapping

Current: `5→9, 4→4, 3→1.5, ≤2→0.1`

Proposed: `5→3.0, 4→2.0, 3→1.0, 2→0.3, 1→0.1`

This reduces the maximum weight ratio from 90:1 (9 vs 0.1) to 30:1 (3.0 vs 0.1), making the centroid more stable with few samples.

#### 2. Confidence-Aware Candidate Filtering

Instead of trusting the centroid absolutely, compute a **confidence radius** from the rated tracks:

$$r_{confidence} = \frac{1}{N_{rated}} \sum_{i=1}^{N_{rated}} w_i \cdot d(v_i, \bar{v})$$

where $\bar{v}$ is the weighted centroid and $d$ is cosine distance.

Only include candidates within `r_confidence * expansion_factor` of the centroid, where `expansion_factor` is initially 1.5 (tight) and increases as more ratings arrive:

$$\text{expansion\_factor} = 1.5 + 0.5 \cdot \min\left(1, \frac{N_{rated} - 10}{40}\right)$$

This means:
- 10 ratings → expansion factor 1.5 (very tight — only highly similar tracks)
- 25 ratings → expansion factor 1.69
- 50+ ratings → expansion factor 2.0 (confident enough to explore)

#### 3. Multi-Centroid Clustering for Diverse Tastes

When the user's rated tracks span disparate perceptual regions (e.g., they like both "dark ambient" and "upbeat game music"), a single centroid produces meaningless midpoint recommendations.

**Algorithm**:
1. Compute pairwise distances between all positive-rated tracks (rating ≥ 3)
2. If max pairwise distance > 0.5 (perceptually distinct clusters):
   - Run k-means with k=2 on the positive tracks
   - Generate station candidates separately for each cluster
   - Interleave results (alternating cluster membership, preserving score ranking within each)
3. Otherwise: single centroid as before

This allows the station to coherently serve users with diverse tastes without averaging away their distinct preferences.

#### 4. Minimum Viable Seed Improvement

Reduce `MINIMUM_RATED_TRACKS` from 10 to 5 **for the first station**, but with tighter confidence filtering (expansion_factor starts at 1.2) and a hard minimum similarity of 0.82. This gets users to their first station faster while maintaining quality.

After 15+ ratings, the confidence system relaxes and the full exploration range opens up.

---

## 8. User Feedback Model

### Current State (Verified)

| Signal | Captured? | Stored? | Used in Training? | Used in Recommendations? |
|--------|-----------|---------|-------------------|-------------------------|
| Explicit rating (e/m/c/p) | ✅ Web UI | ✅ Server-side JSONL | ✅ Full weight | ✅ Via LanceDB vector |
| Like | ✅ Web + CLI | ✅ IndexedDB (client) | ⚠️ If synced | ✅ Aggregate boost |
| Dislike | ✅ Web + CLI | ✅ IndexedDB (client) | ⚠️ If synced | ✅ Aggregate penalty |
| Skip | ✅ Web + CLI | ✅ IndexedDB (client) | ⚠️ Weak weight (0.3) | ✅ Small penalty |
| Listening duration | ❌ Not captured | ❌ | ❌ | ❌ |
| Replay (play same track again) | ❌ Not distinguished from new play | ❌ | ❌ | ❌ |
| Station abandonment | ❌ Not tracked | ❌ | ❌ | ❌ |
| Play completion (listened to end) | ❌ Not tracked | ❌ | ❌ | ❌ |

### Redesign: Enhanced Signal Collection

#### New Implicit Signals

1. **Play completion** (`play_complete`): Track played to ≥80% of duration. Strong positive signal.
   - Weight: +0.7

2. **Early skip** (`skip_early`): Skip within first 15s of playback. Stronger negative than late skip.
   - Weight: -0.7

3. **Late skip** (`skip_late`): Skip after 15s but before 60%. Milder negative (user sampled but didn't love it).
   - Weight: -0.2

4. **Replay** (`replay`): Same track played again within same session. Very strong positive.
   - Weight: +1.5

5. **Station abandonment**: Session ended within 3 tracks of start. Negative signal for the entire seed concept.
   - Weight: -0.3 per track played before abandonment

6. **Session duration**: Total time spent in a station session. Positive signal proportional to engagement.
   - Used for station-level quality scoring, not per-track

#### Feedback → Similarity Space Mapping

Each feedback signal updates the track's **effective preference vector** via exponential moving average:

$$v_{pref,t+1} = (1 - \alpha) \cdot v_{pref,t} + \alpha \cdot f(signal)$$

where:
- $\alpha = 0.1$ (slow adaptation)
- $f(\text{like}) = v_{track}$ (reinforce current position)
- $f(\text{dislike}) = 2 \cdot v_{centroid} - v_{track}$ (push toward anti-direction)
- $f(\text{skip_early}) = 0.5 \cdot f(\text{dislike})$ (mild push away)
- $f(\text{play_complete}) = v_{track}$ (reinforce)
- $f(\text{replay}) = v_{track}$ at weight $1.5\alpha$ (stronger reinforce)

#### Temporal Decay

Feedback events decay over time to allow preference evolution:

$$w_{effective} = w_{base} \cdot e^{-\lambda \cdot \Delta t}$$

where $\lambda = \frac{\ln 2}{T_{half}}$ and $T_{half} = 90$ days (3-month half-life).

This means:
- Feedback from today: full weight
- Feedback from 3 months ago: 50% weight
- Feedback from 6 months ago: 25% weight
- Feedback from 1+ year ago: <13% weight

For explicit ratings, $T_{half} = 365$ days (slower decay — conscious choices persist longer than implicit signals).

#### Negative Feedback Strength

Negative signals are weighted 1.5x relative to positive signals of the same magnitude, reflecting the empirical finding that a bad recommendation is more damaging to trust than a good one is beneficial. This asymmetry is bounded:

$$w_{negative} = \min(1.5 \cdot |w_{base}|, 2.0)$$

---

## 9. Controlled Randomness ("Adventure Factor")

### Current Implementation

The adventure parameter (default: 3, range: ≈1–5+) affects:
- Score exponent: `max(1.15, 3.05 - adventure * 0.35)` — flatter = more random
- Candidate pool: `limit * (3 + adventure)`
- Flow shortlist: `1 + floor(adventure / 2)`

### Redesign: Principled Exploration With Safety Bounds

#### New Model: Exploration as Controlled Radius Expansion

Instead of flattening the score distribution (which can include arbitrarily dissimilar tracks), model adventure as a **controlled expansion of the similarity acceptance radius**:

$$r_{accept} = r_{base} + \text{adventure} \cdot r_{step}$$

where:
- $r_{base} = 0.82$ (minimum similarity for inclusion at adventure=0)
- $r_{step} = 0.03$ (each adventure point relaxes threshold by 0.03)
- Adventure 0: min_sim = 0.82 (very tight, no exploration)
- Adventure 3: min_sim = 0.73 (moderate exploration)
- Adventure 5: min_sim = 0.67 (wide exploration)
- Adventure 10: min_sim = 0.52 (maximum — still above noise floor)

#### Hard Safety Floor

Regardless of adventure setting, **no candidate with similarity < 0.50 is ever included**. This prevents perceptual outliers at any adventure level.

Additionally, the per-dimension deviation check (Section 6) applies at all adventure levels. This means adventure controls how dissimilar on aggregate a track can be, but no single perceptual axis can deviate beyond 0.3 + adventure * 0.02 from the centroid (max 0.5 at adventure=10).

#### Exploration Injection Strategy

Rather than flattening all scores:

1. Fill 70% of station slots from the top-similarity candidates (exploitation)
2. Fill 30% from candidates in the `[min_sim, min_sim + 0.10]` band (near-boundary exploration)
3. Within the exploration band, select uniformly rather than by score — this ensures true diversity rather than just "slightly worse" same-sound tracks

#### Flow Ordering Preservation

Keep the flow-ordering algorithm (cosine continuity blending) for all tracks regardless of adventure level. Exploration tracks are interspersed with continuity-aware placement, so the station never has jarring transitions even with high adventure.

---

## 10. Autonomous Self-Improvement Loop

### Signal Collection

```
User interactions
  │
  ├─ Explicit: ratings (e/m/c/p, 1-5)
  ├─ Implicit: like, dislike, skip_early, skip_late, play_complete, replay
  ├─ Session: station duration, abandonment, track count
  └─ Contextual: time of day, station seed type
  │
  ▼
Event Store (append-only JSONL, date-partitioned)
  data/feedback/YYYY/MM/DD/events.jsonl
```

### Training Signal Derivation

Events are converted to training pairs during offline processing:

#### Positive Pairs (anchor → positive)
- Track A liked + Track B liked in same session → (A, B) positive pair
- Track A play_complete + Track B play_complete consecutively → (A, B) positive pair, weak
- Track A replay → (A, A) self-positive (reinforcement)

#### Negative Pairs (anchor → negative)
- Track A liked + Track B skipped_early in same session → (A, B) negative pair
- Track A liked + Track B disliked → (A, B) negative pair, strong

#### Fit Scores (per-track)
- Aggregate: `fit = (likes + play_completes - 1.5*dislikes - 0.5*skips_early - 0.2*skips_late) / max(total_events, 1)`
- Per-station: local fit within that station's context

#### Ranking Signals
- Within a station session, tracks that received positive signals are ranked above tracks that received negative signals
- This produces listwise ranking labels for learning-to-rank

### Model Update Strategy

**Primary: Periodic Offline Retraining (Weekly or on-demand)**

```
Schedule: Every 7 days (configurable) OR after N new feedback events
  │
  1. Load current production embedding vectors (24D per track)
  2. Load accumulated feedback events since last training
  3. Derive positive/negative pairs + fit scores + ranking signals
  4. Train lightweight metric learning update:
  │   - Triplet loss on positive/negative pairs
  │   - Margin ranking loss on ranking signals
  │   - Model: small MLP (24D → 24D projection) that refines embeddings
  │   - Epochs: 5-10 (fast convergence on incremental data)
  │   - Learning rate: 0.0001 (conservative — small adjustments only)
  5. Produce candidate embedding set (refined 24D vectors for all tracks)
  6. Evaluate candidate vs champion (Section 11)
  7. Promote or reject
```

**Training is fully local**: The MLP trains on the same machine that runs SIDFlow. Input is 24D float vectors, output is 24D float vectors. Total parameters: ~1200 (24×48 + 48×24). Training time: <30s for 50K tracks on any modern CPU.

**Optional: Incremental Weight Update**

For users who want real-time adaptation without waiting for retraining:

1. After each feedback event, adjust the per-track preference weight in the scoring formula
2. This does not change embeddings — just the scoring multiplier
3. Effect: immediate response to likes/dislikes
4. This is already partially implemented via the `likes/dislikes/skips` counters in the database

### Resource Requirements

| Component | CPU | Memory | Disk | Time |
|-----------|-----|--------|------|------|
| Feedback aggregation | Single core | < 50 MB | Read feedback JSONL | < 5s |
| Pair derivation | Single core | < 100 MB | In-memory | < 10s |
| MLP training (50K tracks) | Single core | < 200 MB | Model weights ~10KB | < 30s |
| Embedding refinement | Single core | < 100 MB | Updated SQLite ~50MB | < 60s |
| **Total retraining cycle** | | | | **< 2 min** |

---

## 11. Safety of Self-Improvement

### Threat Model

| Threat | Description | Severity |
|--------|-------------|----------|
| Feedback loop collapse | Model reinforces its own bad recommendations → user confirms → model doubles down | Critical |
| Style narrowing | User likes a few tracks → model narrows to only those → exploration dies | High |
| Temporal drift | Gradual shift in embedding space makes old favorites unreachable | Medium |
| Noisy signal overfitting | Single accidental like/skip shifts model materially | Medium |
| Adversarial feedback | Bulk fake likes/dislikes corrupt model | Low (single-user) |

### Safeguards

#### 1. Holdout Validation Set

Reserve 15% of feedback events (random, stratified by signal type) as a validation set. During retraining:
- Compute ranking accuracy on holdout: "do positive pairs still rank as positive?"
- If holdout accuracy drops below 0.6 (where 0.5 = random), reject the candidate model

#### 2. Champion vs Challenger Evaluation

Every retraining produces a **challenger** model. Before promotion:

1. **Coherence test**: Generate 10 stations from fixed seeds using challenger embeddings. Compute mean intra-station cosine similarity. Must be ≥ 0.70.

2. **Diversity test**: The 10 test stations must collectively cover ≥ 40% of the corpus's perceptual space (measured by convex hull volume in the top-3 PCA dimensions). Prevents style collapse.

3. **Stability test**: Compute mean L2 distance between champion and challenger embeddings across all tracks. Must be ≤ 0.15 (prevents catastrophic drift). If > 0.15, reject or reduce learning rate by 50% and retrain.

4. **Feedback correlation**: On a held-out 10% of recent feedback events, compute: "does the challenger rank liked tracks higher than disliked tracks?" Must exceed champion's score or be within 0.02.

Only if all four tests pass is the challenger promoted.

#### 3. Promotion Threshold and Rollback

- Challenger must improve on 3 of 4 metrics to be promoted
- If challenger is rejected, the champion persists unchanged
- Last 5 champion models are retained for rollback
- Manual override: user can run `sidflow-train --rollback` to revert to any previous model

#### 4. Diversity Constraints Within Style

Even when the model is "correct", prevent excessive concentration:

- **Max composer share**: No single composer can provide more than 15% of a station's tracks (prevents "all Rob Hubbard" stations even if the user rated him highly)
- **Max bucket share**: No single HVSC directory prefix can provide more than 25% of tracks
- **Minimum perceptual spread**: Station's tracks must span at least 0.15 in each major perceptual axis (energy, mood, complexity). A station of 50 tracks that all have identical energy is considered degenerate.

#### 5. Embedding Drift Monitoring

Track the mean and variance of the full embedding space over time:

$$\mu_t = \frac{1}{N}\sum_{i} v_{i,t}, \quad \sigma^2_t = \frac{1}{N}\sum_{i} \|v_{i,t} - \mu_t\|^2$$

If $\|\mu_t - \mu_0\| > 0.2$ or $|\sigma^2_t - \sigma^2_0| / \sigma^2_0 > 0.25$, flag the model for review and pause automatic promotion until the user confirms.

#### 6. Minimum Event Threshold

Do not retrain until at least 50 new feedback events have accumulated since last training. This prevents overfitting to small, noisy batches.

---

## 12. Target Architecture

### System Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                      OFFLINE PIPELINE                             │
│                                                                   │
│  SID → WAV → Feature Extraction → 24D Perceptual Vector          │
│        (sidplayfp/WASM)   (Essentia.js + new features)           │
│                                                                   │
│  Per-track output:                                                │
│    { sid_path, song_index, vector_24d: float[24],                │
│      legacy_ratings: {c,e,m}, features: {...} }                  │
│                                                                   │
│  Dataset normalization: μ/σ per feature, stored in manifest       │
│                                                                   │
│  Index building:                                                  │
│    SQLite: tracks table (vector_json = 24D float array)           │
│    LanceDB: 24D vector index                                      │
│    Precomputed neighbors (optional, for export)                   │
│                                                                   │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                   RUNTIME (CLI + Web)                              │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  SIMILARITY + RANKING LAYER                              │     │
│  │                                                          │     │
│  │  Input: seed vector(s) + user preferences + adventure    │     │
│  │                                                          │     │
│  │  1. Weighted centroid from favorites (weighted cosine)    │     │
│  │  2. Candidate retrieval (k-NN on 24D vectors)            │     │
│  │  3. Outlier rejection (min_sim + per-dim checks)         │     │
│  │  4. Feedback scoring (likes/dislikes/plays aggregates)   │     │
│  │  5. Adventure injection (controlled radius expansion)    │     │
│  │  6. Diversity filtering (bucket balance + min spread)    │     │
│  │  7. Flow ordering (continuity-aware sequencing)          │     │
│  │                                                          │     │
│  │  Output: ordered station playlist                        │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  INTENT MODEL                                            │     │
│  │                                                          │     │
│  │  Input: user ratings (5+ tracks)                         │     │
│  │  Process:                                                │     │
│  │    - Cluster detection (single vs multi-centroid)        │     │
│  │    - Confidence radius computation                       │     │
│  │    - Intent vector(s) with uncertainty bounds            │     │
│  │  Output: 1-3 intent centroids + confidence radii         │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  FEEDBACK INGESTION                                      │     │
│  │                                                          │     │
│  │  Input: user events (like, dislike, skip, play, replay)  │     │
│  │  Process:                                                │     │
│  │    - Validate + deduplicate                              │     │
│  │    - Append to date-partitioned JSONL                    │     │
│  │    - Update in-memory counters for immediate scoring     │     │
│  │    - Emit training-ready events                          │     │
│  │  Output: persisted events + updated aggregate counters   │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                   LEARNING LOOP (Periodic Offline)                │
│                                                                   │
│  1. Load production embeddings (24D × N tracks)                   │
│  2. Load new feedback events                                      │
│  3. Derive training pairs + ranking signals                       │
│  4. Train metric learning MLP (24D → 24D)                        │
│  5. Produce candidate embeddings                                  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  EVALUATION + PROMOTION                                  │     │
│  │                                                          │     │
│  │  Tests:                                                  │     │
│  │    ✓ Holdout validation accuracy ≥ 0.6                   │     │
│  │    ✓ Coherence: mean intra-station sim ≥ 0.70            │     │
│  │    ✓ Diversity: ≥ 40% corpus coverage                    │     │
│  │    ✓ Stability: mean drift ≤ 0.15                        │     │
│  │    ✓ Feedback correlation ≥ champion - 0.02              │     │
│  │                                                          │     │
│  │  Promote if 3/4 pass; reject otherwise                   │     │
│  │  Keep last 5 models for rollback                         │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. Offline Pipeline

- **Inputs**: SID files from HVSC or any local collection
- **Outputs**: 24D vectors per track, stored in JSONL + SQLite/LanceDB
- **Implementation**: Extend `@sidflow/classify` to compute additional 13 features (onset rate, onset regularity, spectral flux, centroid variance, MFCC delta, pitch salience, inharmonicity, dissonance, dynamic range, low-freq energy ratio, beat strength); assemble 24D vector from existing + new features
- **Compute cost**: ~3s per track (up from ~2s; additional Essentia algorithms)
- **Risk**: Essentia.js may not support all proposed algorithms; fallback heuristics needed

#### 2. Representation Layer

- **Inputs**: Raw features from classification
- **Outputs**: 24D normalized float vector per track
- **Implementation**: New `buildPerceptualVector()` function in `@sidflow/classify/deterministic-ratings.ts`
- **Compute cost**: <1ms per track
- **Risk**: Normalization statistics (μ/σ) must be recomputed when the corpus changes significantly

#### 3. Similarity + Ranking Layer

- **Inputs**: Intent vector(s), candidate pool, adventure parameter, feedback aggregates
- **Outputs**: Ordered playlist
- **Implementation**: Modify `recommendFromFavorites()` and `recommendFromSeedTrack()` in `@sidflow/common/similarity-export.ts` to use 24D weighted cosine with outlier rejection
- **Compute cost**: <100ms for full-corpus scan
- **Risk**: Migration requires rebuilding SQLite exports; old exports won't work with new code

#### 4. Intent Model

- **Inputs**: 5–50 user ratings
- **Outputs**: 1–3 centroids + confidence radii
- **Implementation**: New `buildIntentModel()` function in `@sidflow/play/station/queue.ts`
- **Compute cost**: <10ms
- **Risk**: Multi-centroid mode adds complexity; may confuse users who expect a single "station style"

#### 5. Feedback Ingestion

- **Inputs**: User interaction events
- **Outputs**: Persisted events, updated counters
- **Implementation**: Complete the server-side sync endpoint; add play_complete/replay/skip_early detection
- **Compute cost**: <1ms per event
- **Risk**: Duration tracking requires client-side timer instrumentation

#### 6. Learning Loop

- **Inputs**: Production embeddings + accumulated feedback
- **Outputs**: Candidate refined embeddings
- **Implementation**: New `@sidflow/train/metric-learning.ts` module
- **Compute cost**: <2 min per cycle on commodity hardware
- **Risk**: Metric learning quality depends on sufficient positive/negative pairs (minimum 50 events)

#### 7. Evaluation + Promotion

- **Inputs**: Champion + challenger embedding sets + holdout feedback
- **Outputs**: Promote/reject decision
- **Implementation**: New `@sidflow/train/evaluate.ts` module
- **Compute cost**: <30s per evaluation cycle
- **Risk**: Fixed evaluation seeds may become unrepresentative over time; rotate them periodically

---

## 13. Validation Plan

### Measurable Metrics

| Metric | Definition | Target | Current Baseline |
|--------|-----------|--------|------------------|
| **Intra-station coherence** | Mean pairwise cosine similarity of tracks in a station | ≥ 0.72 | ~0.95 (artificially high due to quantized 4D — most tracks in same bucket) |
| **Perceptual outlier rate** | % of station tracks where any derived axis deviates > 0.3 from station centroid | ≤ 5% | Unknown (no measurement exists) |
| **Cold-start quality** | Mean coherence of stations built from exactly 10 ratings | ≥ 0.68 | Untested |
| **Feedback convergence** | Number of events until station quality stabilizes (measured by rolling coherence) | ≤ 100 events | N/A (no feedback loop) |
| **Retraining stability** | Mean L2 drift between consecutive model versions | ≤ 0.10 | N/A |
| **Diversity** | Unique HVSC directory prefixes represented per 50-track station | ≥ 8 | ~5-15 (dependent on bucket balancer) |
| **Abandonment rate** | % of station sessions abandoned within 3 tracks | Decrease by 30% | Unmeasured |

### Test Scenarios

#### T1: Deterministic Coherence Test (Automated)
```
For each mood preset (quiet, ambient, energetic, dark, bright, complex):
  1. Generate seed vector from preset
  2. Build 50-track station
  3. Compute intra-station pairwise similarity (24D weighted cosine)
  4. Assert mean ≥ 0.72
  5. Assert max deviation on any derived axis ≤ 0.35
  6. Assert no track pair with similarity < 0.50
```

#### T2: Cold-Start Simulation (Automated)
```
For 100 simulated users:
  1. Draw 10 random tracks, assign ratings from distribution:
     - 3 tracks rated 4-5 (favorites, clustered in perceptual space)
     - 5 tracks rated 3 (neutral)
     - 2 tracks rated 1-2 (dislikes)
  2. Build station from these ratings
  3. Compute coherence relative to the 3 favorites' centroid
  4. Assert coherence ≥ 0.65
  5. Assert no track in station is within 0.2 of the dislikes' centroid
```

#### T3: Feedback Convergence Simulation (Automated)
```
For 20 simulated users:
  1. Define ground-truth preference vector (random 24D point)
  2. Generate station from random seed
  3. Simulate feedback:
     - Like tracks with similarity > 0.8 to ground truth
     - Skip tracks with similarity < 0.5
     - Neutral for 0.5–0.8
  4. After each batch of 10 events, retrain and regenerate station
  5. Measure and plot station centroid distance to ground truth
  6. Assert convergence to within 0.15 of ground truth within 80 events
```

#### T4: Safety Regression Tests (Automated)
```
1. Style collapse test:
   - Generate 100 consecutive like events for a single bucket (e.g., DEMOS/Crest)
   - Retrain
   - Assert station still contains ≥ 5 distinct buckets
   - Assert no bucket exceeds 25% share

2. Drift detection test:
   - Run 10 consecutive retraining cycles with random feedback
   - Assert cumulative embedding drift < 0.30

3. Rollback verification:
   - Train model A, train model B, rollback to A
   - Assert all stations generated match model A output exactly

4. Noisy feedback resilience:
   - Inject 20 random likes/dislikes (uncorrelated with perceptual content)
   - Retrain
   - Assert coherence metric drops by < 0.03
```

#### T5: Controlled Rating Scenarios (Manual + Automated)
```
Scenario A: "Dark Ambient Only"
  - Rate 10 tracks: low energy, low brightness, high mood (tonal clarity), moderate complexity
  - Verify: station contains no high-energy, high-brightness tracks

Scenario B: "Upbeat Game Music"
  - Rate 10 tracks: high energy, high brightness, moderate complexity, strong rhythm
  - Verify: station contains no slow, ambient, sparse tracks

Scenario C: "Mixed Taste"
  - Rate 5 dark ambient + 5 upbeat tracks
  - Verify: multi-centroid mode activates, station alternates coherently

Scenario D: "Progressive Narrowing"
  - Start with broad ratings, progressively dislike boundary tracks
  - Verify: station tightens without collapsing to single track
```

---

## 14. Implementation Roadmap

### Phase A: Quick Fixes (High Impact, Low Cost)

**Timeline**: Can be implemented independently, each in < 1 day

#### A1. Add Minimum Similarity Threshold to Station CLI
- **File**: `packages/sidflow-play/src/station/queue.ts`
- **Change**: In `buildStationQueue`, filter recommendations by `score >= 0.75` before bucket selection
- **Acceptance**: Station with adventure=3 has no candidate with cosine similarity < 0.75 to centroid
- **Risk**: May reduce station size for users with very diverse preferences; mitigate by reducing threshold if candidate count < `stationSize`

#### A2. Soften Cold-Start Weight Mapping
- **File**: `packages/sidflow-play/src/station/queue.ts`, function `buildWeightsByTrackId`
- **Change**: Replace `{5:9, 4:4, 3:1.5, ≤2:0.1}` with `{5:3.0, 4:2.0, 3:1.0, 2:0.3, 1:0.1}`
- **Acceptance**: Re-run cold-start simulation with current 4D vectors; centroid should shift < 50% as much when swapping one rating from 5→4
- **Risk**: Slightly less personalization from strong preferences; acceptable trade-off for stability

#### A3. Reduce Minimum Rated Tracks to 5
- **File**: `packages/sidflow-play/src/station/constants.ts`
- **Change**: `MINIMUM_RATED_TRACKS = 5` (from 10), with corresponding tighter similarity threshold when < 10 rated
- **Acceptance**: Station of 50+ tracks generated from 5 ratings, coherence ≥ 0.65
- **Risk**: Lower quality stations from too-few ratings; mitigate with tighter thresholds

#### A4. Per-Dimension Deviation Filter
- **File**: `packages/sidflow-play/src/station/queue.ts` (in `buildStationQueue`, after `recommendFromFavorites`)
- **Change**: Reject candidates where `|candidate.e - centroid.e| > 1.5` or `|candidate.m - centroid.m| > 1.5` or `|candidate.c - centroid.c| > 1.5` (using current integer ratings)
- **Acceptance**: No station track deviates by more than 1.5 on any axis from centroid
- **Risk**: May over-filter with current coarse ratings; threshold may need tuning

### Phase B: Medium Improvements (Moderate Impact, Moderate Cost)

**Timeline**: Each 2–5 days

#### B1. Extract Additional Audio Features
- **Files**: `packages/sidflow-classify/src/essentia-features.ts`, `packages/sidflow-classify/src/essentia-frame-features.ts`
- **Change**: Add onset detection, spectral flux, pitch salience, inharmonicity, dynamic range computation
- **Acceptance**: Classification JSONL contains new feature fields; values within expected ranges on test corpus
- **Risk**: Essentia.js may not expose all algorithms; implement heuristic fallbacks

#### B2. Build 24D Perceptual Vector
- **Files**: `packages/sidflow-classify/src/deterministic-ratings.ts` (new `buildPerceptualVector` function)
- **Change**: Assemble 24D vector from existing + new features; store in `vector_json` in classification output
- **Acceptance**: All classified tracks have 24D vectors; vectors pass normalization validation (mean ≈ 0, std ≈ 1 per dimension)
- **Risk**: Requires reclassification of entire corpus; ~28 hours for 50K tracks at 2s/track

#### B3. Update Similarity Functions for 24D Vectors
- **Files**: `packages/sidflow-common/src/similarity-export.ts`, `packages/sidflow-common/src/recommender.ts`
- **Change**: Modify `cosineSimilarity`, `buildCentroid`, `recommendFromFavorites`, `recommendFromSeedTrack` to handle variable-dimension vectors with optional weighting
- **Acceptance**: All existing tests pass with both 4D and 24D vectors; new coherence metric ≥ 0.72 on test stations
- **Risk**: Breaking change for SQLite export consumers; version the schema (`sidcorr-2`)

#### B4. Implement Enhanced Feedback Collection
- **Files**: `packages/sidflow-web/lib/feedback/recorder.ts`, `packages/sidflow-web/app/api/feedback/sync/route.ts`
- **Change**: Add `play_complete`, `skip_early`, `skip_late`, `replay` event types; implement server-side persistence in sync endpoint
- **Acceptance**: All new event types stored in date-partitioned JSONL; round-trip from browser to server verified
- **Risk**: Client-side duration tracking may be unreliable (tab switching, browser sleep)

#### B5. Implement Temporal Decay
- **Files**: `packages/sidflow-common/src/lancedb-builder.ts` (feedback aggregation)
- **Change**: Apply exponential decay weighting based on event age when aggregating feedback counters
- **Acceptance**: Events from 6 months ago contribute 25% weight; verified via unit test with mock timestamps
- **Risk**: First deployment will retroactively down-weight all existing feedback; may feel like regression to active users

### Phase C: Advanced Model Changes (High Impact, High Cost)

**Timeline**: Each 1–2 weeks

#### C1. Multi-Centroid Intent Model
- **Files**: New `packages/sidflow-play/src/station/intent.ts`
- **Change**: Implement k-means clustering on rated tracks to detect diverse taste clusters; generate separate candidate pools per cluster; interleave results
- **Acceptance**: Station from user with 2 distinct preference clusters produces coherent interleaving; both clusters represented
- **Risk**: Increases station generation time; may confuse flow ordering

#### C2. Weighted Cosine Similarity With Dimension Weights
- **Files**: `packages/sidflow-common/src/similarity-export.ts`
- **Change**: Replace unweighted cosine with weighted cosine using per-group weights (derived axes: 1.5, temporal: 1.2, spectral: 1.0, MFCC: 0.8)
- **Acceptance**: Stations generated with weighted similarity are more perceptually coherent than unweighted (measured via controlled A/B on test seeds)
- **Risk**: Weight tuning is subjective; initial values based on literature may not be optimal for SID-specific content

#### C3. Adventure as Radius Expansion
- **Files**: `packages/sidflow-play/src/station/queue.ts`
- **Change**: Replace score-exponent model with radius-expansion model; implement exploration band injection (70/30 exploit/explore split)
- **Acceptance**: Adventure=0 station has all tracks > 0.82 similarity; adventure=5 station has tracks ranging from 0.67–0.95; no track < 0.50 at any level
- **Risk**: Changes station character significantly; existing users may notice different feel

### Phase D: Self-Improvement System (High Impact, Highest Cost)

**Timeline**: 2–4 weeks total

#### D1. Training Pair Derivation
- **Files**: New `packages/sidflow-train/src/pair-builder.ts`
- **Change**: Implement positive/negative pair extraction from session-level feedback events; ranking signal construction
- **Acceptance**: Given 100 feedback events, produces ≥ 50 valid positive pairs and ≥ 30 negative pairs
- **Risk**: Session boundary detection may be unreliable; define session as "consecutive events within 2 hours"

#### D2. Metric Learning MLP
- **Files**: New `packages/sidflow-train/src/metric-learning.ts`
- **Change**: Implement small MLP (24→48→24) trained with triplet loss on feedback-derived pairs; produces refined embeddings
- **Acceptance**: Trained model produces embeddings where positive pairs have higher cosine similarity than negative pairs with ≥ 0.7 accuracy
- **Risk**: TensorFlow.js on Bun may have compatibility issues; alternatively implement in pure JS/TS with manual gradient computation for this small model

#### D3. Champion/Challenger Evaluation
- **Files**: New `packages/sidflow-train/src/evaluate.ts`
- **Change**: Implement coherence, diversity, stability, and feedback correlation tests; promotion logic
- **Acceptance**: Challenger that improves on ≥ 3 of 4 metrics is promoted; challenger that degrades 2+ metrics is rejected
- **Risk**: Fixed evaluation seeds may become stale; implement seed rotation on a 30-day cycle

#### D4. Automated Retraining Scheduler
- **Files**: New `packages/sidflow-train/src/scheduler.ts`, integration in `packages/sidflow-web/lib/server/`
- **Change**: Schedule weekly retraining; trigger on N new feedback events; emit training logs
- **Acceptance**: After accumulating 50 events, system automatically retrains and logs result; no manual intervention required
- **Risk**: Retraining during peak usage could degrade performance; schedule for low-activity periods

#### D5. Rollback Mechanism
- **Files**: Extend `packages/sidflow-train/src/cli.ts`
- **Change**: `sidflow-train --rollback [version]` reverts to specified model version from retained history
- **Acceptance**: After rollback, all station generation uses the specified model version exactly
- **Risk**: Disk usage for model history; cap at 5 versions (each ~50MB SQLite → 250MB total)

---

## Appendix A: Glossary

| Term | Definition |
|------|-----------|
| **Centroid** | Weighted average vector of user's rated tracks; represents "ideal station center" |
| **Perceptual vector** | 24D float array representing a track's audio-perceptual character |
| **Legacy rating** | Integer 1–5 on Energy/Mood/Complexity axes (current system) |
| **Bucket** | Group of tracks sharing HVSC directory prefix (e.g., DEMOS/Crest) |
| **Adventure** | User-configurable exploration parameter controlling how far from the centroid candidates can be |
| **Champion model** | Currently deployed embedding set used for all recommendations |
| **Challenger model** | Candidate embedding set produced by retraining, pending evaluation |
| **Fit score** | Per-track aggregate of positive and negative feedback signals |
| **Confidence radius** | Computed spread of user's rated tracks around centroid; controls acceptance threshold |

## Appendix B: Feature Computation Reference

### Onset Detection (New)
```
Algorithm: Essentia OnsetDetection(method='complex') + Onsets
Input: 11025 Hz audio signal, frame_size=512, hop_size=256
Output: onset_times[] in seconds
Derived: onset_density = len(onset_times) / duration_seconds
         onset_regularity = 1 - std(diff(onset_times)) / mean(diff(onset_times))
```

### Spectral Flux (New)
```
Algorithm: Essentia Flux(halfRectify=true)
Input: Frame-level spectra
Output: flux_mean, flux_std (over all frames)
```

### Pitch Salience (New)
```
Algorithm: Essentia PitchSalience
Input: Frame-level spectra
Output: mean_salience over frames (0 = no clear pitch, 1 = strong pitch)
```

### Dynamic Range (New)
```
Algorithm: Per-frame RMS
Input: Frame-level audio
Output: (max_rms - min_rms) / max_rms over frames
```

### Low-Frequency Energy Ratio (New)
```
Algorithm: Band energy ratio
Input: Frame-level spectra
Output: energy_below_250Hz / total_energy (averaged over frames)
```

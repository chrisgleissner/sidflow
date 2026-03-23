# SID Classification Enhancement Report

## 1. Executive Summary

The codebase already implements most of the station-similarity audit's Phase A-D recommendations, including 24D perceptual vectors, weighted similarity in the active export path, multi-centroid station intent modeling, and a full offline metric-learning stack. The largest missing capability is the one the existing audit did not yet implement: a deterministic, bounded, SID-native register-analysis pipeline. That gap matters because the current system still infers SID character entirely from a WAV window and currently defaults to skipping 30 seconds before analyzing 15 seconds, which does not satisfy the required shared 15s skip plus 15s analyze window.

This report therefore does two things. First, it verifies which audit recommendations are implemented, partially implemented, or still missing, with file-backed evidence. Second, it specifies an implementation-ready SID-native analysis design based on PSID/RSID init/play execution, per-frame register capture, and a no-overlap hybrid vector where each perceptual concept is represented exactly once as SID-derived, WAV-derived, or explicitly fused.

## 2. Inputs and Design Anchors

This report is grounded in four required inputs.

1. `doc/research/sid-station-similarity-audit.md`
   - Provides the original Phase A-D recommendation set and the existing 24D perceptual-vector rationale.
2. `doc/c64/sid-file-structure.md`
   - Defines the PSID/RSID header contract: `initAddress`, `playAddress`, `songs`, `startSong`, timing hints, and the case where `playAddress = 0` and the tune installs its own ISR.
3. `doc/c64/sid-spec.md`
   - Defines the canonical SID register map at `$D400-$D418`, voice control bits, filter registers, and the significance of `$D418` volume writes for digi playback.
4. `doc/research/phase-ab-sample-24d-classification.json`
   - Confirms the currently shipped feature surface and vector shape: 24 output dimensions built from spectral, temporal, MFCC, and derived features.

These documents imply the following non-negotiable design constraints.

| Constraint | Value |
|---|---|
| Analysis skip window | 15 seconds |
| Analysis capture window | 15 seconds |
| SID timebase | Frame-based only |
| PAL frame rate | 50 Hz |
| NTSC frame rate | 60 Hz |
| Hardware target | 8 CPU cores, <= 16 GiB RAM |
| Determinism | Required |
| Feature duplication | Forbidden |

## 3. Implementation Audit

### 3.1 Atomic Requirements from the Existing Audit

The existing audit yields these atomic requirements.

| ID | Requirement | Expected Behavior | Code Evidence | Status | Gap |
|---|---|---|---|---|---|
| R1 | Minimum similarity floor | Station candidates below the floor are rejected before final queue selection | `packages/sidflow-play/src/station/queue.ts:39`, `packages/sidflow-play/src/station/queue.ts:206`, `packages/sidflow-play/src/station/queue.ts:542` | DONE | None in active station path |
| R2 | Softer cold-start weights | `5→3`, `4→2`, `3→1`, `2→0.3`, `1→0.1` | `packages/sidflow-play/src/station/queue.ts:182` | DONE | None |
| R3 | Minimum rated tracks = 5 | Station can activate with 5 ratings | `packages/sidflow-play/src/station/constants.ts:3`, `packages/sidflow-play/src/station/run.ts:254` | DONE | None |
| R4 | Per-dimension deviation rejection | Candidates too far from centroid on `e/m/c` are rejected | `packages/sidflow-play/src/station/queue.ts:22`, `packages/sidflow-play/src/station/queue.ts:251` | DONE | None |
| R5 | Additional audio features | Add onset/rhythm/flux/dynamics/pitch/inharmonicity/low-frequency features | `packages/sidflow-common/src/jsonl-schema.ts:56-70`, `packages/sidflow-classify/src/essentia-features.ts:103-121`, `packages/sidflow-classify/src/essentia-frame-features.ts:262-289` | DONE | None |
| R6 | 24D perceptual vector | Deterministic continuous vector emitted in classification output | `packages/sidflow-classify/src/deterministic-ratings.ts:323-401`, `packages/sidflow-classify/src/index.ts:2028` | DONE | None |
| R7 | Variable-dimension weighted similarity | Active similarity path handles 24D vectors with group weights | `packages/sidflow-common/src/similarity-export.ts:196`, `packages/sidflow-common/src/similarity-export.ts:757-780`, `packages/sidflow-common/src/similarity-export.ts:1123-1205` | PARTIAL | Active export/station path is updated, but legacy `packages/sidflow-common/src/recommender.ts:320` still uses unweighted cosine |
| R8 | Enhanced feedback capture | `play_complete`, `skip_early`, `skip_late`, `replay` are accepted and persisted | `packages/sidflow-common/src/jsonl-schema.ts:109-139`, `packages/sidflow-web/app/api/feedback/sync/route.ts:33-127`, `packages/sidflow-common/src/feedback.ts:118-195` | PARTIAL | Web sync path is updated, but `packages/sidflow-common/src/lancedb-builder.ts:183-215` still ignores the new action types |
| R9 | Temporal decay | Feedback aggregation applies a 90-day half-life | `packages/sidflow-web/lib/server/rating-aggregator.ts:14`, `packages/sidflow-web/lib/server/rating-aggregator.ts:80-137` | PARTIAL | Decay is implemented for the web aggregate path only; `packages/sidflow-common/src/lancedb-builder.ts:183-215` and `packages/sidflow-common/src/similarity-export.ts:576-614` still aggregate by raw counts |
| R10 | Multi-centroid intent model | Distinct user taste clusters produce separate centroids and interleaved results | `packages/sidflow-play/src/station/intent.ts:181-248`, `packages/sidflow-play/src/station/queue.ts:549-575` | DONE | None |
| R11 | Adventure as radius expansion | Exploration widens by lowering a bounded minimum similarity threshold and splitting exploit/explore pools | `packages/sidflow-play/src/station/queue.ts:39`, `packages/sidflow-play/src/station/queue.ts:302-386`, `packages/sidflow-play/src/station/queue.ts:619` | DONE | None |
| R12 | Training-pair derivation | Session feedback is converted into positive/negative/triplet/ranking pairs | `packages/sidflow-train/src/pair-builder.ts:139-228` | DONE | None |
| R13 | Metric-learning MLP | Deterministic 24→48→24 model trained on triplet and ranking losses | `packages/sidflow-train/src/metric-learning.ts:19-29`, `packages/sidflow-train/src/metric-learning.ts:82-110` | DONE | None |
| R14 | Challenger evaluation | Holdout/coherence/diversity/drift/feedback metrics gate promotion | `packages/sidflow-train/src/evaluate.ts:17-21`, `packages/sidflow-train/src/evaluate.ts:305-360` | DONE | None |
| R15 | Automated retraining scheduler | Retraining triggers after new feedback without manual operator choreography | `packages/sidflow-train/src/scheduler.ts:205-267` | PARTIAL | Scheduler exists, but source inspection found no autonomous service integration; it is reachable from CLI flow rather than a persistent worker/service |
| R16 | Versioned rollback | Current model can be replaced by an earlier version deterministically | `packages/sidflow-train/src/scheduler.ts:156-183`, `packages/sidflow-train/src/cli.ts:151-189` | DONE | None |

### 3.2 Audit Conclusion

The answer to "are all recommendations implemented?" is no.

The codebase implements the majority of the recommendation set, but not all of it end-to-end:

- Fully implemented in active paths: R1, R2, R3, R4, R5, R6, R10, R11, R12, R13, R14, R16
- Implemented only partially across the codebase: R7, R8, R9, R15

The main pattern behind the remaining gaps is inconsistency between the newer active station/web/train paths and older shared aggregation/recommendation paths.

## 4. Current-State Gaps Beyond the Original Audit

The original audit was still audio-centric. For the requested SID-native redesign, four additional gaps matter.

| Gap | Current Evidence | Consequence |
|---|---|---|
| No SID register tracing | `packages/sidflow-common/src/sid-parser.ts` parses headers only; no register event API exists in `@sidflow/libsidplayfp-wasm` | No direct arpeggio, waveform, PWM, filter, or `$D418` causal features |
| No canonical frame event model | No `frame/voice/register/value` event store or JSONL schema exists | SID-native features cannot be derived reproducibly |
| Window mismatch | `packages/sidflow-classify/src/index.ts:69-79`, `packages/sidflow-classify/src/essentia-features.ts:475-480`, `packages/sidflow-classify/src/audio-window.ts:28-33` default to `introSkipSec = 30`, `maxClassifySec = 15` | WAV and SID-native analyses are not aligned to the same bounded region |
| No explicit orthogonalization | Current 24D vector mixes spectral/audio concepts without a formal SID-vs-WAV overlap policy | Double-counting risk remains for timbre, rhythm, and motion features |

## 5. Deterministic, Bounded SID-Native Execution Model

### 5.1 Why This Model Follows the C64 Docs

`doc/c64/sid-file-structure.md` establishes that SID playback is driven by an `init` routine and a per-frame `play` routine, with timing determined by PAL/NTSC VBlank or tune-installed timing when `playAddress = 0`. `doc/c64/sid-spec.md` defines the voice and filter registers at `$D400-$D418` whose writes express waveform choice, gate transitions, ADSR, filter movement, and `$D418` digi playback.

The correct SID-native analysis model is therefore not an unconstrained CPU trace. It is a bounded init plus frame-step execution that samples SID state at music-frame boundaries.

### 5.2 Proposed Frame Budget

Let:

- `F = 50` for PAL, `60` for NTSC
- `skip_frames = 15 * F`
- `analyze_frames = 15 * F`
- `total_play_frames = 30 * F`

Therefore:

| Clock | Skip Frames | Analyze Frames | Total Post-init Frames |
|---|---|---|---|
| PAL 50 Hz | 750 | 750 | 1500 |
| NTSC 60 Hz | 900 | 900 | 1800 |

### 5.3 Execution Procedure

For each `sid_path` and `song_index`:

1. Parse PSID/RSID header.
2. Determine clock mode from header flags.
3. Load tune memory and invoke `init(song_index)` once.
4. Run `play` once per frame for `skip_frames + analyze_frames` frames.
5. Record SID register writes only for the final `analyze_frames` window.
6. Aggregate final per-frame register state using last-write-wins within each frame.

If `playAddress = 0`, the tracer must capture the tune-installed ISR boundary and still emit one logical frame record per PAL/NTSC frame.

### 5.4 Safety Limits

To remain bounded and deterministic:

| Limit | Proposed Value | Reason |
|---|---|---|
| `init_cycle_cap` | 5,000,000 cycles | Prevent pathological decompression/boot loops while tolerating heavy setup |
| `play_cycle_cap_per_frame` | `min(100,000, 5 * nominal_frame_cycles)` | Prevent runaway frame handlers; still far above normal player budgets |
| `instruction_cap_per_frame` | 50,000 instructions | Secondary bound if cycle-level hooks are unavailable |
| `consecutive_overrun_frames` | 3 | Abort clearly broken tunes deterministically |
| `register_events_per_frame_cap` | 2,048 writes | Prevent event-buffer explosion on pathological digi traces |

Nominal frame cycles:

- PAL: `985,248 / 50 ≈ 19,705`
- NTSC: `1,022,727 / 60 ≈ 17,045`

### 5.5 Performance Budget

Reference budget per track on 8 cores:

| Stage | Budget |
|---|---|
| SID load + init | 0.5s |
| Bounded SID frame trace | 1.0s |
| WAV representative-window extraction + features | 3.5s |
| Hybrid feature assembly + residualization | 0.5s |
| I/O + slack | 2.5s |
| Hard cap | 8.0s |

This is compatible with commodity hardware and does not require a GPU.

## 6. Canonical Register Event Model

All SID-native features must be derived from a single canonical representation.

| frame | voice | register | value | derived_signal |
|---|---:|---|---:|---|
| integer frame index in analysis window | `1`, `2`, or `3` | SID register mnemonic or address | final register value for that frame | normalized interpreted value |

Rules:

1. One record per `(frame, voice, register)` after last-write-wins compaction.
2. Global registers (`$D415-$D418`) are broadcast to each affected voice so `voice ∈ {1,2,3}` remains valid. `derived_signal.scope = "global"` marks the duplication.
3. `derived_signal` stores human-usable interpretations, not independent data. Examples:
   - `freq_ratio`
   - `gate_on`
   - `waveform = pulse|saw|triangle|noise|mixed`
   - `pulse_width_norm`
   - `attack_nibble`, `decay_nibble`, `sustain_nibble`, `release_nibble`
   - `filter_cutoff_norm`, `filter_mode`, `volume_nibble`

Minimum emitted registers per frame:

- Voice 1: `$D400-$D406`
- Voice 2: `$D407-$D40D`
- Voice 3: `$D40E-$D414`
- Broadcast globals: `$D415-$D418`

Implementation path:

1. Add a trace hook in `packages/libsidplayfp-wasm` that captures SID writes with CPU-cycle timestamps.
2. Bucket writes into PAL/NTSC frame boundaries.
3. Compact to the canonical model.
4. Emit per-track trace sidecars under `data/classified/sid-traces/` or a binary sidecar under `workspace/audio-cache/`.

## 7. SID-Native Feature Extraction

All features below are deterministic functions of the canonical event model.

### 7.1 Arpeggio Detection

- Definition:
  - For each voiced segment with `gate_on = 1`, compute semitone deltas from consecutive frequency-register values using
    `Δst = 12 * log2(freq_reg_t / freq_reg_ref)`.
  - A segment is arpeggiated when, within a rolling 8-frame window, it contains at least 3 distinct semitone offsets, each held for <= 3 frames, with median absolute pitch jump between 2 and 12 semitones.
- Thresholds:
  - `distinct_offsets >= 3`
  - `max_hold_frames <= 3`
  - `arpeggio_rate_hz >= 6`
- Windowing:
  - 8-frame rolling window, summarized over all 750/900 analysis frames.
- Complexity:
  - `O(F * V)`
- Failure modes:
  - Vibrato or portamento can mimic shallow arpeggios; reject windows where `|Δst| < 1.5` for > 60% of changes.

### 7.2 ADSR Envelope Classification

- Definition:
  - Extract AD/SR nibbles per gate event and classify each note into one of `pluck`, `pad`, `swell`, `percussive`, `organ-like`.
- Thresholds:
  - `pluck`: attack <= 3 and release <= 4
  - `pad`: attack >= 8 and release >= 8
  - `swell`: attack >= 10 and sustain >= 8
  - `percussive`: attack <= 2, decay <= 4, sustain <= 3
- Windowing:
  - Per note event, then histogram over the full analysis window.
- Complexity:
  - `O(note_events)`
- Failure modes:
  - Hard-restart players can alter perceived attack without changing AD/SR; mark `adsr_confidence = low` when TEST-bit resets are detected.

### 7.3 Waveform Distribution

- Definition:
  - Histogram active-frame occupancy of control-register waveform bits for `triangle`, `saw`, `pulse`, `noise`, and `mixed`.
- Thresholds:
  - A voice frame counts as active if `gate_on = 1` or the frequency register changed within the last 2 frames.
- Windowing:
  - All analysis frames.
- Complexity:
  - `O(F * V)`
- Failure modes:
  - Mixed waveforms collapse multiple bits; preserve a separate `mixed_ratio` rather than forcing a single class.

### 7.4 Filter Sweep Detection

- Definition:
  - Compute absolute first derivative of normalized cutoff and count mode transitions in `$D417-$D418`.
  - `filter_sweep_activity = mean(|Δcutoff_norm|)` over active-filter frames.
- Thresholds:
  - Sweep present if `mean(|Δcutoff_norm|) >= 0.04` or cutoff range >= 0.20.
- Windowing:
  - 16-frame rolling statistics plus full-window summary.
- Complexity:
  - `O(F)`
- Failure modes:
  - Static filter settings with routed voices can still shape timbre; keep separate `filter_static_usage_ratio`.

### 7.5 Sample Playback Detection (`$D418`)

- Definition:
  - Detect bursts of `$D418` volume writes above normal effect usage.
- Thresholds:
  - Digi present if either:
    - `writes_per_frame_mean >= 4`, or
    - `>= 32` `$D418` writes occur in any 4-frame block.
- Windowing:
  - 4-frame burst detector plus global summary.
- Complexity:
  - `O(events)`
- Failure modes:
  - Volume slides can create false positives; suppress when value changes are monotonic with <= 1 step per frame for >= 80% of the burst.

### 7.6 Rhythmic Structure from Gate Toggles

- Definition:
  - Treat rising `gate_on` edges as note onsets.
  - Derive onset density, inter-onset interval variance, syncopation, and beat regularity from the onset sequence.
- Thresholds:
  - `rhythmic_regularity_sid = 1 - min(1, σ(IOI) / μ(IOI))`
  - `syncopation_sid` = fraction of onsets not aligned to the dominant beat period.
- Windowing:
  - Entire analysis window with dominant period estimated by onset autocorrelation.
- Complexity:
  - `O(onsets + F)`
- Failure modes:
  - Legato melodies undercount rhythm; blend only from voices with median note length <= 12 frames.

### 7.7 Voice Role Classification

- Definition:
  - For each voice, compute median log-frequency, note density, and sustain ratio.
  - Label each voice `melody`, `bass`, or `accompaniment` using deterministic rules.
- Thresholds:
  - `bass`: lowest median log-frequency and note density <= corpus median
  - `melody`: highest melodic salience score = `pitch_stability * note_density * gate_prominence`
  - remaining voice = accompaniment
- Windowing:
  - Whole-window summary after per-note extraction.
- Complexity:
  - `O(note_events)`
- Failure modes:
  - Role-swapping demo tunes can change roles mid-window; emit `role_switch_count` and `role_confidence`.

## 8. WAV-to-SID Orthogonalization

The current sample artifact confirms the WAV-side feature pool:

- `bpm`, `rms`, `energy`
- `spectralCentroid`, `spectralCentroidStd`, `spectralRolloff`, `spectralFlatnessDb`, `spectralEntropy`, `spectralCrest`, `spectralHfc`, `spectralContrastMean`
- `mfccMean1..5`
- `zeroCrossingRate`
- `onsetDensity`, `rhythmicRegularity`, `spectralFluxMean`, `dynamicRange`, `pitchSalience`, `inharmonicity`, `lowFrequencyEnergyRatio`

The anti-double-counting rule requires each concept to be represented only once.

### 8.1 Decision Table

| WAV Feature | SID Equivalent? | Relationship | Action |
|---|---|---|---|
| `bpm` | Yes, from gate-on onset periodicity | Complementary because audio BPM captures digi/percussion beyond gate events | FUSE |
| `onsetDensity` | Yes | Same concept | FUSE |
| `rhythmicRegularity` | Yes | Same concept | FUSE |
| `spectralCentroid` | Yes, via waveform/filter mix | Mostly redundant | REMOVE |
| `spectralRolloff` | Yes, via waveform/filter mix | Mostly redundant | REMOVE |
| `spectralHfc` | Yes, via waveform/noise/digi activity | Redundant with SID timbre + digi detector | REMOVE |
| `spectralFlatnessDb` | Partial, via noise/mixed waveform usage | Mostly redundant | REMOVE |
| `spectralEntropy` | Partial, via waveform mix and digi usage | Mostly redundant | REMOVE |
| `spectralCrest` | Partial | Redundant with rhythmic/percussive SID features | REMOVE |
| `spectralContrastMean` | Partial | Overlaps SID timbre basis | REMOVE |
| `spectralCentroidStd` | Yes, via filter/PWM motion | Same perceptual concept | FUSE |
| `spectralFluxMean` | Partial, from register motion rate | Complementary because analog output and digi create extra motion | FUSE |
| `pitchSalience` | Yes, from voice-role and pitch stability | Complementary | FUSE |
| `lowFrequencyEnergyRatio` | Yes, from bass-role occupancy | Complementary | FUSE |
| `rms` | No exact register-domain equivalent | Output-domain loudness | KEEP |
| `energy` | No exact register-domain equivalent | Output-domain loudness support | FUSE with RMS |
| `dynamicRange` | No exact register-domain equivalent | Output-domain amplitude dynamics | KEEP |
| `inharmonicity` | No exact exact register-domain equivalent for chip nonlinearities and digi roughness | Orthogonal | KEEP |
| `mfccMean1..5` | Partial timbre overlap | Keep only as residualized output-timbre descriptors | KEEP as residualized features |
| `zeroCrossingRate` | Partial overlap with pulse/noise/arpeggio behavior | Redundant once SID-native causal features exist | REMOVE |

### 8.2 Explicit Fusion and Residualization Formulas

All fused values are deterministic and bounded to `[0,1]`.

1. `tempo_fused = 0.7 * tempo_sid + 0.3 * tempo_wav`
   - If `d418_digi_present = 1`, switch to `0.5 / 0.5`.
2. `onset_density_fused = 0.7 * onset_sid + 0.3 * onset_wav`
3. `rhythmic_regularity_fused = 0.7 * regularity_sid + 0.3 * regularity_wav`
4. `filter_motion_fused = 0.75 * filter_sweep_sid + 0.25 * centroid_std_wav`
5. `spectral_motion_fused = 0.6 * register_motion_sid + 0.4 * spectral_flux_wav`
6. `melodic_clarity_fused = 0.6 * melody_confidence_sid + 0.4 * pitch_salience_wav`
7. `bass_presence_fused = 0.6 * bass_share_sid + 0.4 * low_frequency_energy_wav`
8. `loudness_fused = 0.6 * rms_norm + 0.4 * energy_norm`

Residual MFCC features:

For `k in {1,2,3}` only:

`mfcc_residual_k = clip(mfcc_norm_k - ridge_k(sid_timbre_basis), -3, 3)`

where `sid_timbre_basis` is the normalized SID vector:

`[triangle_ratio, saw_ratio, pulse_ratio, noise_ratio, mixed_ratio, pwm_activity, filter_cutoff_mean, filter_sweep_sid, sample_playback_rate]`

This keeps only output-domain timbre variance not already explained by causal SID controls.

## 9. Final Hybrid Feature Vector

The final vector should represent each concept once.

### 9.1 Proposed 24D Final Vector

| Dim | Feature | Source | Normalization | Weight |
|---:|---|---|---|---:|
| 1 | `tempo_fused` | FUSED | `[0,1]` min-max on corpus | 1.1 |
| 2 | `onset_density_fused` | FUSED | `[0,1]` min-max | 1.1 |
| 3 | `rhythmic_regularity_fused` | FUSED | `[0,1]` | 1.2 |
| 4 | `syncopation_sid` | SID | `[0,1]` | 1.0 |
| 5 | `arpeggio_rate_sid` | SID | `[0,1]` log-scaled | 1.0 |
| 6 | `wave_triangle_ratio` | SID | simplex-normalized | 0.9 |
| 7 | `wave_saw_ratio` | SID | simplex-normalized | 0.9 |
| 8 | `wave_pulse_ratio` | SID | simplex-normalized | 0.9 |
| 9 | `wave_noise_ratio` | SID | simplex-normalized | 1.0 |
| 10 | `pwm_activity_sid` | SID | `[0,1]` | 0.9 |
| 11 | `filter_cutoff_mean_sid` | SID | `[0,1]` | 0.8 |
| 12 | `filter_motion_fused` | FUSED | `[0,1]` | 1.1 |
| 13 | `sample_playback_rate` | SID | `[0,1]` | 1.2 |
| 14 | `melodic_clarity_fused` | FUSED | `[0,1]` | 1.2 |
| 15 | `bass_presence_fused` | FUSED | `[0,1]` | 1.1 |
| 16 | `accompaniment_share_sid` | SID | `[0,1]` | 0.8 |
| 17 | `voice_role_entropy_sid` | SID | `[0,1]` | 0.8 |
| 18 | `adsr_pluck_ratio_sid` | SID | `[0,1]` | 0.9 |
| 19 | `adsr_pad_ratio_sid` | SID | `[0,1]` | 0.9 |
| 20 | `loudness_fused` | FUSED | `[0,1]` | 1.0 |
| 21 | `dynamic_range_wav` | WAV | `[0,1]` | 0.9 |
| 22 | `inharmonicity_wav` | WAV | `[0,1]` | 0.9 |
| 23 | `mfcc_residual_1` | WAV residual | z-score, clip to `[-3,3]`, then `/3` | 0.7 |
| 24 | `mfcc_residual_2` | WAV residual | z-score, clip to `[-3,3]`, then `/3` | 0.7 |

`mfcc_residual_3` is intentionally omitted to keep the vector at 24D while avoiding low-value redundancy. If later evaluation shows a gain, it can replace `voice_role_entropy_sid`.

### 9.2 Group Weight Balance

Total weight by source:

- SID-only: `12.0`
- WAV-only or residual: `3.2`
- FUSED: `7.8`

This prevents the output-domain audio features from dominating while still preserving phenomena the SID registers cannot fully explain.

## 10. Missing State-of-the-Art Capabilities

| Capability | Gap Addressed | Concrete Implementation | Complexity | Expected Gain |
|---|---|---|---|---|
| Lightweight frame-sequence encoder | Static vectors lose phrase evolution across the 15s window | Add `packages/sidflow-train/src/sequence-encoder.ts` implementing a 1D temporal convolution network over 750/900 frame SID feature sequences; train contrastively against session pairs | Moderate | +0.03 to +0.05 pairwise ranking accuracy |
| Dual-encoder symbolic/audio embedding | Register and audio signals are currently combined only by hand-engineered fusion | Train two 24D encoders, one on SID-native features and one on WAV residuals, then distill to a fused 24D student embedding | Moderate | Better cold-start robustness and clearer causal debugging |
| Sequence-aware similarity reranking | Static cosine cannot distinguish same-vector but different temporal order | Add segment pooling over 5 equal temporal bins and rerank top-200 cosine neighbors by weighted segment alignment | Low to moderate | +0.04 station coherence for structurally evolving tracks |

## 11. Evaluation Framework

### 11.1 Systems Compared

1. WAV-only baseline
   - Current shipped 24D perceptual vector without SID-native features
2. Hybrid system
   - Proposed 24D no-overlap vector above

### 11.2 Offline Metrics

| Metric | Definition | Improvement Threshold |
|---|---|---|
| Pairwise ranking accuracy | Fraction of positive pairs ranked above negative pairs | `+0.07` absolute |
| `NDCG@10` on holdout favorites | Ranking quality for held-out liked tracks | `+10%` relative |
| Station coherence | Mean pairwise weighted cosine inside generated stations | `+0.05` absolute |
| Rating agreement | Spearman correlation between model similarity buckets and explicit user ratings | `+0.10` absolute |
| Early-skip AUC | Ability to predict `skip_early` from similarity score | `+0.03` absolute |

Promotion rule:

- Ship the hybrid model only if it improves at least 3 of the 5 metrics and does not regress station coherence.

## 12. Testing Requirements

### 12.1 Unit Tests

1. Register parsing correctness
   - Verify last-write-wins compaction
   - Verify frame bucketing at PAL/NTSC boundaries
   - Verify broadcast handling for `$D415-$D418`
2. Feature detection correctness
   - Arpeggio detector on known pitch-cycling traces
   - ADSR classifier on synthetic AD/SR sequences
   - `$D418` digi detector on burst vs volume-slide traces
   - Voice-role classifier on bass/melody/accompaniment fixtures

### 12.2 Golden SID Corpus

Add a trace fixture manifest under `test-data/sid-native/manifest.json` containing at minimum:

- `arpeggio-heavy`
- `sample-based`
- `filter-heavy`
- `pwm-heavy`
- `sparse-melodic`

For each fixture, store:

- SID header metadata
- expected frame count (`750` or `900`)
- expected feature summary JSON

### 12.3 Regression Tests

1. Existing WAV-only outputs remain byte-stable unless the new 15s skip change is intentionally enabled.
2. New SID-native features must be deterministic across 3 consecutive runs.
3. Mixed-mode classification must degrade gracefully to WAV-only with an explicit `sid_native_degraded` flag if a trace fails a safety limit.

## 13. Implementation Roadmap

| Item | Inputs / Outputs | Files / Modules Affected | Test Strategy | Acceptance Criteria |
|---|---|---|---|---|
| I1. Align analysis window defaults | Input: config; Output: shared `15+15` window for WAV and SID | `packages/sidflow-classify/src/{index,audio-window,essentia-features,feature-extraction-worker}.ts` | unit tests on representative window selection | Default config uses `introSkipSec = 15`, `maxClassifySec = 15` |
| I2. Add SID write trace API | Input: libsidplayfp SID writes; Output: per-write events with cycle stamps | `packages/libsidplayfp-wasm/src/player.ts`, new WASM binding layer | synthetic SID trace fixtures | Deterministic write log available for all traced tunes |
| I3. Canonical frame event compactor | Input: write log; Output: `frame/voice/register/value/derived_signal` rows | new `packages/sidflow-classify/src/sid-register-trace.ts` | PAL/NTSC frame-boundary tests | Exactly 750 or 900 analysis frames emitted |
| I4. SID-native feature extractor | Input: canonical trace; Output: SID-native features JSON | new `packages/sidflow-classify/src/sid-native-features.ts` | golden traces for all seven mandatory features | Feature outputs match golden expectations |
| I5. MFCC residualizer | Input: SID timbre basis + WAV MFCCs; Output: residual MFCC dims | new `packages/sidflow-classify/src/hybrid-orthogonalization.ts` | corpus-level regression test | Residual MFCC dims have <= 0.2 absolute correlation with SID timbre basis |
| I6. Hybrid vector builder | Input: SID-native + WAV features; Output: final 24D vector | `packages/sidflow-classify/src/deterministic-ratings.ts` or new `hybrid-vector.ts` | vector-shape and normalization tests | No duplicate concepts remain in vector spec |
| I7. Propagate richer feedback + decay everywhere | Input: feedback JSONL; Output: decayed shared aggregates | `packages/sidflow-common/src/{lancedb-builder,similarity-export,recommender}.ts` | unit tests with old/new event types | Shared aggregation respects new actions and 90-day decay |
| I8. Autonomous scheduler integration | Input: feedback delta; Output: background retraining job | `packages/sidflow-web/lib/server/`, job worker integration | integration test using mock feedback growth | Retraining triggers without manual CLI invocation |
| I9. Evaluation harness | Input: baseline vs hybrid embeddings; Output: metrics report | new `scripts/evaluate-hybrid-similarity.ts` | repeatable offline benchmark run | All promotion thresholds evaluated from one command |

## 14. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Trace API overhead slows classification | Higher wall-clock time | Last-write-wins compaction in-memory per frame; binary sidecar option |
| Multi-SID tunes complicate the voice model | Partial feature loss | Phase 1 scope: primary SID only, with explicit `multi_sid_unhandled` flag |
| Digi-heavy tracks break gate-based rhythm | Wrong tempo/rhythm | Fuse with WAV rhythm and promote `$D418` detector to a hard routing condition |
| Residualization introduces hidden complexity | Harder debugging | Store regression coefficients in manifest and emit pre/post values for audit mode |

## 15. Bottom Line

The current codebase is materially ahead of the original audit in its station and training stack, but it still lacks the SID-native core that would make the similarity system properly C64-aware. The next implementation step is not more heuristic WAV feature work. It is the addition of a bounded, per-frame SID register trace, followed by a hybrid vector that removes overlapping audio descriptors rather than stacking them.
# Phase A/B Validation Report

Generated from `scripts/validate-phase-ab.ts` on 2026-03-22.

## Scope

This report captures the measurable validation artifacts requested for the station-similarity audit implementation:

- Sample classification output with a 24D perceptual vector
- Feature-distribution sanity checks for the newly added audio features
- Similarity ranking quality around an ambient seed track
- Station coherence measurements using weighted cosine over 24D vectors

The raw machine-readable artifacts remain under `tmp/phase-ab-validation/`.

## Sample Classification Output

Tracked sample artifact:

- `doc/research/phase-ab-sample-24d-classification.json`

Key properties:

- `sid_path`: `MUSICIANS/A/Artist/ambient-1.sid`
- `ratings`: `{ c: 2, e: 2, m: 4 }`
- `vectorDimensions`: `24`
- `featureSetVersion`: `1.2.0`

## Feature Distributions

| Feature | Min | Max | Mean |
| --- | ---: | ---: | ---: |
| onsetDensity | 1.10 | 4.20 | 2.56 |
| rhythmicRegularity | 0.32 | 0.78 | 0.556 |
| spectralFluxMean | 0.14 | 0.43 | 0.274 |
| dynamicRange | 0.38 | 0.74 | 0.558 |
| pitchSalience | 0.44 | 0.84 | 0.646 |
| inharmonicity | 0.18 | 0.66 | 0.414 |
| lowFrequencyEnergyRatio | 0.11 | 0.31 | 0.210 |

Interpretation:

- The newly added features vary across the validation fixture set rather than collapsing to constants.
- Bounded features remain within plausible normalized ranges.
- Temporal and low-frequency measures show enough spread to support thresholding and weighted similarity.

## Similarity Metrics

Ambient seed: `MUSICIANS/A/Artist/ambient-1.sid`

Ranked neighbors:

| Rank | SID Path | Similarity |
| --- | --- | ---: |
| 1 | `MUSICIANS/A/Artist/ambient-2.sid` | 0.989089 |
| 2 | `DEMOS/C/Group/demo-hybrid.sid` | 0.898468 |
| 3 | `GAMES/B/Composer/game-drive.sid` | 0.677026 |
| 4 | `GAMES/B/Composer/game-drive-2.sid` | 0.642097 |

Summary:

- Best similarity: `0.989089`
- Worst similarity: `0.642097`
- The ambient pair stays tightly clustered while game-oriented tracks sit materially farther away.

## Station Coherence

Station members:

- `MUSICIANS/A/Artist/ambient-1.sid`
- `MUSICIANS/A/Artist/ambient-2.sid`
- `DEMOS/C/Group/demo-hybrid.sid`

Pairwise weighted-cosine coherence:

- Mean: `0.938962`
- Min: `0.898468`
- Max: `0.989089`

Interpretation:

- The weighted 24D station remains internally coherent, with even the weakest pair staying well above the Phase A minimum-similarity floor.
- The new thresholding and deviation filtering do not force collapse to a single exact clone; the third track remains related but not identical.

## Validation Notes

Focused validation completed during implementation:

- Station CLI policy tests: passed after adding threshold, centroid, and 5-track cold-start coverage
- Classifier/common tests: passed after adding 24D vector, schema, feature, and similarity-export coverage
- Feedback/web tests: passed after implementing sync persistence and temporal-decay aggregation
- Quick TypeScript builds: passed after each substantive implementation slice

Repository-level validation should still be treated as the final convergence gate, but the Phase A/B measurable outputs are now captured in tracked files.

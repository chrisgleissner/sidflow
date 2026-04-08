<!-- markdownlint-disable MD060 -->

# Tiny Export Equivalence Report Template

## Scope

- Audit target:
- Export source: local | release
- Full export path:
- Tiny export path:
- Release repo/tag:
- Host OS:
- Audit mode: local Linux full | CI reduced
- Generated at:

## Inputs

| Input | Path | SHA256 | Notes |
| --- | --- | --- | --- |
| Full export |  |  |  |
| Tiny export |  |  |  |
| Optional lite export |  |  |  |
| Persona definitions |  | n/a |  |

## Commands Run

```bash
# Local full audit


# Hosted release audit


# Optional CI reduced audit

```

## Repeatability Contract

| Rule | Status | Evidence |
| --- | --- | --- |
| Explicit output root |  |  |
| All randomness seeded |  |  |
| Non-interactive execution |  |  |
| Local Linux runnable |  |  |
| Optional CI runnable |  |  |
| JSON artifacts emitted |  |  |
| Markdown summary emitted |  |  |
| Determinism subset rerun completed |  |  |

## Persona Station Equivalence Summary

| Persona | Runs | Median overlap | Worst overlap | Median Jaccard | Median rank corr | Median coherence delta | Median style similarity | Pass/Fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fast_paced |  |  |  |  |  |  |  |  |
| slow_ambient |  |  |  |  |  |  |  |  |
| melodic |  |  |  |  |  |  |  |  |
| experimental |  |  |  |  |  |  |  |  |
| nostalgic |  |  |  |  |  |  |  |  |
| composer_focus |  |  |  |  |  |  |  |  |
| era_explorer |  |  |  |  |  |  |  |  |
| deep_discovery |  |  |  |  |  |  |  |  |
| theme_hunter |  |  |  |  |  |  |  |  |

## Persona Station Detailed Results

### Thresholds

| Metric | Threshold |
| --- | --- |
| Station overlap |  |
| Station Jaccard |  |
| Rank correlation |  |
| Coherence delta |  |
| Style distribution similarity |  |

### Per-Run Results

| Persona | Run seed | Export pair | Favorite seeds file | Full station file | Tiny station file | Overlap | Jaccard | Rank corr | Coherence full | Coherence tiny | Coherence delta | Style similarity | Pass/Fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

### Material Divergences

| Persona | Run seed | Divergence type | Evidence |
| --- | --- | --- | --- |

## Cross-Persona Divergence Summary

Cross-persona rows should pass when tiny stays within the configured divergence delta of the authoritative full baseline. Baseline persona-collapse findings should be listed below as warnings unless tiny materially worsens them.

### Full Export

| Persona A | Persona B | Median overlap | Worst overlap | Median rank corr | Pass/Fail |
| --- | --- | --- | --- | --- | --- |

### Tiny Export

| Persona A | Persona B | Median overlap | Worst overlap | Median rank corr | Pass/Fail |
| --- | --- | --- | --- | --- | --- |

### Collapse Risks

| Export | Persona pair | Reason | Evidence |
| --- | --- | --- | --- |

## Seed-Song Similarity Summary

| Cohort | Seed count | Median top-10 overlap | Worst top-10 overlap | Median top-20 overlap | Worst top-20 overlap | Median top-50 overlap | Median rank corr | Pass/Fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full vs tiny | 50 |  |  |  |  |  |  |  |

## Seed-Song Detailed Results

| Seed track | Full results file | Tiny results file | Top-10 overlap | Top-20 overlap | Top-50 overlap | Top-10 Jaccard | Top-20 Jaccard | Rank corr | Missing from tiny | Missing from full | Pass/Fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

## Determinism Proof

| Check | First run artifact | Second run artifact | Identical? | Notes |
| --- | --- | --- | --- | --- |
| Station subset rerun |  |  |  |  |
| Seed-song subset rerun |  |  |  |  |
| Final verdict stability |  |  |  |  |

## CI/Local Run Guidance

### Local Linux

```bash

```

### Optional CI

```bash

```

### Environment Notes

- Bun version:
- Expected runtime:
- Artifact size expectations:
- Prebuilt exports required?:
- Hosted release source:
- Reduced CI mode differences:

## Verdict

- Persona station equivalence: PASS | FAIL
- Seed-song similarity equivalence: PASS | FAIL
- Material persona divergences:
- Material seed-song divergences:
- Repeatable enough for CI enforcement: YES | NO
- Final recommendation:
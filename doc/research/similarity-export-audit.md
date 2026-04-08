# Similarity Export Audit

Date: 2026-04-07

## Scope

This audit re-checked the live tree for the three supported similarity formats:

- `sidcorr-1` via SQLite
- `sidcorr-lite-1`
- `sidcorr-tiny-1`

The review covered the export builders, portable loaders, station runtime integration, wrapper workflow, release publication path, README claims, and the enforced test surface.

## Capability Matrix

| Capability | sqlite (`sidcorr-1`) | lite (`sidcorr-lite-1`) | tiny (`sidcorr-tiny-1`) | Status |
| --- | --- | --- | --- | --- |
| Authoritative export generation | Yes | Derived from sqlite | Derived from sqlite | CORRECT |
| Runtime loading through station CLI | Yes | Yes | Yes | CORRECT |
| Shared dataset contract (`resolveTrack`, `resolveTracks`, `getTrackVectors`, `getNeighbors`, `getStyleMask`, `recommendFromFavorites`) | Yes | Yes | Yes | CORRECT |
| Format-specific station branching required | No | No | No | CORRECT |
| Random seed sampling parity | Yes | Yes | Yes | CORRECT |
| Real rating preservation at load time | Yes | Yes | Yes | CORRECT |
| Neighbor similarity preservation | Yes | Yes | Yes | CORRECT |
| Style mask availability | Yes | Yes | Yes | CORRECT |
| Non-interactive wrapper generation | Yes | Yes | Yes | CORRECT |
| Release publication support | Yes | Yes | Yes | CORRECT |
| CI-enforced fidelity/equivalence tests | Yes | Yes | Yes | CORRECT |

## README And Docs Reality Check

| Claim | Source | Verdict | Notes |
| --- | --- | --- | --- |
| The station runtime can load sqlite, lite, and tiny through the same CLI path | `README.md`, `doc/similarity-export.md` | CORRECT | Proven by the shared dataset backend and the station equivalence tests. |
| The unattended wrapper is the authoritative workflow | `doc/similarity-export.md` | CORRECT | Still true after fixing the wrapper to emit all three artifacts instead of only sqlite. |
| Default export output includes sqlite, lite, and tiny artifacts | `doc/similarity-export.md` | CORRECT | This was previously overstated; the wrapper now derives all three by default. |
| Publish-only release flow supports the documented export set | `README.md`, `doc/similarity-export.md` | CORRECT | The release staging path now validates and uploads sqlite, lite, tiny, their manifests, `SHA256SUMS`, and the tarball. |
| Tiny is close enough to sqlite for production station building | implied by portable-format docs | CORRECT | Enforced by metric-based station equivalence thresholds plus tiny graph fidelity tests. |

## Gaps Found During The Re-Audit

These were real defects in the live tree before the Phase 32 fixes landed:

1. Tiny reconstructed placeholder `e/m/c/p` values at load time instead of preserving real exported ratings.
2. Tiny synthesized edge scores from ordinal rank instead of preserving persisted similarity weights.
3. The station runtime still mixed sqlite-specific access with portable helpers instead of depending on one dataset contract.
4. Portable `readRandomTracksExcluding(...)` behavior was deterministic-first-row selection rather than actual random sampling.
5. The prior equivalence tests were too weak to prove production-safe convergence.
6. The wrapper and docs claimed three-format output while the script only emitted sqlite.

## Fix Summary

1. Introduced a single `SimilarityDataset` contract in `packages/sidflow-common/src/similarity-portable.ts` and moved station runtime access behind it.
2. Added a sqlite dataset adapter and repaired the lite and tiny loaders so they preserve ratings, style masks, and neighbor fidelity.
3. Made portable seed sampling random instead of deterministic-first-row.
4. Refactored the station runtime so format differences stay in dataset backends rather than queue-building logic.
5. Strengthened the test surface with dataset fidelity checks and metric-based station equivalence thresholds.
6. Updated the authoritative wrapper so one run now builds sqlite, lite, and tiny, and publish-only validates and uploads the full artifact set.

## Proof Surface

The following tests now enforce the convergence contract under existing `*.test.ts` coverage roots:

- `packages/sidflow-common/test/similarity-dataset.test.ts`
- `packages/sidflow-common/test/similarity-export.test.ts`
- `packages/sidflow-play/test/station-portable-equivalence.test.ts`

The station proof checks:

- top-50 overlap
- top-100 overlap
- Jaccard similarity
- rank correlation
- style distribution parity

The tiny fidelity proof checks:

- identity and rating preservation
- style-mask parity
- neighbor ranking overlap
- graph reachability

## Residual Risk

The strongest remaining risk is not format drift inside the station runtime, but future divergence if one backend changes scoring or serialization without updating the shared tests. The current CI-enforced tests are intended to make that regression visible immediately.
# Changelog


## 0.8.2 (2026-07-30)

> **A release tagged 0.8.2 existed briefly and was withdrawn.** Its releases and tags were deleted
> from both `chrisgleissner/sidflow` and `chrisgleissner/sidflow-data`. It shipped one definition of
> what a tiny neighbour edge means; this release ships a different one, and publishing both would
> have asked every consumer to absorb two incompatible redefinitions of the same field within days,
> for no benefit, since nobody had built against the first. The number is reused so that a
> consumer's history reads 0.8.0 → 0.8.2 with one change in what the edges mean. The entry below
> replaces the withdrawn one entirely. `doc/plans/neighbour-graph-flow/prompt.md` and PR #100 remain
> as an accurate record of what was tried; history is not what is being cleaned up here, the
> published contract is.

### The tiny neighbour graph becomes an index, and the station becomes a policy

`sidcorr-tiny-1` is the profile SID Radio stations are built from. Through 0.8.0 it exported a
**directed acyclic graph**, and that guarantee was the defect — not the orientation that implemented
it.

"A station must never repeat a track" is a real product requirement. Turning it into "the exported
edges must form a directed acyclic graph" looks like enforcing it at the source and is actually
something else: a constraint on which *true* similarity relationships the artefact is allowed to
state. Cycles in a similarity graph are not a defect; if A's nearest neighbour is B and B's is A,
both edges are true and both are useful. What must not happen is a *player* revisiting a track, and
the fix for that is a set of what has already been played — which every player already keeps.

Enforcing acyclicity here discarded **50.76%** of the source export's edges and shipped **6.69%** of
the tiny bundle's slot capacity as sentinels, to solve a problem that does not belong in the
artefact.

**`graph_flags` bit 0 therefore reads 0, and acyclicity is no longer claimed or true.** The ordinal
rule — every target must be a lower track ordinal — is gone with it. This is a specification change,
not a schema change: `binary_format_version` stays `2`, the header layout and section order are
unchanged, and §5.2 already required consumers to ignore bits they do not recognise. Only the edge
values, their order within a row, and `graph_flags` differ.

**What replaces it.** Vamana (DiskANN) construction with diversifying pruning, reverse insertion, a
reachability repair and a bound on in-degree. Measured on the published 0.8.0 bundle against the
bundle this release ships, 87,868 tracks:

| | 0.8.0 | 0.8.2 |
|---|---:|---:|
| mean out-degree | 2.799 of 3 | **3.000 of 3** |
| tracks with no incoming edge | 24,669 (28.08%) | **0** |
| tracks with no outgoing edge | 2,786 (3.17%) | **0** |
| largest undirected component | 99.08% | **99.995%** |
| in-degree max, as a multiple of the mean | 66 (23.6x) | 192 (64.0x) |
| greedy routing recall@1 | 0.30% | **0.80%** |
| bundle size | 1,834,993 B | 1,834,993 B |

Row order is descending similarity, so slot 0 is the closest exported neighbour — the convention
0.8.0 used and the one `c64commander`'s `neighbors - slot` weighting assumes.

**Why a simpler rule was not enough, since this is the part worth knowing.** The obvious fix is to
keep three of the source export's 25 nearest neighbours and choose them by diversifying pruning
(HNSW's neighbour heuristic, DiskANN's alpha rule). That was implemented and swept over 30
configurations — alpha in {1.0, 1.05, 1.1, 1.2, 1.4} × {no correction, mutual proximity, local
scaling} × {reverse insertion on, off} — and **every one of them failed**: 9.9% to 13.6% of tracks
left with no incoming edge, 99.52%-99.66% largest component, and greedy routing recall@1 of
0.10%-0.30%, no better than a plain top-3 graph.

The reason is geometric and was measured directly over 400 sampled tracks: the mean distance from a
seed to its rank-1 neighbour is **0.02832**, to its rank-25 neighbour **0.05190**, and to a random
track **0.24294**. Every edge the published candidate pool can offer is five to nine times shorter
than a typical distance in the corpus, so no selection over that pool can produce an edge that
crosses the space, and a graph of only short edges cannot be searched. Vamana works because it
generates each track's candidate pool from a search over the graph being built, so long edges are
available to keep. `doc/neighbour-graph-design.md` §3 states this in full; it is the finding most
likely to be re-learned the hard way.

**What this fixes for a listener, and what it does not.** The graph is no longer what limits a
station. `c64commander` expands at most 8 hops from a seed that never moves, so the reachable region
depends on the branching factor rather than on how far the graph goes — which is why the withdrawn
0.8.2 raised the reachable stream from 17 tracks to 43,934 and the station it fed still served
*fewer* tracks than 0.8.0 did (1,141 against 1,367, simulated over 300 seeds). Reaching a station
that runs for hours needs the client to let its query drift with what the listener has heard. With
that policy, measured on this bundle, every one of 30 sampled stations reached the 25,000-track
measurement cap. The client change ships alongside this release; see
`doc/neighbour-graph-design.md` §7.

**Retrieval quality, and the constraint that shaped the design.** Diversifying all three slots
raised nDCG@10 by 14.35% and dropped composer lift by **21.12%** against the withdrawn 0.8.2 — the
third slot goes to a long edge that rarely shares a composer, and a 21% drop is a graph that streams
further through worse matches. The release refuses more than 5%, so **two of the three slots are
reserved for the seed's own nearest neighbours** and only the third is diversified, which is the move
HNSW makes with `keepPrunedConnections`. The reserved edges are protected from the reachability
repair and the hub trim as well, since either would otherwise silently undo the reservation.

Measured over 8,000 sampled seeds against the withdrawn 0.8.2:

| | 0.8.2 | shipped | change |
|---|---:|---:|---:|
| composer lift | 75.865 | 74.772 | **-1.44%** |
| nDCG@10 | 0.1133 | 0.1507 | **+33.05%** |

Slot 0's mean similarity is 0.9729 and slot 1's is 0.9675, which are exactly the source export's own
rank-1 and rank-2 means: the reservation is exact, not approximate. For reference, 0.8.0's composer
lift was 84.536 and its nDCG@10 0.1440 — it spent all three slots on proximity, so it is still ahead
on unweighted precision and behind on the rank-weighted metric. The release's stated baseline is
0.8.2; both numbers are recorded so a reader can compare against either.

### `sidcorr-1` is deliberately not changed

The full export's `neighbors` table is a **retrieval** answer — `u64deck` uses it for "♪ More like
this", a single-hop query where "the 25 most similar" is exactly right — so it was evaluated rather
than assumed, and left alone.

Measured over 8,000 sampled seeds, re-ranking each seed's published 25 candidates:

| ordering | composer lift | nDCG@10 | rank 1 changed | mean Spearman vs published |
|---|---:|---:|---:|---:|
| published (raw weighted cosine) | 70.382 | 0.2919 | — | 1.000 |
| mutual proximity | 69.991 (**-0.56%**) | 0.2843 (**-2.60%**) | 4,664 of 8,000 | 0.5015 |
| local scaling | 71.162 (+1.11%) | 0.2953 (+1.16%) | 2,126 of 8,000 | 0.7083 |

Mutual proximity — the correction the plan proposed — makes retrieval **worse** on this corpus.
Local scaling gains 1.1%, which is a fifth of the regression the guardrail tolerates elsewhere, and
buying it would change the rank-1 answer for 27% of seeds and reorder 99.96% of rows. Neither can
touch the headline hubness figures at all: in-degree max **217** and the **456 tracks (0.52%)** with
no incoming edge are properties of which tracks appear in someone's row, and re-ranking changes order,
never membership. Against that, the cost is a 982 MB re-download for every consumer.

So `sidcorr-hvsc-full-sidcorr-1.sqlite` ships byte-identical to 0.8.0 and `u64deck` is unaffected.
The 456 unreachable tracks remain a real, unfixed limitation of the full export, recorded in
`doc/neighbour-graph-design.md` §9; the tiny profile does not inherit it.

The same-file question was taken deliberately rather than inherited: the rank-1 neighbour is a
different subsong of the same `.sid` file for **14.42%** of seeds, and **905** seeds have all 25
neighbours from their own file.

They stay in the export. The metric is telling the truth — subsongs of one file usually are
near-identical — and a table that silently answered "most similar, from a different file" would be
harder to build on, since a consumer can derive that from the inclusive answer and not the reverse.
Flagging them would need a new column, which is a schema change this release does not make, and is
unnecessary because `sid_path` and `song_index` are already in the table. The specification now says
plainly that a neighbour may be a sibling and that a consumer wanting distinct tunes must group by
file identity itself. The defect a listener actually experiences — three subsongs of one file in a
row — is fixed in the client, where the exclusion set moves from track ordinals to file identities.

### Measurement tools are committed, not thrown away

Every figure above comes from a script in the repository. The 0.8.0 and 0.8.2 numbers were originally
produced by throwaway code that no longer ran, so nothing could be re-derived or compared:

- `scripts/neighbour-graph/analyse.ts` — degree distributions, connectivity, reciprocity, greedy
  routing recall, slot-0 walk attractors and same-file rates, over any tiny bundle or the full
  export at any width.
- `scripts/neighbour-graph/simulate-station.ts` — a port of `c64commander`'s `computeStation` driven
  the way `stationQueueProvider` drives it, with both the shipped fixed-seed policy and the drifting
  query. No HVSC, no audio, no device.
- `scripts/neighbour-graph/sweep-selection.ts` — the parameter sweeps, reporting the curve rather
  than a chosen point.
- `scripts/neighbour-graph/verify-rank1-reproduction.ts` — proves the published graph is derivable
  from the published vectors under the published weights, so a rebuild needs no reclassification.
  503 of 503 sampled seeds reproduce their published rank-1 neighbour.
- `scripts/neighbour-graph/retrieval-quality.ts` — composer lift and nDCG@10, the guardrail.
- `scripts/neighbour-graph/full-export-hubness.ts` — the evidence for the `sidcorr-1` decision.

`decodeTinyNeighbourGraph` was added to `@sidflow/common` so the release gate and the analyser share
one statement of the header offsets instead of each carrying a copy.

### Derived exports stop stamping the building machine's HVSC version

`lite` and `tiny` are derived from an existing export, and that export is the authority on
which HVSC its `sid_path` values belong to. The library builders already fell back to the
source's own `hvsc_version` when none was passed, but the CLI always resolved the local
collection's `hvsc-version.json` first and passed it in, which overrode the fallback.
Rebuilding the 0.8.0 lite bundle on a machine holding HVSC 84 produced byte-identical bundle
contents with a manifest claiming `"HVSC 84 + Update 84"` against the source's
`"HVSC 85 + Update 85"`. The CLI now resolves the local version only for the formats built
from the local collection; `--hvsc-version` still overrides.

### Smaller fixes

- `scripts/ci/release-prepare.ts` threw when a directory under `packages/` had no
  `package.json`. `packages/libsidplayfp-wasm/` still holds build caches after 0.8.1 moved
  that package to npm, and a stale directory should not break a release mid-bump.
- Two station-equivalence assertions divided an overlap count by the station size requested
  rather than by the number of tracks the profile returned, so a legitimately short tiny
  queue scored as disagreement. They now measure precision over what was returned.

### Release gate

`scripts/verify-published-exports.ts` gains seven checks over the shipped tiny bytes: the
acyclicity declaration, the flow-successor declaration, a topological sort proving the edges
really are acyclic, dead-end and unreachable-track bounds, that slot 0 chains every track
into a single path, and that the median track's longest forward path covers at least a
quarter of the corpus. All five of the substantive ones fail against the published 0.8.0
bundle.

### Fixed: two test files could not run at all

`beforeAll` takes no timeout argument on the pinned Bun (1.3.1) — passing one raises
`beforeAll() expects a function as the second argument` at collection time, so every test in
the file errored out before it ran. `similarity-export-tiny-populations.test.ts` had been in
that state; the fixture now relies on the 120s default from `bunfig.toml` and only `test()`
carries an explicit allowance.


## 0.8.1 (2026-07-28)

### libsidplayfp WASM moves to its own package

The engine was vendored here as the `@sidflow/libsidplayfp-wasm` workspace package: its
own Docker build of libsidplayfp and libresidfp, its own upstream pin, its own release
qualification, all carried inside this repository. It now lives at
[`chrisgleissner/libsidplayfp-wasm`](https://github.com/chrisgleissner/libsidplayfp-wasm)
and is consumed from npm as [`libsidplayfp-wasm`](https://www.npmjs.com/package/libsidplayfp-wasm).

That removes 58 files and roughly 8,200 lines from this repository, along with the
`wasm:build` and `wasm:check-upstream` scripts and the Docker cross-compilation they
drove. Upstream tracking, the dual-engine build, native differential parity, and release
publication are now that project's responsibility.

**Behaviour changes inherited from the extracted package**, all fixes:

- `seekSeconds()` budgeted its fast-forward loop by dividing samples by cycles, which are
  not interchangeable. A 60-second seek landed at 3.95 seconds and reported the shortfall
  as if it were the position. It now seeks where it is asked to.
- `seekSeconds()` was a no-op whenever a render cache existed: it returned a sample index
  and left playback where it was.
- libsidplayfp was compiled with exception handling disabled, so its own `try`/`catch`
  blocks were compiled not to catch and errors it reports through a status escaped as
  opaque exceptions. Malformed input now returns `false` with a readable message.
- The engine artifacts are 16–26% smaller.

**New capability**, should this repository want it: per-voice muting, filter bypass,
playback clock, CIA1 timer, SID register read-back, the HVSC `Songlengths.md5` key, the
full `SidConfig` (C64 and SID model, sampling method, digi boost, power-on delay, extra
chip addresses), and reSIDfp filter tuning.

The web player's `public/wasm/` deployment is now synchronised from
`node_modules/libsidplayfp-wasm/dist`, so its integrity comes from the npm lockfile
rather than from a hand-maintained checksum list.

**Fixed: the web player's deployed engine was missing a module.** `public/wasm/index.js`
imports `./upstream-versions.js`, but the deployment copied a hand-listed set of four
files that did not include it, so the served bundle referenced a module that was never
deployed. The deployment now copies what the package ships, filtered to what a browser
needs, and fails the build if any relative import in the result does not resolve inside
the served directory. It also no longer rewrites `index.js` on the way in: from
libsidplayfp-wasm 0.1.1 the entry point resolves its artifacts relative to itself, so the
copy is byte-for-byte and cannot drift from the package it claims to be.

The `Engine Parity` workflow, which built libsidplayfp natively to check the WASM build
against it, and the release job that published the engine as a GitHub release asset, both
move with the package. Releases here no longer carry a `libsidplayfp-wasm-*.tar.gz`
asset; install the npm package instead.


## 0.8.0 (2026-07-27)

Closes the findings of the July 2026 export audit
(`doc/research/hvsc-correlation-export-audit/20260726/review.md`). **No reclassification
was run**: every artefact is derived deterministically from the 0.7.0 export, whose data
the audit verified as correct.

Consumers migrating from any earlier data release should read
[`doc/migration/0.5-to-0.8.md`](doc/migration/0.5-to-0.8.md).

### The manifest now describes the file it ships beside

- **`file_checksums.sqlite_sha256` has never matched the published file, in any release,
  by construction.** The exporter hashed the database and then wrote the manifest —
  including that hash — into the database's own `meta` table, mutating the bytes it had
  just measured. `SHA256SUMS` was always correct, so nothing downstream broke, but
  `sidflow-data` tells consumers to "verify the checksum and retain the manifest", and a
  consumer who did rejected every release SIDFlow ever shipped. The embedded copy now
  omits `file_checksums` entirely — a file cannot contain its own digest — and the sidecar
  carries it, computed after the last write.
- **`neighbor_row_count` is measured, not `track_count × k`.** The two coincide for HVSC
  (2,196,700 = 87,868 × 25), but a consumer that validates the table against this field
  depends on it being accurate for any corpus. Measured on an 8-track corpus asking for 25
  neighbours, the old code declared 200 against 56 actual.
- `paths.*` are basenames. The 0.7.0 manifest published the build host's absolute
  filesystem layout.
- New: `hvsc_version` (e.g. `"HVSC 85 + Update 85"`), read from `hvsc-version.json` at
  export time. `corpus_version` was the bare string `"hvsc"` in every previous release, so
  nothing recorded which collection the paths belong to.
- New: `--rewrite-manifest` recomputes an existing export's manifest from the database's
  own contents, without reclassifying. Idempotent: it does not open the database for
  writing when the manifest is already correct, because SQLite bumps three header bytes on
  every `VACUUM`.

### The similarity metric is now implementable from what is published

- **New manifest fields `similarity_metric` and `vector_weights`.** The 58-entry learned
  weight table defines the metric and lived only in TypeScript source, so a third party who
  implemented the published lite specification exactly computed plain cosine and agreed
  with the authoritative neighbours on roughly half their results — measured R@1 0.478
  against 0.983, and 40% station overlap against 98% — with no way to notice.
- The three format specifications now describe the artefacts as shipped: the 58-dimension
  vector and its three groups, rank-uniform normalisation with the exact `(r + 0.5) / n`
  formula and its tie handling, the weight table and how it is applied, `sid_engine` versus
  the `render_engine` column, and that `e`/`m`/`c` are corpus-relative quintiles.
  `--dims 3|4` is marked legacy.
- New: `scripts/verify-lite-against-full.ts`, which decodes the bundle from the published
  specification rather than with SIDFlow's own reader and takes the metric from the
  manifest. Measured on the 0.8.0 assets over 1,000 seeds: R@25 = 0.9868, R@1 = 0.9850.

### Stations

- **Station membership is now a design decision, and the export refuses to publish a
  broken one.** 0.7.0 shipped `theme_hunter` matching **0** tracks — a tile that could
  never play anything — `composer_focus` matching 673, five personas each covering about
  half the corpus, and **9,451 tracks carrying both `fast_paced` and `slow_ambient`**.
  Each persona is now the top 20% of the corpus by its own score: nine stations of 17,574
  tracks, spread 1.0 against 69×, zero conflicting overlap.
- **The hybrid personas had no distinguishing signal, and supplying metadata was not
  enough.** `scoreMetadataBonus` scored metadata *presence*, and composer and category
  resolve for 100% of HVSC, so the bonus was a constant that changed no ranking:
  `composer_focus` had 30 distinct scores over 87,868 tracks with metadata and 30 without.
  Each field now contributes its content — composer prominence on a log scale,
  release year as a rank position, directory rarity, theme-tag richness. Measured:
  `composer_focus` 30 → 5,986 distinct scores, `era_explorer` 14 → 316, `theme_hunter`
  30 → 5,321.
- The audio/metadata blend for hybrid personas moves from 0.85/0.15 to 0.45/0.55. At the
  old blend, rarity — the entire premise of Deep Discovery — could move a score by 0.015,
  and with populations equalised Deep Discovery and Melodic shared 91% of their tracks.
- `melodic` / `experimental` join `fast_paced` / `slow_ambient` as mutually exclusive.
  This is a format decision, not a claim about the music: plenty of SID music is both, but
  as station tiles they came out at Jaccard 0.659 and a listener would hear the same
  station twice.
- **Hard population gate at export time**: floor `max(1000, 5%)`, ceiling 40%, spread ≤ 4×,
  zero overlap on conflicting pairs, plus tie-fraction and pairwise-distinctness checks that
  a population floor cannot make. Both bounds scale down so a small private collection is
  not blocked. `--allow-sparse-styles` bypasses it and records the waiver in the manifest.
- New tiny manifest fields: `style_populations`, `style_population_policy`,
  `style_population_waiver`.
- Stations exclude the seed's **file**, not just the seed track. The rank-1 neighbour is a
  different subsong of the same `.sid` file for **14.4%** of seeds.

### Tiny profile reader (library behaviour change)

The bundle bytes are not involved; these affect consumers of `@sidflow/common`.

- **`recommendFromFavorites` now ranks from the neighbour graph.** It computed a five-hop
  decayed walk and then overwrote every score with a cosine over `[e, m, c, p ?? 3]` — a
  4-element rating vector with at most 125 distinct values across 87,868 tracks. The
  neighbour graph, 57% of the bundle's bytes, contributed nothing. Measured on a
  purpose-built corpus: a seed's stored neighbours came back 5th and 7th behind two tracks
  that were not its neighbours at all, and all 11 scores matched an independent rating
  cosine to 12 decimal places while taking 5 distinct values.
  **A favourites call whose seeds have no neighbour edges now returns nothing**, rather
  than noise that looks like a recommendation.
- `hasVectorData` reports `false` and `getTrackVectors()` returns nothing. Tiny carries no
  vectors; reporting that it did let consumers do centroid arithmetic on the rating vector.
- Returned scores are relative to the strongest match rather than clamped. The walk
  accumulates, so the old clamp reported an entire top-100 as exactly `1.0`.
- `computeSimilarityStyleMask` is replaced by `buildStyleMaskIndex`: a station is "the most
  X tracks in this corpus" and cannot be derived from one track in isolation.

### CLI player

Verifying `sidflow-play` end to end against the 0.8.0 artefacts turned up four defects.

- **Tiny stations collapsed to three tracks.** Tiny's reported score was changed earlier in
  this release from a clamped walk score to one normalised against the strongest match —
  which reads as a sensible `[0, 1]` value but is a *rank*, not a similarity. The station
  layer applies an absolute minimum-similarity threshold (0.73 at the default adventure
  setting), so a 100-track station came back with 3. The field now carries the product of
  the stored edge similarities along the best path that reached a track: bounded, decaying
  with distance, and on the same scale as the cosine the other two profiles report.
- **`bun run build:db` crashed on any corpus containing feature-phase output.**
  `data/classified` accumulates `features_*.jsonl` from runs where extraction completed but
  rating did not, and those records carry no `ratings`. The builder walked the tree
  recursively and destructured `ratings` off every line. Measured on an 87,868-track
  workspace it could not build at all. It now skips and counts those records, as the
  similarity export already did.
- **Every `--persona` playlist returned one song.** A persona seeds the recommender with
  its `ratingTargets`, which are integers, so the nearest neighbours all share the same
  `[e, m, c]` — and the diversity filter measures Euclidean distance over exactly those
  three integers, so every candidate scored 0 and was dropped. Diversity is now applied and
  then relaxed rather than allowed to starve the result.
- **Decayed feedback was silently ignored.** `calculateNormalizedSongFeedback` reads
  `decayedLikes` while a `DatabaseRecord` names it `decayed_likes`, so the function fell
  back to raw lifetime totals for every track and recency did not influence recommendations
  at all. This predates the release; it was invisible because the diversity filter
  truncated result lists to one item.

New: `scripts/verify-station-cli.ts` drives the same code path as `sidflow-play station`
against all three profiles and asserts the properties a listener experiences — seeds
resolve, stations fill, no same-file siblings of a seed, no tune contributes twice, every
persona can build a station, and lite reproduces the authoritative ranking at 0.970
candidate overlap.

### New release assets

Both additive; no existing filename changed.

- `sidcorr-hvsc-full-sidcorr-1.sqlite.gz` — 194,351,886 bytes, **5.05×** smaller.
- `sidcorr-hvsc-full-features-1.jsonl.gz` — 75,933,721 bytes. The raw feature records,
  sorted by `track_id`, with their own manifest. A consumer that reads `features_json` and
  uses neither `vector_json` nor the `neighbors` table can take 8 MB of lite plus 76 MB of
  this instead of 982 MB.

### Release naming

- **A `sidflow-data` release tag is now the SIDFlow version that produced it.** The old
  timestamp scheme recorded the producing version nowhere machine-readable — and the
  0.5-era release turns out to have a *split* lineage, its full export generated while
  0.5.6 was newest and its derived bundles the next morning after 0.5.7 was tagged.
  Historical releases are not retagged; the verified mapping is in the migration document.

### Verification

- `scripts/verify-published-exports.ts` gains checks for every finding above. Measured:
  **15 checks fail against the published 0.7.0 assets and all pass against 0.8.0.**
- It now runs on every commit against a fixture built through the real export chain
  (`scripts/ci/build-similarity-fixture.ts`), rather than only when someone remembered to
  run it against a 1 GB export.
- `scripts/reproduce-published-bundles.sh` proves the lite and tiny derivations are
  deterministic; `scripts/diff-tiny-sections.ts` asserts which sections of a rebuilt tiny
  bundle were allowed to change.

### Data release 0.8.0

Rebuilt from the 0.7.0 full export. The lite bundle is **byte-identical** to 0.7.0's; the
tiny bundle differs **only** in its style-mask table (104,507 bytes), with every `md5_48`
identity, per-file subsong count, packed rating and neighbour record unchanged. The full
export shrank 1,013,977,088 → 982,155,264 bytes as `VACUUM` reclaimed free pages during
the manifest repair. All digests change; see the migration document.


## 0.7.0 (2026-07-26)

Rebuilds how SIDFlow decides two SID tunes are alike, and regenerates the published
`sidflow-data` corpus from it.

### Station quality

- Similarity retrieval improves **243x** over the vectors in the currently published export
  (nDCG@10 0.0016 -> 0.3915) and **+156.4%** over the best configuration previously in the
  repository (0.1527 -> 0.3915), both p=0.0002. Measured on the full 87,868-track corpus with
  all 11,284 development-corpus tracks excluded, so nothing measured was used for fitting.
  (Absolute nDCG falls as a corpus grows, because each seed competes against more candidates
  for the same ten slots; the relative figure is the one that transfers across corpus sizes.)
- **A defect was suppressing that result by roughly half.** A fixed 15-second intro skip landed
  past the end of short subsongs, so 16,398 of 87,868 tracks (18.66%) had all 22 playroutine
  dimensions at the "no trace" default and 34 of the 58 similarity dimensions were a shared
  constant across a fifth of HVSC. Nothing failed and every record was well-formed. The
  analysis window now scales with song length. Corrected, the gain over the previous best rose
  from +69.1% to +156.4%.
- The stored similarity vector grows from 4 dimensions in the published export to
  **58**: 24 perceptual, 11 pitch/texture, and 23 describing how a tune's playroutine
  drives the SID chip. The manifest's `vector_dimensions` declares the width; consumers
  must not assume it.
- Most of the gain comes from describing the **playroutine** rather than the sound.
  Composers reuse their player code, and its register-write pattern is that tooling's
  signature. One such dimension separates composers better than all 24 original
  dimensions together (0.7713 against 0.7229).
- Category stations fixed: the 1-5 energy/mood/complexity scales used 3 of 5 levels with
  up to 94% of the corpus on one value. Quantile calibration puts 20.00% in each level,
  raising mood entropy from 0.397 bits to the 2.3219-bit maximum.
- Complexity now measures note density, polyphony and rhythmic vocabulary rather than
  loudness. Mood now sees harmony.
- Stations no longer repeat themselves: 54.7% of generated stations replayed a tune,
  now 6.0%.

### The published export

- Regenerated end to end through the documented `run-similarity-export.sh` workflow.
- Renders with **SIDLite**, chosen by a pre-registered paired comparison on 23,817
  identical tracks (`doc/sid-engine-comparison.md`). reSIDfp is +1.49% on the 24
  WAV-derived dimensions but fails Holm correction, reverses on cold start, and shrinks
  to +0.40% on the shipped vector because 34 of 58 dimensions read the register trace and
  are engine-identical.
- New `sid_engine` field records which SID emulation rendered the corpus, in both the
  classified records and the export manifest. The export now **refuses** a corpus that
  mixes emulations.
- Precomputed neighbours per track raised from 3 to 25.

### Reliability of the classification pipeline

- Classification now runs in bounded chunks (default 2,500 songs) rather than one long-lived
  process. A single process exhausts memory at a predictable ~3.5 GiB after tens of thousands
  of WASM instantiations and dies; chunking holds peak RSS to ~2,000 MiB and the final corpus
  pass completed with **zero crashes**, against three to fourteen per pass before.
- A resume that works: the index of already-classified songs is built by streaming the feature
  records, so it costs 948 ms and 400 MB at 87,868 records. It also validates each record and
  treats an unsound one as not-done, so a rerun repairs rather than preserves it.
- A live integrity assertion aborts a run whose records contradict themselves — a trace holding
  events cannot yield an all-zero playroutine vector — above 1% over a 500-record sample.
- Continuous memory sampling to `memory-samples.jsonl` and full crash reports under
  `logs/crash-reports/`, which is how the failure above was finally characterised.
- Thread count measured on real chunks rather than a microbenchmark: throughput is flat from 6
  to 14 threads (9.43–9.90 songs/s), so the default is 6, which leaves the most memory headroom.

### Fixes

- `recommendFromSeedTrack` served the precomputed neighbour cache whenever it held even
  one row, so with the previous default of 3 stored neighbours, a request for 100
  candidates returned 3. It now falls back to a vector scan unless the cache can serve
  the whole request.
- The documented default classify runtime could not run at all: `--runtime node` failed
  with `ERR_UNSUPPORTED_ESM_URL_SCHEME` because `@sidflow/common` re-exports modules
  importing `bun:sqlite`. Default is now `bun`.
- The tiny profile's 48-bit file identity had no collision check, so two files sharing
  one silently reported the loser's tracks under the winner's path. Collisions are now
  detected at build time and at open time, and both files named.
- Weighted cosine switched itself off for any vector not exactly 24 wide.
- The tiny profile returned zero recommendations against a real nested HVSC layout.
- Neighbour insertion took over 40 minutes for 11,284 tracks; now 48 seconds.
- Release notes no longer publish the builder's local filesystem path, and now state the
  vector width and SID emulation, read from the manifest at publish time.

### Documentation

- `doc/station-quality.md` reports the full optimisation campaign including failures,
  the four measurement defects that fabricated signal, a configuration scoring +136.9%
  that was rejected for regressing cold start by 33%, and a representation that scored
  higher but is unshippable because zero candidates clear the station's similarity
  threshold.
- `doc/sid-engine-comparison.md` pre-registers and reports the engine comparison.
- README corrected: engine default now carries its measurement, thread optimum (12)
  documented with the measured curve, and the broken Node runtime path replaced.


## 0.6.0 (2026-07-24)

- docs: record PR 94 completion
- Verify correctness of tiny export via radio station creation and comparison with full/lite export (#94)
- Add DeepWiki link to developer documentation
- chore: update CHANGES.md for 0.5.8


## 0.5.8 (2026-04-08)

- Merge pull request #93 from chrisgleissner/fix/sidcorr-tiny-release
- feat: implement fixes and enhancements for sidcorr-tiny export, including CLI validation and manifest updates
- Automated full vs tiny export comparison
- feat: add support for sidcorr-tiny export and update release asset upload script
- Add similarity export audit documentation and convergence validation script
- chore: update CHANGES.md for 0.5.7


## 0.5.7 (2026-04-07)

- Merge pull request #92 from chrisgleissner/feat/sidcorr-tiny
- Implement code changes to enhance functionality and improve performance
- fix: update Bun to 1.3.11 in CI Docker image to fix SIGILL crash
- fix: update E2E tests to pass dataset handle instead of sqlite path
- fix: resolve TypeScript errors and test threshold blocking CI
- feat: enhance tiny similarity export with songlengths integration and CI improvements
- Refactor similarity export process and enhance dataset fidelity
- feat: add tiny similarity export functionality and portable dataset interfaces


## 0.5.6 (2026-03-29)

- Merge pull request #89 from chrisgleissner/fix/oome
- fix: treat SIDFLOW_MAX_THREADS as a direct ceiling override, not a heuristic cap
- fix: enforce error handling in WASM and WAV rendering to prevent silent failures
- fix: enhance WASM renderer and CPU detection logic for improved stability and performance
- fix: implement skip-hole fix in flushIntermediate to prevent data loss on WASM errors
- Refactor WASM error handling in SidAudioEngine and classification process
- fix: add job timeout configuration and handling in WASM render pool
- Enhance multithread rendering tests and WAV renderer duration caps
- Refactor SID classification and rendering logic for improved error handling and debugging
- fix: enhance error handling for rendering failures and add tests for high-risk SID classification
- fix: use dynamic import for LanceDB connection to optimize worker thread performance
- Refactor feature extraction and rendering logic
- fix: resolve worker timeout issues and enhance rendering stability in WASM pool
- Enhance WASM Renderer Pool with Job Timeout Management and Stress Testing
- feat: update feature schema version and manifest details
- feat: enhance rendering capabilities with new classification render profiles and metadata handling
- feat: enhance stability and performance of SID classification pipeline with new rendering strategies and telemetry improvements
- chore: update CHANGES.md for 0.5.5


## 0.5.5 (2026-03-26)

- Merge pull request #88 from chrisgleissner/copilot/implement-per-song-logging
- feat: update classification E2E tests with cache-complete fixtures and add five-profile station regression
- Refactor E2E tests to use seedClassificationCacheEntry utility
- fix: update admin session cookie path to cover both admin pages and APIs
- Add validation scripts for HVSC similarity export and quality
- feat: enhance classification logging and filtering in E2E tests
- feat: implement per-song lifecycle logging for classification pipeline
- feat: add classification slowdown telemetry
- chore: initialize slowdown investigation plan
- Initial plan
- Updated logs in README.md
- chore: update CHANGES.md for 0.5.4


## 0.5.4 (2026-03-24)

- Merge pull request #87 from chrisgleissner/fix/direct-sid-classification
- Add SID files for 2/3 SIDs to exercise edge conditions
- test: improve buffer pool tests for SidAudioEngine and enhance synthetic tone verification
- feat: enhance render timeout and circuit breaker handling in WasmRendererPool and related components
- feat: implement render timeout handling and circuit breaker in WasmRendererPool
- feat: enable SID register-write trace capture during WAV rendering
- feat: implement OOM fix and data-retention cleanup in similarity export script
- Refactor libsidplayfp loading mechanism to cache default module instances
- fix: update fallback render cap to 30 seconds in tests
- feat: implement WASM module compilation caching to improve rendering performance
- feat: enhance performance instrumentation and caching for WASM module in rendering pipeline
- feat: optimize SID trace sidecar writing for improved performance and reduced syscall overhead
- feat: update rendering parameters and resource management for improved performance
- feat: add system ROMs requirements and alternative locations to README
- Merge pull request #86 from chrisgleissner/feat/improve-raw-sid-feature-extraction-performance
- feat: enhance end-to-end tests and documentation for SID feature extraction and classification
- feat: enhance documentation and examples for SID file handling and performance metrics
- feat: enhance single-pass SID classification pipeline and documentation
- feat: enhance SID trace sidecar handling and WAV rendering settings
- feat: improve performance of raw SID feature extraction by integrating trace sidecar handling
- feat: enhance dual-source classification audit and HVSC export process
- chore: update CHANGES.md for 0.5.3


## 0.5.3 (2026-03-23)

- Merge pull request #85 from chrisgleissner/feat/improve-classification-2
- test(web): stabilize browser audio fidelity checks
- fix(web): always show playlist browser controls
- feat(tests): add visibility check for playlists button in E2E tests
- fix(ci): restore decay export and stabilize wasm test
- feat: enhance performance tests with error handling and resource management
- feat: add C64U LED CLI integration and offline evaluation metrics
- Refactor code structure for improved readability and maintainability
- feat: Enhance SID-native classification by preserving WAV-derived features and improving compatibility with cached bundles
- feat: Enhance SID feature extraction and testing
- feat: add SID write tracing and feedback aggregation functionality
- fix: extend station demo fixture for C3 min_sim stability; mark Phase C/D complete in PLANS/WORKLOG
- Add comprehensive tests for queue adventure and evaluation modules
- feat: Implement metric-learning MLP for triplet and ranking pair training
- chore: update CHANGES.md for 0.5.2


## 0.5.2 (2026-03-22)

- Merge pull request #84 from chrisgleissner/feat/improve-classification
- ci: warm up /api/play before k6 perf smoke to prevent WASM-init flakiness
- feat: implement playback session stream preparation and refactor related API routes
- test(ci): stabilize render integration coverage
- fix: address Copilot PR review comments
- fix: update chunk size for sidflow-classify in coverage batch processing; enhance validation gates in WORKLOG
- fix: remove existing coverage directory before running coverage batches
- fix: adjust chunk sizes for sidflow-classify and sidflow-web in coverage batch processing
- Add unit tests for deterministic ratings and feedback sync route; implement validation script for phase A/B
- Update README formatting and headings
- Clarify SIDFlow project description [skip ci]
- Revise development status note in README [skip ci]
- docs: streamline README.md for clarity and conciseness, update installation and usage instructions
- docs: update README.md to clarify SID Flow Station usage and add CLI player description
- chore: update CHANGES.md for 0.5.1


## 0.5.1 (2026-03-22)

- Merge pull request #83 from chrisgleissner/test/coverage
- feat: complete station playlist UI hardening and interaction test matrix
- Add exhaustive interaction-level tests for SIDFlow station rendering engine
- feat: update playback sessions and improve playlist handling
- Fix E2E storage reset typecheck
- Fix batched test storage reset
- feat: implement unit coverage batching and improve playback session handling
- feat: enhance station screen rendering and playlist management
- feat: enhance station CLI with rating filters and improved navigation
- feat: integrate fixed-width star rating column in station playlist window
- Add demo-basic.prg file with initial content
- Add comprehensive tests for various API endpoints and utility functions
- Add unit tests for station dataset and playback adapters


## 0.5.0-rc3 (2026-03-21)

- fix(ci): create tmp/ dir before mktemp in docker-smoke.sh
- fix(station): preserve filter when entering edit mode; clear filterBuffer on /
- chore: remove unused demo-basic.prg file
- feat: add station screen and types for SIDFlow CLI
- chore: update CHANGES.md for 0.5.0-rc2
- Added SID CLI Station screenshot
- feat(cli): improve station screen rendering and playlist management
- feat: enhance station demo CLI with reset selections functionality
- feat: update .gitignore to include cache directory and add pull request convergence task in PLANS.md
- feat: add PR convergence prompt for merging process guidance
- feat: update README with enhanced CLI tools description and new CLI SID radio station section
- feat(cli): add interactive filter for station playlist by title or artist
- feat(cli): enhance station demo CLI with local database options
- Enhance station demo CLI and add Ultimate 64 REST API documentation
- feat: enhance docker smoke script with JSONL record count validation and improved output logging
- chore: update CHANGES.md for 0.5.0-rc1
- refactor: simplify docker smoke script by removing unused variables and adjusting paths
- feat: enhance release workflow and smoke test scripts with improved version handling and health checks
- chore: update CHANGES.md for 0.5.0
- feat: enhance SidAudioEngine with context management and disposal
- Merge pull request #82 from chrisgleissner/feat/prod-hardening-1
- feat(cli): add station demo CLI and related tests
- Update similarity export schema to version 1; enhance export functionality and improve CLI output paths
- Update similarity export schema to version 2; enhance export functionality and improve CLI output paths
- Enhance similarity export functionality; recover orphaned feature-phase rows and improve export summary logging
- Enhance performance tests and playback session data; update k6 latency thresholds and improve playlist UI assertions
- Merge remote-tracking branch 'origin/feat/prod-hardening-1' into feat/prod-hardening-1
- Fix CI classification failures and enhance export reliability; update rate limiter persistence and add run lock to export script
- Add new playback sessions for "Lully Marche Ceremonie Turcs Wip" and "10 Orbyte"
- Add tracing and playback session data, enhance test server setup
- Stabilize async perf timing test
- Enhance WAV render settings management and analysis timing accuracy
- Fix Playwright Node test discovery
- Fix production Playwright harness
- Fix web build typing regressions
- Address follow-up PR review feedback
- Fix admin metrics job timestamp typing
- Address PR review feedback on admin auth fallback
- Refactor code structure for improved readability and maintainability
- feat: enhance classification job with limit parameter and update related files
- feat: add similarity export script and classification job manifest
- feat: add similarity export functionality and CLI support
- Add security runtime validation and configuration checks
- Disable nightly performance test schedule
- Revise README with new project details and features
- chore: update CHANGES.md for 0.4.0
- fix(e2e): increase navigation wait timeouts in accessibility tests
- fix(e2e): increase timeout for search debounce and dialog
- fix(e2e): additional flakiness fixes
- fix(e2e): address remaining flaky test root causes
- fix(e2e): address root causes of flaky tests
- fix(e2e): increase global navigation and assertion timeouts for CI stability
- fix(e2e): increase timeouts and use deterministic waits for CI stability
- refactor: optimize page navigation and enhance test reliability with timeout adjustments
- feat: add classification speed journey runner and related scripts
- Add tests for BPM estimation and scripts for station building and verification
- Refactor: Enhance k6 performance tests with retry logic and error handling
- Refactor: Improve production readiness and test reliability (#80)
- Merge pull request #79 from chrisgleissner/cursor/performance-test-reliability-3485
- Fix CI flake: Bind Next.js server to 127.0.0.1
- Add on-commit performance smoke tests
- Refactor: Introduce runner profiles and SLOs for performance tests
- Checkpoint before follow-up message
- Merge pull request #78 from chrisgleissner/cursor/documentation-accuracy-and-consistency-7fb4
- Refactor: Update docs and CLI commands for clarity and consistency
- Update README.md
- Remove user guide reference from README
- chore: update CHANGES.md for 0.3.48


## 0.5.0-rc2 (2026-03-21)

- Added SID CLI Station screenshot
- feat(cli): improve station screen rendering and playlist management
- feat: enhance station demo CLI with reset selections functionality
- feat: update .gitignore to include cache directory and add pull request convergence task in PLANS.md
- feat: add PR convergence prompt for merging process guidance
- feat: update README with enhanced CLI tools description and new CLI SID radio station section
- feat(cli): add interactive filter for station playlist by title or artist
- feat(cli): enhance station demo CLI with local database options
- Enhance station demo CLI and add Ultimate 64 REST API documentation
- feat: enhance docker smoke script with JSONL record count validation and improved output logging
- chore: update CHANGES.md for 0.5.0-rc1
- refactor: simplify docker smoke script by removing unused variables and adjusting paths
- feat: enhance release workflow and smoke test scripts with improved version handling and health checks
- chore: update CHANGES.md for 0.5.0
- feat: enhance SidAudioEngine with context management and disposal
- Merge pull request #82 from chrisgleissner/feat/prod-hardening-1
- feat(cli): add station demo CLI and related tests
- Update similarity export schema to version 1; enhance export functionality and improve CLI output paths
- Update similarity export schema to version 2; enhance export functionality and improve CLI output paths
- Enhance similarity export functionality; recover orphaned feature-phase rows and improve export summary logging
- Enhance performance tests and playback session data; update k6 latency thresholds and improve playlist UI assertions
- Merge remote-tracking branch 'origin/feat/prod-hardening-1' into feat/prod-hardening-1
- Fix CI classification failures and enhance export reliability; update rate limiter persistence and add run lock to export script
- Add new playback sessions for "Lully Marche Ceremonie Turcs Wip" and "10 Orbyte"
- Add tracing and playback session data, enhance test server setup
- Stabilize async perf timing test
- Enhance WAV render settings management and analysis timing accuracy
- Fix Playwright Node test discovery
- Fix production Playwright harness
- Fix web build typing regressions
- Address follow-up PR review feedback
- Fix admin metrics job timestamp typing
- Address PR review feedback on admin auth fallback
- Refactor code structure for improved readability and maintainability
- feat: enhance classification job with limit parameter and update related files
- feat: add similarity export script and classification job manifest
- feat: add similarity export functionality and CLI support
- Add security runtime validation and configuration checks
- Disable nightly performance test schedule
- Revise README with new project details and features
- chore: update CHANGES.md for 0.4.0
- fix(e2e): increase navigation wait timeouts in accessibility tests
- fix(e2e): increase timeout for search debounce and dialog
- fix(e2e): additional flakiness fixes
- fix(e2e): address remaining flaky test root causes
- fix(e2e): address root causes of flaky tests
- fix(e2e): increase global navigation and assertion timeouts for CI stability
- fix(e2e): increase timeouts and use deterministic waits for CI stability
- refactor: optimize page navigation and enhance test reliability with timeout adjustments
- feat: add classification speed journey runner and related scripts
- Add tests for BPM estimation and scripts for station building and verification
- Refactor: Enhance k6 performance tests with retry logic and error handling
- Refactor: Improve production readiness and test reliability (#80)
- Merge pull request #79 from chrisgleissner/cursor/performance-test-reliability-3485
- Fix CI flake: Bind Next.js server to 127.0.0.1
- Add on-commit performance smoke tests
- Refactor: Introduce runner profiles and SLOs for performance tests
- Checkpoint before follow-up message
- Merge pull request #78 from chrisgleissner/cursor/documentation-accuracy-and-consistency-7fb4
- Refactor: Update docs and CLI commands for clarity and consistency
- Update README.md
- Remove user guide reference from README
- chore: update CHANGES.md for 0.3.48


## 0.5.0-rc1 (2026-03-15)

- refactor: simplify docker smoke script by removing unused variables and adjusting paths
- feat: enhance release workflow and smoke test scripts with improved version handling and health checks
- chore: update CHANGES.md for 0.5.0
- feat: enhance SidAudioEngine with context management and disposal
- Merge pull request #82 from chrisgleissner/feat/prod-hardening-1
- feat(cli): add station demo CLI and related tests
- Update similarity export schema to version 1; enhance export functionality and improve CLI output paths
- Update similarity export schema to version 2; enhance export functionality and improve CLI output paths
- Enhance similarity export functionality; recover orphaned feature-phase rows and improve export summary logging
- Enhance performance tests and playback session data; update k6 latency thresholds and improve playlist UI assertions
- Merge remote-tracking branch 'origin/feat/prod-hardening-1' into feat/prod-hardening-1
- Fix CI classification failures and enhance export reliability; update rate limiter persistence and add run lock to export script
- Add new playback sessions for "Lully Marche Ceremonie Turcs Wip" and "10 Orbyte"
- Add tracing and playback session data, enhance test server setup
- Stabilize async perf timing test
- Enhance WAV render settings management and analysis timing accuracy
- Fix Playwright Node test discovery
- Fix production Playwright harness
- Fix web build typing regressions
- Address follow-up PR review feedback
- Fix admin metrics job timestamp typing
- Address PR review feedback on admin auth fallback
- Refactor code structure for improved readability and maintainability
- feat: enhance classification job with limit parameter and update related files
- feat: add similarity export script and classification job manifest
- feat: add similarity export functionality and CLI support
- Add security runtime validation and configuration checks
- Disable nightly performance test schedule
- Revise README with new project details and features
- chore: update CHANGES.md for 0.4.0
- fix(e2e): increase navigation wait timeouts in accessibility tests
- fix(e2e): increase timeout for search debounce and dialog
- fix(e2e): additional flakiness fixes
- fix(e2e): address remaining flaky test root causes
- fix(e2e): address root causes of flaky tests
- fix(e2e): increase global navigation and assertion timeouts for CI stability
- fix(e2e): increase timeouts and use deterministic waits for CI stability
- refactor: optimize page navigation and enhance test reliability with timeout adjustments
- feat: add classification speed journey runner and related scripts
- Add tests for BPM estimation and scripts for station building and verification
- Refactor: Enhance k6 performance tests with retry logic and error handling
- Refactor: Improve production readiness and test reliability (#80)
- Merge pull request #79 from chrisgleissner/cursor/performance-test-reliability-3485
- Fix CI flake: Bind Next.js server to 127.0.0.1
- Add on-commit performance smoke tests
- Refactor: Introduce runner profiles and SLOs for performance tests
- Checkpoint before follow-up message
- Merge pull request #78 from chrisgleissner/cursor/documentation-accuracy-and-consistency-7fb4
- Refactor: Update docs and CLI commands for clarity and consistency
- Update README.md
- Remove user guide reference from README
- chore: update CHANGES.md for 0.3.48


## 0.5.0 (2026-03-15)

- feat: enhance SidAudioEngine with context management and disposal
- Merge pull request #82 from chrisgleissner/feat/prod-hardening-1
- feat(cli): add station demo CLI and related tests
- Update similarity export schema to version 1; enhance export functionality and improve CLI output paths
- Update similarity export schema to version 2; enhance export functionality and improve CLI output paths
- Enhance similarity export functionality; recover orphaned feature-phase rows and improve export summary logging
- Enhance performance tests and playback session data; update k6 latency thresholds and improve playlist UI assertions
- Merge remote-tracking branch 'origin/feat/prod-hardening-1' into feat/prod-hardening-1
- Fix CI classification failures and enhance export reliability; update rate limiter persistence and add run lock to export script
- Add new playback sessions for "Lully Marche Ceremonie Turcs Wip" and "10 Orbyte"
- Add tracing and playback session data, enhance test server setup
- Stabilize async perf timing test
- Enhance WAV render settings management and analysis timing accuracy
- Fix Playwright Node test discovery
- Fix production Playwright harness
- Fix web build typing regressions
- Address follow-up PR review feedback
- Fix admin metrics job timestamp typing
- Address PR review feedback on admin auth fallback
- Refactor code structure for improved readability and maintainability
- feat: enhance classification job with limit parameter and update related files
- feat: add similarity export script and classification job manifest
- feat: add similarity export functionality and CLI support
- Add security runtime validation and configuration checks
- Disable nightly performance test schedule
- Revise README with new project details and features
- chore: update CHANGES.md for 0.4.0


## 0.4.0 (2025-12-21)

- fix(e2e): increase navigation wait timeouts in accessibility tests
- fix(e2e): increase timeout for search debounce and dialog
- fix(e2e): additional flakiness fixes
- fix(e2e): address remaining flaky test root causes
- fix(e2e): address root causes of flaky tests
- fix(e2e): increase global navigation and assertion timeouts for CI stability
- fix(e2e): increase timeouts and use deterministic waits for CI stability
- refactor: optimize page navigation and enhance test reliability with timeout adjustments
- feat: add classification speed journey runner and related scripts
- Add tests for BPM estimation and scripts for station building and verification
- Refactor: Enhance k6 performance tests with retry logic and error handling
- Refactor: Improve production readiness and test reliability (#80)
- Merge pull request #79 from chrisgleissner/cursor/performance-test-reliability-3485
- Fix CI flake: Bind Next.js server to 127.0.0.1
- Add on-commit performance smoke tests
- Refactor: Introduce runner profiles and SLOs for performance tests
- Checkpoint before follow-up message
- Merge pull request #78 from chrisgleissner/cursor/documentation-accuracy-and-consistency-7fb4
- Refactor: Update docs and CLI commands for clarity and consistency
- Update README.md
- Remove user guide reference from README
- chore: update CHANGES.md for 0.3.48


## 0.3.48 (2025-12-14)

- Merge pull request #77 from chrisgleissner/cursor/test-suite-stability-and-fixes-44be
- Refactor: Scope E2E tests to the play tab and improve FCP check
- feat: Implement WAV file truncation and duration management
- feat: enhance Dockerfile for legacy path support and update classification duration handling
- chore: update CHANGES.md for 0.3.47


## 0.3.47 (2025-12-12)

- ci: fix fly app creation
- chore: update CHANGES.md for 0.3.46


## 0.3.46 (2025-12-12)

- ci: auto-create fly apps
- chore: update CHANGES.md for 0.3.45


## 0.3.45 (2025-12-12)

- Merge pull request #76 from chrisgleissner/feat/classification-pipeline-hardening
- fix: adjust polling parameters for classification heartbeat test to improve performance
- feat: enhance classification CLI with limit and sidPathPrefix options; improve heartbeat test for thread freshness
- chore: remove committed training JSONL artifact
- feat: enhance heartbeat mechanism to prevent stale threads during long feature extraction
- fix: rename middleware.ts to proxy.ts for Next.js 16 compatibility
- chore: update CHANGES.md for 0.3.44


## 0.3.44 (2025-12-06)

- Merge pull request #75 from chrisgleissner/feat/classification-pipeline-hardening
- fix: address PR review comments
- refactor: remove unused import and add jsonl writer queue functions
- docs: clean up PLANS.md - archive completed tasks
- fix(e2e): speed up CI by skipping slow classification tests
- fix(e2e): use correct progress endpoint to check classification status
- fix(e2e): increase classification test timeouts
- fix(e2e): wait for classification idle before starting test
- feat(classify): pipeline hardening and productionization
- feat(tests): add end-to-end tests for synthetic SID classification and REST API integration
- Refactor code structure for improved readability and maintainability
- Merge pull request #72 from chrisgleissner/fix/classify
- fix: correct comment terminology in classify-progress-store
- fix: enhance accessibility tests with improved wait conditions and retry logic
- chore: reduce verbose getPositionSeconds logging
- fix: add istanbul ignore file comments to Edge runtime files
- chore: suppress baseline-browser-mapping warnings in CI workflows
- fix: exclude middleware from Istanbul coverage to avoid Edge runtime eval error
- feat: enhance image comparison utility and improve accessibility tests
- feat: consolidate CLI argument parsing across multiple packages
- fix: enhance classification pipeline error handling and logging
- fix: update classification pipeline to use default feature extractor and predictor
- feat: add Codebase Deduplication & Cleanup task to PLANS.md
- feat: add performance journey for 'play-start-stream' with navigation and playback steps
- Remove obsolete performance test results and summary files for the 'play-start-stream' journey across multiple timestamps, including both k6 and playwright metrics. This cleanup helps maintain a tidy project structure and ensures only relevant data is retained.
- Merge main into fix/classify: resolve conflicts, add cachedFiles tracking
- Remove deprecated SIDFlow scripts: logs.sh, restore.sh, start.sh, status.sh, stop.sh, update.sh, and webhook-server.sh
- Refactor SIDFlow web documentation and remove obsolete files
- feat: implement unified performance testing framework with Playwright and k6
- feat: add support for JSON journey files with line comments
- Add comprehensive tests for state machine, middleware, and classify progress metrics
- Merge pull request #74 from chrisgleissner/copilot/fix-unit-and-e2e-tests
- Fix test permissions after Docker e2e runs
- Restore original screenshots modified by e2e tests
- Verify unit and e2e tests passing
- Initial plan
- chore: update CHANGES.md for 0.3.43
- Add scripts for SIDFlow management: logs, restore, start, status, stop, update, and webhook server

This changelog is a lightweight summary of releases; it may include some mechanical “update CHANGES.md” entries from automation.

## 0.3.43 (2025-12-02)
- Refined classify progress counters and data-testid coverage for thread metrics.
- Clarified feature extraction output visibility and terminology in docs/UI.
- Updated managed-hosting production configuration and admin credential handling.
- Cleaned README terminology (HVSC → SID Browser) and deployment notes.

## 0.3.42 (2025-11-30)
- Added classification scheduler plus export/import APIs and UI with tests.
- Exposed skip/delete options for classification runs; improved parallelism for exports/imports.
- Optimized unit/E2E tests and Playwright waits for stability.
- Deployment fixes: dynamic staging app name and corrected health-check URL.

## 0.3.41–0.3.40 (2025-11-28–30)
- Large test-speed improvements (phase transitions, accessibility waits, higher worker counts).
- Pause/resume playback sync fixes; inline rendering heartbeat and phase visibility.
- HVSC extraction reliability: p7zip-full support and richer error logging.
- Managed-hosting deployment hardening: health checks, dynamic app selection, admin password workflow.

## 0.3.39–0.3.35 (2025-11-27–28)
- Classification pipeline tightening: inline render per song, Essentia-first defaults, thread state verification.
- Docker/health adjustments: precreate workspace/data paths, roms dir, sudo-safe install paths.
- Security/health: auth-safe health checks, sidplayfp CLI rendering simplification, WAV duration fixes.

## 0.3.34–0.3.32 (2025-11-26–27)
- Added default sidplayfp.ini creation and force-rebuild flag for classification.
- Improved render engine ordering, UI display of active engines, and non-root Docker execution.
- Config tidying: preferred engines, render defaults, and CPU limit tuning for deploy scripts.

## Earlier milestones (≤0.3.31)
- 0.3.31 (2025-11-25): Unified performance runner (Playwright + k6) with deterministic tmp/results layout.
- 0.3.28–0.3.24: End-to-end classification pipeline with Essentia defaults and JSONL export; WAV render cache + songlength safeguards; improved retry/backoff.
- 0.3.20–0.3.15: HVSC fetch pipeline hardened, sidplayfp/ffmpeg integration, workspace layout finalized.
- 0.3.10: Initial public release with fetch, classify (heuristic), rate, play, and Fly/Docker deployment scaffolding.
- 0.3.9–0.3.6: Release packaging hardening (standalone Next.js bundle, size cuts, symlink handling), GHCR images, and smoke-testable artifacts.
- 0.3.5–0.3.3: CI stabilization (path filters, retries, sharding) and E2E coverage ramp.
- 0.3.2–0.3.1: AudioWorklet/SAB pipeline, telemetry, similarity search, favorites, playlists, adaptive station, and first comprehensive web rollout phases.

## 0.2.x (2025-10)
- Introduced web UI flows for browse/search/play with early rating storage.
- Added basic progress reporting for classification, initial Playwright E2E harness, and unified performance journey scaffolding.
- Release automation and Docker/Fly scripts stabilized with health checks and config defaults.

## 0.1.x (2025-09)
- First internal prototypes: HVSC fetcher, WASM-based SID rendering, heuristic ratings.
- Seeded workspace layout (`hvsc`, `audio-cache`, `tags`) and minimal CLI wrappers.
- Laid groundwork for future feature extraction and training flows.

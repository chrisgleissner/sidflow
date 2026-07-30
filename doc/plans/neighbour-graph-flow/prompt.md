# Implementation prompt — make the published neighbour graphs sustain long stations (0.9.0)

The goal is a listening experience, and it is worth stating in plain terms before the numbers start.
A station built from the published data should carry a listener forward through the corpus for a long
time without repeating itself and without circling back into the same few tunes. Today it does not.
This prompt says exactly how far short it falls, why, and what to change.

> **Where to work.** `sidflow` lives at `/home/chris/dev/c64/sidflow` (`/home/chris/dev` is a symlink
> to `/mnt/data/dev`, so the two spellings are the same directory). Branch off `main`; this prompt was
> written on `feat/neighbour-graph-flow`, which is based on `5de8f52`. The `c64commander` work in
> Part F is a separate repository with its own checkout and its own branch — see that section.

> **Everything below was measured, not assumed.** The artefacts analysed are the `sidflow-data`
> `0.8.0` release assets, downloaded 2026-07-30 and verified against the release `SHA256SUMS`:
> `sidcorr-hvsc-full-sidcorr-1.sqlite` = `d3d825ae…b176da`, `sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr`
> = `64bee446…f7c9c6d`. That tiny digest is the one `c64commander` pins in
> `src/lib/sidRadio/sidcorrRelease.ts:38`, so the measurements are of the exact bytes users are
> running. Appendix A says how to reproduce each figure.

---

## 1. The finding

Two separate defects produce the same symptom. They live in different artefacts and need different
fixes, so keep them apart.

**The station-facing artefact caps a forward-only station at tens of tracks.** `sidcorr-tiny-1` — the
profile `c64commander`'s SID Radio consumes — exports a directed acyclic graph. Acyclicity is real and
correctly enforced (0 violations across 263,604 slots). But the orientation rule is
`doc/similarity-export-tiny.md` §10.3: *"every populated target MUST be a track ordinal strictly
smaller than the current track ordinal"*, and the track ordinal is the position in `sid_path`
alphabetical order (§4.2). Alphabetical path order has nothing to do with what a tune sounds like, so
the DAG it induces is shallow. **Measured on the shipped bundle: the longest forward path from the
median track is 17 tracks, and the longest forward path anywhere in the corpus is 79.** A rank-greedy
forward walk does much worse than that ceiling — median 5 tracks, 57.98% of seeds stranded within 5.

**The authoritative artefact's ranking is dominated by two-track cycles.** `sidcorr-1`'s `neighbors`
table is a plain top-25 by weighted cosine with no hubness or reciprocity control
(`insertNeighbors`, `packages/sidflow-common/src/similarity-export.ts:1121`). 47.28% of its 2,196,700
directed edges are reciprocated. Follow rank 1 repeatedly — the most obvious thing a consumer can do
with a ranked neighbour table — and **every attractor in the corpus is a 2-cycle**: 16,700 of them,
holding 33,400 tracks (38.01%). The walk hears a median of 3 distinct tracks before it starts
repeating, and never more than 12.

The user-visible consequence, measured by running a faithful port of `c64commander`'s
`computeStation` the way `stationQueueProvider` drives it (fixed seed, growing exclude set,
`REFILL_BATCH = 24`), over 300 random seeds on the shipped tiny bundle:

| Song Radio station | tracks served before `empty: "exhausted"` |
|---|---|
| median | 1,137 |
| p10 | 654 |
| p90 | 1,755 |
| max | 2,384 |
| median corpus coverage | **1.294%** of 87,868 tracks |

1,137 tracks is roughly two days of continuous listening, so the client does not fall over in an
afternoon. But it reaches even that only by discarding the direction the export enforces: it builds a
reverse adjacency at load and weights reverse edges at 2.0 against a forward rank-1 weight of 3.0
(`stationEngine.ts:34,258,261`), then widens from `MAX_HOPS = 3` to `EXTENDED_MAX_HOPS = 8` when the
yield is thin. Treating the DAG as undirected reinstates exactly the two-track cycles the acyclicity
rule was meant to prevent. The station then stops with 98.7% of the corpus unplayed.

---

## 2. What the graphs actually look like

### 2.1 `sidcorr-1`, k = 25 — the authoritative graph

| Property | Measured |
|---|---|
| tracks / `.sid` files | 87,868 / 61,157 |
| neighbour rows | 2,196,700 (25 per track, no unfilled slots) |
| reciprocated edges | 47.28% (k=3: 43.92%, k=1: 38.01%) |
| strongly connected components | 526; largest 86,123 = **98.01%** |
| weakly connected components | 2; largest 87,565 = 99.66% |
| forward reachability from a seed (BFS closure) | 86,990–86,991 tracks = **99.0%** |
| in-degree | mean 25.0, median 20, max 217; **456 tracks (0.52%) have zero in-degree** |
| rank-1 neighbour is a different subsong of the same `.sid` | 14.42% (rank 2: 10.96%, rank 3: 9.23%, all ranks: 5.13%) |

Read those two blocks together, because they say different things. Connectivity is not the problem:
99.0% of the corpus is forward-reachable from any seed. The problem is that no simple way of walking
the graph reaches it.

A greedy walk that never repeats — at each track, step to the highest-ranked neighbour not yet played
— strands after a **median of 1,992 tracks** (3,000 seeds; mean 1,964, p10 235, p90 3,822, max 7,876).
2.90% of seeds strand within 100 tracks; 17.37% within 500. That is 2.3% of the corpus.

The stranded set is not a trap. At the moment the walk strands, **29.84% of the out-edges leaving the
already-played set still point outside it** (min 12.65%, max 53.05% over 25 seeds). The walk is
myopic, not enclosed. But no simple step rule recovers the difference — measured on the same 25 seeds
and the same edges:

| step rule | median walk length | corpus coverage |
|---|---:|---:|
| highest-ranked unvisited (today's obvious reading) | 2,036 | 2.32% |
| lowest-ranked unvisited | 1,243 | 1.41% |
| random unvisited | 1,855 | 2.11% |
| Warnsdorff (fewest onward options first) | 1,476 | 1.68% |

**This is the result that decides the shape of the work.** Traversal policy is not the lever. A
consumer cannot fix this from the client side, because the information needed to keep going is not in
the exported edge set. The export has to carry it.

### 2.2 `sidcorr-tiny-1`, k = 3 — the station graph

Header: `binary_format_version` 2, `graph_flags` `0x0007`, `track_count` 87,868, `file_count` 61,157,
`style_count` 9, `neighbors_per_track` 3.

The DAG is well-formed: 0 edges point at an ordinal ≥ their source, 0 sentinels appear before a
populated slot, and the strongly connected component count is exactly 87,868, which is what a true DAG
gives. The damage is in what the rule discards and in which direction it points.

| Property | Measured |
|---|---|
| slots populated | 245,964 of 263,604 = 93.31%; mean out-degree 2.799 of 3 |
| tracks with **no** outgoing edge | 2,786 (3.17%) |
| tracks with **no** incoming edge | **24,669 (28.08%)** |
| in-degree | mean 2.80, median 2, max 66 |
| longest forward path from a track | median **17**, mean 18.8, p90 36, **max 79** |
| rank-greedy forward walk | median **5**, p90 9, max 21; 57.98% of seeds stranded by 5 tracks, 99.98% by 20 |
| weakly connected components (direction ignored) | 162; largest 87,064 = 99.08% |

The orientation drains toward the start of the alphabet, and the effect is monotone across the corpus:

| decile of track ordinal | mean out-degree | tracks with 0 out-edges | mean in-degree |
|---|---:|---:|---:|
| 1 (`DEMOS/0-9…`) | 2.013 | 1,722 | 5.086 |
| 2 | 2.377 | 741 | 5.360 |
| 5 | 2.965 | 29 | 2.724 |
| 9 | 2.997 | 3 | 0.953 |
| 10 | 2.987 | 15 | 0.830 |

A track early in the alphabet has few places to go and is pointed at by many; a track late in the
alphabet has three onward edges and is pointed at by almost nobody. That is a drain, not a stream.

**The rule is cheap in similarity and expensive in structure**, and this distinction matters for
choosing the fix. Only 49.24% of the full export's edges satisfy it. The retained edges sit at a
median original rank of 3 (mean 4.90, p90 11, max 25); 53.25% come from the true top 3, 72.09% from
the top 5, 89.07% from the top 10. Slot 1 carries mean similarity 0.9681 against the true rank-1 mean
of 0.9729 — **a mean loss of 0.0048** — and is the true rank-1 neighbour for 51.38% of tracks. So the
tunes a listener hears are still good matches. What the rule destroys is the ability to keep going.

---

## 3. There is headroom, and it was measured

The published 58-dimension vectors support a single non-repeating path through the **entire** corpus at
near rank-1 quality. Greedy nearest-unvisited over `vector_json` under the manifest's `vector_weights`
and `similarity_metric: "weighted-cosine"`:

| Property | Measured |
|---|---|
| tracks visited, no repeats | **87,868 — all of them** |
| mean consecutive similarity | **0.9638** (median 0.9695) |
| for comparison, published rank-1 mean | 0.9728 |
| p1 / p5 / p10 | 0.8730 / 0.9163 / 0.9336 |
| steps below 0.90 | 2,355 (2.68%) |
| steps below 0.80 | 101 (0.11%) |

A corpus-spanning stream costs 0.009 of mean similarity against the best possible single step. The
101 steps below 0.80 are the moments the path leaves an exhausted region for a new one; they are
audible and they are 0.11% of the journey.

**Most of that path is already inside the exported edge budget.** For 89.88% of tracks the next track
on the greedy path is already one of that track's 25 exported neighbours (median rank 2, mean 4.29,
p90 11; it is the rank-1 neighbour for 31.65% of them). Only 8,888 tracks (10.12%) would need an edge
the current top-25 does not contain.

Re-orienting the existing k=25 edges by that flow order — same edges, same "keep the first 3 that
point forward" rule, only the definition of *forward* changed:

| | alphabetical order (today) | similarity flow order |
|---|---:|---:|
| longest forward path, median | 17 | **2,379** |
| longest forward path, mean | 18.4 | 5,501 |
| longest forward path, max | 64 | 25,842 |
| tracks with 0 incoming edges | 28.07% | **3.16%** |
| tracks with 0 outgoing edges | 2.72% | 10.12% |
| rank-greedy forward walk, median | 5 | 32 |

> **Caveat, and it matters.** This reconstruction ordered tracks by `track_id` rather than by the
> normative sidcorr-1 key (`sid_path` bytewise, then `song_index` numeric); the two differ at 14,878
> of 87,868 positions. Under the reconstruction the alphabetical baseline measures 17 / 64 / 5 against
> the shipped bundle's authoritative 17 / 79 / 5. The direction and magnitude of the comparison hold;
> **re-derive the exact figures under the correct ordering before quoting any of them.**

Two things follow. Re-orientation is worth roughly two orders of magnitude of path depth for no change
to the edge set — and it is not sufficient on its own. Rank-greedy still strands at a median of 32,
and 10.12% of tracks end up with no forward edge at all, because the flow order's tail has nowhere
left to point. A forward walk needs a *guaranteed* continuation, not merely a deeper graph.

---

## 4. Hard constraints

Violating any of these invalidates the work.

1. **No reclassification.** Do not re-render, re-extract features, or re-classify any part of HVSC.
   Everything ships from the existing `0.8.0` assets. This is achievable and was verified: recomputing
   weighted cosine from `vector_json` and the manifest's `vector_weights` reproduced the published
   rank-1 neighbour exactly for probe seeds 0, 1,000 and 50,000 (targets 86,297 / 359 / 61,874). Run
   that check first; if it fails, stop, because nothing downstream is derivable.

2. **Asset filenames must not change.** `u64deck` resolves
   `https://github.com/chrisgleissner/sidflow-data/releases/latest/download/<name>` with `<name>`
   hardcoded. New assets may be added; existing ones may not be renamed or removed.

3. **`sidcorr-1` stays wire-compatible.** Do not change `schema_version`, and do not change the shape
   of the `neighbors` table — `u64deck` hard-refuses a `schema_version` it does not recognise. Which
   neighbours are stored, and in what rank order, is data and may change.

4. **Baseline reproduction before any change.** As in the 0.8.0 work: rebuild lite and tiny from the
   published full export using pre-change code and assert the results are byte-identical to the
   published bundles (`fe92bd57…a346cd`, `64bee446…f7c9c6d`). Without this, no later byte difference
   is attributable to anything.

5. **Retrieval quality is a guardrail, not a free variable.** Whatever edge selection you land on,
   composer lift and nDCG@10 from `scripts/station-quality/` must not regress more than 5% relative
   against the 0.8.0 graph. A stream that runs forever through worse matches is not an improvement.

6. **Every claim in the release notes must be re-measured** against the artefacts you actually
   publish, not carried over from this prompt.

---

## 5. The work

### A. Compute a flow order over the corpus

Produce a total order over all 87,868 tracks in which consecutive tracks are similar. Derive it from
the published vectors; it is a pure function of the existing export.

Greedy nearest-unvisited is the demonstrated baseline (mean consecutive similarity 0.9638, §3) and is
what every alternative must beat. Try at least one better construction and report both: Or-opt / 2-opt
refinement of the greedy path, and spectral seriation (Fiedler vector of the k-NN similarity graph)
are the two obvious candidates. The metric to optimise is not mean similarity alone — it is the
combination of mean similarity and the count of low-similarity steps, because the 101 steps below 0.80
are what a listener actually notices.

Two properties are required of whatever you build:

- **Deterministic.** Same input, byte-identical order. The lite build already holds this property
  through a quantile codebook with no RNG; do not introduce one here.
- **Same-file aware.** Consecutive positions must not walk through the subsongs of one `.sid` file.
  The rank-1 same-file rate is 14.42% today, and a flow order that strings subsongs together is the
  eddy this whole document is about, at its smallest scale.

Report the resulting order's mean and percentile consecutive similarity against the greedy baseline.
If nothing beats greedy, ship greedy and say so.

### B. Orient the exported edges by flow rank, and guarantee continuation

Re-orientation alone leaves 10.12% of tracks with no forward edge (§3). Close that by **reserving one
slot per track for the flow successor**: the track that follows it in the flow order. Then a
forward-only walk can always continue, and — because the flow order is a permutation of the corpus —
a walk that falls back on the successor visits all 87,868 tracks without repeating, by construction.

For 89.88% of tracks the successor is already in the exported top-25, so this is usually a re-ranking
rather than an addition. For the remaining 8,888 it is a genuinely new edge, and adding it is exactly
what turns "nearly always continues" into a guarantee. Do not skip it: a guarantee that holds for 90%
of tracks is not a guarantee, and the tracks it fails on are the ones at the sparse end of the order —
precisely where a station is most likely to be stranded already.

The remaining slots carry the highest-similarity forward edges, so the walk still has choices and
different `shuffleSeed` values still produce different journeys. Branching is what makes it a station
rather than a playlist; the successor edge is what stops it dying.

### C. Fix the ranking pathologies in the full profile

These are independent of the flow work and are cheap.

- **No rank-1 two-cycles.** If A's rank-1 neighbour is B, B's rank-1 neighbour must not be A. This
  alone removes all 16,700 attractors and is a pure re-ranking within each seed's existing 25
  candidates — no new edges, no schema change, and directly verifiable.
- **Reciprocity and hubness control.** 47.28% of edges are reciprocated and in-degree reaches 217
  against a mean of 25. Mutual proximity is already implemented in
  `scripts/station-quality/techniques.ts` and was evaluated in the station-quality work; apply it at
  graph-construction time and report the effect on both reciprocity and nDCG@10.
- **An in-degree floor.** 456 tracks (0.52%) have zero in-degree at k=25 and can never be recommended
  by anyone. Either guarantee every track appears in at least one other track's list, or state why
  that is not achievable and how many tracks remain unreachable.

Take the same-file item that 0.8.0 deferred (`doc/station-quality.md` §15, "Neighbour diversification")
with you: while re-selecting edges anyway, decide deliberately what rank-1 same-file should be, rather
than leaving it at 14.42% because nothing touched it.

### D. Decide how the order reaches consumers — this is the open design question

The measurements above do not settle the format question, and there is a real trade-off. Resolve it
explicitly and record the reasoning; do not let it be decided by whichever code was easiest to change.

**For `sidcorr-tiny-1`,** the ordinal-based rule in §10.3 is normative and is the thing that has to
go. Three options:

| Option | What changes | Cost |
|---|---|---|
| **(a) Ship the flow order** — relax §10.3 to "acyclic under the exported flow order", add a flow-rank section, bump `binary_format_version` to 3 | new section, `u24 × 87,868` ≈ 264 KB on a 1.83 MB bundle (**+14%**) | needs a coordinated `c64commander` reader update |
| (b) Relax §10.3 to plain acyclicity and ship no order | binary layout unchanged | a reader can no longer *verify* acyclicity, only trust it |
| (c) Keep §10.3 as it stands | nothing | keeps the 17-track median ceiling; rejected |

**Recommend (a).** It is the only option under which a consumer can check the guarantee instead of
taking it on faith, and 264 KB is a fair price for turning a 17-track ceiling into the whole corpus.
Note that `c64commander`'s parser range-checks ordinals but does **not** enforce §10.3
(`src/lib/sidRadio/sidcorrTiny.ts`), so a bundle built under (b) would parse there today — that is an
argument about blast radius, not an argument that (b) is correct. Shipping data that violates a
normative rule of your own specification is not acceptable; if the rule goes, the spec text goes with
it in the same release.

**For `sidcorr-1`,** the `neighbors` table shape is fixed (constraint 3), so the flow rank needs
somewhere else to live. A new optional table is the obvious candidate, and a new column on `tracks` is
the other. **Both must be verified against `u64deck`'s importer before either is chosen**, because its
`slim_database()` copies specific tables and hard-fails when the neighbour row count disagrees with
the manifest. Adding a second `profile` value to `neighbors` is admissible under the primary key and
is tempting — do not use it until you have confirmed that `u64deck` filters on `profile` rather than
importing every row and then failing its own count check. Read its source; do not infer from
behaviour.

If no addition to `sidcorr-1` survives that review, the honest outcome is that the flow order ships in
tiny and lite only, and the full export gets the §5C ranking fixes alone. Say so plainly rather than
forcing a change that breaks the one consumer of the full export.

### E. Prove it, with the metrics this prompt used

The measurements in §1–§3 are the pre-change baseline. Re-run every one of them against the rebuilt
artefacts and publish the before/after table. Add each as a check in
`scripts/verify-published-exports.ts`, so the next release cannot quietly regress:

| Check | 0.8.0 baseline | Requirement |
|---|---:|---|
| longest forward path from a track (tiny), median | 17 | ≥ 10,000 |
| forward walk visiting the whole corpus exists from every track | no | yes, proven by construction and asserted in a test |
| rank-1 two-cycles (full) | 16,700 | 0 |
| distinct tracks before a rank-1 walk repeats (full), median | 3 | no repeat within the corpus |
| tracks with zero in-degree (tiny) | 24,669 (28.08%) | report; target < 5% |
| tracks with zero in-degree (full, k=25) | 456 (0.52%) | 0, or a stated reason |
| tracks with zero out-degree (tiny) | 2,786 (3.17%) | 0 |
| reciprocated edges (full) | 47.28% | report; state the target and why |
| Song Radio distinct tracks served, median (§1 simulation) | 1,137 (1.294% of corpus) | ≥ 20,000, or the achieved number with an explanation |
| composer lift / nDCG@10 | `scripts/station-quality/` | no regression > 5% relative |
| style populations | 0.8.0 gate | unchanged; the tiny rebuild must not disturb the style-mask section |

The station simulation is the one that speaks for the product, so keep it as a committed script rather
than an ad-hoc measurement. It needs no HVSC and no audio — it reads the tiny bundle and runs the
engine's own traversal.

### F. Consumers

**`c64commander`** (`/home/chris/dev/c64/c64commander`, currently pinned to `0.8.0`,
`sidcorrRelease.ts:26,38`). Delegate this to a subagent running inside that checkout; it has its own
`AGENTS.md` with a task-classification model and a strict screenshot policy, and an agent working from
the `sidflow` checkout will not see it. Branch off `main`.

With a real flow order, the compensations that engine currently needs stop being necessary: the
reverse adjacency, `REVERSE_EDGE_WEIGHT = 2`, and the widening from 3 to 8 hops all exist because
forward edges alone go nowhere. Measure the station length before and after rather than removing them
on principle — they may still earn their place for variety, and the reverse edges are also what let a
station reach tracks that point *at* the seed. What must change is the reader, if option (a) is
chosen, and the re-pin once `sidflow-data` `0.9.0` is published.

**`u64deck`** consumes the full export and prefers the `neighbors` table for "♪ More like this" when
it is non-empty. Re-ranking changes its results. Notify it in writing with the before/after numbers,
and confirm the schema question in §5D against its source before shipping.

---

## 6. Out of scope

Record these as deferred with their justification; do not attempt them here.

| Deferred | Why not now |
|---|---|
| Reclassification of any kind | constraint 1; the classification run is a full corpus pass |
| Changing the 58-dimension vector or the similarity metric | the graph is the defect, not the metric — §3 shows the vectors already support a corpus-spanning stream |
| Deriving categories from the 58-dim vector | the other 0.9.0 item (`doc/station-quality.md` §15); independent of this work |
| Re-encoding the full export (982 MB → ~430 MB) | separate change, separate risk; do not bundle it with a data-semantics change |
| `md5_48` → `md5_64` in tiny | changes the binary layout for an unrelated reason |

---

## 7. Release

This changes shipped data semantics and, under option (a), a binary format version. It is **0.9.0**,
not 0.8.1 — under the 0.y.z convention the ecosystem uses, `^0.8.1` admits 0.8.x but not 0.9.0, so a
patch release would silently pull a changed neighbour graph into consumers pinned to `^0.8`.

Tag `0.9.0` on `main` in `sidflow` and publish `sidflow-data` `0.9.0` under the same name, per the
naming contract established in 0.8.0. Every bundle digest changes; state the new ones. Add
`doc/migration/0.8-to-0.9.md` alongside the existing `0.5-to-0.8.md`, and update
`doc/migration/0.5-to-0.8-u64deck.md` — or add its 0.9 counterpart — with whatever §5D concludes about
the `sidcorr-1` schema. Say in the migration note that a consumer who was working around short
stations with client-side heuristics can now stop.

---

## Definition of done

- [ ] The rank-1 reproduction check from constraint 1 passes, and is committed as a script.
- [ ] Baseline reproduction of the published lite and tiny bundles is byte-exact before any change.
- [ ] A flow order exists, is deterministic, is same-file aware, and its consecutive-similarity
      profile is reported against the greedy baseline (mean 0.9638).
- [ ] Every track's flow successor is an exported edge, and a test proves a forward walk from any
      track visits the whole corpus without repeating.
- [ ] No rank-1 two-cycle survives in the full export.
- [ ] The before/after table in §5E is published in full, including the checks that did not improve.
- [ ] `scripts/verify-published-exports.ts` gates every §5E check and fails against the 0.8.0 assets.
- [ ] The station simulation is a committed script, not an ad-hoc measurement.
- [ ] The format decision in §5D is recorded with its rejected alternatives, and
      `doc/similarity-export-tiny.md` §10.3 matches what the artefact actually contains.
- [ ] `u64deck` has been notified in writing; the `sidcorr-1` schema question was answered from its
      source, not inferred.
- [ ] `c64commander` is on a new branch off `main`, with the reader update if option (a) was chosen,
      the re-pin to `0.9.0`, and station-length measurements before and after.
- [ ] No reclassification was run.

---

## Appendix A — reproducing the measurements

All figures come from the `0.8.0` release assets. Download and verify:

```bash
mkdir -p tmp/neighbour-analysis && cd tmp/neighbour-analysis
gh release download 0.8.0 --repo chrisgleissner/sidflow-data \
  --pattern 'sidcorr-hvsc-full-sidcorr-1.sqlite' \
  --pattern 'sidcorr-hvsc-full-sidcorr-1.manifest.json' \
  --pattern 'sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr' \
  --pattern 'SHA256SUMS'
sha256sum -c SHA256SUMS --ignore-missing
```

**The k=25 graph.** Read `tracks` ordered by the sidcorr-1 key (`sid_path` bytewise, then `song_index`
numeric — not by `track_id`; see the caveat in §3) into a track→ordinal map, then load `neighbors`
where `profile = 'full'` into an `(87868, 25)` array of ordinals plus similarities. Strongly and
weakly connected components come from `scipy.sparse.csgraph.connected_components` on that adjacency,
truncated to the first k columns for the k=1/2/3/5/10 rows. Reciprocity is the fraction of directed
edges `(u,v)` for which `(v,u)` is also present. The rank-1 attractors come from treating column 0 as
a functional graph and finding each walk's cycle. The greedy no-repeat walk steps to the
lowest-ranked unvisited neighbour and stops when all 25 are visited; run it over 3,000 seeds drawn
with `numpy.random.default_rng(20260730)`. The escape fraction is measured at the moment a walk
strands: out-edges of the visited set that point outside it, over all out-edges of the visited set.

**The tiny bundle.** Parse the 64-byte header per `doc/similarity-export-tiny.md` §5.2; with
`binary_format_version` 2, `NEIGHBOR_TABLE` at `neighbors_offset` is `track_count × 3` records of
`{u24 target, u8 similarity}` little-endian, with `0xFFFFFF` as the unused-slot sentinel. Out-degree,
in-degree, sentinel placement and the §10.3 ordinal rule all read directly off that array. Longest
forward path is a single ascending-ordinal dynamic-programming pass, valid because every edge points
to a smaller ordinal.

**The station simulation.** Port `computeStation` from `c64commander/src/lib/sidRadio/stationEngine.ts`
for the `song` seed with no likes, no style filter and no `admit` predicate, keeping
`NEIGHBORS_PER_TRACK = 3`, `REVERSE_EDGE_WEIGHT = 2`, `HOP_DECAY = 0.7`, `MAX_HOPS = 3`,
`EXTENDED_MAX_HOPS = 8`, `SUFFICIENCY_FACTOR = 3` and `FRONTIER_CAP = 256`. Drive it as
`stationQueueProvider` does: same seed every call, exclude set growing by every ordinal consumed,
`limit = REFILL_BATCH = 24`, until a call returns nothing. The weighted permutation in step 5 changes
the order of a batch but not its membership, so it does not affect the count.

**The flow-order feasibility probe.** Load `vector_json` for all tracks, scale each vector by
`sqrt(vector_weights)` from the manifest and L2-normalise; weighted cosine is then a plain dot
product. Confirm the setup by checking that `argmax` over that matrix reproduces the published rank-1
neighbour for a few seeds. The greedy path starts at ordinal 0 and repeatedly takes the
highest-similarity unvisited track; it terminates after 87,867 steps having visited everything.

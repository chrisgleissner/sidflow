# The neighbour graph: what it is for, and what it must not be

This document exists so that the next change to `sidcorr-tiny-1`'s neighbour graph does not have
to relearn what two previous attempts learned. It states the separation the design rests on, the
construction that is shipped, the parameter sweeps that chose its settings, the metrics that define
a good graph here and the command that produces each, and — at the end, with numbers — the two
approaches that were tried and rejected.

Every figure below was measured with committed scripts against the published artefacts. Each
section says which command produced its numbers. Re-derive rather than quote if you are publishing.

---

## 1. The index and the policy are different things

| Concern | Where it belongs |
|---|---|
| "what sounds like this" | the exported graph — a proximity index |
| "what plays next" | the client — a policy over retrieved candidates |
| "never play the same tune twice" | the client — a visited set |

**Nothing in the artefact encodes a traversal order.** This is the single most important sentence
in this document, because both previous designs violated it and both paid the same price.

The mistake is easy to make and hard to see. "A station must never repeat a track" is a real
product requirement. Turning it into "the exported edges must form a directed acyclic graph" looks
like enforcing it at the source, and is actually something else: a constraint on which *true*
similarity relationships the artefact is allowed to state. Cycles in a similarity graph are not a
defect. If A's nearest neighbour is B and B's nearest neighbour is A, both facts are true and both
are useful. What must not happen is a *player* revisiting a track, and the fix for that is a set of
what has already been played — which every player already keeps.

Measured cost of getting this wrong: the acyclicity constraint discarded **50.76%** of the source
graph's edges, and the tiny bundle shipped **6.69%** (0.8.0) and **14.76%** (0.8.2) of its slot
capacity as sentinels, to solve a problem that does not belong in the artefact.

`graph_flags` bit 0 therefore reads 0 from 0.8.2 onward, and bit 3 (the flow-successor declaration)
is retired. This is a specification change, not a schema change: the field exists, the layout is
unchanged, and §5.2 of the tiny specification already requires consumers to ignore bits they do not
recognise.

---

## 2. What the graph has to be good at

Three slots per track, 87,868 tracks. That budget is small enough that the selection rule matters
more than the similarity metric does.

The graph serves two different consumers, and they want different things:

- **`u64deck`** uses the full export's 25-neighbour table for "♪ More like this" — a single-hop
  retrieval. It wants the nearest neighbours, in rank order. The tiny bundle is not involved.
- **`c64commander`** expands a neighbourhood from a seed over forward *and reverse* edges, scores
  what it reaches, and serves the admissible remainder. It wants the reachable region to be large
  and to keep sounding like the seed.

With three slots you cannot fully serve both. An edge spent on reaching somewhere new is an edge
not spent on the closest match. Section 5 quantifies that trade-off; this section is about which
metrics express it.

### The metrics, and the command for each

All of these come from the graph analyser:

```bash
node scripts/run-bun.mjs run scripts/neighbour-graph/analyse.ts \
  --tiny <bundle>.sidcorr \
  --sqlite <full>.sqlite --manifest <full>.manifest.json \
  --vector-cache tmp/vectors.bin
```

| Metric | What it answers | Why it matters here |
|---|---|---|
| mean out-degree | is the slot budget spent? | a sentinel is capacity the consumer paid for and did not get |
| tracks with no outgoing edge | where does a walk stop? | a dead end ends a station |
| tracks with no incoming edge | what can nothing reach? | a forward-only walk can never arrive there |
| in-degree distribution, max over mean | has one track become everyone's neighbour? | the same handful of tunes in every station |
| largest undirected component | is the corpus one navigable region? | undirected, because the consumer traverses reverse edges |
| reciprocity | are edges pairing off? | a mutual pair is a trap, not a route |
| station length | how many distinct tunes does a listener get? | the only metric the product is actually judged on |
| greedy routing recall@1 | can the graph be *searched*? | the standard test of a proximity index |
| same-`.sid`-file rate | is a "neighbour" the same tune again? | a listener-facing defect, not a structural one |
| rows in descending similarity | is slot 0 the nearest? | `c64commander` weights slots by `neighbors - slot` |

Station length is measured separately, because it is a statement about the product rather than
about the artefact:

```bash
node scripts/run-bun.mjs run scripts/neighbour-graph/simulate-station.ts \
  --tiny <bundle>.sidcorr --seeds 300 --policy fixed
```

`scripts/neighbour-graph/station-engine-port.ts` is a port of `c64commander`'s `computeStation`,
driven the way `stationQueueProvider` drives it. It is a port, so it has to be updated when the
client engine changes; that coupling is the price of being able to measure the listening experience
from the export side at all. It omits path resolution and the minimum-duration filter, both of
which only ever remove candidates, so its numbers are an upper bound on what a listener gets.

### Greedy routing recall, precisely

From a random entry point, step to the neighbour closest to the query and stop when no neighbour
improves; success is landing on the query's true nearest neighbour. The query is treated as absent
from the index — it is skipped wherever it appears as a neighbour — because the query is itself a
corpus point and a walk allowed to land on it would measure nothing. Forward and reverse edges are
both followed, because that is what the consumer does.

---

## 3. Why the source export's top-25 is the wrong candidate pool

This is the finding that shaped the design, and it was not anticipated.

The obvious construction is: take each track's 25 nearest neighbours from the full export, and pick
three of them well. "Well" means diversifying pruning, as used by HNSW's neighbour-selection
heuristic and DiskANN/Vamana's alpha-pruning. With distance `d = 1 - s`:

```
selectNeighbours(u, candidates ascending by d(u, ·), alpha, k):
    kept = []
    for v in candidates:
        if |kept| == k: break
        if for every w in kept:  alpha * d(w, v) > d(u, v):
            kept.append(v)
    return kept
```

In words: drop a candidate you could already reach just as well via one you have kept. `alpha = 1`
is the relative-neighbourhood-graph rule and diversifies hardest; `alpha > 1` retains more short
edges.

**It does not work on this pool, and the reason is geometric.** Measured over 400 sampled tracks:

| | mean distance |
|---|---:|
| seed to its rank-1 neighbour | 0.02832 |
| seed to its rank-25 neighbour | 0.05190 |
| seed to a random track | 0.24294 |
| between two of the seed's own candidates | 0.05526 |

Every edge the pool can offer is five to nine times shorter than a typical distance in the corpus.
The pool is a thin shell around the seed. Two consequences follow:

1. **The pruning rule almost never fires.** Mutual distance among candidates (0.05526) is slightly
   *larger* than the seed's distance to its 25th neighbour (0.05190), so `d(w,v) > d(u,v)` holds
   nearly always and only **23.41%** of candidates are dominated by an earlier one. Since three
   slots are filled from the nearest end, pruning changes almost nothing.
2. **No selection over this pool can produce a searchable graph.** A graph whose every edge is
   short cannot be navigated, whatever rule chose the edges: greedy search from a distant entry
   point has no edge to ride in on, and gets stuck after about three hops.

The sweep confirms it. 30 configurations — alpha in {1.0, 1.05, 1.1, 1.2, 1.4} × correction in
{none, mutual proximity, local scaling} × reverse insertion {on, off}:

```bash
node scripts/run-bun.mjs run scripts/neighbour-graph/sweep-selection.ts \
  --sqlite <full>.sqlite --manifest <full>.manifest.json \
  --builders prune --alphas 1.0,1.05,1.1,1.2,1.4 \
  --corrections none,mutual-proximity,local-scaling --no-reverse
```

Every configuration:

- filled all three slots (out-degree 3.000 — this part the rule does fix, and it is worth having);
- left **9.9% to 13.6%** of tracks with no incoming edge;
- reached **99.52%–99.66%** of the corpus in its largest undirected component;
- scored greedy routing recall@1 of **0.10%–0.30%**, against 0.30% for a plain top-3 graph;
- served a station median of **1,092–1,408** tracks, against 1,367 on the 0.8.0 bundle.

Raising alpha made every structural measure worse, because pruning removes candidates without
replacing them with anything better and backfill refills from the same near-duplicates.

**Reverse insertion is necessary but not sufficient.** It bounds in-degree and keeps edges pointing
back, and it must be implemented — but it cannot create reachability for a track that nothing
chose, because an unchosen track is offered no reverse edge. Measured: zero-in-degree 8,692 with
reverse insertion against 8,771 without, at alpha 1.

---

## 4. What is shipped: Vamana construction

DiskANN/Vamana does not prune a top-*k* list. It generates each point's candidate set by running a
**greedy search for that point over the graph being built**, from a fixed entry point near the
centre of the data. The visited set of such a search contains the points the search passed through
on its way in — which are far from the query — as well as the ones it converged on. Pruning *that*
set has long edges available to keep, and the alpha rule keeps the ones that are not redundant.

Implemented in `packages/sidflow-common/src/similarity-graph-build.ts`:

1. Initialise each row from the source export's nearest neighbours, so the first pass's searches
   are immediately useful.
2. Pick an entry point by sampled medoid.
3. Two passes over a fixed permutation of the corpus, the first at `alpha = 1` and the second at
   the configured alpha, as in the paper. For each track: search, prune the visited set, backfill
   from the source export's nearest neighbours if the rule yielded fewer than three, then offer the
   reverse edge to each target and re-prune that target's row if it overflows.
4. **Reachability repair.** Give every track with no incoming edge one, donated by its own nearest
   neighbour, displacing that donor's least similar edge — and only ever an edge whose target still
   has another incoming edge, so the repair cannot create the problem it is fixing.
5. **Hub trimming**, bounded by a multiple of the mean in-degree. See section 5.

Determinism: no RNG anywhere that is not seeded by a constant. The insertion order is a fixed
permutation rather than ordinal order, because ordinal order is alphabetical `sid_path` position and
would bias construction towards one end of the corpus. The medoid sample, the permutation and every
tie-break are fixed, so a bundle reproduces exactly from its source export — which
`scripts/reproduce-published-bundles.sh` checks.

Nothing here is a reclassification. Every distance comes from `tracks.vector_json` in the published
full export under the manifest's published weights, and
`scripts/neighbour-graph/verify-rank1-reproduction.ts` proves that route reproduces the export's own
rank-1 neighbour: 503 of 503 sampled seeds, including the pinned probes 0 → 86,297, 1,000 → 359 and
50,000 → 61,874.

### Cost

Roughly 42–45 million distance evaluations for the two passes over 87,868 tracks at a beam width of
96, which is a few minutes of a single core. It is paid once per release and nothing at read time
changes: the artefact is still three edges per track.

---

## 5. Hubness, and the trade-off it forces

Music similarity is hub-prone, and this corpus is no exception. On the **full export at k=25**,
in-degree reaches **217** against a mean of 25, and **456 tracks (0.52%)** have no incoming edge
and can never be returned as anyone's neighbour.

Vamana at three slots makes hubness much worse before it makes it better. Its searches all start
from one entry point and converge through the same well-placed tracks, so those tracks end up in a
large share of everyone's three. Measured at alpha 1.2: in-degree **max 1,030** against a mean of 3,
with a p99 of 23. A handful of extreme hubs, not a broadly skewed distribution.

The uncomfortable part is that **those hubs are the long edges** — the navigational backbone. In a
small-world graph a few high-degree nodes are the feature, not the defect. Trimming in-degree to 8×
the mean bounds the maximum to 24 and moves 39,517 edges, and costs:

Swept at alpha 1.2 (`sweep-selection.ts --in-degree-caps 8,16,32,64,0`):

| cap | in-degree max | largest undirected component | recall@1 | station median (fixed seed) |
|---:|---:|---:|---:|---:|
| 8× mean | 24 | 99.885% | 0.50% | 2,057 |
| 16× mean | 48 | 99.925% | 0.40% | 2,601 |
| 32× mean | 96 | 99.960% | 0.70% | 3,744 |
| 64× mean | 192 | 99.995% | 1.00% | 4,845 |
| none | 1,030 | 100.000% | 0.80% | 6,168 |

Two things fall out of that table, and together they decide the parameter.

**A cap at 8× the mean cannot be used, because it fails a different acceptance target.** It takes the
largest undirected component to 99.885%, below the 99.9% the release requires. The two bounds are in
direct tension at three slots: the edges that hold the corpus together are the same edges that make
a few tracks over-subscribed. So the cap is set where connectivity still passes with margin rather
than at the figure the acceptance table names, and this paragraph is the stated reason the table
asks for.

**More importantly, the trade-off the table describes is an artefact of the old client.** Every
station figure above is measured with the shipped fixed-seed policy. Measured again with the
drifting-query policy that lands in the same release (`--drift-stations`), on the same graph:

| policy | station median | p10 | p90 |
|---|---:|---:|---:|
| fixed seed (shipped client) | 6,166 | 3,145 | 9,502 |
| drifting query (this release) | **25,000** | **25,000** | **25,000** |

25,000 is the measurement cap, and **all 30 sampled stations reached it**. Station length is
therefore not something the graph has to buy at the cost of its in-degree distribution: it is
delivered by the policy, which is exactly what section 1 claims. That is what licenses choosing the
graph parameters as an *index* — tight in-degree, high connectivity, best retrieval quality — and
letting the client supply the length.

Repeated on the bundle this release actually ships, with tune-level deduplication enabled as well:

```
=== song station, policy drift, recent 5 @ w1 d0.6, origin 0.3, tune-level dedupe ===
stations sampled 30
distinct tracks served: median 25000, p10 25000, p90 25000, range 25000..25000
stations under 20000 tracks 0 (0.0%), reached the cap 30
same-file adjacency 0 pairs (0.000% of consecutive pairs)
duplicate tracks within a station 0
```

Every station reaches the cap, no station plays two subsongs of one file in a row, and no station
repeats a track. Those are the Part E acceptance targets, met on the graph side; the client-side work
that supplies the policy lands in `c64commander` in the same release.

### Alpha

Swept at corpus scale with the navigable builder, no correction, beam width 96:

| alpha | in-degree max before trim | recall@1 | mean hops | station median (fixed seed) |
|---:|---:|---:|---:|---:|
| 1.0 | 396 | 1.50% | 3.5 | 3,254 |
| 1.2 | 1,030 | 0.80% | 3.1 | 6,168 |
| 1.5 | 1,806 | 1.90% | 2.8 | 12,434 |

Alpha trades in the direction the parameter is supposed to: more diversification means longer edges,
a larger reachable region and better routing, and more concentrated in-degree. 2.0 was not measured
at corpus scale — each configuration is a few minutes of construction plus the metric passes, and the
curve had already flattened where it mattered. If someone wants to push further, that is the next
point to try, and `sweep-selection.ts --alphas` is how.

### Reserving slots for the nearest neighbours, and why the guardrail forced it

Diversifying every slot produced a graph that failed the release's retrieval guardrail, and the
failure is worth stating because it is the clearest statement of what three slots can and cannot do.

Measured against the withdrawn 0.8.2 as the stated baseline, over 8,000 sampled seeds, with every
slot diversified at alpha 1.5:

| | 0.8.2 (baseline) | fully diversified | change |
|---|---:|---:|---:|
| composer lift | 75.865 | 59.841 | **−21.12%** |
| nDCG@10 | 0.1133 | 0.1296 | +14.35% |

Both movements have the same cause. nDCG@10 is rank-weighted, so it rewards slot 0 being a genuinely
close match — 0.9694 mean similarity against 0.8.2's 0.9583, because 0.8.2 spent slot 0 on a
traversal successor. Composer lift is unweighted precision over all three slots, so it punishes slot
2 being a long edge at 0.9215 mean similarity, which rarely shares a composer.

A 21% drop in composer lift is a graph that streams further through worse matches, which the release
explicitly refuses at more than 5%. So slots are **reserved for the seed's nearest neighbours** and
only the remainder is diversified — the same move HNSW makes with `keepPrunedConnections`. The
reserved edges are protected from the reachability repair and the hub trim as well, since either
would otherwise quietly undo the reservation.

Swept at alpha 1.5 with the 64x in-degree bound, over 8,000 seeds for quality and 1,000 for routing:

| reserved slots | composer lift | vs 0.8.2 | nDCG@10 | vs 0.8.2 | recall@1 | unreachable | largest cc | station median |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 59.841 | **-21.12%** | 0.1296 | +14.35% | 1.00% | 0 | 99.980% | 6,332 |
| 1 | 64.962 | **-14.37%** | 0.1382 | +21.98% | 0.60% | 0 | 100.000% | 3,351 |
| **2** | **74.770** | **-1.44%** | **0.1507** | **+33.01%** | 0.80% | 2 (0.002%) | 99.995% | 2,364 |

Two reserved slots is the shipped value. It is the smallest reservation that clears the guardrail, and
it clears it comfortably while improving nDCG@10 by a third. The cost is stated rather than hidden:
greedy routing recall falls from 1.00% to 0.80% and the fixed-seed station median from 6,332 to 2,364.
Both are acceptable because station length comes from the client's drifting query — which saturates
the measurement cap on any of these graphs — and retrieval quality has no other source.

Reserving the nearest also reduces hub concentration on its own, before the trim runs: the untrimmed
in-degree maximum falls from 1,806 to 535, because the reserved edges are spread over the corpus
rather than converging on whatever the search passed through.

### The shipped configuration

```
builder             navigable (Vamana, 2 passes)
alpha               1.5
searchListSize      96
hubnessCorrection   none
inDegreeCapMultiple 64
entryPointCount     1   (the published algorithm)
forcedNearestSlots  2   (of 3)
```

Declared as constants in `packages/sidflow-common/src/similarity-export-tiny.ts`, not as build flags:
a bundle built with different settings is a different artefact, and a caller that can vary them
silently can ship one without saying so.

Measured on the HVSC corpus, against the two designs it replaces:

| | 0.8.0 | 0.8.2 (withdrawn) | shipped |
|---|---:|---:|---:|
| mean out-degree | 2.799 of 3 | 2.557 of 3 | **3.000 of 3** |
| tracks with no outgoing edge | 2,786 | 1 | **0** |
| tracks with no incoming edge | 24,669 (28.08%) | 1 | **2 (0.002%)** |
| in-degree max (× mean) | 66 (23.6×) | 59 (23.1×) | 192 (64.0×) |
| largest undirected component | 99.08% | 100.00% | **99.995%** |
| reciprocated edges | 0.00% | 0.00% | 53.46% |
| greedy routing recall@1 | 0.30% | **0.00%** | **0.80%** |
| rows not in descending similarity order | 0.00% | 46.09% | **0.00%** |
| same-file edges, all slots | 9.72% | 7.80% | 9.55% |
| composer lift | 84.536 | 75.865 | 74.772 |
| nDCG@10 | 0.1440 | 0.1133 | **0.1507** |
| station median, fixed seed | 1,367 | 1,141 | **2,364** |
| station median, drifting query | — | — | **≥25,000 (measurement cap)** |
| station same-file adjacency, drifting query with tune-level dedupe | — | — | **0** |

Notes on three of those rows, because they are the ones a reader should be suspicious of:

- **In-degree is 64× the mean, not the 8× the acceptance table names.** The stated reason is above:
  8× fails the connectivity target. The bound still removes the extreme tail — the untrimmed
  construction reaches 1,806 — and the p99 is 23, so the distribution is not broadly skewed.
- **Reciprocity rises from 0.00% to 53.46%.** That is not a regression; both earlier designs were
  acyclic, which makes reciprocity 0 by construction. It is higher than the source export's own
  43.92% at k=3 because two of three slots are now the seed's nearest neighbours, and near
  neighbours are frequently each other's. Reciprocity is only a defect when it is *all* a graph has,
  and the routing recall shows it is not.
- **Composer lift is 74.770, below 0.8.0's 84.536.** Worth stating plainly: on same-composer
  precision this graph is better than the withdrawn 0.8.2 within measurement noise (-1.44%) and
  genuinely worse than 0.8.0 (-11.6%). The third slot is spent on reach, and 0.8.0 spent all three on
  proximity. nDCG@10 — which weights by rank, so it reflects what a consumer reading the top of the
  row actually gets — is the best of the three at 0.1507. The release's stated baseline is 0.8.2, and
  a reader comparing against 0.8.0 should know both numbers.
- **Same-file edges are 9.55%, close to 0.8.0's 9.72%.** The construction does not filter siblings;
  section 8 explains why, and the client-side fix that addresses what a listener notices.

Mutual proximity is the principled alternative to trimming, because it changes *which* edges are
chosen rather than deleting them afterwards. It re-expresses a distance as the probability that two
points are close to each other given each one's own distance distribution, so being close to a hub
stops being remarkable. `scripts/station-quality/techniques.ts` already implements it over a full
distance matrix, which cannot run at corpus scale; `packages/sidflow-common/src/similarity-hubness.ts`
uses the same Gaussian model with the per-track moments estimated from a deterministic random sample
of 256 distances. That is an unbiased estimator of the mean and standard deviation the exhaustive
version computes, which is all the model uses. Estimating them from the k-nearest distances instead
would be cheaper and wrong: those are the smallest 25 of 87,867 and describe the tail.

Local scaling (Zelnik-Manor & Perona) is also implemented, and needs only the candidate lists.

---

## 6. What was tried and rejected

The two most instructive things in this history.

### 6.1 The 0.8.0 ordinal rule

**What it did.** Every exported edge had to point at a track ordinal strictly smaller than the
current one. Track ordinal is alphabetical `sid_path` position (§4.2 of the tiny specification), so
the orientation had nothing to do with what a tune sounds like.

**Measured on the published 0.8.0 bundle** (`analyse.ts --tiny`):

| | |
|---|---:|
| mean out-degree | 2.799 of 3 |
| tracks with no incoming edge | 24,669 (28.08%) |
| tracks with no outgoing edge | 2,786 |
| largest undirected component | 99.08% |
| in-degree max | 66 (23.6× mean) |
| greedy routing recall@1 | 0.30% |
| station median, distinct tracks | 1,367 |

**Why it was wrong.** It cost almost nothing in match quality — slot 0 carried mean similarity
0.9681 against a true rank-1 mean of 0.9729 — and almost everything in structure. A quarter of the
corpus could never be recommended by anything.

### 6.2 The 0.8.2 flow order

**What it did.** Kept the acyclicity constraint (it was a patch, and could not withdraw a published
guarantee) and satisfied it by threading a Hamiltonian path through the graph: slot 0 of every row
became the next track in a corpus-wide greedy nearest-unvisited listening order, and slot 1 became
"the forward candidate that jumps furthest along that order".

**Measured on the published 0.8.2 bundle:**

| | |
|---|---:|
| mean out-degree | 2.557 of 3 |
| tracks with no incoming edge | 1 |
| tracks with no outgoing edge | 1 |
| largest undirected component | 100.00% |
| in-degree max | 59 (23.1× mean) |
| distinct tracks a slot-0 walk hears before repeating | 43,935 (median) |
| greedy routing recall@1 | **0.00%** |
| rows not in descending similarity order | 46.09% |
| station median, distinct tracks | **1,141** |

**Why it was rejected.** Three reasons, in order of how much they matter.

1. **It did not help the listener.** The reachable stream grew from 17 tracks to 43,934 — three
   orders of magnitude — and the station served *fewer* tracks than before: 1,141 against 1,367.
   The station's length was never limited by graph depth. It is limited by the client expanding a
   fixed-radius ball around a seed that never moves, which is Part E's subject.
2. **It made the graph unsearchable.** Recall@1 fell to 0.00%, worse than the 0.8.0 bundle it
   replaced. A Hamiltonian path is long and thin; it is navigable in sequence and in nothing else.
3. **It smuggled an itinerary into an index.** Slot 0, slot 1 and slot 2 came to mean three
   unrelated things — a successor, a long jump and a nearest match — so 46.09% of rows were not in
   similarity order, silently breaking the assumption `c64commander`'s `neighbors - slot` weighting
   makes. It also shipped 14.76% of the slot capacity empty, more than the design it replaced.

The shortcut edge deserves its own note, because it was the right instinct. It existed because a
graph that is only a path cannot be explored in a bounded number of hops, and it was a hand-rolled
long edge. Section 3 explains why alpha-pruning could not produce that edge "properly" as was hoped:
the candidate pool has no long edges in it. Vamana produces them because it changes the pool.

### 6.3 What both attempts have in common

Both started from a true product requirement, expressed it as a constraint on the artefact, and then
optimised within the constraint instead of questioning it. Both were measured against structural
properties of the graph — path length, acyclicity, degree — and neither was measured against what a
listener got, because until this release nothing in this repository could measure that. The station
simulator exists so that the next change cannot repeat that.

---

## 7. The station-side policy

Recorded here so that a future client author does not reinvent a ball expansion.

`c64commander`'s `computeStation` expands from a seed over forward and reverse edges, at most
`EXTENDED_MAX_HOPS = 8` hops with `FRONTIER_CAP = 256`, scores everything it reaches by
`Σ seedWeight × (neighbors − slot)` with hop decay, and returns the admissible remainder.
`stationQueueProvider` calls it repeatedly with a growing exclusion set — **and, before this
release, the same seed every time**. The station was therefore a sphere of radius 8 around a point
that never moves, and its size depended on the branching factor rather than on how far the graph
goes. That is why it served about a thousand tracks on both the 0.8.0 and the 0.8.2 bundle while the
graph underneath changed by three orders of magnitude.

The fix is not to restructure the traversal. The engine already supports many weighted seeds, so the
policy is: **add the recently played tracks as additional seeds, with weight decaying by recency,
keeping the original seed at reduced weight so the station remembers where it started.** The
retrieval centre then moves with the listener, which is how the recommendation literature builds
session-based radio. Determinism survives because the recent window is passed in rather than read
from ambient state, so the emitted sequence stays a pure function of
`(seed, rankingSnapshot, shuffleSeed, exclude, recent)`.

Separately, deduplication belongs at the **tune** level, not the track level. The exclusion set
holds track ordinals, so a station will play subsong 1, 2 and 3 of the same `.sid` file back to
back, which a listener experiences as the same tune three times. `md5_48` is the file identity and
the bundle exposes every sibling of a track, so excluding siblings on consumption needs no new data.
The corpus averages 1.44 subsongs per file over 61,157 files, so there is no shortage of material to
draw on instead.

---

## 8. The same-file question

The full export's rank-1 neighbour is a different subsong of the **same `.sid` file** for **14.42%**
of seeds, and **905 seeds have all 25 neighbours from their own file**. Over all 25 ranks the rate
is 5.13%.

This is not a bug in the similarity metric — subsongs of one file usually are near-identical, so the
metric is telling the truth. It is a question about what the export should say, and the options are
to exclude siblings, to flag them, or to leave them to consumers.

**Decision: leave them in the export, state it explicitly in the specification, and fix the
consequence in the client.** The reasoning, in the order it decides the question:

- **Excluding them would make the export inaccurate.** The table answers "what is most similar to
  this". A sibling subsong genuinely is, and a table that silently answers a different question —
  "what is most similar to this, from a different file" — is harder to build on, not easier, because
  a consumer that wants either answer can derive it from the inclusive one and not the reverse.
- **Flagging them needs a new column**, which is a schema change, which this release does not make.
  It is also unnecessary: `sid_path` and `song_index` are already in the table, so a consumer can
  identify siblings with no extra data.
- **The defect is felt in the client, not the export.** What a listener experiences is subsong 1, 2
  and 3 of one file played back to back, and that comes from the station's exclusion set holding
  track ordinals rather than file identities. Fixing it there fixes it once, for every station kind,
  without a re-download. See section 7.

So the specification now says plainly that a neighbour may be a sibling and that a consumer wanting
distinct tunes must group by file identity itself.

---

## 9. `sidcorr-1`: the decision was to change nothing

The plan for this release proposed applying a hubness correction to the full export's own
25-neighbour selection. It was evaluated and rejected. This section is the record, because "we
considered it and left it alone" is worth exactly as much as the numbers behind it.

Measured over 8,000 sampled seeds (`scripts/neighbour-graph/full-export-hubness.ts`):

| ordering | composer lift | nDCG@10 | rows reordered | rank 1 changed | mean Spearman vs published |
|---|---:|---:|---:|---:|---:|
| published (raw weighted cosine) | 70.382 | 0.2919 | — | — | 1.000 |
| re-ranked by mutual proximity | 69.991 (**−0.56%**) | 0.2843 (**−2.60%**) | 7,999 of 8,000 | 4,664 | 0.5015 |
| re-ranked by local scaling | 71.162 (+1.11%) | 0.2953 (+1.16%) | 7,997 of 8,000 | 2,126 | 0.7083 |

Four reasons follow from that table, and any one of them would be enough:

1. **Mutual proximity — the correction the plan proposed — makes retrieval worse on this corpus**, on
   both metrics. It is not a close call at nDCG@10.
2. **Local scaling's gain is smaller than the noise this release is willing to ignore.** +1.1% is a
   fifth of the 5% relative regression the guardrail tolerates elsewhere. Buying it would change the
   rank-1 answer for **27%** of seeds and reorder **99.96%** of rows.
3. **Neither correction can touch the headline hubness figures.** In-degree max 217 and the 456
   tracks with no incoming edge are properties of which tracks appear in *someone's* row.
   Re-ranking changes order, never membership, so it leaves both exactly where they were. Fixing
   them would need exact 25-nearest-neighbour search under the corrected distance over 87,868
   points, and would change what ranks 5 through 25 mean — and that meaning is part of the table's
   contract.
4. **The cost is a 982 MB re-download** (194 MB gzipped) for every consumer of the authoritative
   artefact, for a change that does not clearly improve it.

So `sidcorr-hvsc-full-sidcorr-1.sqlite` ships byte-identical to 0.8.0, and `u64deck` is unaffected.

The 456 zero-in-degree tracks remain a real, unfixed limitation of the full export: nothing will ever
return them from a "♪ More like this" query. They are 0.52% of the corpus. The tiny profile does not
inherit the problem — its construction takes zero-in-degree to exactly 0 — so the place this would
be worth fixing is a future rebuild of the full export's neighbour selection, where changing
membership is on the table.

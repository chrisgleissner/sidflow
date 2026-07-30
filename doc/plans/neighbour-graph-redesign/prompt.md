# Implementation prompt — make the neighbour graph an index and the station a policy

The goal is a listening experience: a station that runs for hours, never plays the same tune
twice, and keeps sounding like the thing you asked for. 0.8.2 removed the defect that made
that impossible in the data. It did not make it happen, and it introduced a structure that
works around the problem rather than solving it. This is the deliberate version.

> **Where to work.** `sidflow` lives at `/home/chris/dev/c64/sidflow` (`/home/chris/dev` is a
> symlink to `/mnt/data/dev`). Branch off `main`; this prompt was written on
> `feat/neighbour-graph-redesign`, based on `830644e` (the 0.8.2 merge). Part E is a separate
> repository with its own checkout, its own `AGENTS.md` and its own branch — see that section.

> **Every number in this document was measured** against the `sidflow-data` 0.8.0 and 0.8.2
> release assets, verified against their `SHA256SUMS`. Appendix A says how to reproduce each
> one. Re-derive anything you intend to publish; do not carry figures over from here.

---

## 0. First: unpublish 0.8.2, and ship this work under that number

NOTE: Contrary to what is written in the remainder of chapter 0, I have already deleted all tags and releases related to 0.8.2 across sidflow and sidflow-data. I have also, possibly prematurely, deleted the migration guide from 0.8.0 to 0.8.2. You will need to restore the latter
and amend it as needed. NOTE END.

**0.8.2 is being withdrawn, not superseded.** It shipped one definition of what a tiny
neighbour edge means; this work ships a different one. Publishing both would ask every
consumer to absorb two incompatible redefinitions of the same field within days of each other,
for no benefit — the first definition is one nobody has built against yet.

So the released `0.8.2` is deleted now, and the number is reused for the finished design. A
consumer's history then reads 0.8.0 → 0.8.2, with a single change in what the edges mean.

### 0.1 Delete the releases and tags

Do this **before** any implementation work, so the exposure window is as short as possible.

```bash
gh release delete 0.8.2 --repo chrisgleissner/sidflow-data --cleanup-tag --yes
gh release delete 0.8.2 --repo chrisgleissner/sidflow      --cleanup-tag --yes
git tag -d 0.8.2
git fetch --prune --prune-tags origin
```

**Then verify what a consumer sees**, because this is the part that can go wrong quietly:

- `gh release list --repo chrisgleissner/sidflow-data` shows 0.8.0 as `Latest` again.
- `curl -sIL https://github.com/chrisgleissner/sidflow-data/releases/latest/download/sidcorr-hvsc-full-sidcorr-1.manifest.json`
  returns `200`. This is the URL shape `u64deck` hardcodes; if it 404s, nothing else matters.
- `c64commander` is pinned to the **0.8.0** tag and digest and was never re-pinned, so it is
  unaffected. Confirm that rather than assuming it.

`u64deck` is unaffected either way: the full export, its `.gz`, the features sidecar and the
lite bundle are byte-identical in 0.8.0 and 0.8.2, so `latest` reverting to 0.8.0 serves it the
same bytes it already had.

### 0.2 Do **not** revert the 0.8.2 commit

Deleting the release does not delete the work, and most of that work stays. `9840c20` (merged
as `830644e`) also carried:

- the release gate's graph checks and the measurement approach behind them;
- the fix that stopped `lite` and `tiny` stamping the building machine's HVSC version over
  the source export's own;
- `similarity-export-tiny-populations.test.ts`, which could not run at all on the pinned Bun;
- two station-equivalence assertions that divided by the requested station size rather than by
  what the profile returned;
- `release-prepare.ts` no longer throwing on a stray directory under `packages/`;
- the `packages/*/data/audit/` gitignore entry.

Only the **neighbour selection** is being replaced. `git revert` would take the rest with it.
Let this work delete the flow order as part of Part A instead, which is what the Definition of
Done already requires.

`main` therefore carries an unreleased design for the duration of this work. That is ordinary
unshipped work in progress; it is not a released artefact and nothing consumes it.

### 0.3 Rewrite the 0.8.2 record rather than appending to it

Because the number is being reused, two documents currently describe a design that will never
ship and must be **rewritten wholesale**, not amended:

- the `## 0.8.2` entry in `CHANGES.md` — replace its body entirely;
- `doc/migration/0.8.0-to-0.8.2.md` — rewrite for the final design. Its digest table, its
  "what each consumer needs to do" section and its `graph_flags` note are all specific to the
  flow order.

The package versions already read `0.8.2` across the workspace, so no bump is needed; leave
them.

### 0.4 Retag only when the whole thing is done

Tag `0.8.2` on `main` and publish both releases **once every item in the Definition of Done is
satisfied**, including Part E's client work landing in `c64commander`. The point of withdrawing
the first 0.8.2 is to present consumers with one coherent change; retagging early and patching
afterwards reproduces exactly the problem this section exists to avoid.

The `sidflow-data` release must again carry the **complete** asset set — the full export, its
`.gz`, the features sidecar and their manifests are unchanged and must be re-uploaded so
`releases/latest/download/<name>` keeps resolving. Their digests are the evidence that nothing
outside the tiny bundle moved; publish them in the notes as 0.8.2 did.

> **PR #100 and its description stay as they are.** They are an accurate record of what was
> tried and why it was replaced, and `doc/plans/neighbour-graph-flow/prompt.md` is the
> reasoning that produced it. History is not the thing being cleaned up here; the published
> contract is.

---

## 1. Where things stand

0.8.2 fixed a real defect. `sidcorr-tiny-1` oriented its edges by track ordinal —
alphabetical `sid_path` position — which made the exported graph acyclic and useless for
playing:

| | 0.8.0 | 0.8.2 |
|---|---:|---:|
| longest forward path from the median track | 17 | 43,934 |
| tracks nothing could ever recommend | 24,669 (28.08%) | 1 |
| tracks with no outgoing edge | 2,786 (3.17%) | 1 |
| mean out-degree | 2.799 of 3 | 2.557 of 3 |

But look at what a listener got out of it. `c64commander` is the only shipping consumer of the
tiny profile, and its station length barely moved:

| | 0.8.0 | 0.8.2 |
|---|---:|---:|
| distinct tracks served, median | 1,137 | 1,042 |
| distinct tracks served, p10 | 654 | 701 |
| distinct tracks served, p90 | 1,755 | 1,446 |
| stations ending within 500 tracks | 5.3% | 4.0% |

**The data can now carry a 43,934-track stream and the product serves about a thousand
tracks.** That gap is the subject of this work.

### The mistake worth naming

`sidcorr-tiny-1` encoded a **playback policy** — "never repeat a track" — as a **data
structure constraint** — "the exported edges must form a directed acyclic graph". Those are
different concerns and fusing them caused everything else.

Cycles in a similarity graph are not a defect. If A's nearest neighbour is B and B's is A,
that is true and useful. What must not happen is a *player* revisiting a track, and the fix
for that is a set of what has already been played — which every player already keeps.
Enforcing acyclicity in the artefact discarded 50.76% of the source graph's edges to solve a
problem that does not belong in the artefact.

0.8.2 kept that constraint (it had to; it was a patch) and satisfied it by threading a
Hamiltonian path through the graph: slot 0 of every row became the next track in a
corpus-wide listening order. That works, and it is an itinerary smuggled into an index. It is
why slot 0, slot 1 and slot 2 currently mean three unrelated things, and why a consumer that
explores a neighbourhood instead of walking a line gets *less* out of the graph than before.

---

## 2. The structure to build instead

### 2.1 Separate the index from the policy

| Concern | Where it belongs |
|---|---|
| "what sounds like this" | the exported graph — a proximity index |
| "what plays next" | the client — a policy over retrieved candidates |
| "never play the same tune twice" | the client — a visited set |

Nothing in the artefact should encode a traversal order.

### 2.2 Prune for navigability, not for raw rank

Keeping the *k* most similar neighbours is the wrong selection when *k* is small. All three
slots land inside one tight cluster — three near-duplicates that mostly point back at each
other — so the graph has high reciprocity, a large diameter and poor coverage. Measured on
the published full export: **47.28%** of directed edges are reciprocated, and following rank 1
repeatedly lands in a two-track cycle after a median of **3 distinct tracks** (all 16,700
attractors in that functional graph have length exactly 2).

The established fix is diversifying pruning, as used by HNSW's neighbour-selection heuristic
and DiskANN/Vamana's α-pruning. With distance `d = 1 − s` for weighted cosine `s`:

```
selectNeighbours(u, candidates ascending by d(u, ·), alpha, k):
    kept = []
    for v in candidates:
        if |kept| == k: break
        if for every w in kept:  alpha * d(w, v) > d(u, v):
            kept.append(v)
    return kept
```

In words: **drop a candidate you could already reach just as well via one you have kept.**
`alpha = 1` is the relative-neighbourhood-graph rule and diversifies hardest; `alpha > 1`
retains more short edges and raises degree pressure. At `k = 3` you want `alpha` close to 1.
Sweep it and report the curve rather than picking a value.

Two details that matter and are easy to omit:

- **Backfill.** If pruning yields fewer than *k*, fill the remaining slots from the unpruned
  candidates in similarity order. Never ship a sentinel where a real edge was available.
- **Reverse insertion.** After selecting *u*'s edges, offer the reverse edge to each target
  and re-prune that target's list if it overflows. This is Vamana's second pass and it is what
  bounds in-degree and removes unreachable tracks. Without it the 0.8.0 outcome — a quarter of
  the corpus with no incoming edge — can recur under a different cause.

The 0.8.2 shortcut edge (slot 1, "the forward candidate that jumps furthest along the flow
order") was a hand-rolled approximation of the long edge α-pruning produces properly. Delete
it; do not port it.

### 2.3 Correct for hubness

Music similarity is hub-prone: a few tracks become everyone's neighbour and dominate every
retrieval. Measured on the published full export at k=25, in-degree reaches **217** against a
mean of 25, and **456 tracks (0.52%)** have zero in-degree and can never be recommended by
anything.

Mutual proximity is already implemented in `scripts/station-quality/techniques.ts` and was
evaluated during the station-quality work. Apply it at graph-construction time and report its
effect on both the degree distribution and retrieval quality. Local scaling is the obvious
alternative if mutual proximity underperforms; measure, do not assume.

### 2.4 Withdraw the acyclicity guarantee

`graph_flags` bit 0 currently declares the exported edges acyclic, and the tiny specification
says it is "always 1". Under this design it becomes 0, and bit 3 (the flow-successor
declaration added in 0.8.2) is retired.

This is a specification change, not a schema change — the field exists, the layout is
unchanged, and §5.2 already requires consumers to ignore bits they do not recognise. Say so
plainly in the spec and in the release notes: the artefact no longer promises acyclicity, and
the reason is that the promise was never the artefact's to make.

---

## 3. Hard constraints

1. **No schema changes.** Concretely:
   - `sidcorr-1`: `schema_version` unchanged; the `tracks` and `neighbors` table shapes
     unchanged; no new tables and no new columns.
   - `sidcorr-lite-1`: unchanged in every respect. It carries no neighbour graph and is not
     in scope.
   - `sidcorr-tiny-1`: `binary_format_version` stays `2`; the header layout, section order and
     every section's encoding unchanged. Only edge **values**, their order within a row, and
     `graph_flags` bits change.

   If you find a change that cannot be expressed this way and that you believe is necessary,
   stop and write down what it is and what it would cost, rather than working around it. The
   0.8.2 flow order is what working around it looks like.

2. **No reclassification.** Everything derives from the published 0.8.2 assets. The rank-1
   reproduction check in Appendix A proves that is possible; run it first.

3. **Asset filenames must not change.** `u64deck` resolves
   `releases/latest/download/<name>` with `<name>` hardcoded. New assets may be added.

4. **Baseline reproduction before any change.** Rebuild lite and tiny from the published full
   export with pre-change code and assert byte-identity with 0.8.2
   (`fe92bd57…a346cd`, `62097331…c62d294`). Without it, no later byte difference is
   attributable.

5. **Retrieval quality is a guardrail.** Composer lift and nDCG@10 from
   `scripts/station-quality/` must not regress by more than 5% relative against 0.8.2. A graph
   that streams forever through worse matches is not an improvement.

6. **Every published claim must be re-measured** against the artefacts you actually ship.

---

## 4. Part A — `sidcorr-tiny-1`: a pruned, navigable 3-edge graph

Replace the flow-order selection in `packages/sidflow-common/src/similarity-flow-order.ts`
with the selection in §2.2. Delete the flow order itself; nothing else uses it.

The builder already reads the whole 25-neighbour candidate list per track from the source
export (`buildNeighborCandidatesFromSqliteHint`), which is the input the pruning rule needs.
The three fallback paths for corpora built without a SQLite hint must use the same selection,
so there is exactly one implementation.

**Row order within a slot triple** goes back to descending similarity. Slot 0 becomes the
nearest kept neighbour again, which is what a consumer reading a neighbour table expects and
what `c64commander`'s rank weighting (`neighbors - slot`) assumes.

**Acceptance**

| Check | 0.8.0 | 0.8.2 | Target |
|---|---:|---:|---|
| tracks with no incoming edge | 24,669 | 1 | ≤ 0.1% of corpus |
| tracks with no outgoing edge | 2,786 | 1 | 0 |
| mean out-degree | 2.799 | 2.557 | 3.000 |
| reciprocated edges | 43.92% (k=3) | report | report, and state the target |
| in-degree max | 66 | report | ≤ 8× mean, or a stated reason |
| undirected connected component | 99.08% | report | ≥ 99.9% in one component |
| greedy routing recall@1 | — | — | report; this is the metric that says the pruning worked |

**Greedy routing recall** is the standard way to judge a proximity index and does not exist in
this repository yet. From a random entry point, follow the greedy rule "step to the neighbour
closest to the query, stop when no neighbour improves" and check whether you land on the
query's true nearest neighbour. Sample 1,000 queries. Report recall@1 and the mean hop count.
A well-pruned 3-degree graph over 87,868 points should route in tens of hops; a top-3 graph
gets stuck almost immediately, which is the same pathology the 2-cycle measurement shows from
the other side.

---

## 5. Part B — `sidcorr-1`: hubness, and a decision to take with evidence

The full export's `neighbors` table is a **retrieval** answer — `u64deck` uses it for "♪ More
like this", a single-hop query where "the 25 most similar" is exactly right. Do not prune it
for navigability; pruning changes what rank 5 through 25 mean, and that table's meaning is
part of its contract.

What is worth changing is the **similarity used to select them**. Apply the hubness correction
from §2.3 and measure:

- the change in in-degree distribution, especially the 456 tracks currently at zero;
- composer lift and nDCG@10 against the 0.8.2 graph;
- how many seeds' top-25 change at all, and by how much (rank correlation).

**Then decide, and record the decision with its numbers.** If hubness correction does not
improve retrieval quality on this corpus, leave `sidcorr-1` alone and say so — an unnecessary
change to the authoritative artefact costs every consumer a re-download and buys nothing.

Either way, address the same-file rate while you are here: the rank-1 neighbour is a different
subsong of the **same `.sid` file** for **14.4%** of seeds, and 905 seeds have all 25
neighbours from their own file. Whether the export should exclude siblings, flag them, or
leave them to consumers is a decision this release should take deliberately rather than
inherit. Note that Part E fixes the consequence client-side regardless.

---

## 6. Part C — write the practice down

Add `doc/neighbour-graph-design.md`. This is the deliverable that stops the next change
relearning all of it. It must state:

- the index/policy separation from §2.1, and that traversal order never belongs in an artefact;
- the pruning rule from §2.2, with the chosen `alpha` and the sweep that chose it;
- hubness correction: what was applied, what it measured, what was decided;
- the metrics that define a good graph here — connectivity, in-degree distribution, greedy
  routing recall, reciprocity — and the command that produces each;
- the station-side policy from Part E, so a future client author does not reinvent a ball
  expansion;
- what was tried and rejected, with numbers. The 0.8.0 ordinal rule and the 0.8.2 flow order
  both belong in this section; they are the two most instructive things in the history.

Update `doc/similarity-export-tiny.md` §10.3–§10.5 to describe what the artefact actually
contains, and delete the flow-order and shortcut-edge sections rather than leaving them as
history. `CHANGES.md` is where history lives.

---

## 7. Part D — the gate and the harness

`scripts/verify-published-exports.ts` gained seven graph checks in 0.8.2. Three of them assert
the flow-order structure and must go: the flow-successor declaration, the slot-0 Hamiltonian
path check, and the longest-forward-path check. They are replaced by the Part A acceptance
table — connectivity, degree bounds, and greedy routing recall.

The acyclicity check also goes, and this is worth being deliberate about: it is being deleted
because the property is no longer claimed, not because it became inconvenient. Say that in the
commit message.

Two measurement scripts exist only as throwaways in `tmp/` from the 0.8.2 work and should be
committed properly, because every number in this document depends on them:

- **the graph analyser** — degree distributions, components, reciprocity, routing recall,
  same-file rates — run against any bundle;
- **the station simulator** — a faithful port of `c64commander`'s `computeStation` driven the
  way `stationQueueProvider` drives it. It needs no HVSC and no audio, and it is the only
  thing in the repository that measures what a listener actually gets.

---

## 8. Part E — `c64commander`: walk the graph, and never play the same tune twice

> **Delegate this to a subagent running inside the `c64commander` checkout**, not from
> `sidflow`. That repository has its own `AGENTS.md` with a task-classification model,
> build/test decision rules and a strict screenshot policy, and an agent working from the
> `sidflow` checkout will not see it. **Read it first and follow it**; where it conflicts with
> anything below, `AGENTS.md` wins — flag the conflict rather than silently choosing.
>
> **Working directory:** `/home/chris/dev/c64/c64commander`. **Branch off `main`.**

### Why the station is short

`computeStation` (`src/lib/sidRadio/stationEngine.ts`) expands from a seed over forward and
reverse edges, at most `EXTENDED_MAX_HOPS = 8` hops with `FRONTIER_CAP = 256`, scores
everything it reaches, and returns the admissible remainder. `stationQueueProvider` then calls
it repeatedly with a growing exclusion set — **and the same seed every time**
(`useSidRadio.ts`, `buildProvider` captures `seed` in the closure it passes as
`computeCandidates`).

So the station is a sphere of radius 8 around a point that never moves. Its size depends on
branching factor, not on how far the graph goes, which is why it served ~1,000 tracks on both
the 0.8.0 and the 0.8.2 bundle while the graph underneath changed by three orders of
magnitude.

### E1. Let the query drift

The engine already supports multiple weighted seeds — `seedStrength` is a map, and the taste
and style seed kinds populate it with many ordinals. So the minimal change is not to
restructure the traversal: it is to **add the recently played tracks as additional seeds**.

- `StationQueueProvider` keeps the last *N* consumed ordinals (start with N = 5; sweep it) and
  passes them to `computeCandidates`.
- The worker adds them to `seedStrength` with a weight that decays with recency, alongside the
  original seed at reduced weight so the station remembers where it started.

That is a drifting query: the retrieval centre moves with the listener, so the reachable
region moves too, and the station does not run out. It is also how the recommendation
literature builds a session-based radio, rather than a special case invented here.

**Determinism (G11) must survive.** The emitted sequence stays a pure function of
`(seed, rankingSnapshot, shuffleSeed, exclude, recent)`, and every one of those is passed in
rather than read from ambient state. Note that `StationQueueProvider.excludedOrdinals` returns
a `Set` spread into an array, so it is already in consumption order and its tail *is* the
recent window — but relying on `Set` iteration order incidentally is not the same as
specifying it. Make it explicit, and make the persisted session
(`src/lib/sidRadio/sidRadioSession.ts`) carry whatever the resume path needs so a resumed
station continues identically.

**Then re-measure the hop budget.** `EXTENDED_MAX_HOPS = 8` and the widening loop exist because
a fixed seed runs out of neighbourhood. With a drifting query they may be unnecessary, and a
smaller radius is cheaper and more coherent. Measure before removing; do not remove on
principle.

### E2. Prevent duplicates at the tune level, not the track level

The exclusion set holds **track ordinals**, so a station will happily play subsong 1, 2 and 3
of the same `.sid` file back to back. A listener experiences that as the same tune three
times. The corpus averages 1.44 subsongs per file over 61,157 files, so there is no shortage
of material to draw on instead.

`bundle.resolveTrack(ordinal)` returns the track's `md5_48`, which **is** the file identity,
and `bundle.trackOrdinalsForMd548(md5_48)` returns every sibling. So when a track is consumed,
exclude its siblings as well. This needs no new data and no format knowledge beyond what
`sidcorrTiny.ts` already exposes.

Consider whether to exclude siblings outright or to allow them after a long gap. Outright is
simpler and is what the corpus size supports; if you allow them, the rule must be stated in
the UI, not just in code.

**Report the measured same-file adjacency rate before and after.** Today it is not zero, and
it should be, and nobody has ever counted it.

### E3. Re-pin

Only after `sidflow-data` is published. `SIDCORR_RELEASE_TAG` and `SIDCORR_BUNDLE_SHA256` in
`src/lib/sidRadio/sidcorrRelease.ts`, plus the second copy in `scripts/fetch-sidcorr.mjs` that
`tests/unit/scripts/fetchSidcorr.test.ts` asserts never drifts. `SIDCORR_EXPECTED` pins
`fileCount: 61157`, `trackCount: 87868`, `neighborsPerTrack: 3` and `styleCount: 9`; none of
those change, but re-check them against the published manifest rather than assuming.

E1 and E2 land against the currently pinned 0.8.2 bundle and should not wait for the re-pin.

### E4. Screenshots

E1 and E2 change behaviour, not layout, so this may not classify as a `UI_CHANGE` at all. If
it does, follow `AGENTS.md`'s minimal screenshot rule: update only the affected files under
`docs/img/`, never refresh the corpus, and report exactly which files changed and why. If none
changed, say so.

### Acceptance

| Check | Today | Target |
|---|---:|---|
| distinct tracks served before `exhausted`, median | 1,042 | ≥ 20,000 |
| distinct tracks served, p10 | 701 | ≥ 5,000 |
| same-file adjacency in a served queue | unmeasured | 0 |
| duplicate track in a session | 0 | 0 (unchanged) |
| determinism: same inputs, same sequence | holds | holds, proven by test |
| resumed session continues identically | holds | holds, proven by test |

Every one of these is measurable with the station simulator from Part D, against the real
bundle, without audio.

---

## 9. Versioning

No schema version and no binary format version changes, but the **meaning** of the shipped
edges does: acyclicity is withdrawn, slot order changes, and a consumer that relied on either
would behave differently. By the same reasoning 0.8.0 used — shipped-data semantics change is
MINOR, corrective-only is PATCH — this is **0.9.0**.

Tag on `main`. Publish `sidflow-data` `0.9.0` under the same name. Every bundle digest changes
except the full export's, which is untouched unless Part B decides otherwise; state which is
which, as 0.8.2 did. Add `doc/migration/0.8.2-to-0.9.0.md` covering the withdrawn acyclicity
guarantee, the slot-order change, and the `graph_flags` bits that changed meaning.

---

## 10. Definition of done

- [ ] The rank-1 reproduction check passes and is committed as a script.
- [ ] Baseline reproduction of the published 0.8.2 lite and tiny bundles is byte-exact before
      any change.
- [ ] The flow order and the shortcut edge are **deleted**, not disabled.
- [ ] Neighbour selection is the pruning rule from §2.2 with a swept `alpha`, one
      implementation shared by every code path that builds a tiny graph.
- [ ] Reverse insertion is implemented, and the zero-in-degree count proves it works.
- [ ] Greedy routing recall@1 is measured, reported, and gated.
- [ ] Part B's decision on `sidcorr-1` is recorded with the numbers that drove it, including
      the case where the decision is "change nothing".
- [ ] `doc/neighbour-graph-design.md` exists and covers the rejected approaches with their
      measurements.
- [ ] The graph analyser and the station simulator are committed scripts, not throwaways.
- [ ] The release gate's flow-order checks are removed and the Part A checks replace them.
- [ ] Composer lift and nDCG@10 have not regressed by more than 5% relative.
- [ ] `c64commander` is on a branch off `main` with the drifting query, tune-level dedupe, the
      re-pin, determinism and resume tests, and `AGENTS.md`'s required reporting.
- [ ] A station on the real bundle serves ≥ 20,000 distinct tracks with no repeated tune,
      measured rather than asserted.
- [ ] No reclassification was run and no schema changed.

---

## Appendix A — reproducing the baselines

Artefacts, verified against each release's `SHA256SUMS`:

```bash
mkdir -p tmp/graph && cd tmp/graph
gh release download 0.8.2 --repo chrisgleissner/sidflow-data \
  --pattern 'sidcorr-hvsc-full-sidcorr-1.sqlite' \
  --pattern 'sidcorr-hvsc-full-sidcorr-1.manifest.json' \
  --pattern 'sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr' \
  --pattern 'SHA256SUMS'
gh release download 0.8.0 --repo chrisgleissner/sidflow-data \
  --pattern 'sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr' --dir v080
sha256sum -c SHA256SUMS --ignore-missing
```

Expected digests: full `d3d825ae…b176da` (identical in 0.8.0 and 0.8.2), lite
`fe92bd57…a346cd` (identical), tiny `64bee446…f7c9c6d` in 0.8.0 and `62097331…c62d294` in
0.8.2. Corpus: HVSC 85 + Update 85, 87,868 tracks over 61,157 files.

**Reproduction check (constraint 2).** Load `vector_json` for every track, scale each vector by
`sqrt(vector_weights)` from the manifest and L2-normalise; weighted cosine is then a plain dot
product. `argmax` over that matrix must reproduce the published rank-1 neighbour. It does for
probe ordinals 0, 1,000 and 50,000 (targets 86,297 / 359 / 61,874) when tracks are ordered by
`sid_path` then `song_index`. If this fails, stop — nothing downstream is derivable.

**Tiny bundle.** Parse the 64-byte header per `doc/similarity-export-tiny.md` §5.2. At
`binary_format_version` 2 the neighbour table is `track_count × 3` records of
`{u24 target, u8 similarity}`, little-endian, `0xFFFFFF` as the unused-slot sentinel. Degree
distributions, components, reciprocity and same-file rates all read off that array.

**Station simulation.** Port `computeStation` from
`c64commander/src/lib/sidRadio/stationEngine.ts` for the `song` seed with no likes, no style
filter and no `admit` predicate, keeping `NEIGHBORS_PER_TRACK = 3`,
`REVERSE_EDGE_WEIGHT = 2`, `HOP_DECAY = 0.7`, `MAX_HOPS = 3`, `EXTENDED_MAX_HOPS = 8`,
`SUFFICIENCY_FACTOR = 3`, `FRONTIER_CAP = 256`. Drive it as `stationQueueProvider` does: same
seed each call, exclusion set growing by every consumed ordinal, `limit = REFILL_BATCH = 24`,
until a call returns nothing. Sample 300 seeds. The weighted permutation in the engine's final
step changes the order of a batch but not its membership, so it does not affect the count.

**Full-export figures quoted in §2.2 and §2.3.** Reciprocity is the fraction of directed edges
`(u,v)` for which `(v,u)` is also present: 47.28% at k=25, 43.92% at k=3, 38.01% at k=1. The
two-cycle result comes from treating rank 1 as a functional graph and finding each walk's
attractor: 16,700 attractors, every one of length 2, holding 33,400 tracks (38.01%), reached
after a median of 3 distinct tracks. In-degree at k=25: mean 25, median 20, max 217, 456 tracks
(0.52%) at zero. Same-file: 14.42% at rank 1, 5.13% across all 25 ranks.

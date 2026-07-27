# HVSC correlation export audit — full / lite / tiny

**Date:** 2026-07-27
**Subject:** the three published HVSC similarity exports in `sidflow-data`, their correctness, their
mutual equivalence, the size gap between full and lite, the case for an intermediate tier, and the
impact of the third export on `u64deck`.
**Artefacts audited:** all three profiles of releases `sidcorr-hvsc-full-20260407T115218Z` (v2) and
`sidcorr-hvsc-full-20260726T203707Z` (v3, currently `latest`), downloaded from GitHub and verified
against their published `SHA256SUMS`.
**Source audited:** `fix/libsidplayfp-wasm-pin-and-residfp-audit` at `c282fd5` (tag `0.7.0`) — the tree
that produced the v3 artefacts, not `main`. Every line number below is that tree's; where the
pre-merge `main` (`4f41ed2`) numbering differs, it is given alongside.

> **Re-verified 2026-07-27 against the merge.** The branch landed on `main` as `1e59ab6` (PR #95,
> 09:25). It was based on `4f41ed2` with nothing on `main` in between, so the merge introduced no
> tree change: `git diff c282fd5 origin/main` is empty and `0.7.0` is now contained in `main`. Every
> source reference in this document therefore resolves identically on today's `main`. The merge
> closes the *lineage* half of F3 and leaves the *specification* half open — see §3.2. Corrections
> made during that pass are marked **[corrected 2026-07-27]**.

---

## 1. Executive summary

The third export is a large, genuine improvement over the second: the second export's similarity data
was **effectively inert** (91.4% of all 87,073 tracks shared the literal vector `[3,3,3,3]`), and the
third fixes that completely (87,717 distinct vectors over 87,868 tracks). Anything built on v2
similarity was, in measurable terms, recommending at random.

Seven findings need action. Four are correctness defects, one is a specification gap that silently
halves third-party recommendation quality, one is a size problem with a clear fix, and one is a
product-level gap in the category system that directly limits the "category radio that adapts"
use case.

| # | Finding | Severity | Evidence |
|---|---------|----------|----------|
| F1 | The full manifest's own `file_checksums.sqlite_sha256` **never matches the published file**, in every release, by construction | High | §4.1 |
| F2 | The lite spec omits the per-dimension weight table that defines the similarity metric; a spec-compliant consumer gets **40% agreement** with the authoritative result | High | §5.2 |
| F3 | The v3 artefacts were cut from a branch that never updated the three format specs; now that it is merged, `main`'s specs describe neither the 58-dim vector nor the normalisation | High | §3.2 |
| F4 | `u64deck`'s footprint goes **37.6 MB → 269.4 MB** and its recommendation metric silently switches | High | §8 |
| F5 | Full is 125× lite mostly through avoidable encoding, not information: **~615 MB of the 1014 MB is recoverable** without losing a single value | Medium | §6 |
| F6 | The persona/category system is unusable as a station filter — `theme_hunter` matches 0 tracks, `slow_ambient` matches 53% of the corpus, 10.8% of tracks are labelled both `fast_paced` and `slow_ambient` — and `c64commander` ships all nine as user-facing station tiles | Medium, but user-visible today | §9 |
| F7 | Tiny's `recommendFromFavorites` computes a 5-hop neighbour walk and then **overwrites every score** with a cosine over the 4-dimension rating vector; measured, a seed's own stored neighbours land 5th and 7th while non-neighbours take the top slots | High | §5.3 |

The good news, and it is substantial: **lite is an excellent representation of full.** Measured on
3,000 random seeds, lite reproduces full's top-25 neighbours at **R@1 = 0.983, R@25 = 0.988**, and
favourite-seeded stations agree at **98%** overlap@50 — provided the consumer applies the weights.
The 3.3 MB → 8.1 MB growth bought a near-lossless 58-dimension vector. Lite is the right default for
almost every client, and the intermediate tier that is actually missing is not between full and lite
at all (§7).

---

## 2. Method

All numbers below are measured, not estimated.

- Both releases' bundles downloaded via `gh release download`; every artefact's SHA-256 recomputed
  and matched against the release `SHA256SUMS` (all six match).
- Full SQLite inspected with `dbstat` for page-level size attribution.
- Lite decoded with the repository's own `decodeLiteSimilarityExport`; tiny with
  `openTinySimilarityDataset`. Vectors dumped to `float32` and compared in NumPy.
- Neighbour agreement measured on a fixed random sample of 3,000 seeds (seed `20260726`), against the
  full export's stored `neighbors` table as ground truth.
- Station agreement measured over 400 trials of 5 random favourites, top-50, whole corpus and per
  energy quintile.
- Intermediate-tier candidates were **built and measured**, not projected.
- `u64deck`'s own `slim_database()` was executed against both the v2 and v3 full exports.

Scripts are in `tmp/audit/` (git-ignored).

---

## 3. Release inventory and lineage

### 3.1 What is published

| Asset | v2 (2026-04-07) | v3 (2026-07-26) | Change |
|---|---:|---:|---|
| `…-sidcorr-1.sqlite` (full) | 416,112,640 | 1,013,977,088 | **+144%** |
| `…-sidcorr-lite-1.sidcorr` | 3,286,090 | 8,118,973 | +147% |
| `…-sidcorr-tiny-1.sidcorr` | 1,818,171 | 1,834,993 | +0.9% |
| `hvsc-full-sidcorr-1-….tar.gz` | 41,318,927 | 206,648,039 | +400% |
| tracks | 87,073 | 87,868 | +795 |
| files | 60,571 | 61,157 | +586 |
| `vector_dimensions` | **4** | **58** | — |
| `neighbor_row_count` | **0** | 2,196,700 | — |
| `feature_schema_version` | 1.3.0 | 1.5.0 | +58 feature keys |
| `sid_engine` | *(absent)* | `sidlite` | new |
| `vector_normalisation` | *(absent)* | `rank-uniform` | new |

Full is **125× lite** and **553× tiny** in v3.

Corpus delta: 86,864 track IDs are common; **209 tracks present in v2 are absent from v3**
(e.g. `DEMOS/A-F/Blizzard.sid#1`, `DEMOS/G-L/Kontakt_Demo.sid#1`), and 1,004 are new. The 209
disappearances are a coverage regression worth a look — they are not explained by the HVSC version
bump alone, since the export does not record which HVSC release it was built from (see §4.3).

### 3.2 F3 — the published data is ahead of the published tooling

The v3 export was produced by commits that, when this audit was measured, lived only on
`origin/fix/libsidplayfp-wasm-pin-and-residfp-audit` — 87 commits ahead of `origin/main`, unmerged.
`main` was at `4f41ed2`, 2026-07-24. The branch head `c282fd5` carries tag `0.7.0`, and the export
was cut from it: the release timestamp `20260726T203707Z` falls between `32f5087` (21:36:39 +0100)
and `8503797` (21:38:41 +0100), the last two commits before the release chore.

**[corrected 2026-07-27] The branch has since been merged** — `1e59ab6`, PR #95, 09:25. It was
branched from `4f41ed2` with nothing landing on `main` in between, so the merge was a clean
fast-forward in effect: `git diff c282fd5 origin/main` is empty and `git branch -a --contains 0.7.0`
now lists `main`. The lineage half of this finding is closed.

The branch contains the entire station-quality campaign that makes v3 good: the 58-dimension vector,
the learned weight schedule, rank-uniform normalisation, greedy forward feature selection, the
playroutine-based composer signal. It also adds `doc/station-quality.md` and
`scripts/verify-published-exports.ts`, neither of which existed on `4f41ed2`.

What it does **not** touch is the three files the `sidflow-data` README sends consumers to:

```
git diff --stat 4f41ed2..origin/fix/libsidplayfp-wasm-pin-and-residfp-audit \
  -- doc/similarity-export.md doc/similarity-export-lite.md doc/similarity-export-tiny.md
(empty)
```

That is the half the merge did not fix, and merging arguably made it worse: the stale specs are now
`main`'s specs rather than a branch's. `doc/similarity-export.md:142` still documents `--dims 3|4`;
`grep -c 58` returns 0 in all three files, and nothing in `doc/` outside `station-quality.md`
mentions rank-uniform normalisation or the weight schedule. So a third party who follows the
documented path — read the spec on `main`, implement it, load the `latest` bundle — is still
implementing against a description that predates the artefact by one major revision.

**Action:** land the three spec documents. This is the root cause of F2 as well.

---

## 4. Correctness findings

### 4.1 F1 — the full manifest's self-checksum is always wrong

The manifest published beside the full SQLite declares a checksum for that SQLite. It has never
matched, in either release:

| | v2 | v3 |
|---|---|---|
| `file_checksums.sqlite_sha256` (sidecar manifest) | `510560e6…5d48` | `d7e5f77a…7d51` |
| `manifest_json` inside the DB's `meta` table | `510560e6…5d48` | `d7e5f77a…7d51` |
| **Actual file, recomputed** | `7eea82ef…4eb7f` | `17953aa5…c6d78` |
| `SHA256SUMS` entry | `7eea82ef…4eb7f` ✓ | `17953aa5…c6d78` ✓ |

`SHA256SUMS` is correct. The manifest is not.

The cause is a plain ordering bug in `packages/sidflow-common/src/similarity-export.ts` (line 1346 on
the tree that produced v3 and on today's `main`; 1156 on the pre-merge `main` — the branch moved the
code without changing it). The file is hashed, then mutated:

```ts
const sqliteChecksum = await computeFileChecksum(temporaryOutputPath);
const manifest: SimilarityExportManifest = { … file_checksums: { sqlite_sha256: sqliteChecksum } … };

const writerDatabase = new Database(temporaryOutputPath, { create: true });
writerDatabase.query("UPDATE meta SET value = ? WHERE key = ?")
  .run(JSON.stringify(manifest), "manifest_json");   // ← mutates the file AFTER hashing it
writerDatabase.close();
```

The `UPDATE` writes the manifest (including its own checksum) into the database, changing the very
bytes that were just hashed. The declared digest is therefore the digest of a file that is never
published. This is unfixable in place — a file cannot contain its own hash — so the fix is to either
hash after the final write and store the digest only in the sidecar, or drop `sqlite_sha256` from the
embedded copy and hash last.

**Impact.** `sidflow-data`'s README instructs consumers to "verify the checksum and retain the
manifest". A consumer who verifies via the manifest rejects every release. `u64deck` survives only
because it prefers `SHA256SUMS` and falls back to the manifest field solely when `SHA256SUMS` has no
entry (`server.py:4821–4823`) — correct by luck of ordering, not by design.

### 4.2 F1b — `neighbor_row_count` is computed, not measured

In the same function the final manifest reports:

```ts
neighbor_row_count: neighborCount > 0 ? tracks.length * neighborCount : 0,   // :1359
```

**[corrected 2026-07-27]** The measured count is not simply thrown away — it is written and then
overwritten. `insertNeighbors()` returns the number actually inserted (`:1308`) and that value goes
into the placeholder manifest embedded in the database's `meta` table (`:1324`, alongside
`sqlite_sha256: "pending"`). The final manifest at `:1347` recomputes every field from scratch,
substitutes `tracks.length * neighborCount`, and `UPDATE`s it over the placeholder — so both the
embedded copy and the sidecar end up carrying the computed number, and the measured one survives
nowhere. For v3 the two happen to coincide (2,196,700 = 87,868 × 25, verified against the DB). They
will not coincide the moment any track yields fewer than `neighborCount` candidates.

This matters more than it looks, because `u64deck` treats the field as authoritative and **hard-fails
the import** on mismatch (`sidflow_similarity.py:364`):

```python
if source_neighbors != requested_neighbors:
    raise ValueError(f"SIDFlow neighbor row count {source_neighbors:,} does not match manifest {requested_neighbors:,}")
```

A future export with one under-filled seed bricks `u64deck`'s import with no fallback. Report the
measured count.

### 4.3 F4b — no HVSC release is recorded

`corpus_version` is the string `"hvsc"` in both releases. No manifest field records which HVSC
release the `sid_path` values belong to; the local workspace says HVSC 84 + Update 84, and branch
commits reference HVSC 85. Since every consumer that resolves tracks against a local collection
matches on `sid_path` (`u64deck`) or on an MD5 of file bytes (tiny), the HVSC release is part of the
data's identity. `u64deck`'s README already has to tell users that "paths that no longer match the
installed HVSC version fail gracefully" — a version field would let it say *which* version instead.

Add `hvsc_version` (base + applied deltas) to all three manifests.

### 4.4 Absolute paths and host leakage in manifests

- v3 full manifest: `"paths": { "sqlite": "/mnt/data/dev/c64/sidflow/data/exports/…" }` — the build
  host's absolute path, published.
- v2 tiny manifest: `"hvsc_root": "/home/chris/dev/c64/sidflow/workspace/hvsc"` — fixed in v3
  (`"hvsc"`), but the full profile still leaks.

Cosmetic, but it is in a file consumers are told to retain. Publish basenames.

### 4.5 What is correct — and it is a lot

Verified positively:

- **Every published artefact matches `SHA256SUMS`.** All six checked.
- **The full export is internally self-consistent.** Recomputing weighted cosine from the stored
  58-dim vectors reproduces the stored `neighbors` table at **R@25 = 1.0000**, with stored-vs-
  recomputed similarity error of mean 7.9 × 10⁻⁸ / max 4.3 × 10⁻⁷ over 74,998 pairs — exactly the
  `toFixed(8)` rounding and nothing else. The neighbour precomputation is right.
- **Every seed has exactly 25 neighbours.** 2,196,700 rows over 87,868 distinct seeds.
- **Lite carries the same track set and identical ratings.** Set equality on 87,868 track IDs;
  zero rating mismatches.
- **The v3 vector is non-degenerate.** 87,717 distinct vectors / 87,868 tracks; largest identical
  bucket is 30.
- **Ratings are exact rank-uniform quintiles.** Each of `e`, `m`, `c` splits
  17,574 / 17,573 / 17,574 / 17,573 / 17,574. All 125 `(e,m,c)` combinations are populated.

### 4.6 The v2 export was inert — quantified

For the record, since v2 is what most consumers are still on:

- **15 distinct vectors** across 87,073 tracks. **79,567 tracks (91.4%) share `[3,3,3,3]`.**
- Ratings never took the values 1 or 5 at all: `e` ∈ {2,3,4} with 96% at 3; `m` 94% at 3; `c` 94.6%
  at 3.
- `neighbor_row_count = 0` — the "full" export shipped with no neighbours.

Cause: `resolveTargetVectorDimensions()` returns `maxStoredDimensions > 4 ? maxStoredDimensions : 4`,
and with no stored vector upstream it fell to 4, which routes through `buildLegacyVector()` →
`[e, m, c, p ?? 3]`. With ratings themselves collapsed onto 3, the vector became a constant. Anything
v2 recommended by vector was noise. Category radio on v2 was impossible: 91% of the corpus sat in one
rating cell.

This is consistent with the previously recorded `similarity-vector-is-degenerate` note, but the
severity is worse than "defaulted to 4 dims": the *ratings* were degenerate too, so even the 4 dims
carried nothing.

---

## 5. Equivalence: full ↔ lite ↔ tiny

### 5.1 Lite is a near-lossless carrier of the full vector

Lite stores each vector L2-normalised and product-quantised with `pq_subspaces = vector_dimensions`,
i.e. subspace dimension 1 — a per-dimension 256-centroid scalar quantiser, effectively 8 bits per
dimension. Measured against the full export's vectors, unit-normalised:

| Metric | Value |
|---|---|
| cosine(lite, full) — mean | **0.999965** |
| cosine(lite, full) — 1st percentile | 0.999448 |
| cosine(lite, full) — min | 0.985778 |
| per-component abs error — mean | 3.0 × 10⁻⁴ |
| per-component abs error — p99 | 2.6 × 10⁻³ |
| per-component abs error — max | 1.1 × 10⁻¹ |

The size growth 3.29 MB → 8.12 MB is exactly accounted for: 87,868 × 58 = 5.10 MB of PQ codes plus
the codebook and per-file metadata. Lite paid 4.8 MB for a 14.5× wider vector. Good trade.

### 5.2 F2 — but the metric is not in the specification

The full export's neighbours are ranked by **weighted** cosine. `cosineSimilarity()` in
`vector-similarity.ts` looks up a 58-entry learned weight table (`SIMILARITY_VECTOR_WEIGHTS`, fitted
by coordinate ascent on nDCG@10) keyed on vector width, and applies it. Weights range 0.328 → 2.109,
a 6.4× spread.

That table exists **only in TypeScript source**. It is not in the bundle, not in any manifest, and
not mentioned in `doc/similarity-export.md`, `doc/similarity-export-lite.md`, or
`doc/similarity-export-tiny.md` — `grep -i weight` across all three returns only unrelated hits about
favourite weighting and style scoring.

A third party who implements the published lite spec computes plain cosine. Measured, 3,000 seeds,
against the full export's stored neighbours:

| What the consumer computes | R@1 | R@3 | R@10 | R@25 |
|---|---:|---:|---:|---:|
| full vectors, weighted cosine *(reference implementation)* | 0.9993 | 0.9991 | 0.9999 | **1.0000** |
| lite vectors, weighted cosine | 0.9827 | 0.9823 | 0.9841 | **0.9878** |
| full vectors, **plain** cosine | 0.4810 | 0.4992 | 0.5036 | 0.5055 |
| lite vectors, **plain** cosine *(spec-compliant consumer)* | 0.4783 | 0.4990 | 0.5038 | **0.5048** |

And on the product's actual primitive — a station grown from 5 favourites, top-50, 400 trials:

| Comparison | Whole corpus | Within `e=1` category |
|---|---:|---:|
| lite vs full, **same** metric | **0.982** | 0.981 |
| authoritative (weighted) vs spec-only lite (plain) | **0.403** | 0.458 |

**Half the recommendations are different.** The lite bundle is not lossy — the *specification* is.
Quantisation costs 1.5% of neighbours; the missing weight table costs 50%.

Fortunately the fix is nearly free: weighted cosine is scale-invariant per vector, so lite's
L2-normalised vectors reproduce the exact weighted cosine of the originals once the weights are
applied. **Publish the 58 weights in the lite manifest** (a `vector_weights` array, 58 numbers, ~600
bytes) and spec-compliant consumers reach 0.988. SIDFlow's own TypeScript readers already call the
weighted `cosineSimilarity`, so only third parties are affected — which is precisely the audience
`sidflow-data` exists for.

### 5.3 Tiny is a different product, not a smaller one

Tiny carries **no vectors at all**. Its 1,834,993 bytes decompose exactly as:

| Section | Bytes |
|---|---:|
| file identities, `md5_48` @ 6 B × 61,157 | 366,942 |
| per-file subsong count, 1 B × 61,157 | 61,157 |
| style mask, 2 B × 87,868 | 175,736 |
| packed ratings, 2 B × 87,868 | 175,736 |
| neighbours, 3 B ordinal + 1 B similarity × 3 × 87,868 | 1,054,416 |
| header + style table | ~1,006 |

That explains why tiny barely moved between v2 and v3 (+0.9%): its size is independent of vector
width. It also means tiny cannot do vector arithmetic — and there is no meaningful "recall against
full" to quote, because tiny stores only 3 of full's 25 neighbours by construction.

Three defects here:

- **F7 — the neighbour walk is computed and then discarded.**
  **[corrected 2026-07-27; this section previously described only the walk.]**
  `recommendFromFavorites` (`similarity-export-tiny.ts:966`) does run a 5-hop decayed walk over the
  3-neighbour graph, forward and reverse edges, decays 0.76ᵈ / 0.70ᵈ with reverse edges at ×0.92,
  frontier capped at 256 (`:995-1021`). That is a reasonable design given the constraint. It is then
  thrown away. The block that follows is written as a fallback but is not conditioned on the walk
  having failed:

  ```ts
  if (favoriteRows.length > 0) {                                    // :1023 — no `scores.size` guard
    const centroid = normalizeVector(/* mean of [e, m, c, p ?? 3] over the favourites */);
    for (let trackOrdinal = 0; trackOrdinal < rows.length; trackOrdinal += 1) {
      …
      const fallbackScore = cosine(centroid, normalizeVector([row.e, row.m, row.c, row.p ?? 3]));
      scores.set(trackOrdinal, fallbackScore);                      // :1044 — set, not add
    }
  }
  ```

  It sweeps **every** ordinal and `set`s — not accumulates — so every track the walk scored is
  overwritten, and every track it never reached is given a score anyway. The only ordinals skipped
  are the excluded ones and the favourites themselves, which the final `.filter` drops regardless.
  So whenever at least one favourite resolves — the only case in which the function returns anything
  — **100% of the returned ranking comes from a cosine over the 4-dimension rating vector**, and the
  neighbour graph that is 57% of the bundle's bytes contributes nothing.

  **Measured, not only read.** Built a 12-track corpus through the real
  `buildSimilarityExport` → `buildLiteSimilarityExport` → `buildTinySimilarityExport` chain on
  `c282fd5`, with a vector geometry that gives the seed genuine neighbour edges and ratings ordered
  against it, then called `recommendFromFavorites` on the opened bundle:

  | | Result |
  |---|---|
  | Seed's stored neighbours (`getNeighbors`) | `T6` @ 0.867, `T7` @ 0.725 |
  | Where those land in the recommendations | `T6` **5th**, `T7` **7th** — at their rating-cosine scores |
  | Top two returned | `T10`, `T5` — not neighbours of the seed at all |
  | Returned scores vs an independent rating-cosine computation | identical for all 11, to 12 decimal places |
  | Distinct scores among 11 recommendations | **5** |

  The control matters: the walk had edges available and its output still does not appear anywhere in
  the result. The consequence is the v2 degeneracy in a new place — the ranking key takes at most 125
  distinct values over 87,868 tracks (`e`,`m`,`c` ∈ 1..5; `p` carries user feedback, so in a
  published corpus it is unset and `p ?? 3` is a constant fourth component), and ties break by
  `trackOrdinal`, so the same low-ordinal tracks win every tie for every listener.
  This is not new in v3. `git blame` puts the block at `a7aac3ea`, 2026-04-07; the branch touched
  only its canonical-id handling (`499536a`). Every tiny bundle ever published has been read this
  way — which is also why it survived the station-quality campaign untouched: that work measured the
  full and lite retrieval paths, and this one is neither.

  The release gate cannot see it: `verify-published-exports.ts:131` asserts only
  `tinyRecommendations.length > 0`, which the fallback guarantees. Lite has no equivalent defect —
  its `scoreRows` ranks by weighted `cosineSimilarity` over the real 58-dim vectors
  (`similarity-export-lite.ts:238`, `:265`). Nor is `c64commander` affected: it has no dependency on
  `@sidflow/common` and reads the bundle with its own `sidcorrTiny.ts` / `stationEngine.ts`, so this
  is SIDFlow's own tiny reader and any third party using the library.

  **Fix:** run the fallback only when the walk produced nothing (`scores.size === 0`), or delete it —
  the next defect below argues the 4-dim rating vector should not be a retrieval key at all. Either
  way this is a code change; the bundle bytes are unaffected.
- **`info.hasVectorData` is `true` and it is not.** `getTrackVectors()` (`:914`) returns
  `[row.e, row.m, row.c, row.p ?? 3]` — a 4-element rating vector, at most 125 distinct positions
  across 87,868 tracks, and at the `LEGACY_RATINGS_VECTOR_MAX_DIMENSIONS` limit of 4, so
  `weightsForDimensions()` returns `null` and it receives no weighting. A consumer that branches on
  `hasVectorData` (`:848`) and does centroid arithmetic silently reproduces the exact v2 degeneracy.
  Set `hasVectorData: false`, or return `null`.
- **Identity is a 48-bit MD5 prefix.** Over 61,157 files the birthday probability of at least one
  collision is ≈ 0.66% — the figure the code's own comment quotes as "around 0.7%". The branch added
  collision *detection* (`2b178bf fix(export): detect md5_48 identity collisions instead of
  mislabelling tracks`), which is right, but the margin is thin and the next HVSC will make it
  thinner. `md5_64` costs 122 KB and drops the probability to ~10⁻⁷.

Tiny also requires the consumer to have HVSC locally and MD5 every file to resolve any path at all —
a real integration cost that should be stated prominently in its spec rather than discovered.

### 5.4 Neighbour quality: same-file siblings

Across the full export's 2,196,700 neighbour rows, the neighbour is a **different subsong of the same
`.sid` file** in:

| Rank | 1 | 2 | 3 | 4 | 5 | 10 | overall (1–25) |
|---|---:|---:|---:|---:|---:|---:|---:|
| same-file % | **14.4** | 11.0 | 9.2 | 8.0 | 7.2 | 4.7 | **5.1** |

- 905 seeds (1.03%) have **all 25** neighbours from their own file.
- 2,103 seeds (2.39%) have a majority same-file.
- 75.0% of seeds have none — the tail is concentrated, not diffuse.

With 61,157 files and 87,868 tracks (1.44 subsongs/file average), 14.4% at rank 1 is far above chance.
Subsongs of one tune are frequently near-identical variants, so "the most similar track" being the
next subtune is a poor listening result. The branch added `bdc79c3 fix(station): stop stations
replaying the same tune` at the station layer; the export layer should also expose the file grouping
so any consumer can diversify. Cheapest fix: keep the 25 rows but add a `same_file` flag, or export
30 and let consumers drop siblings.

---

## 6. F5 — why full is 125× lite

`dbstat` attribution of the 1,013,977,088-byte v3 SQLite:

| Object | Bytes | % of file | Pages | Payload | **Unused** |
|---|---:|---:|---:|---:|---:|
| `tracks` | 747,544,576 | 73.7% | 182,506 | 492,175,491 | **253,833,401** |
| `neighbors` | 257,744,896 | 25.4% | 62,926 | 221,159,498 | 29,142,526 |
| `tracks_sid_path_idx` | 8,679,424 | 0.9% | 2,119 | 7,366,010 | 1,022,396 |
| `meta`, schema | 8,192 | 0.0% | 2 | — | — |

Within the `tracks` payload:

| Column | Bytes | avg/track |
|---|---:|---:|
| `features_json` | **381,275,214** | 4,339 |
| `vector_json` | **98,227,041** | 1,118 |
| `track_id` | 3,582,421 | 41 |
| `sid_path` | 3,398,037 | 39 |
| `classified_at` + `source` + `render_engine` + `feature_schema_version` | 3,251,116 | 37 |

Four causes, in order of size:

1. **`features_json` — 381 MB (37.6%).** The complete 129-key raw feature record, stored as
   pretty-free but still uncompressed JSON, per track. Of those 129 keys, the vector uses 58 and
   `u64deck` — the only known external consumer — uses 48. This is the diagnostic payload, not the
   similarity payload.
2. **The `neighbors` table — 258 MB (25.4%).** 2,196,700 rows, each repeating two full TEXT track IDs
   (~41 bytes each) inside a `WITHOUT ROWID` B-tree. The same information as
   `(uint32 ordinal, uint8 similarity)` is 5 bytes × 2.2M = **11 MB**. A 23× encoding overhead.
3. **`WITHOUT ROWID` + 4 KB pages — 254 MB of pure padding in `tracks`.** A `WITHOUT ROWID` table is
   an index B-tree, whose max local payload at 4 KB pages is ~1,002 bytes. Average row payload is
   5,601 bytes, so essentially every row spills to an overflow chain whose last page is mostly empty.
   34% of the `tracks` allocation is unused space.
4. **`vector_json` — 98 MB.** 58 floats written as full-precision JSON text averaging 1,118 bytes.
   As `float32` that is 232 bytes; as `uint16` over the rank-uniform `[0,1]` range, 116 bytes.

None of these is information the lite bundle is missing. Full is 125× lite because of **encoding**,
plus one genuinely extra payload (`features_json`) that most consumers never read.

---

## 7. Is there a useful tier between full and lite?

I built nine candidate exports from the real v3 data and measured them. Every candidate below is
byte-for-byte value-preserving except where the vector encoding is stated as quantised.

| Variant | MB | gzip MB | vs full |
|---|---:|---:|---:|
| **A** full, as published | 1014.0 | — | 1.00× |
| **B** drop `features_json` only | 644.2 | 105.9 | 0.64× |
| **C** drop features + `float32` vectors | 274.3 | 77.2 | 0.27× |
| **D** drop features + `uint16` vectors | 263.2 | 71.7 | 0.26× |
| **E** drop features + `uint8` vectors | 257.7 | 67.2 | 0.25× |
| **F** = D + 64 KB pages | 259.3 | 71.1 | 0.26× |
| **G** = D **without the neighbours table** | **31.7** | **12.3** | **0.031×** |
| **H** keep features + `float32` vectors | 665.2 | 167.5 | 0.66× |
| **I** = H + 64 KB pages | 669.2 | 166.5 | 0.66× |

The decisive comparison is **D (263.2 MB) vs G (31.7 MB)**: the precomputed neighbours cost **231 MB**,
seven times everything else combined. Nothing else in the file is close.

### What this means

**There is no useful tier between full and lite as they are currently drawn.** Once you drop
`features_json` and encode the vector as binary, the artefact is 31.7 MB — four times lite, not
thirty. The apparent chasm between 8 MB and 1014 MB is an encoding artefact, and closing it collapses
the space where an intermediate would have lived.

The tier that *is* missing sits on the other side, and it is the one `u64deck` had to build for
itself:

> **A "features" tier** — the raw 129-key feature record, without vectors, without neighbours, for
> consumers that want to derive their own representation. Measured: `features_json` is 381 MB raw,
> and B minus everything else gzips to ~106 MB. As line-delimited JSON with a shared key table, or
> Parquet, it lands around 60–90 MB compressed.

That is exactly what `u64deck` downloads 1 GB to obtain. It is the only real consumer requirement not
served by lite.

### Recommended shape

Rather than adding a fourth tier, **fix the three that exist**:

1. **Full** — keep it authoritative and complete, but stop paying for the encoding. Store the vector
   as a `float32` BLOB, drop `WITHOUT ROWID` from `tracks` or raise `page_size` to 65536, and store
   neighbours as one BLOB per seed (`uint32` ordinal + `uint8` similarity, 125 bytes for 25
   neighbours) rather than 25 rows with repeated TEXT keys. That is variant I's structure with the
   neighbour fix: **~1014 MB → ~430 MB**, losing nothing. Ship the `.gz` (~166 MB) as the primary
   download.
2. **Lite** — already the right default. Add the weight table (§5.2) and it is a complete,
   spec-implementable, 8 MB recommendation dataset with 98% station agreement against full. This
   should be what the README recommends first, not second.
3. **Tiny** — keep for genuinely constrained clients, fix `hasVectorData`, widen the file ID.
4. **New: a features sidecar** — `features.jsonl.gz` or `.parquet`, ~60–90 MB, published alongside.
   `u64deck` then downloads 8 MB + 80 MB instead of 1,014 MB, and any future consumer that wants to
   train its own representation has a first-class artefact instead of a 1 GB SQLite to strip-mine.

That is a smaller change than adding a tier, and it addresses every real consumer need observed.

---

## 8. F4 — impact on `u64deck`

### 8.1 Which variant it uses

**`u64deck` uses the full SQLite, exclusively.** `server.py:4740`:

```python
candidates = [(SIDFLOW_FULL_SQLITE, SIDFLOW_FULL_MANIFEST, "full")]
```

with the comment that the mobile profile omits `features_json` "which is required for musically
useful recommendations". It never reads lite or tiny, and — importantly — **it never reads
`vector_json` either.** It extracts its own 48-dimension vector from `features_json`
(`FEATURE_DIMENSIONS`, `sidflow_similarity.py:39`), z-normalises it corpus-wide, and stores it as a
192-byte BLOB in a private `u64deck-featvec-1` database.

Two consequences worth stating plainly:

- `u64deck` was **immune to the v2 vector degeneracy**, because it never used the degenerate vector.
  Its `duplicate_vector_ratio` guard measured 0.0057 on v2 and did not fire — correctly.
- `u64deck` gets **no benefit** from v3's 58-dimension rank-uniform vector or its learned weights,
  because it builds its own representation. The entire station-quality campaign is invisible to it
  except through the neighbours table (below).

### 8.2 What changes when it picks up v3

v3 is already tagged `latest`, and `u64deck` resolves
`https://github.com/chrisgleissner/sidflow-data/releases/latest/download/…`. The next user who opens
**Settings → SIDFlow Similarity Data** gets v3. I ran `u64deck`'s own `slim_database()` against both
exports:

| | v2 | v3 | Change |
|---|---:|---:|---:|
| Source download | 416 MB | **1,014 MB** | **2.4×** |
| Compact DB retained | 37.6 MB | **269.4 MB** | **7.2×** |
| Neighbour rows imported | 0 | 2,196,700 | — |
| Peak disk during import | ~460 MB | **~1,290 MB** | 2.8× |
| Slim duration (this machine) | 6.2 s | 16.4 s | 2.6× |
| `duplicate_vector_ratio` | 0.0057 | 0.00034 | improved |

**a) Download and footprint.** 1 GB over a home connection, and the retained database is no longer
"well under 40 MB". `u64deck`'s README currently states:

> "The source is about 400 MB … The retained database is normally well under 40 MB."

Both sentences are now false. On a Windows box with a modest SSD this is a visible regression, and
the import path writes the 1 GB download into the application directory before deleting it.

**b) The recommendation metric silently switches.** `SimilarityStore.rank()`
(`sidflow_similarity.py:533`) prefers the neighbours table whenever it is non-empty:

```python
has_neighbors = int(conn.execute("SELECT COUNT(*) FROM neighbors").fetchone()[0]) > 0
if has_neighbors:
    rows = conn.execute("… FROM neighbors n JOIN tracks t … WHERE n.seed_track_id=? …")
    …
    if len(out) >= limit:
        return out
# otherwise fall through to brute-force cosine over u64deck's own 48-dim vectors
```

With v2 (0 neighbour rows) every query brute-forced `u64deck`'s own metric over the whole corpus.
With v3 (2.2M rows) the table wins, and **"♪ More like this" now returns SIDFlow's 58-dimension
weighted-cosine neighbours instead of `u64deck`'s 48-dimension z-normalised ones.** These are
different metrics producing different results. Whether that is an improvement is arguable — SIDFlow's
is the better-validated one — but it is an unannounced behaviour change in someone else's product,
triggered by a data download.

The fall-through is well designed: if fewer than `limit` neighbours survive the `present_paths` filter
(the user's actual on-device tracks), the partial result is discarded and brute force runs. So no hard
failure. But note two edges:

- The stored depth is 25 and `More like this` requests up to 20, so the table path is normally taken
  in full. A user with a partial HVSC will oscillate between the two metrics depending on seed.
- **Radio** tops up repeatedly from recently played tunes. Drawing from a fixed 25-neighbour pool per
  seed rather than the whole corpus will increase repetition within a session.
- `excluded` contains the seed *track*, not the seed *file*. With 14.4% of rank-1 neighbours being
  same-file siblings (§5.4), "More like this" will now frequently open with the next subtune of the
  tune just played.

**c) A latent hard-fail.** As noted in §4.2, `slim_database` raises if the neighbours row count
differs from `manifest.neighbor_row_count`. That field is computed rather than measured. v3 is safe;
the next export may not be.

**d) Feature coverage.** All 48 of `u64deck`'s `FEATURE_DIMENSIONS` are present in v3's
`features_json`, except `spectralContrastMean` and `spectralContrastStd`, missing on 7 of 5,000
sampled tracks (0.14%). `_numeric_feature` coerces those to 0.0, which for a z-normalised dimension
is a silent displacement toward the corpus mean rather than a neutral value. Small, but it is the same
SIDLite spectral-contrast dropout recorded previously, and it now reaches a downstream consumer. No
feature keys were removed between 1.3.0 and 1.5.0 (58 were added), so nothing else regresses.

### 8.3 What to tell `u64deck`

In priority order:

1. **Flag the size change before users hit it** — 1 GB download, 269 MB retained. Update the README's
   two size claims.
2. **Decide, don't inherit, the metric.** If `u64deck` wants its own 48-dim ranking, skip importing
   neighbours entirely — it saves 232 MB and restores v2 behaviour exactly. If it wants SIDFlow's,
   adopt it deliberately and drop the redundant brute-force path.
3. **Measure the neighbour count instead of trusting the manifest**, or treat a mismatch as a warning
   that skips neighbours rather than failing the import.
4. **Exclude the seed's file, not just the seed track**, from `More like this`.

Item 2 alone takes the retained database from 269.4 MB back to ~37 MB.

### 8.4 The other consumer: `c64commander`

`u64deck` is not the only downstream. `c64commander`'s SID Radio consumes the **tiny** export and is
already pinned to this release. It is unaffected by everything in §8.1–8.3 — different profile,
different retrieval model — but it is the consumer that F6 lands on directly. See §9.

Between them the two consumers cover the extremes: `u64deck` takes the 1 GB full export and ignores
its vectors; `c64commander` takes the 1.8 MB tiny export which has no vectors. **Neither uses lite**,
the profile the audit finds is the best-engineered of the three.

---

## 9. F6 — fitness for the target use case

The stated goal is a category station that then adapts to what the listener likes while staying inside
the category. v3 supports the *adaptive* half well and the *category* half poorly.

### What works

Category-restricted adaptation is sound. Restricting to an energy quintile leaves a 17,574-track pool,
and lite tracks full inside that pool as well as it does globally:

| Pool | lite vs full, favourites@50 |
|---|---:|
| whole corpus (87,868) | 0.982 |
| `e=1` (17,574) | 0.981 |
| `e=3` (17,574) | 0.986 |
| `e=5` (17,574) | 0.987 |

Because ratings are exact rank-uniform quintiles, **every category has a guaranteed 20% pool** — a
genuinely good property for station building, and one worth documenting as intentional. The corollary
is that `e=1` means "the calmest fifth of HVSC", not "objectively calm"; that is the right choice for
a station and the wrong one for a label, and it should be stated.

### What does not work

The shipped category vocabulary is the 9 personas, and `computeSimilarityStyleMask()` derives them
**solely from `e`, `m`, `c`, `p`** — the same 3 quintiles. So the category axis has at most 125 distinct
inputs, and the top-3-personas rule collapses those to **17 distinct masks** across 87,868 tracks.

| Persona | Tracks | % of corpus |
|---|---:|---:|
| `slow_ambient` | 46,652 | 53.1% |
| `nostalgic` | 45,562 | 51.9% |
| `melodic` | 45,496 | 51.8% |
| `experimental` | 42,495 | 48.4% |
| `fast_paced` | 41,648 | 47.4% |
| `era_explorer` | 29,116 | 33.1% |
| `deep_discovery` | 11,962 | 13.6% |
| `composer_focus` | 673 | **0.8%** |
| `theme_hunter` | 0 | **0.0%** |

- **`theme_hunter` selects nothing.** A category in the vocabulary that can never match.
- **`composer_focus` selects 0.8%** — too small to build a station from, and ironic given that the
  v3 vector work was explicitly about composer identity.
- **Five personas each cover roughly half the corpus.** A filter that admits 53% of everything is not
  a category.
- **10.8% of the corpus is labelled both `fast_paced` and `slow_ambient`.** The cause is the forced
  top-3 rule: at `e=3`, 57% of tracks are `fast_paced` *and* 65% are `slow_ambient`. Mid-energy tracks
  get three labels whether or not any fits.

Overlap matrix, % of corpus in both (diagonal = that persona's own share):

```
                  fast_p  slow_a  melodi  experi  nostal  compos  era_ex  deep_d  theme_
fast_paced          47.4    10.8    20.8    30.1    19.4     0.0    11.9     1.8     0.0
slow_ambient        10.8    53.1    20.7    11.9    38.7     0.0    21.8     2.3     0.0
melodic             20.8    20.7    51.8    34.6    15.4     0.8     0.0    11.3     0.0
experimental        30.1    11.9    34.6    48.4     2.7     0.0     5.8    11.8     0.0
nostalgic           19.4    38.7    15.4     2.7    51.9     0.8    26.7     0.0     0.0
composer_focus       0.0     0.0     0.8     0.0     0.8     0.8     0.0     0.0     0.0
era_explorer        11.9    21.8     0.0     5.8    26.7     0.0    33.1     0.0     0.0
deep_discovery       1.8     2.3    11.3    11.8     0.0     0.0     0.0    13.6     0.0
theme_hunter         0.0     0.0     0.0     0.0     0.0     0.0     0.0     0.0     0.0
```

### Where this lands: `c64commander`

This is not theoretical. `c64commander`'s SID Radio consumes the **tiny** export — already pinned to
this release (`SIDCORR_RELEASE_TAG = "sidcorr-hvsc-full-20260726T203707Z"` in
`src/lib/sidRadio/sidcorrRelease.ts`) — and surfaces **all nine personas as user-facing station
tiles**: "Fast-Paced", "Chill / Ambient", "Composer Deep-Dive", "Game Themes". Station membership is
literally the mask bit (`src/lib/sidRadio/stationEngine.ts:120-123`):

```ts
const mask = 1 << styleBit;
if ((bundle.styleMask[ordinal] & mask) === 0) continue;
```

So every number in the table above is something a user can see:

- **"Game Themes" is a station tile that can never play anything** — 0 tracks carry `theme_hunter`.
  The client has an `{ type: "empty" }` fallback so it degrades rather than crashes, but it does not
  guard against a zero-population style, and none of the nine is hidden.
- **"Composer Deep-Dive" draws from 673 tracks**, so it loops quickly.
- **"Fast-Paced" and "Chill / Ambient" share ~9,500 tracks**, which a listener experiences as two
  stations playing overlapping music.

**[corrected 2026-07-27]** The client *parses* the bundle's `STYLE_TABLE` — `parseStyleTable`
(`sidcorrTiny.ts:146-181`) reads each style's key, label, kind and mask bit — but it does not drive
the UI from it. `bundle.styles` is consumed in exactly one place, for its `.length`
(`sidRadioWorkerCore.ts:43`). The nine tiles are a hardcoded client-side table,
`SID_RADIO_STYLE_TILES` (`useSidRadio.ts:389-399`), which fixes each persona's bit, key, label and
blurb in the app.

The practical consequence is narrower than "no client change", and it cuts both ways:

- **Corrected masks do propagate on a re-pin with no client change**, because membership is
  `styleMask[ordinal] & (1 << bit)` and the bit numbers on both sides are fixed constants that
  agree. So the mask fix itself belongs in the export.
- **Anything else does not propagate.** Renaming a style, retiring one, or reassigning a bit would
  leave the client showing its own stale labels against the new mask — silently, since nothing
  cross-checks `bundle.styles` against `SID_RADIO_STYLE_TILES`. That is why the bit assignments have
  to be treated as a wire contract, and why an export-side fix must keep all nine positions.

### Why `theme_hunter` is empty — the mechanism

`computeSimilarityStyleMask()` (`similarity-portable.ts:83`) calls
`scoreAllPersonas({ metrics, ratings })` and passes **no `metadata` field at all**. The four hybrid
personas — `composer_focus`, `era_explorer`, `deep_discovery`, `theme_hunter` — are defined with a
`metadataPolicy` and earn their distinguishing signal from `composer`, `year`, `category` and
`titleThemeTags` (`persona.ts:209-320`). With `metadata` undefined, `scoreMetadataBonus()` returns 0
for every one of them (`persona-scorer.ts:99-147`), so they are scored on exactly the same five
metrics derived from `e`/`m`/`c`/`p` as the audio-led personas.

**[corrected 2026-07-27]** They are scored on the same inputs but not on the same scale. A hybrid's
score is `clamp01(audioScore * 0.85 + bonus * 0.15)` (`persona-scorer.ts:176`, applied to the four
personas declared `kind: "hybrid"` at `persona.ts:214/241/268/295`), so a zero bonus
is not neutral — it is a flat 15% handicap against every audio-led persona in the same top-3 race.
That is the mechanism behind the whole bottom half of the coverage table: the four metadata-starved
personas take the four lowest ranks (33.1%, 13.6%, 0.8%, 0.0%) while the five audio-led ones each
clear 47%.

`theme_hunter`, whose entire premise is title-derived theme tags, therefore has nothing to
distinguish it, carries the handicap, and never reaches the top three. **Relaxing the top-3 rule
alone will not revive it.**

The fix does not need reclassification: composer, year and title come from SID file headers and
paths, not from rendered audio, and `metadata-cache.ts` already exists. It does need a local HVSC
matching the export's corpus — which the release does not currently record (§4.3), so that has to be
established first.

### Recommendation

The product already ships a better category primitive than the one it exposes. **Make the quintiles
the category axis** — "Slow" = `e ∈ {1,2}`, exactly the calmest 40%, monotone, guaranteed pool size,
no overlap — and demote personas to a presentation-layer convenience over those. Then:

- Replace the forced top-3 mask with a threshold, so a track carries the personas it actually earns
  and mid-energy tracks can carry none.
- Delete or redefine `theme_hunter`; it has no data behind it.
- Consider deriving categories from the 58-dim vector rather than from 3 quintiles. The information is
  there — the export threw away a 58-dimension description and then labelled tracks from three
  numbers. `slow_ambient` currently cannot distinguish a quiet arpeggio étude from a sparse noise
  piece; the vector can.

That last point is the structural observation of this audit: **v3 made similarity 14.5× richer and
left categories exactly as coarse as they were.** For the intersection use case the user wants, the
category axis is now the binding constraint.

---

## 10. Prioritised actions

**Before anything else consumes v3 as `latest`:**

1. ~~Merge `fix/libsidplayfp-wasm-pin-and-residfp-audit`~~ — **done 2026-07-27, `1e59ab6`.** What
   remains is the half the merge did not do: land the three spec docs. Published data still outruns
   published tooling by a full revision, and the stale specs are now on `main`. (§3.2)
2. Fix the manifest self-checksum ordering bug and republish the manifests for v3. (§4.1)
3. Publish `SIMILARITY_VECTOR_WEIGHTS` in the lite and full manifests and document them in both
   specs. This is ~600 bytes that takes third-party recommendation quality from 0.40 to 0.99. (§5.2)
4. Notify `u64deck` of the 1 GB / 269 MB change and the metric switch before users discover it. (§8)
   Notify `c64commander` that "Game Themes" is an empty station and that `fast_paced` / `slow_ambient`
   overlap on 10.8% of the corpus — it is already pinned to this release. (§9)
5. Stop tiny's favourites fallback overwriting the neighbour walk (`scores.size === 0` guard, or
   delete the fallback). Every station SIDFlow's own tiny reader builds today is ranked by a 4-dim
   rating cosine with at most 125 distinct values. Code-only; no artefact changes. (§5.3, F7)

**Next:**

6. Report the measured `neighbor_row_count`, not `tracks × k`. (§4.2)
7. Add `hvsc_version` to all three manifests; publish basenames instead of build-host absolute paths.
   (§4.3, §4.4)
8. Set tiny's `hasVectorData: false`, or stop synthesising a 4-dim rating vector from
   `getTrackVectors`. (§5.3)
9. Re-encode full: `float32` vector BLOB, neighbours as one BLOB per seed, 64 KB pages. ~1014 MB →
   ~430 MB with zero information loss. (§6, §7)

**Then:**

10. Publish a features sidecar (~60–90 MB) so `u64deck` and future consumers stop downloading 1 GB for
    the 37% of it they want. (§7)
11. Widen tiny's file identity from `md5_48` to `md5_64`. (§5.3)
12. Diversify neighbours away from same-file subsongs, or expose file grouping so consumers can.
    (§5.4)
13. Rebuild the category axis on the quintiles, and reconsider deriving it from the 58-dim vector.
    (§9)
14. **Gate station populations at export time.** The deeper gap behind F6 is that the export has no
    notion of how big a station is, so nothing objected when one persona shipped with 0 members and
    another with 673 while five carried ~45,000 — a 69× spread among the non-empty ones. Guarantee
    population by construction (assign each persona the top *X*% by its own score, the way ratings
    already guarantee 20% buckets), then fail the export on a floor, an upper bound, a spread ratio
    and zero overlap between conflicting personas. A population floor alone is not enough: a persona
    whose ranking is degenerate — `theme_hunter` has at most 125 distinct scores — would pass the
    floor while remaining meaningless, which is worse than empty because it misleads silently rather
    than visibly failing. (§9)

**Also worth closing:** 209 tracks present in v2 are missing from v3 with no recorded reason. (§3.1)

---

## Appendix A — reproduction

```bash
# artefacts
gh release download sidcorr-hvsc-full-20260726T203707Z -D v3   # 1.0 GB + lite + tiny + manifests
gh release download sidcorr-hvsc-full-20260407T115218Z -D v2
sha256sum -c SHA256SUMS

# size attribution
sqlite3 v3/sidcorr-hvsc-full-sidcorr-1.sqlite \
  "SELECT name, SUM(pgsize), SUM(payload), SUM(unused) FROM dbstat GROUP BY name ORDER BY 2 DESC;"

# audit scripts (git-ignored)
bun  run tmp/audit/dump-lite.ts   v3/…-lite-1.sidcorr  lite3.vec lite3.ids
python3  tmp/audit/dump-full.py   v3/…-sidcorr-1.sqlite full3.vec full3.ids
python3  tmp/audit/cmp.py         # lite vs full vector fidelity
python3  tmp/audit/neigh.py       # neighbour recall, 3000 seeds
python3  tmp/audit/fav.py         # favourites-station agreement, 400 trials
python3  tmp/audit/samefile.py    # same-file neighbour rates
python3  tmp/audit/mid.py         # nine intermediate-tier candidates, built and measured
python3  tmp/audit/delta.py       # v2 vs v3 corpus, ratings, feature keys
python3  tmp/audit/slim.py v2|v3  # u64deck's own slim_database against each export
bun  run tmp/audit/style.ts       # persona distribution and overlap
```

**F7 (added 2026-07-27)** is reproduced from source rather than from the published artefacts: build a
small corpus through `buildSimilarityExport` → `buildLiteSimilarityExport` → `buildTinySimilarityExport`
with ratings ordered against the vector geometry, open it, and compare `recommendFromFavorites`
against both `getNeighbors` on the same seed and an independent cosine over `[e, m, c, p ?? 3]`. The
second matches to full precision; the first does not appear in the result at all. That check belongs
in `packages/sidflow-common/test/` as a regression test — see the prompt's A5.

## Appendix B — key source locations

Line numbers are `c282fd5` (tag `0.7.0`), which is now also `main`. Pre-merge `main` (`4f41ed2`) is
given in brackets where it differs; "0.7.0 only" means the file or symbol does not exist on
`4f41ed2` at all.

| Concern | Location |
|---|---|
| Manifest checksum ordering bug | `packages/sidflow-common/src/similarity-export.ts:1346` (pre-merge `main`: `:1156`) |
| `neighbor_row_count` computed not measured | same file, `:1359` (pre-merge `main`: `:1167`); measured value written then overwritten, `:1308` → `:1324` |
| Weight table (not published anywhere) | `packages/sidflow-common/src/vector-similarity.ts:78`, `SIMILARITY_VECTOR_WEIGHTS` (0.7.0 only — pre-merge `main` has only the 24-entry `PERCEPTUAL_VECTOR_WEIGHTS`) |
| Weighting selected by vector width | same file, `weightsForDimensions():98`, `cosineSimilarity():114` |
| Rank-uniform normalisation | `packages/sidflow-common/src/similarity-export.ts:1126`, `normaliseVectorsByRank()` (0.7.0 only) |
| Lite PQ encoding | `packages/sidflow-common/src/similarity-export-lite.ts`, `buildScalarCodebooks():167` |
| Lite favourites ranking (correct) | same file, `scoreRows():238`, ranks at `:265` |
| Tiny `hasVectorData` / `getTrackVectors` | `packages/sidflow-common/src/similarity-export-tiny.ts:848`, `:914` |
| **Tiny favourites fallback overwrites the walk (F7)** | same file, walk `:995-1021`, fallback `:1023-1046` |
| Tiny `md5_48` resolution throws on a miss | same file, `:198`; style mask written at `:542` |
| Persona mask from ratings only | `packages/sidflow-common/src/similarity-portable.ts:83`, `computeSimilarityStyleMask()` |
| Hybrid personas' 0.85/0.15 blend | `packages/sidflow-common/src/persona-scorer.ts:176`; bonus `:99-147`; definitions `persona.ts:209-320` |
| Release gate | `scripts/verify-published-exports.ts` (0.7.0 only); weak tiny assertion at `:132` |
| `sidflow-data` tag scheme | `scripts/run-similarity-export.sh`, `release_tag():179` |
| `u64deck` full-only asset choice | `u64deck/server.py:4740` |
| `u64deck` checksum verification | `u64deck/server.py:4821` |
| `u64deck` slim + neighbour count check | `u64deck/sidflow_similarity.py:213`, `:364` |
| `u64deck` metric switch | `u64deck/sidflow_similarity.py:533` (`rank`) |

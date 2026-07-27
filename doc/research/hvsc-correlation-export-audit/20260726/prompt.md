# Implementation prompt — remediate the HVSC export audit findings as 0.8.0

**Read [`review.md`](./review.md) first.** It is the evidence base for everything below; every number
quoted here was measured against the published artefacts and is reproducible via its Appendix A.

Your job is to close the audit findings and ship the result as **`0.8.0`**, tagged identically in
`chrisgleissner/sidflow` and `chrisgleissner/sidflow-data`, plus a migration document for consumers
moving from the 0.5-era data release to 0.8.

---

## Why 0.8.0 and not 0.7.1

Semver reserves PATCH for **backward-compatible bug fixes only**. This release is not that:

| Change | Semver class |
|---|---|
| `vector_weights`, `similarity_metric`, `hvsc_version` added to manifests (A3, A5) | added functionality → MINOR |
| `.sqlite.gz` asset and the features sidecar published (B1, B2) | new artefacts → MINOR |
| tiny's `hasVectorData` flips to `false`, `getTrackVectors()` returns nothing (A5) | library behaviour change → MINOR |
| persona station membership changes for ~10% of the corpus (B3) | shipped-data semantics change → MINOR |
| export gains a hard population gate and `style_populations` in the tiny manifest (B4) | added functionality + new failure mode → MINOR |
| `sidflow-data` release tags change scheme (C1) | published naming contract → MINOR |
| manifest checksum, measured neighbour count, path hygiene (A1, A2, A5) | genuine PATCH material |

The last row alone would be 0.7.1. Everything above it is additive or behaviour-changing, so the
release as scoped is a MINOR. Under the 0.y.z convention the ecosystem actually uses (`^0.7.1` admits
0.7.x but not 0.8.0), shipping this as a patch would silently pull the changes into consumers
pinned to `^0.7`.

**On version runway:** bumping MINOR in 0.y.z costs nothing. 0.8.0 → 0.9.0 → **0.10.0** → 0.11.0 is
valid semver and sorts correctly; there is no ceiling at 0.9 and no pressure toward 1.0.0. 1.0.0 is a
statement that the public API is stable, which is a decision to make deliberately — not something
minor bumps drift you into.

If a pure 0.7.1 is wanted first, the only legitimate scope is A1, A2 and the path hygiene in A5:
strictly corrective, no new fields, no new assets, no behaviour change. Everything else then lands in
0.8.0. This is more release work for little benefit — A3, the highest-value item in the audit, is
additive and would be stuck behind the split.

---

## Hard constraints

These are not negotiable. Violating any of them invalidates the work.

1. **No reclassification.** Do not re-render, re-extract features, or re-classify any part of HVSC.
   Every artefact you ship must be derived deterministically from the existing
   `sidcorr-hvsc-full-20260726T203707Z` release assets. The classification run that produced them
   took a full corpus pass and is not to be repeated.

2. **Asset filenames must not change.** `u64deck` resolves
   `https://github.com/chrisgleissner/sidflow-data/releases/latest/download/<name>` with `<name>`
   hardcoded (`sidflow_similarity.py:31-35`). These four names are a public API:
   - `sidcorr-hvsc-full-sidcorr-1.sqlite`
   - `sidcorr-hvsc-full-sidcorr-1.manifest.json`
   - `SHA256SUMS`
   - (plus the lite/tiny bundles and their manifests, same names as today)

   New assets may be **added**. Existing ones may not be renamed or removed.

3. **`sidcorr-1`, `sidcorr-lite-1` and `sidcorr-tiny-1` stay wire-compatible.** Do not change any
   schema version string, any binary layout, or any persona bit assignment. `u64deck` hard-refuses a
   `schema_version` it does not recognise (`sidflow_similarity.py:64-68`); a bump would take its
   SIDFlow features offline entirely. Structural improvements are deferred — see Part E.

4. **Do not retag or delete the historical `sidflow-data` releases.** Their download URLs are live.
   The new naming convention applies going forward; the mapping between old and new is documented,
   not rewritten.

5. **Every claim in the release notes and migration doc must be measured**, not carried over from
   this prompt. Re-derive the numbers from the artefacts you actually publish.

---

## Part A — correctness (blocking)

### A1. Fix the manifest self-checksum, and repair the published artefact

*Finding F1, review §4.1. The declared `file_checksums.sqlite_sha256` has never matched the published
file, in any release.*

**Root cause.** `packages/sidflow-common/src/similarity-export.ts:1156` (`:1346` on the 0.7.0 branch)
hashes the temporary database, then writes the manifest — including that hash — into the database's
`meta` table, mutating the bytes that were just hashed.

**Fix the exporter** so the invariant holds by construction:

- The copy embedded in `meta.manifest_json` **omits `file_checksums` entirely**. A file cannot contain
  its own digest; stop pretending it can.
- Hash the file **after** the final write.
- The sidecar `*.manifest.json` carries the true digest.

> **Keep `file_checksums.sqlite_sha256` in the sidecar.** `u64deck` falls back to it when `SHA256SUMS`
> has no matching entry (`server.py:4821-4823`) and raises `"No SHA-256 checksum was published"` if it
> is absent or not 64 hex chars. Removing it from the sidecar would break that path.

**Refresh the existing SQLite's manifest through the export tool, not a bespoke patcher.** The full
export is the one artefact that cannot be regenerated — rebuilding it means reclassifying, which
constraint 1 forbids. Its *data* is correct and verified (review §4.5); only the manifest embedded in
its `meta` table is wrong. So make manifest generation a re-runnable stage of the existing tool rather
than a stage welded to classification:

Add `--rewrite-manifest` to `sidflow-play export-similarity --format sqlite`, taking an existing
`sidcorr-1` database and recomputing its manifest **from the database's own contents** —
`track_count` from `tracks`, `neighbor_row_count` from `neighbors`, `vector_dimensions` from the
stored vectors, `feature_schema_version` from the column — then rewriting `meta.manifest_json`,
`VACUUM`ing, hashing, and writing the sidecar. This is an ordinary SQL update plus a vacuum, in the
tool that owns the format. It must be idempotent: running it twice on its own output produces
byte-identical results. Assert that in a test.

Reuse the same code path in the normal export so there is exactly one manifest writer. That is what
makes A2's measured-count fix and A5's manifest fields land in both the fresh-export and the
refresh path automatically.

**Then regenerate lite and tiny from it** — see the regeneration chain in A1b. Their
`source_checksums`, `generated_at` and `file_checksums.bundle_sha256` all follow from that rebuild;
there is no manifest bookkeeping to do by hand.

**Acceptance**
- `sha256sum` of every published asset matches both `SHA256SUMS` and the corresponding manifest field.
- A test in `packages/sidflow-common/test/` builds a small export and asserts
  `sha256(file) == manifest.file_checksums.sqlite_sha256`. This test must fail against today's code.
- `--rewrite-manifest` run twice is byte-stable.

### A1b. Regenerate lite and tiny through the existing scripts

**No artefact is patched in place.** Lite and tiny are *derived* formats and the CLI already exposes
their derivations as first-class commands, so every fix to them is a fix to the builder plus a
rebuild:

```bash
# 1. refresh the full export's manifest in place (A1) — the only artefact that cannot be rebuilt
sidflow-play export-similarity --format sqlite --rewrite-manifest \
  --output data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite

# 2. lite, derived from the full export
sidflow-play export-similarity --format lite \
  --source-sqlite data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite

# 3. tiny, derived from lite, with the full export as neighbour hint
sidflow-play export-similarity --format tiny \
  --source-lite data/exports/sidcorr-hvsc-full-sidcorr-lite-1.sidcorr \
  --neighbor-source-sqlite data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite
```

Step 3 resolves every `sid_path` against `config.sidPath` and **throws** on the first miss
(`similarity-export-tiny.ts:198`), so a mismatched HVSC fails loudly rather than producing silently
wrong `md5_48` identities.

**Two properties make this safe, and both must be proven before you change anything.**

*The lite build is deterministic.* Its PQ codebook is quantile-based — sort each dimension, take
equal-count buckets, use the bucket mean as the centroid (`similarity-export-lite.ts:171-190`). There
is no k-means and no RNG, so identical input yields identical output.

*Therefore the pipeline is reproducible, and that is your baseline.* **Before applying any fix**, run
steps 2 and 3 with today's code against the *published* full export and assert the results are
**byte-identical to the published lite and tiny bundles** (`fe92bd57…a346cd` and `081664d8…cba7c5`).

This single check does three jobs:

1. proves the derivation is deterministic and the published bundles really came from this pipeline;
2. **identifies the HVSC release empirically** — tiny only reproduces byte-for-byte if the local HVSC
   is the one the export was built from, which resolves the open question in A5 without guesswork;
3. establishes a baseline so that after the fixes, every byte that differs is attributable to a change
   you intended.

If the reproduction fails, **stop and diagnose before proceeding.** A non-reproducible pipeline is a
finding in its own right and changes the shape of this work.

**Acceptance**
- Baseline reproduction of published lite and tiny is byte-exact, and the command to reproduce it is
  committed as a script.
- Final lite and tiny are produced only by the commands above — no bespoke tool writes into a bundle.
- The regenerated bundles differ from the published ones **only** in the fields the fixes touch:
  style masks (B3), manifest additions (A3, A5), `generated_at`, and the checksums that follow.
  Enumerate the diff and justify every part of it.

### A2. Report the measured neighbour count

*Finding F1b, review §4.2.*

`similarity-export.ts:1167` writes `neighbor_row_count: tracks.length * neighborCount` — a computed
value. `insertNeighbors()` already returns the number actually inserted and it is discarded. Use the
returned value.

This is not cosmetic: `u64deck` **hard-fails the import** when the actual row count differs from the
manifest (`sidflow_similarity.py:364`), with no fallback. Today's export happens to be exact
(2,196,700 = 87,868 × 25, verified) so the repaired manifest carries the same number — but the next
export with one under-filled seed would brick every `u64deck` install.

**Acceptance:** manifest `neighbor_row_count` equals `SELECT COUNT(*) FROM neighbors` on the shipped
file. Add a regression test with a corpus small enough that some seed cannot fill `k`.

### A3. Publish the similarity weights

*Finding F2, review §5.2. This is the highest-value fix in the release.*

`SIMILARITY_VECTOR_WEIGHTS` (58 entries, range 0.328–2.109,
`packages/sidflow-common/src/vector-similarity.ts`) defines the similarity metric and exists only in
TypeScript source. A third party implementing the published lite spec computes plain cosine and gets
**R@1 = 0.478 and 40% station overlap** against the authoritative result, versus 0.983 / 98% with the
weights applied.

Add to the **full and lite manifests**:

```jsonc
"vector_weights": [0.4375, 0.4375, /* … 58 numbers … */],
"similarity_metric": "weighted-cosine"
```

~600 bytes. Then document in `doc/similarity-export.md` and `doc/similarity-export-lite.md`:

- the exact scoring function, including that weighting is applied to **both** the dot product and both
  norms (`cosineSimilarity` in `vector-similarity.ts` — it is not a plain reweighting of the dot
  product, and getting this wrong produces subtly different rankings);
- that weighted cosine is scale-invariant per vector, so lite's L2-normalised vectors reproduce the
  full export's ranking exactly once weights are applied — the normalisation is not an obstacle;
- that a consumer ignoring the weights gets roughly half the correct neighbours, with the measured
  numbers.

Also state that weighting is selected by vector width via `weightsForDimensions()`, and that widths
≤ 4 are legacy ratings vectors that receive no weighting.

**Acceptance:** an independent reimplementation that reads only the lite bundle and its manifest
reproduces the full export's top-25 at R@25 ≥ 0.98 on a 1,000-seed sample. Ship that check as
`scripts/verify-lite-against-full.ts` so it can be run on any future release.

### A4. Land the 0.7.0 branch and its specifications

*Finding F3, review §3.2.*

Tag `0.7.0` points at `c282fd5`, which is contained **only** in
`origin/fix/libsidplayfp-wasm-pin-and-residfp-audit` — 87 commits ahead of `main`, unmerged. Both the
published data *and* the published SIDFlow release were cut from an off-`main` branch, while `main`'s
specs still document `--dims 3|4` and say nothing about 58 dimensions, rank-uniform normalisation, or
the weight schedule.

1. Merge the branch to `main`. Resolve honestly; do not squash away the station-quality history —
   `doc/station-quality.md` is the record of why the vector is shaped as it is.
2. Bring `doc/similarity-export.md`, `doc/similarity-export-lite.md` and
   `doc/similarity-export-tiny.md` up to what the artefacts actually contain:
   - the 58-dimension vector and its three groups (24 perceptual from rendered audio, 11 pitch/texture,
     23 from the playroutine's SID register-write trace) — this is currently documented only in the
     release-notes generator in `scripts/run-similarity-export.sh`, which is the wrong place for it;
   - `vector_normalisation: "rank-uniform"`, what it means (per-dimension rank onto `[0,1]`, ties get
     the average of the ranks they span), and that it makes every dimension **corpus-relative**;
   - `sid_engine`, and that it differs from the `render_engine` column (which reads `wasm` for both
     emulations);
   - the weight table (A3);
   - the ratings are **exact rank-uniform quintiles** — `e=1` means "calmest fifth of this corpus",
     not "objectively calm". Document this as intentional, because it is the property that guarantees
     every category has a usable pool.
3. Remove the `--dims 3|4` documentation, or mark it explicitly legacy.

**Acceptance:** `git branch -a --contains 0.7.0` includes `main`. `grep -c '58' doc/similarity-export*.md`
is non-zero in all three. No spec describes a behaviour the shipped artefact does not have.

### A5. Manifest hygiene: HVSC version, paths, tiny vector claim

*Findings §4.3, §4.4, §5.3.*

**`hvsc_version`** — `corpus_version` is the bare string `"hvsc"` in every release, so nothing records
which HVSC the `sid_path` values belong to. Every consumer resolves against a local collection, so this
is part of the data's identity.

Determine it empirically for the existing export rather than guessing:

- resolve the tiny bundle's `md5_48` file identities against a local HVSC and report the match rate;
  a near-100% match identifies the release, a partial match identifies which;
- cross-check the file count (61,157) and the 795-track delta against v2.

Record `"hvsc_version"` (base release plus applied deltas, the shape of `workspace/hvsc-version.json`)
in all three manifests. **If it cannot be established from evidence, write `"unknown"` — do not guess.**
Separately, fix the pipeline to read it from `workspace/hvsc-version.json` at export time so no future
release has this problem.

**Paths** — the v3 full manifest publishes the build host's absolute path
(`/mnt/data/dev/c64/sidflow/data/exports/…`). Emit basenames only, in every profile. The v2 tiny
manifest leaked `/home/chris/…`; that one is already fixed, so match its behaviour.

**Tiny's `hasVectorData`** — `openTinySimilarityDataset` reports `hasVectorData: true` while
`getTrackVectors()` returns `[e, m, c, p ?? 3]`: a 4-element rating vector with at most 125 distinct
positions across 87,868 tracks, below `LEGACY_RATINGS_VECTOR_MAX_DIMENSIONS` so it receives no
weighting. A consumer branching on `hasVectorData` and doing centroid arithmetic silently reproduces
the exact v2 degeneracy this release fixed.

Set `hasVectorData: false` and make `getTrackVectors()` return an empty map. This is a code change
only — the tiny bundle bytes are unaffected. Document in the tiny spec that the profile carries **no
embedded vectors** and that its retrieval model is a decayed walk over the 3-neighbour graph, not
vector search.

**Acceptance:** no manifest contains an absolute path. `hvsc_version` present in all three. Tiny's
`info.hasVectorData` is `false` and a test asserts `getTrackVectors()` returns nothing.

---

## Part B — consumer relief (should ship in 0.8.0)

Everything here is additive or data-only. Nothing changes a schema version or a binary layout.

### B1. Publish a compressed full export

*Finding F5, review §6.*

The full SQLite is 1,013,977,088 bytes. **Measured: gzip -6 yields 199,515,386 bytes — 5.08×
smaller.** `u64deck` currently streams the full 1 GB.

Publish `sidcorr-hvsc-full-sidcorr-1.sqlite.gz` as a first-class release asset with its own
`SHA256SUMS` entry, alongside the uncompressed file (constraint 2 — the plain `.sqlite` stays).
Document the pairing in the full spec and in the `sidflow-data` README so a consumer can choose.

The existing `hvsc-full-sidcorr-1-<timestamp>.tar.gz` bundle stays as-is; it serves a different
purpose (everything in one archive) and its name encodes a timestamp that the new tag scheme replaces.
State in the release notes which asset a consumer should prefer and why.

### B2. Publish a features sidecar

*Review §7. This is the only genuinely missing tier.*

The audit measured nine candidate intermediate exports and found no useful tier between full and lite:
once `features_json` is dropped and vectors are binary-encoded, the artefact is 31.7 MB — four times
lite, not thirty. **The chasm is an encoding artefact, not an information gap.** What is actually
missing sits on the other side: the raw feature records, which is precisely what `u64deck` downloads
1 GB to obtain and then discards the rest of.

Emit `sidcorr-hvsc-full-features-1.jsonl.gz` from the existing full SQLite — one JSON object per line,
`{"track_id": …, "sid_path": …, "song_index": …, "features": {…}}`, sorted by `track_id`, with its own
manifest recording `feature_schema_version`, `track_count`, `hvsc_version` and the source SQLite digest.

Measured inputs for your sizing check: `features_json` is 381,275,214 bytes raw across 87,868 tracks
(avg 4,339 B), 129 keys per record. Expect 60–90 MB gzipped; **report what you actually get.**

A consumer then needs 8 MB (lite) + the sidecar instead of 1,014 MB. Document it as a supplementary
artefact for consumers deriving their own representation — not as a fourth tier, and not as something
required for recommendation.

### B3. Make persona masks self-consistent

*Finding F6, review §9. Data-only; bit assignment must not change.*

> **This is a live product bug, not a theoretical one.** `c64commander`'s SID Radio consumes the
> **tiny** export (pinned to `sidcorr-hvsc-full-20260726T203707Z` in
> `src/lib/sidRadio/sidcorrRelease.ts`) and surfaces **all nine personas as user-facing station
> tiles** — "Fast-Paced", "Chill / Ambient", "Composer Deep-Dive", "Game Themes". Station membership
> is literally `bundle.styleMask[ordinal] & (1 << styleBit)`
> (`src/lib/sidRadio/stationEngine.ts:120-123`). Every defect measured below is something a user can
> see. It reads style keys, labels and bit assignments **from the bundle's STYLE_TABLE**, not from
> hardcoded constants, so fixing the export propagates on a re-pin with no client change.

Measured on the shipped tiny bundle:

- **10.8% of the corpus carries both `fast_paced` and `slow_ambient`** — ~9,500 tracks appear in two
  stations a user experiences as opposites.
- **`theme_hunter` ("Game Themes") matches 0 tracks** — a station tile that can never play anything.
- **`composer_focus` ("Composer Deep-Dive") matches 673 tracks (0.8%)** — loops almost immediately.
- Five personas each cover ~half the corpus, so a style filter barely narrows anything.

**Two independent causes. Fix both.**

**(a) The forced top-3 rule.** `computeSimilarityStyleMask()` takes the three highest-scoring personas
unconditionally, so a mid-energy track gets three labels whether or not any fits — at `e=3`, 57% of
tracks are `fast_paced` *and* 65% are `slow_ambient`. Replace it with a **score threshold**, so a
track carries the personas it earns and may carry none.

**(b) The masks are computed with no metadata at all.** `computeSimilarityStyleMask()` calls
`scoreAllPersonas({ metrics, ratings })` and passes **no `metadata` field**. The four hybrid personas
(`composer_focus`, `era_explorer`, `deep_discovery`, `theme_hunter`) are defined with a
`metadataPolicy` and earn their distinguishing signal from `composer`, `year`, `category` and
`titleThemeTags` (`persona.ts:209-320`, `persona-scorer.ts:99-137`). With `metadata` undefined,
`scoreMetadataBonus()` returns 0 for all of them and they are scored on exactly the same five metrics
derived from `e`/`m`/`c`/`p` as the audio-led personas. `theme_hunter` — whose entire premise is
title-derived theme tags — therefore can never distinguish itself and never reaches the top three.
**Thresholding alone will not revive it; it will simply stay at zero.**

The metadata comes from SID file headers and paths, not from rendered audio, so supplying it is
**not** reclassification. The full SQLite carries `sid_path` for every track, and `metadata-cache.ts`
already exists. Feed real metadata into the mask computation.

**Where the fix goes.** The style mask is written by the tiny builder —
`styleMaskTable.writeUInt16LE(computeSimilarityStyleMask(rows[index]!), …)`
(`similarity-export-tiny.ts:542`) — from the ratings carried in the lite bundle. So both causes are
fixed in `computeSimilarityStyleMask()` / `persona-scorer.ts`, and the corrected masks reach the
artefact by **rebuilding tiny through the CLI** (A1b). Nothing is patched.

For (b), `computeSimilarityStyleMask()` currently takes only `Pick<SimilarityTrackRow, "e"|"m"|"c"|"p">`.
Widen it to accept optional track metadata and thread it through from the tiny builder, which already
has the HVSC root resolved and already loads per-file data there (`loadSonglengthsData`,
`buildMd548PathMap`). Composer, title and year come from the SID header via `sid-parser.ts`; theme
tags derive from the title. Keep the metadata argument optional so callers without HVSC access still
get the audio-led personas.

**Constraints**

> **Do not change which bit belongs to which persona.** Consumers read the `u16` mask positionally —
> `c64commander` maps bit → station tile. Keep all nine positions and `style_count = 9`. Do not bump
> `binary_format_version`. Under those rules this is a data change, not a format change, and existing
> readers stay correct.

> **The rebuild must change only the style-mask section.** A1b's baseline reproduction gives you the
> published bundle byte-for-byte; after this fix, diff the new tiny against it and confirm the
> differences are confined to the style-mask table plus the manifest. Every `md5_48` identity, every
> per-file track count, every packed rating and every neighbour record must be unchanged. Assert it,
> do not eyeball it.

**Acceptance**
- No track carries both `fast_paced` and `slow_ambient`.
- Report new per-persona coverage against the audit's table (review §9). Populations are enforced by
  the hard gate in B4 — calibrate the threshold to satisfy it rather than picking a threshold and
  hoping. **B3 and B4 must be developed together**; a threshold chosen without the gate will starve
  personas that the forced top-3 rule was inflating.
- The diff against the baseline tiny bundle is confined to the style-mask section and the manifest.
- Notify `c64commander` with the before/after coverage table so it can re-pin, and recommend the two
  defensive client changes: hide or disable a style whose population is zero, and show population
  counts on the station tiles.

### B4. Guarantee station populations at export time — hard gate

*The safeguard that would have caught F6 before it shipped.*

A station with 100 tracks next to one with 30,000 reads as a defect, not as a curated selection. The
export currently has **no notion of how big a station is**, which is why it shipped one persona with
zero members and another with 673 while five others carried ~45,000 each — a 69× spread among the
non-empty ones. Fixing B3's mask logic without adding a gate just moves the numbers; it does not stop
the next export from doing the same thing.

**Guarantee population by construction, then assert it.**

The export already solves this exact problem once: ratings are rank-uniform quintiles, so every rating
bucket holds exactly 20% of the corpus by construction. Apply the same principle to personas. Instead
of an absolute score threshold — whose resulting population is whatever it happens to be — assign each
persona to **the top *X*% of tracks by that persona's own score**, with *X* chosen per persona. Every
station then has a known size before a single track is written, and the shipped populations are a
design decision rather than an accident.

This also keeps the semantics honest: a station is "the most *X* tracks in this corpus", which is what
a radio station actually is, and it matches how the ratings and the similarity vector are already
normalised (review §9).

**The gate.** In the tiny builder, accumulate per-persona populations across the mask loop
(`similarity-export-tiny.ts:542`) and **fail the export** if any of these is violated:

| Check | Recommended default | Rationale |
|---|---|---|
| Absolute floor | every persona ≥ **`max(1000, 5% of corpus)`** tracks | the user-visible floor; on HVSC that is ~4,400 |
| Upper bound | every persona ≤ **40% of corpus** | a station admitting half of everything is not a filter (review §9: five personas each cover ~50% today) |
| Spread | largest persona ≤ **4×** smallest | kills the 69× imbalance directly |
| Exclusivity | declared conflicting pairs overlap by **0 tracks** | `fast_paced` ∩ `slow_ambient` is 10.8% today |

Treat those numbers as defaults to calibrate and report, not as gospel — but do not loosen one to make
a persona pass. If a persona cannot meet the floor, that is the finding.

> **The absolute floor must scale to small corpora.** Someone exporting a private 500-track collection
> cannot satisfy "≥ 1000" and must not be blocked by a rule written for HVSC. That is why the floor is
> `max(absolute, fraction)` — express it that way, and derive both from the corpus size at export time.

**A populated station can still be a broken one.** A pure population floor would have waved
`theme_hunter` through the moment quantile assignment gave it 20% of the corpus — while its ranking
remains meaningless, because with no metadata its score is a function of three quintiles and takes at
most 125 distinct values (review §9). That is *worse* than an empty station: a dead tile is visibly
broken, a populated meaningless one silently misleads. So the gate needs a second, semantic check:

- **Tie fraction at the cut.** If more than a small fraction of the corpus is tied at the score where
  the persona's cut falls, the ranking cannot support a station — the membership is arbitrary among
  the tied set. Fail.
- **Distinctiveness.** If two personas' member sets have a Jaccard similarity above a threshold, they
  are the same station under two names. Fail, or merge them deliberately.

**Record the result.** Add `style_populations` to the tiny manifest — persona key → track count, plus
the thresholds the gate ran with. This makes the populations verifiable at download time, gives the
release gate (C4) and the migration doc a machine-readable source, and lets `c64commander` render tile
counts (D2) without a full pass over the mask table. Manifest-only, so no format break.

**The escape hatch is recorded, never silent.** A `--allow-sparse-styles` flag may bypass the gate for
a small or unusual private corpus, but when used it must write that fact into the manifest, so a
bundle produced under a waiver can never be mistaken for one that passed.

**Acceptance**
- The gate is a **hard failure**, not a warning, and it runs in the export path — not only in the
  release gate.
- Report the shipped populations for all nine personas against the audit's table (review §9), and
  state which threshold each was calibrated to.
- A test builds a corpus that deliberately starves one persona and asserts the export fails with a
  message naming that persona and its count.
- A test asserts `--allow-sparse-styles` both permits the build and records the waiver in the manifest.
- No persona ships at 0. If one cannot be made viable in this release, say so explicitly and take it
  through the deliberate route in B3 rather than shipping a dead station.

### B5. Document the quintile category axis

*Review §9, documentation only.*

The product already ships a better category primitive than the one it exposes. `e`, `m`, `c` are exact
rank-uniform quintiles (measured: 17,574 / 17,573 / 17,574 / 17,573 / 17,574 for each, all 125
`(e,m,c)` cells populated), which gives every category a **guaranteed 20% pool**, monotone ordering and
no overlap. Personas are derived from the same three numbers and collapse them to 17 distinct masks.

Document the quintiles as the intended category axis for station building — "Slow" is `e ∈ {1,2}`,
exactly the calmest 40% — with personas positioned as a presentation-layer convenience over them.
Include the measured evidence that category-restricted adaptation works: lite tracks full at 0.981–0.987
overlap@50 *inside* an energy quintile, versus 0.982 corpus-wide.

Be explicit about the limitation, because it is the binding constraint on the product: **categories are
computed from 3 quintiles while similarity uses 58 dimensions.** 0.7.0 made similarity 14.5× richer and
left categories exactly as coarse. Record this in `doc/station-quality.md` as known work, with the
measured persona coverage as the baseline to beat.

### B6. Same-file neighbour siblings

*Review §5.4, documentation plus station-layer only.*

Measured: the rank-1 neighbour is a different subsong of the **same `.sid` file** for **14.4%** of
seeds (5.1% across all 25 ranks); 905 seeds have all 25 neighbours from their own file. Subsongs are
often near-identical variants, so "most similar track" being the next subtune is a poor listening
result.

Changing the `neighbors` table shape is deferred (constraint 3, Part E). For 0.8.0:

- document the measured rate in the full spec so consumers know to diversify;
- ensure SIDFlow's own station layer excludes the seed's **file**, not just the seed track — verify
  `bdca7c3 fix(station): stop stations replaying the same tune` actually covers this and extend it if
  not;
- note it in the migration doc as a behaviour `u64deck` will now see, since its `excluded` set contains
  only the seed track (`sidflow_similarity.py:533`).

---

## Part C — release, naming and migration

### C1. Align release names across the two repositories

SIDFlow tags are bare semver (`0.7.0`, `0.6.0`, `0.5.8`). `sidflow-data` releases are currently
`sidcorr-<corpus>-<profile>-<timestamp>`, generated by `release_tag()` in
`scripts/run-similarity-export.sh:179`.

**Going forward, the `sidflow-data` release tag is the SIDFlow tag that produced it** — this release is
`0.8.0` in both repositories. Change `release_tag()` to take the SIDFlow version rather than a
timestamp, and fail loudly if it is not given a resolvable tag: a data release that cannot name its
producing tag is exactly the lineage problem this release exists to fix.

Keep the corpus and profile information — it moves from the tag into the release **title** and notes
(e.g. title `0.8.0 — HVSC full`), which is where it was always more useful.

Per constraint 4, do **not** retag history. Instead publish a mapping table in the `sidflow-data`
README and in the migration doc:

| `sidflow-data` release | SIDFlow version | Published |
|---|---|---|
| `sidcorr-hvsc-full-20260315T095426Z` | 0.5.0-era | 2026-03-15 |
| `sidcorr-hvsc-full-20260407T115218Z` | 0.5.7 / 0.5.8 | 2026-04-07 |
| `sidcorr-hvsc-full-20260726T203707Z` | 0.7.0 | 2026-07-26 |
| `0.8.0` | 0.8.0 | *this release* |

> Verify the first three rows before publishing them. The v2 assets straddle a tag boundary — the full
> SQLite's `generated_at` is `2026-04-07T11:18:09Z`, which predates tag `0.5.7` (2026-04-07 23:06),
> while its lite and tiny bundles were generated `2026-04-08T08:31`–`08:32`, between `0.5.7` and `0.5.8`
> (2026-04-09 00:30). State the real lineage, including that it is split, rather than rounding it to a
> single tag.

### C2. Migration document: 0.5 → 0.8

Split it into two clearly labelled hops, because they are different in kind and a consumer needs to
know which one affects them:

- **0.5 → 0.7.0 — the data changed.** Vector, ratings, neighbours, corpus. This is where the real
  behavioural break lives.
- **0.7.0 → 0.8.0 — the contract changed.** Manifest fields, new assets, persona masks, release
  naming. Small, but every item needs a consumer decision.


Write `doc/migration/0.5-to-0.8.md`, linked from both READMEs. Audience: someone consuming the
0.5-era data release who is moving to 0.8.0. It must be candid about how bad the old data was, because
a consumer who does not know cannot judge whether their own tuning was compensating for it.

Cover, with measured numbers:

**What was broken in the 0.5-era release**
- 15 distinct vectors across 87,073 tracks; **79,567 (91.4%) shared the literal `[3,3,3,3]`**
- ratings never took the values 1 or 5 at all: `e` 96% at 3, `m` 94% at 3, `c` 94.6% at 3
- `neighbor_row_count: 0` — the "full" export shipped with no neighbours at all
- consequence: vector-based recommendation was indistinguishable from random, and category selection
  was impossible

**What changed in the data**

| | 0.5-era | 0.7.x |
|---|---|---|
| `vector_dimensions` | 4 | 58 |
| distinct vectors | 15 | 87,717 |
| `vector_normalisation` | *(absent)* | `rank-uniform` |
| `neighbor_row_count` | 0 | 2,196,700 (25/track) |
| `feature_schema_version` | 1.3.0 | 1.5.0 (+58 keys, **none removed**) |
| `sid_engine` | *(absent)* | `sidlite` |
| tracks / files | 87,073 / 60,571 | 87,868 / 61,157 |
| full SQLite | 416 MB | 1,014 MB (199.5 MB gzipped) |
| lite | 3.29 MB | 8.12 MB |
| tiny | 1.82 MB | 1.83 MB |

**Breaking changes a consumer must act on**
- `vector_json` width changed 4 → 58. Never hardcode; read `vector_dimensions`.
- Similarity is **weighted** cosine. Read `vector_weights` from the manifest (new in 0.8.0). A
  consumer using plain cosine gets R@1 = 0.478 instead of 0.983.
- `e`/`m`/`c` are now meaningful and rank-uniform. Any threshold tuned against the old data — where
  94%+ of tracks sat at 3 — is now wrong. Rating filters need re-tuning, not carrying over.
- The `neighbors` table is populated. Consumers that prefer a precomputed cache over their own scan
  will **silently switch metric**. Decide deliberately.
- 209 track IDs present in the 0.5-era release are absent from 0.7 (1,004 are new). Handle missing
  seeds gracefully.
- Manifest `file_checksums.sqlite_sha256` was wrong in every pre-0.8.0 release. Verify against
  `SHA256SUMS`, which was always correct. From 0.8.0 both agree.
- **Every bundle digest changes in 0.8.0.** Lite and tiny are regenerated from the full export
  (A1b), and the full export's own bytes change when its manifest is refreshed. A consumer pinning a
  sha256 — `c64commander` does — must update it. State the new digests in the doc.

**A dedicated `u64deck` section** — the consumer of the full export, and the impact is concrete
(review §8, all measured by running its own `slim_database()` against both exports):

| | from 0.5-era | from 0.7.x |
|---|---:|---:|
| source download | 416 MB | **1,014 MB** (or 199.5 MB gzipped) |
| retained compact DB | 37.6 MB | **269.4 MB** |
| neighbour rows imported | 0 | 2,196,700 |
| peak disk during import | ~460 MB | **~1,290 MB** |

- Its README's "about 400 MB" and "well under 40 MB" are both now false.
- It reads `features_json`, never `vector_json`, so it was **immune to the old degeneracy** and gains
  nothing from the new vector — except through the neighbours table.
- `SimilarityStore.rank()` prefers the neighbours table when non-empty, so "♪ More like this" now
  serves SIDFlow's 58-dim weighted-cosine neighbours instead of its own 48-dim z-normalised ones. Not
  necessarily worse — SIDFlow's is the better-validated metric — but it is an unannounced switch.
- **Skipping the neighbours import returns it to ~37 MB and to its previous behaviour exactly.** Say so
  plainly; it is a one-line change on their side and may be what they want.
- `slim_database` hard-fails on a neighbour-count mismatch against a manifest field that was computed
  rather than measured (fixed in A2, but their guard is still brittle).
- `spectralContrastMean` / `spectralContrastStd` are absent on ~0.14% of tracks and coerced to 0.0,
  which for a z-normalised dimension displaces toward the corpus mean rather than being neutral.
- Recommend the `.sqlite.gz` (B1) and the features sidecar (B2) as the path off the 1 GB download.

**A `c64commander` section** — the second external consumer, and the one that reads **tiny**
(`src/lib/sidRadio/sidcorrRelease.ts` is already pinned to the 0.7.0 release):

- Ratings are meaningful for the first time. On the 0.5-era data 94%+ of tracks sat at `e=m=c=3`, so
  every Style station drew from an essentially undifferentiated pool. Any tuning done against that is
  now wrong.
- Persona coverage changes with B3, and from 0.8.0 the export **fails** rather than shipping a
  starved or wildly imbalanced station (B4). Ship the before/after table, and point at
  `style_populations` in the tiny manifest as the machine-readable source.
- It surfaces all nine personas as station tiles and does not guard against an empty one; recommend
  hiding a zero-population style and showing population counts.
- Tiny still carries no vectors (§5.3) — its retrieval is a decayed walk over the 3-neighbour graph.
  That is unchanged in 0.8.0 and is worth restating so the client does not expect vector search.

**Also record:** the 209 disappeared tracks need a cause. Investigate — check whether they were excluded
by the analysis-window or completeness changes on the 0.7.0 branch (`6742460`, `c54af22`, `e8323e0`) —
and state the finding. If the cause cannot be established without reclassifying, say that explicitly
rather than speculating.

### C3. Release 0.8.0

- Version bump across the workspace packages. Note that `main`'s root `package.json` reads `0.3.10`
  while the 0.7.0 branch reads `0.7.0`; reconcile that during the merge (A4) rather than papering over
  it.
- `CHANGES.md` entry describing the manifest fix, the published weights, the compressed and features
  assets, the persona-mask correction, and the migration doc.
- Tag `0.8.0` in `sidflow` **on `main`**, after the merge. The 0.7.0 tag pointing off-`main` is one of
  the findings; do not repeat it.
- Publish `sidflow-data` release `0.8.0` with the repaired assets.
- Update the `sidflow-data` README: the lineage table (C1), the new assets, and — per review §7 — lead
  with **lite** as the recommended default rather than listing full first. Lite reproduces full at 98%
  station overlap in 8 MB; full is for consumers that need `features_json` or SQL access.

### C4. Extend the release gate

`scripts/verify-published-exports.ts` (added on the 0.7.0 branch) is a good gate and did not catch the
findings in this audit. Add:

- sidecar `file_checksums.sqlite_sha256` equals the actual file digest, and equals its `SHA256SUMS`
  entry (would have caught F1 in both prior releases);
- manifest `neighbor_row_count` equals `SELECT COUNT(*) FROM neighbors` (F1b);
- `vector_weights` present, length equals `vector_dimensions` (A3);
- lite reproduces full's top-25 at R@25 ≥ 0.98 on a sampled seed set (§5.2) — the cross-profile
  equivalence check that does not currently exist;
- no manifest field contains an absolute path (§4.4);
- tiny reports `hasVectorData: false` (§5.3);
- no track carries mutually exclusive personas (B3);
- every persona's population clears the floor, the upper bound and the spread ratio, and
  `style_populations` in the tiny manifest matches a recount from the bundle (B4). The gate runs at
  export time, but it must also be checkable against a finished artefact — that is what catches a
  bundle built under `--allow-sparse-styles` and published by mistake.

Tighten the existing tiny assertion while you are there: `!tinyRecommendations.every(e => e.track_id === seedTrackId)`
passes if a single recommendation differs from the seed. It should be `!some(...)`.

Wire the gate into CI so it runs against a fixture, and document the command for running it against a
real release.

---

## Part D — `c64commander` client changes (sibling repo)

**Delegate this to a subagent running inside the `c64commander` worktree**, not from `sidflow`. That
repo has its own `AGENTS.md` with a task-classification model, build/test decision rules and — most
importantly here — a strict screenshot policy. An agent working from the `sidflow` checkout will not
see it and will get the screenshot handling wrong.

- **Working directory:** `/home/chris/dev/c64/c64commander-sid-radio` (a worktree of `c64commander`).
- **Branch:** `feat/sid-radio` — the existing branch. **Do not create a new one.** Commit onto it.
- **First action:** read that repo's `AGENTS.md` and follow it. It governs classification, which test
  suites run, and which screenshots may be regenerated. Where it conflicts with anything below,
  `AGENTS.md` wins — flag the conflict rather than silently choosing.

### D1. Guard against zero-population styles

`SID_RADIO_STYLE_TILES` (`src/pages/playFiles/hooks/useSidRadio.ts:389-399`) hardcodes all nine
persona tiles with client-side labels. Station membership is `bundle.styleMask[ordinal] & (1 << bit)`
(`src/lib/sidRadio/stationEngine.ts:120-123`), and nothing checks whether a style has any members.

Measured on the currently pinned bundle (review §9): **`theme_hunter` / "Game Themes" matches 0
tracks** — a tile that can never play anything — and `composer_focus` / "Composer Deep-Dive" matches
673 (0.8%).

Read per-style population from `style_populations` in the tiny manifest (added in B4), falling back
to a single pass over `bundle.styleMask` for older bundles that lack it. Then **hide or disable a
tile whose population is zero**. This is defensive: the export may ship an empty style
again, and the client should degrade visibly rather than offering a dead station. Keep the existing
`{ type: "empty" }` fallback as the backstop.

### D2. Show population counts on station tiles

With five personas each covering roughly half the corpus and one covering 0.8%, a user has no way to
tell a broad station from a nearly empty one. Surface the count on each tile, from the same source as D1. This is a small change that makes the
data's shape legible and will keep doing so as the export changes.

From 0.8.0 the export gates on population (B4), so the spread should be narrow. The count is still
worth showing: it is how a user — and you — notice the day it stops being narrow.

Follow the repo's own design conventions for where the count goes; do not invent a new tile layout.

### D3. Re-pin to the 0.8.0 data release

**Only after `sidflow-data` `0.8.0` is published** (Part C). Update `SIDCORR_RELEASE_TAG` in
`src/lib/sidRadio/sidcorrRelease.ts` and the bundle sha256 beside it. Note the comment there: *"the
build script keeps its own `SIDCORR_RELEASE` copy and a test asserts the two"* — update both, and let
that test verify it.

Also fix the stale reference in `docs/plans/sid-station/spec.md`, which still cites release
`sidcorr-hvsc-full-20260407T115218Z` (§2.1) while the code is pinned to the 0.7.0 release. That is the
0.5-era bundle whose ratings were 94% identical — a materially misleading citation.

Re-pinning changes station membership for roughly 10% of the corpus (B3). Sanity-check that the
overlap between "Fast-Paced" and "Chill / Ambient" is gone and report the new per-tile populations
against the audit's table.

### D4. Screenshots — minimal, per `AGENTS.md`

D1 and D2 change visible documented UI, so this classifies as a **`UI_CHANGE`**. `AGENTS.md` §"Minimal
screenshot rule" is explicit: update **only** the corresponding files under `docs/img/`, and *"never
refresh the entire screenshot corpus unless explicitly required"*.

The likely affected files — confirm against what actually changes, do not refresh on assumption:

- `docs/img/app/play/sid-radio/02-stations.png` — the station tile grid, which is what D1 and D2 alter
- `docs/img/app/settings/sections/15-sid-radio.png` and `docs/img/app/settings/sid-radio.png` — only if
  the settings surface changes, which it probably does not

Regenerate with `npm run screenshots` (which runs the `@screenshots` Playwright tag and then
`revert-identical-pngs.mjs` to prune unchanged output). Scope the run as narrowly as the harness
allows.

**Report exactly which screenshot files changed and why**, per `AGENTS.md`'s reporting requirements.
If none changed, say that — do not claim a refresh that did not happen.

### D5. Sequencing

D1, D2 and D4 can land immediately against the currently pinned 0.7.0 bundle — the empty "Game
Themes" tile is a live defect today. D3 blocks on Part C. Do not hold the guard work behind the
re-pin.

**Acceptance**
- No station tile is offered that cannot produce a track.
- Every tile shows its population.
- `SIDCORR_RELEASE_TAG` and the build script's copy agree, and the test that asserts it passes.
- Screenshot changes are minimal, enumerated, and justified.
- The work is on `feat/sid-radio`, with `AGENTS.md`'s required reporting in the summary.

---

## Part E — explicitly deferred to 0.9.0

Do **not** attempt these in 0.8.0. Record them in `doc/station-quality.md` or a follow-up plan with the
measured justification from `review.md`, so the reasoning is not lost.

| Deferred | Why not in 0.8.0 | Measured payoff |
|---|---|---|
| Re-encode full: `float32` vector BLOB, neighbours as one BLOB per seed, 64 KB pages or drop `WITHOUT ROWID` | Breaks `sidcorr-1`; `u64deck` refuses an unknown `schema_version` outright | **1,014 MB → ~430 MB**, zero information loss (review §6–7) |
| `md5_48` → `md5_64` in tiny | Changes the binary layout | collision probability 0.66% → ~10⁻⁷ over 61,157 files (§5.3) |
| Neighbour diversification (`same_file` flag, or export 30 and let consumers drop siblings) | Changes the `neighbors` table shape | removes the 14.4% rank-1 sibling rate (§5.4) |
| Categories derived from the 58-dim vector rather than 3 quintiles | Needs design and validation, not a patch release | the binding constraint on the category+similarity product (§9) |

For the re-encode specifically: variant **G** in review §7 (drop `features_json`, `uint16` vectors, no
neighbours table) measured **31.7 MB**. The neighbours table alone accounts for 231 MB of the current
file — seven times everything else combined. That is where the 0.9.0 work should start.

---

## Definition of done

- [ ] Every published asset's digest matches both `SHA256SUMS` and its manifest field.
- [ ] `--rewrite-manifest` is idempotent — proven by test, not by inspection.
- [ ] The **baseline reproduction passed**: lite and tiny rebuilt from the *published* full export with
      pre-fix code are byte-identical to the published bundles (A1b). Without this, nothing else in
      this list is trustworthy.
- [ ] Lite and tiny were **regenerated by the CLI**, not patched. No tool writes into a bundle's
      interior. The diff against the baseline is enumerated and every part of it is attributable to an
      intended fix.
- [ ] An independent reader using only the lite bundle and its manifest reaches R@25 ≥ 0.98 against
      the full export.
- [ ] `0.7.0` is contained in `main`; `0.8.0` is tagged on `main` in `sidflow` and as the release name
      in `sidflow-data`.
- [ ] `doc/migration/0.5-to-0.8.md` exists, is linked from both READMEs, and every number in it was
      re-measured against the artefacts actually published.
- [ ] The three format specs describe the artefacts as shipped — width, normalisation, weights,
      quintiles, engine — with no remaining `--dims 3|4` guidance.
- [ ] `u64deck` has been notified, in writing, of the size change, the metric switch, and the
      neighbour-skip option.
- [ ] Every persona clears the population gate; `style_populations` is in the tiny manifest and
      matches a recount from the bundle; the gate fails the build when starved, proven by test (B4).
- [ ] `c64commander`'s `feat/sid-radio` branch carries the zero-population guard, the tile population
      counts, the 0.8.0 re-pin, and a minimal, enumerated screenshot refresh (Part D).
- [ ] The extended release gate passes against the 0.8.0 assets and fails against the 0.7.0 ones.
- [ ] No reclassification was run.

# Notice for `u64deck`: SIDFlow data release 0.8.0

**Draft for sending as a `u64deck` issue.** Not yet sent — see the checklist at the end.

---

Hello — SIDFlow has published a new `sidflow-data` release, and three things in it affect
`u64deck` in ways you would probably rather hear from us than discover from a bug report.
One of them is already live for your users, because you resolve
`releases/latest/download/…` and the previous release became `latest` on 2026-07-26.

Nothing needs to change on your side for `u64deck` to keep working. But two of these are
decisions we think you should make deliberately rather than inherit.

## 1. The download is 2.4× bigger, and the retained database is 7×

| | before (2026-04-07 release) | now |
|---|---:|---:|
| source download | 416 MB | **982 MB**, or **194 MB** for the new `.gz` |
| retained compact DB | 37.6 MB | **269.4 MB** |
| neighbour rows imported | 0 | 2,196,700 |
| peak disk during import | ~460 MB | ~1,290 MB |

Your README currently says *"The source is about 400 MB … The retained database is
normally well under 40 MB."* Both sentences are now false.

The retained-DB and peak-disk figures were measured by running your own `slim_database()`
against both exports. 0.8.0 changed no track and no neighbour row relative to the release
that is currently `latest`, so those numbers carry over unchanged; the download figures
are measured against the 0.8.0 assets.

**On a Windows box with a modest SSD this is a visible regression**, and the import path
writes the full download into the application directory before deleting it.

## 2. Your recommendation metric has silently switched

This is the one we would most like you to look at.

`SimilarityStore.rank()` prefers the neighbours table whenever it is non-empty. The
2026-04-07 export shipped with **0 neighbour rows**, so every query brute-forced your own
48-dimension z-normalised metric. The current export has 2,196,700 rows, so the table wins,
and **"♪ More like this" now returns SIDFlow's 58-dimension weighted-cosine neighbours
instead of yours.**

These are different metrics producing different results. Whether it is an improvement is
arguable — ours is the better-validated one — but it is a behaviour change in your product
triggered by a data download, which is not how anyone wants to ship a change.

Your fall-through is well designed: if fewer than `limit` neighbours survive the
`present_paths` filter, the partial result is discarded and brute force runs, so there is
no hard failure. Two edges worth knowing about:

- Stored depth is 25 and "More like this" requests up to 20, so the table path is normally
  taken in full. **A user with a partial HVSC will oscillate between the two metrics**
  depending on the seed.
- **Radio tops up repeatedly** from recently played tunes. Drawing from a fixed
  25-neighbour pool per seed rather than the whole corpus will increase repetition within a
  session.

**If you want your own metric back, skip importing neighbours entirely.** It is a one-line
change, it saves 232 MB, and it restores the previous behaviour exactly. If you want ours,
adopt it deliberately and drop the redundant brute-force path.

## 3. Two new assets, either of which removes the 1 GB download

Both are additive. **No existing filename changed** — we know you resolve them from a
hardcoded list, so we treat those four names as a public API.

- **`sidcorr-hvsc-full-sidcorr-1.sqlite.gz`** — 194,351,886 bytes, 5.05× smaller. Same
  file, same schema. The plain `.sqlite` stays alongside it.
- **`sidcorr-hvsc-full-features-1.jsonl.gz`** — 75,933,721 bytes. One JSON object per line,
  sorted by `track_id`: `{"track_id", "sid_path", "song_index", "features"}`, with its own
  manifest recording `feature_schema_version`, `track_count`, `hvsc_version` and the source
  digest.

The second one exists **because of you.** You never read `vector_json` — you extract your
own 48-dimension vector from `features_json`, z-normalise it corpus-wide, and discard the
rest. So you download the whole export to obtain the ~37% of it you actually want, and
until now there was no artefact offering just that.

If you want the features and nothing else, `lite` (8.1 MB) plus this (76 MB) is 84 MB
against 982 MB.

Two consequences of you never reading `vector_json` that are worth stating, because they
cut both ways:

- **You were immune to the old vector degeneracy.** The 2026-04-07 export had 15 distinct
  vectors across 87,073 tracks, with 91.4% sharing the literal `[3,3,3,3]`. Your
  `duplicate_vector_ratio` guard measured 0.0057 and correctly did not fire, because you
  never used that vector.
- **For the same reason, you gain nothing from the new 58-dimension vector** except through
  the neighbours table.

## 4. Smaller things

**Your neighbour-count guard was pointing at a field that was computed, not measured.**
`slim_database` raises when the neighbour row count differs from
`manifest.neighbor_row_count`, and until 0.8.0 that field was `track_count × k` rather than
`SELECT COUNT(*)`. They happen to coincide for HVSC (2,196,700 = 87,868 × 25), so nothing
has failed — but a single seed that could not fill `k` would have bricked every import with
no fallback. **Fixed in 0.8.0: the field is now measured.** Your guard is still brittle
against any other producer, so consider treating a mismatch as a warning that skips
neighbours rather than failing the import.

**The manifest digest was wrong in every release before 0.8.0.** `file_checksums.sqlite_sha256`
never matched the file it described, because the exporter hashed the database and then
wrote that hash into it. You survived by preferring `SHA256SUMS` and falling back to the
manifest field only when `SHA256SUMS` has no entry — correct by luck of ordering rather
than by design. From 0.8.0 both agree.

**`excluded` contains the seed track, not the seed file.** Measured across the export's
2,196,700 neighbour rows, the rank-1 neighbour is a different subsong of the **same `.sid`
file** for **14.4%** of seeds, and 905 seeds have all 25 neighbours from their own file.
Subsongs are frequently near-identical variants, so "More like this" will often open with
the next subtune of the tune just played. Excluding the seed's `sid_path` rather than its
`track_id` fixes it.

**`spectralContrastMean` / `spectralContrastStd` are absent on ~0.14% of tracks.**
`_numeric_feature` coerces those to `0.0`, which for a z-normalised dimension is a silent
displacement toward the corpus mean rather than a neutral value.

**New manifest field: `hvsc_version`** (e.g. `"HVSC 85 + Update 85"`). Your README has to
tell users that "paths that no longer match the installed HVSC version fail gracefully" —
this lets you say *which* version, and diagnose the mismatch instead of describing it.

## 5. Release naming changed

From 0.8.0 a `sidflow-data` release tag is the SIDFlow version that produced it — this one
is `0.8.0`, not `sidcorr-hvsc-full-<timestamp>`. Historical releases are **not** retagged,
so every URL you may have pinned still resolves. `releases/latest/download/…` is unaffected.

## In priority order, if you only do some of this

1. Update the two size claims in your README before users hit them.
2. Decide, don't inherit, the metric. Skipping the neighbours import takes you back to
   ~37 MB and to the previous behaviour exactly.
3. Take `.sqlite.gz`, or better, `lite` + the features sidecar.
4. Exclude the seed's file, not just the seed track.

Full detail, with every number and how it was measured, is in
`doc/migration/0.5-to-0.8.md` in the SIDFlow repository.

---

## Before sending

- [ ] Confirm the `sidflow-data` `0.8.0` release is published and its assets are downloadable.
- [ ] Re-check `SimilarityStore.rank()`, `slim_database()` and the README quotes against
      `u64deck`'s current `main` — the line references here are from the export audit and
      may have moved.
- [ ] Decide where this goes: a `u64deck` issue, or a direct message.

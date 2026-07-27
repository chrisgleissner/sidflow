# Notice for `u64deck`: SIDFlow data release 0.8.0

**Draft for sending as a `u64deck` issue.** Not yet sent — see the checklist at the end.

---

Hi — SIDFlow has published a new `sidflow-data` release. Nothing needs to change on your
side for `u64deck` to keep working, but there are a couple of things you may want to know
about, and two new assets that might make your life easier.

## Smaller downloads, if you want them

The full SQLite export has grown (it now carries 25 precomputed neighbours per track and a
58-dimension vector). Two new assets sit alongside it, both additive — **no existing
filename changed**, since we know you resolve them from a hardcoded list:

| Asset | Size | What it is |
|---|---:|---|
| `sidcorr-hvsc-full-sidcorr-1.sqlite.gz` | 194 MB | the same full export, gzipped — 5× smaller |
| `sidcorr-hvsc-full-features-1.jsonl.gz` | 76 MB | just the raw feature records, one JSON object per line |

The second one exists because of you. You build your own 48-dimension vector from
`features_json` and never touch `vector_json`, so most of the full export is payload you
discard. If that's still how it works, `lite` (8 MB) + the features sidecar (76 MB) gives
you everything you use without the rest.

Each line is `{"track_id", "sid_path", "song_index", "features"}`, sorted by `track_id`,
with its own manifest recording `feature_schema_version`, `track_count`, `hvsc_version`
and the source digest. Happy to adjust the shape if something else would suit you better.

## One behaviour change worth a look

`SimilarityStore.rank()` prefers the neighbours table when it's non-empty. The 2026-04-07
export shipped with **zero** neighbour rows, so in practice every query fell through to
your own 48-dimension metric. The current export has 2.2M rows, so the table now wins —
which means "♪ More like this" is serving SIDFlow's neighbours rather than yours.

Either behaviour is reasonable; we'd just rather you picked one than inherited it. If you
prefer your own metric, skipping the neighbours import restores the previous behaviour
exactly and drops ~230 MB from the retained database. If you prefer ours, the brute-force
path becomes redundant.

Two details that might inform the choice:

- Stored depth is 25 and "More like this" asks for up to 20, so the table path is normally
  taken in full — but a user with a partial HVSC will fall through to brute force on some
  seeds and not others.
- Radio tops up repeatedly from recent tunes. A fixed 25-neighbour pool per seed will
  repeat sooner within a session than a whole-corpus scan.

## Small things you might find useful

- **`hvsc_version` is new in the manifest** (e.g. `"HVSC 85 + Update 85"`). Your README
  mentions that paths not matching the installed HVSC fail gracefully — this lets you say
  *which* version, if that's worth surfacing.
- **`neighbor_row_count` is now measured** rather than computed as `track_count × k`. Your
  import raises on a mismatch; the field is now trustworthy, though you may still prefer a
  warning-and-skip over a hard failure for robustness against any producer.
- **`file_checksums.sqlite_sha256` in the manifest now matches the file.** It didn't in
  earlier releases — you were unaffected because you prefer `SHA256SUMS`, which was always
  correct. Both agree from 0.8.0.
- **Same-file siblings**: 14.4% of rank-1 neighbours are a different subsong of the same
  `.sid`. If "More like this" opening with the next subtune isn't what you want, excluding
  the seed's `sid_path` rather than its `track_id` handles it.
- `spectralContrastMean` / `spectralContrastStd` are missing on ~0.14% of tracks and
  coerced to `0.0`. For a z-normalised dimension that lands near the corpus mean rather
  than being neutral — probably immaterial at that rate, but worth knowing it's there.

## Release naming

From 0.8.0 a `sidflow-data` release tag is the SIDFlow version that produced it. Earlier
releases keep their timestamp tags — nothing is retagged, every existing URL still
resolves, and `releases/latest/download/…` is unaffected.

Full detail, with how each number was measured, is in `doc/migration/0.5-to-0.8.md` in the
SIDFlow repository. Happy to answer anything.

---

## Before sending

- [ ] Confirm the `sidflow-data` `0.8.0` release is published and its assets are downloadable.
- [ ] Re-check `SimilarityStore.rank()` and `slim_database()` against `u64deck`'s current
      `main` — those references came from the export audit and may have moved.
- [ ] Decide where this goes: a `u64deck` issue, or a direct message.

# Similarity Export Tiny Specification

Schema ID: sidcorr-tiny-1
Status: Normative
Current binary_format_version: 2 (readers MUST also accept version 1; see §5.4)

---

# 1. Purpose

This specification defines a compact binary projection of SIDFlow's portable similarity export for:

- deterministic style filtering
- fast local neighbor expansion
- offline matching against later HVSC revisions

It is intended for weak-device runtimes that need a small file, simple parsing, and deterministic behavior.

Non-goals:

- full vector search reconstruction
- exact reproduction of SQLite centroid ranking
- runtime style inference from raw metadata or audio
- replacing the authoritative SQLite export

sidcorr-tiny-1 is a lossy runtime format derived from sidcorr-1.

Recommended filenames:

- uncompressed file: `sidcorr-<corpus>-<profile>-sidcorr-tiny-1.sidcorr`
- optional compressed variant: `sidcorr-<corpus>-<profile>-sidcorr-tiny-1.sidcorr.gz`

The on-disk format is byte-aligned. The compact fields are:

- 48-bit file identities
- 24-bit neighbor target ordinals
- an 8-bit quantized similarity byte per neighbor edge (binary_format_version 2)
- a 16-bit packed compact-rating word per track (binary_format_version 2)

Consumers MAY widen those fields in RAM after loading.

---

# 2. Terminology

The repository uses persona in code. This specification uses style at the export boundary.

- style definition = canonical listening-mode definition from shared persona modules
- style score = continuous score from the shared scorer
- style mask = boolean projection stored in the tiny export

There is no separate style taxonomy.

---

# 3. Normative Sources

The following repository surfaces are normative:

- `packages/sidflow-common/src/persona.ts`
  Canonical style IDs, labels, kinds, metric weights, directions, rating targets, metadata policy.
- `packages/sidflow-common/src/persona-scorer.ts`
  Canonical style scoring formulas and metadata affinity weights.
- `packages/sidflow-common/src/style-assignment.ts`
  Canonical corpus-relative style assignment and the population gate.
- `packages/sidflow-common/src/persona-metadata.ts`
  Canonical derivation of composer, year, category, theme tags, prominence, year position
  and directory rarity from SID headers and HVSC paths.
- `packages/sidflow-common/src/similarity-export.ts`
  Canonical sidcorr-1 identity and ordering model: `track_id = sid_path#song_index`, sorted by `sid_path`, then `song_index`.
- `packages/sidflow-play/src/station/queue.ts`
  Canonical similarity-first station behavior.
- `packages/sidflow-play/src/persona-station.ts`
  Current deterministic metric derivation used for style-oriented projection.
- `packages/sidflow-common/src/songlengths.ts`
  Canonical MD5 handling for SID files.
- `packages/sidflow-common/src/sid-parser.ts`
  Canonical SID header metadata source.

Style definitions and scoring MUST come from `@sidflow/common`. The tiny format MUST NOT redefine style rules.

## 3.1 Current Style Catalog

sidcorr-tiny-1 currently projects these 9 shared styles:

| styleId | styleKey | styleLabel | styleKind |
|--|--|--|--|
| 0 | fast_paced | Fast Paced | audio |
| 1 | slow_ambient | Slow / Ambient | audio |
| 2 | melodic | Melodic | audio |
| 3 | experimental | Experimental | audio |
| 4 | nostalgic | Nostalgic | audio |
| 5 | composer_focus | Composer Focus | hybrid |
| 6 | era_explorer | Era Explorer | hybrid |
| 7 | deep_discovery | Deep Discovery | hybrid |
| 8 | theme_hunter | Theme Hunter | hybrid |

---

# 4. Identity Model

sidcorr-tiny-1 distinguishes:

- file identity: one SID file, matched across HVSC versions
- track identity: one playable subsong inside that file

The export-local dense track ordinal is not a cross-version identity.

The stable cross-version key is:

```text
stable_track_key = (stable_file_identity, song_index)
```

Where `stable_file_identity` is the first 6 bytes of the SID file MD5 digest (`md5_48`).

## 4.1 File Identity Mode Selection

The current `sidcorr-tiny-1` generator MUST encode `stable_file_identity` as `md5_48`.

Rules:

1. builders MUST compute the full SID-file MD5 digest and truncate it to the leading 6 bytes
2. exports MUST reject duplicate 6-byte prefixes within the current corpus
3. readers MUST interpret every file identity record as exactly 6 raw MD5 bytes

Path-based identity encoding is not part of the current `sidcorr-tiny-1` format. Any future identity-mode expansion MUST ship under a new schema revision with its own layout and validation rules.

## 4.2 Track Ordering

Track ordinals MUST follow sidcorr-1 ordering:

1. `sid_path` ascending, bytewise UTF-8
2. `song_index` ascending, numeric

File ordinals MUST follow first appearance in that ordered track stream.

## 4.3 Subsong Mapping Optimization

sidcorr-tiny-1 MUST NOT store per-track file IDs or per-track subsong IDs.

It stores one byte per file:

```text
fileTrackCountMinus1[fileOrdinal] = track_count_for_file - 1
```

At load time:

```text
fileTrackStart[0] = 0
fileTrackStart[i + 1] = fileTrackStart[i] + fileTrackCountMinus1[i] + 1
```

Then resolve any track ordinal `t` to:

- `fileOrdinal = upper_bound(fileTrackStart, t) - 1`
- `song_index = (t - fileTrackStart[fileOrdinal]) + 1`

---

# 5. Binary Layout

## 5.1 Endianness

- little-endian

## 5.2 Header (64 bytes)

| Offset | Field | Type | Notes |
|--|--|--|--|
| 0 | magic | 8 bytes | ASCII `SIDTINY1` |
| 8 | binary_format_version | u16 | current value `2`; readers MUST accept `1` and `2` (see §5.4) |
| 10 | header_bytes | u16 | MUST be `64` |
| 12 | track_count | u32 | total subsongs |
| 16 | file_count | u32 | total SID files |
| 20 | style_count | u16 | current max `16` |
| 22 | neighbors_per_track | u16 | MUST be `3` |
| 24 | file_id_kind | u8 | `1 = md5_48` |
| 25 | neighbor_ref_width_bytes | u8 | MUST be `3` |
| 26 | neighbor_ref_kind | u8 | `1 = absolute_track_ordinal` |
| 27 | style_mask_width_bytes | u8 | MUST be `2` |
| 28 | style_table_version | u16 | current value `1` |
| 30 | graph_flags | u16 | bit `0` = acyclic exported edges (always `1`). The current generator writes `0x0007`; consumers MUST ignore bits they do not recognize |
| 32 | style_table_offset | u32 | byte offset |
| 36 | file_identity_offset | u32 | byte offset |
| 40 | file_track_count_offset | u32 | byte offset |
| 44 | style_mask_offset | u32 | byte offset |
| 48 | neighbors_offset | u32 | byte offset |
| 52 | style_table_bytes | u32 | section length |
| 56 | file_identity_bytes | u32 | section length |
| 60 | neighbors_bytes | u32 | section length |

The section-length fields at offsets 52/56/60 are authoritative. Remaining
section lengths are derived:

```text
file_track_count_bytes = file_count * 1
style_mask_bytes       = track_count * 2
rating_table_bytes     = track_count * 2      # binary_format_version 2 only (see §5.4, §9.1)
neighbors_bytes        = track_count * 3 * 3  # binary_format_version 1 (u24 target only)
neighbors_bytes        = track_count * 3 * 4  # binary_format_version 2 (u24 target + u8 similarity)
```

## 5.3 Section Order

Sections MUST appear in this order:

1. `STYLE_TABLE`
2. `FILE_IDENTITY_TABLE`
3. `FILE_TRACK_COUNT_TABLE`
4. `STYLE_MASK_TABLE`
5. `RATING_TABLE` (binary_format_version 2 only, §9.1)
6. `NEIGHBOR_TABLE`

Sections MUST be tightly packed. In binary_format_version 1 the `RATING_TABLE`
is absent and `NEIGHBOR_TABLE` follows `STYLE_MASK_TABLE` directly.

## 5.4 Binary Format Versions

`binary_format_version` (header offset 8) selects the neighbor-record width and
whether the optional RATING_TABLE is present. Both versions share the header,
`STYLE_TABLE`, `FILE_IDENTITY_TABLE`, `FILE_TRACK_COUNT_TABLE`, and
`STYLE_MASK_TABLE` layouts.

| Aspect | version 1 | version 2 (current) |
|--|--|--|
| Neighbor record | `u24` target only (3 bytes) | `u24` target + `u8` quantized similarity (4 bytes) |
| `neighbors_bytes` | `track_count * 3 * 3` | `track_count * 3 * 4` |
| RATING_TABLE (§9.1) | absent | present, immediately before `NEIGHBOR_TABLE` |

Because the header stores every section offset and the three section-length
fields, a reader determines the encoding without a separate feature flag:

```text
style_mask_bytes   = track_count * 2
rating_present      = (version >= 2) AND
                      (neighbors_offset == style_mask_offset + style_mask_bytes + track_count * 2)
neighbor_similarity = (version >= 2) AND
                      (neighbors_bytes == track_count * 3 * 4)
```

Version 1 exports remain valid; version 2 is a strict superset that adds the
per-edge similarity byte and the per-track compact-rating word.

---

# 6. STYLE_TABLE

## 6.1 Section Header

| Field | Type | Notes |
|--|--|--|
| style_table_version | u16 | current value `1` |
| style_count | u16 | must match file header |
| record_bytes | u16 | MUST be `28` |
| reserved | u16 | MUST be `0` |
| payload_bytes | u32 | total UTF-8 payload bytes after the records |

## 6.2 StyleRecord (28 bytes)

| Field | Type | Notes |
|--|--|--|
| styleId | u8 | stable numeric ID |
| styleMaskBit | u8 | MUST equal `styleId` |
| styleKind | u8 | `0 = audio`, `1 = metadata`, `2 = hybrid` |
| derivationType | u8 | `0 = threshold`, `1 = ranking`, `2 = metadata`, `3 = hybrid` |
| derivationFlags | u32 | reserved, current `0` |
| styleKeyOffset | u32 | offset into payload |
| styleKeyLength | u16 | bytes |
| styleLabelOffset | u32 | offset into payload |
| styleLabelLength | u16 | bytes |
| derivationConfigOffset | u32 | offset into payload |
| derivationConfigLength | u16 | bytes |
| reserved | u16 | MUST be `0` |

## 6.3 Payload Encoding

Payload is a concatenated UTF-8 blob containing:

- `styleKey`
- `styleLabel`
- `derivationConfig`

`derivationConfig` MUST use deterministic JSON serialization.

Consumers MUST treat `STYLE_TABLE` as authoritative for labels, ordering, kind, and derivation metadata.

---

# 7. FILE_IDENTITY_TABLE

## 7.1 No Section Mini-Header

The current format stores `FILE_IDENTITY_TABLE` as a bare record array with no
per-section mini-header. `file_id_kind` comes from the file header (offset 24)
and, in `md5_48` mode, the record width is fixed at 6 bytes. The section spans
exactly `file_identity_bytes` (header offset 56) `= file_count * 6` bytes,
starting at `file_identity_offset` (header offset 36).

`FILE_TRACK_COUNT_TABLE`, `STYLE_MASK_TABLE`, `RATING_TABLE`, and
`NEIGHBOR_TABLE` are likewise bare arrays with no mini-header; only
`STYLE_TABLE` carries an internal section header (§6.1).

## 7.2 `md5_48` Mode

Payload encoding:

```text
fileMd5Prefix[file_count][6]
```

Each record is exactly 6 bytes and stores the first 6 raw bytes of the binary MD5 digest.

Builders MUST compute the full MD5 digest and truncate to the first 6 bytes.

Consumers MAY widen these values to `u64` in RAM by zero-extending the high 16 bits.

## 7.3 Matching Rules

Consumers resolving an export against a local HVSC installation MUST:

1. compute or load local file identities
2. match file identities from `FILE_IDENTITY_TABLE`
3. ignore local files not referenced by the export
4. allow extra local files from newer HVSC revisions

1. if exactly one local file matches an exported prefix, resolve it
2. if multiple local files match an exported prefix, treat that export entry as unresolved

---

# 8. FILE_TRACK_COUNT_TABLE

Encoding:

```text
fileTrackCountMinus1[file_count] : u8[]
```

Constraints:

- stored value = `songs - 1`
- valid range = `0..255`
- decoded file track count = `stored + 1`
- sum of decoded counts MUST equal `track_count`

---

# 9. STYLE_MASK_TABLE

Encoding:

```text
styleMask[track_count] : u16[]
```

Rules:

- bit `i` = membership in style `styleId = i`
- bits `>= style_count` MUST be `0`
- sidcorr-tiny-1 supports at most 16 styles

## 9.1 RATING_TABLE (binary_format_version 2)

binary_format_version 2 stores one packed compact-rating word per track,
immediately after `STYLE_MASK_TABLE` and before `NEIGHBOR_TABLE`. It is absent
in binary_format_version 1.

Encoding:

```text
compactRating[track_count] : u16[]
```

Each `u16` packs four 4-bit rating nibbles (little-endian bit order):

```text
energy     = value        & 0x0F
mood       = (value >> 4)  & 0x0F
complexity = (value >> 8)  & 0x0F
preference = (value >> 12) & 0x0F   # 0 means "no preference" (null)
```

Rules:

- each nibble is clamped to `0..15`
- a stored `preference` nibble of `0` decodes to `null` (absent), not to rating `0`
- these are the same compact ratings used to derive the style mask (§11); they are
  stored so consumers can re-rank or re-derive styles without the SQLite/lite source

## 9.2 Section Detection

A reader locates `RATING_TABLE` purely from header offsets, as described in §5.4:
when `binary_format_version >= 2` and
`neighbors_offset == style_mask_offset + track_count * 2 + track_count * 2`,
the `track_count * 2` bytes preceding `NEIGHBOR_TABLE` are the `RATING_TABLE`.

---

# 10. NEIGHBOR_TABLE

## 10.1 binary_format_version 1

Encoding:

```text
neighborTarget[track_count][3] : packed u24 triplets
```

Each row is exactly 9 bytes.

## 10.2 binary_format_version 2 (current)

Each of the 3 neighbor slots is a 4-byte record — a `u24` target ordinal
followed by a `u8` quantized similarity — so each row is exactly 12 bytes:

```text
neighborRecord[track_count][3] : { targetOrdinal: u24, similarityQ8: u8 }
```

The similarity byte quantizes the cosine similarity in `[-1, 1]`:

```text
encode(similarity) = clamp(round(((similarity + 1) / 2) * 255), 0, 255)
decode(byte)       = (byte / 255) * 2 - 1
```

A reader distinguishes the two layouts from `neighbors_bytes` (§5.4):
`track_count * 3 * 3` is version-1 (target only); `track_count * 3 * 4` is
version-2 (target + similarity). The `u24` target and sentinel semantics below
are identical in both versions.

## 10.3 Shared Rules

Rules:

- exported edges MUST form a directed acyclic graph
- every populated target MUST be a track ordinal strictly smaller than the current track ordinal
- duplicates within a row are forbidden
- row order MUST preserve the original sidcorr-1 similarity rank among the retained edges
- `0xFFFFFF` is the unused-slot sentinel and MUST appear only after populated slots

Retention rule:

1. read the original sidcorr-1 neighbor ranking for the current track
2. scan it in stored similarity order
3. retain the first 3 targets whose track ordinal is smaller than the current track ordinal
4. write each retained edge as the absolute target track ordinal
5. if fewer than 3 qualifying targets exist, write `0xFFFFFF` sentinels for the remaining slots

Current corpus note:

- `track_count = 87,073`
- the current corpus fits comfortably within 24 bits
- 3 neighbors therefore fit in exactly 9 bytes per row

Consumers MAY widen neighbor entries to `u32` in RAM after loading.

---

# 11. Deterministic Style Derivation

Style masks are assigned **corpus-relatively**, by
`assignSimilarityStyleMasks(...)` in `packages/sidflow-common/src/style-assignment.ts`.

A station is "the most X tracks in this corpus". That cannot be decided one track at a
time, and the attempt to do so is what produced the 0.7.0 masks: each track took its
three highest-scoring personas unconditionally, so every track carried exactly three
labels whether any fitted or not. Measured on that bundle over 87,868 tracks —
`theme_hunter` matched **0** tracks, `composer_focus` **673**, five personas each covered
about half the corpus, and 10.8% of tracks carried both `fast_paced` and `slow_ambient`.

## 11.1 Required Track Context

For each track the generator uses the compact ratings:

- `e`, `m`, `c`, optional `p`

and, for the four **hybrid** styles, per-file metadata parsed from the SID header and the
HVSC path:

- `composer` — from the PSID `author` field, falling back to the
  `MUSICIANS/<letter>/<name>/` path segment
- `year` — the first four-digit year in the PSID `released` field
- `category` — the top-level HVSC directory (`DEMOS`, `GAMES`, `MUSICIANS`)
- `titleThemeTags` — content words derived from the title
- plus three corpus-relative signals: composer prominence, year position, and directory
  rarity (see §11.3)

This costs no extra I/O: the generator already reads every `.sid` file to compute its
`md5_48` identity, and the header is parsed from the same buffer. It is **not**
reclassification — none of it comes from rendered audio.

A generator without a local collection may omit the metadata. The hybrid styles then
score on audio alone, and this is stated rather than silently degraded.

## 11.2 Rating-Normalized Proxy Metrics

The scorer derives bounded proxy metrics from the compact ratings:

```text
energy = clamp01((e - 1) / 4)
mood = clamp01((m - 1) / 4)
complexity = clamp01((c - 1) / 4)
preference = p == null ? 0.5 : clamp01((p - 1) / 4)

melodicComplexity = complexity
rhythmicDensity = energy
timbralRichness = (complexity + preference) / 2
nostalgiaBias = mood
experimentalTolerance = (complexity + (1 - mood) + preference) / 3
```

Worth naming plainly: this is the entire input to the five **audio-led** styles, so each
of their scores takes at most **125 distinct values** over any corpus — one per `(e,m,c)`
cell, since `p` carries user feedback and is unset in a published export. That ceiling is
the structural limit on the category axis. Deriving styles from the 58-dimension
similarity vector is recorded as future work in `doc/station-quality.md`.

## 11.3 Persona Scoring And Bit Assignment

For each style, every track is scored, the corpus is ranked by that style's own score, and
the top share is admitted. The default share is **20%**, so on HVSC each of the nine
stations holds 17,574 tracks and the spread between the largest and smallest is exactly
1.0.

Hybrid styles blend audio and metadata:

```text
score = clamp01(audioScore * 0.45 + metadataAffinity * 0.55)
```

`metadataAffinity` is on `[0, 1]` and is normalised over the metadata fields **actually
present** for that track, so a missing field neither helps nor hurts. When a track has no
usable metadata at all, the style falls back to the audio score with no blend — and
therefore no handicap.

Each field contributes its **content**, not its presence:

| Style | Signal | Derivation |
|---|---|---|
| `composer_focus` | composer prominence | `log(tracks by composer) / log(max tracks by any composer)` — log-scaled because 68% of composers have exactly one tune, so a linear share would put nearly all of them indistinguishably near zero |
| `era_explorer` | year position | the year's **rank** among the corpus's years, on `[0,1]` oldest to newest — rank rather than min-max because a single unparseable `released` field otherwise stretches the axis |
| `deep_discovery` | directory rarity | how sparse the track's containing directory is relative to the corpus |
| `theme_hunter` | theme tag richness | content-word count from the title, saturating at four |

`category` is deliberately **not** scored. It resolves for essentially every track and has
no principled ordering, so it could only ever contribute a constant, and a constant cannot
rank anything.

### Exclusivity

Declared conflicting pairs are assigned so that **no track carries both**. A track
contested by two goes to whichever ranks it better relative to that style's own
distribution; the loser reaches one place further down its own list, so exclusivity costs
nothing in population.

| Pair | Why |
|---|---|
| `fast_paced` / `slow_ambient` | a listener experiences these as opposites |
| `melodic` / `experimental` | at equal populations they came out at Jaccard 0.659, sharing 79% of their tracks — two tiles playing the same station |

Declaring a pair exclusive is a **format decision, not a claim about the music**. Plenty of
SID music is both harmonically rich and timbrally adventurous; the rule files each such
tune under its stronger fit, which is what a music director does when assigning a track to
a format.

### Ties

Ties at a style's cut are broken by a hash of the track id, not by corpus order. Corpus
order would hand every tie to the same low-ordinal tracks, so the same tunes would win
every tie for every listener. A hash is still arbitrary, but arbitrary *uniformly*: the
admitted slice of a tied group is spread across the collection rather than concentrated at
its start.

### A track may carry no styles

This is a legitimate and common outcome — 15.3% of HVSC — and it is the property the
forced top-3 rule could not express. Consumers must not assume every track has a station.

Bits outside the declared style table MUST remain unset.

## 11.4 Population Gate

The generator **fails the export** rather than shipping a station a user would experience
as broken. Checks, with the defaults calibrated against HVSC:

| Check | Default | Rationale |
|---|---|---|
| Absolute floor | every style ≥ `max(1000, 5% of corpus)` | the user-visible floor; ~4,393 on HVSC |
| Upper bound | every style ≤ 40% of corpus | a station admitting half of everything is not a filter |
| Spread | largest ≤ 4× smallest | kills the 69× imbalance of 0.7.0 |
| Exclusivity | conflicting pairs overlap by 0 tracks | |
| Tie fraction at cut | ≤ 12% of corpus tied at the cut score | a populated station whose membership is decided inside one tie is *worse* than an empty one: a dead tile is visibly broken, a populated meaningless one misleads silently |
| Distinctness | pairwise Jaccard ≤ 0.55 | above this, two styles are the same station under two names |

Both population bounds are capped by what the corpus can supply, so a 500-track private
collection is not blocked by a rule written for HVSC. The two semantic checks stand down
below 1,000 tracks, where they measure discreteness rather than distribution.

Measured on the 0.8.0 HVSC export: all nine styles at 17,574 tracks (20.0%), spread 1.0,
zero conflicting overlap, worst tie-at-cut 7.03%, worst pairwise Jaccard 0.386.

`--allow-sparse-styles` bypasses the gate for a corpus that genuinely cannot support nine
stations. When used, the violations it bypassed are written into the manifest as
`style_population_waiver`, so a bundle produced under a waiver can never be mistaken for
one that passed.

The manifest also carries `style_populations` (style key → track count) and
`style_population_policy` (the thresholds the gate ran with), so populations are verifiable
at download time without a pass over the mask table — which is what lets a client render a
track count on each station tile.

---

# 11.5 Sidecar Manifest

The sidecar manifest is written beside the bundle with the same basename and a
`.manifest.json` extension:

- `schema_version` — `sidcorr-tiny-1`
- `binary_format_version` — currently `2`
- `generated_at`, `corpus_version`
- `hvsc_version` — which HVSC release the file identities were computed from, e.g.
  `"HVSC 85 + Update 85"`, or `"unknown"`. **Load-bearing for this profile in a way it is
  not for the others**: tiny stores a 48-bit MD5 prefix of each `.sid` file's bytes and
  nothing else, so a consumer whose collection differs resolves *nothing at all* and has
  no diagnostic to work from. Inherited from the source lite bundle.
- `track_count`, `file_count`, `style_count`
- `style_populations` — style key → member count, for all nine
- `style_population_policy` — the gate thresholds this build ran with
- `style_population_waiver` — present **only** when `--allow-sparse-styles` bypassed a
  failing gate, listing the violations it bypassed
- `file_id_kind` — `md5_48`
- `neighbors_per_track` — `3`
- `content_encoding`, `bundle_bytes`, `bundle_bytes_uncompressed`
- `paths.bundle`, `paths.manifest` — basenames only
- `source.lite`, `source.hvsc_root`, `source.sqlite_neighbor_hint`
- `source_checksums.lite_sha256`, `source_checksums.sqlite_neighbor_hint_sha256`
- `file_checksums.bundle_sha256`

## Integration cost, stated up front

This profile requires the consumer to **have HVSC locally and MD5 every file** to resolve
any path at all. That is a real integration cost and it should be discovered here rather
than after implementation. A consumer that only needs recommendations, and can afford
8 MB, will have an easier time with `sidcorr-lite-1`, which carries paths directly.

`md5_48` is a 48-bit prefix. Over HVSC's 61,157 files the birthday probability of at least
one collision is ≈ 0.66%. The generator detects collisions at build time and names both
files rather than silently mislabelling tracks, but the margin is thin and the next HVSC
will make it thinner. Widening to `md5_64` costs 122 KB and drops the probability to
~10⁻⁷; it changes the binary layout, so it is deferred to a future schema revision.

---

# 12. Runtime Consumption

## 12.0 This profile carries no vectors

sidcorr-tiny-1 stores **no embedded vectors and no similarity floats**. Its 1,834,993
bytes on HVSC decompose exactly as:

| Section | Bytes |
|---|---:|
| file identities, `md5_48` @ 6 B × 61,157 | 366,942 |
| per-file subsong count, 1 B × 61,157 | 61,157 |
| style mask, 2 B × 87,868 | 175,736 |
| packed ratings, 2 B × 87,868 | 175,736 |
| neighbours, 3 B ordinal + 1 B similarity × 3 × 87,868 | 1,054,416 |
| header + style table | ~1,006 |

That is why the bundle barely moved (+0.9%) when the similarity vector went from 4 to 58
dimensions: **its size is independent of vector width**.

**The retrieval model is a decayed walk over the 3-neighbour graph, not vector search.**
A reader MUST report `hasVectorData: false` and MUST NOT synthesise a vector from the
packed ratings.

SIDFlow's own reader did exactly that until 0.8.0: it reported `hasVectorData: true` and
returned `[e, m, c, p ?? 3]` — a 4-element rating vector with at most 125 distinct
positions across 87,868 tracks, sitting exactly at the legacy ratings width so it received
no weighting either. A consumer that branched on the flag and did centroid arithmetic
silently reproduced the 0.5-era degeneracy the vector work existed to fix.

The same synthesised vector was, worse, the actual ranking key for favourites: the reader
computed the neighbour walk and then overwrote every score with a cosine over those four
numbers. Measured on a purpose-built corpus, a seed whose stored neighbours were `T6` @
0.867 and `T7` @ 0.725 got them back **5th and 7th**, behind two tracks that were not its
neighbours at all, and all 11 returned scores matched an independent rating cosine to 12
decimal places while taking only **5 distinct values**. Fixed in 0.8.0; the bundle bytes
were never involved.

A consequence worth stating: **a favourites query whose seeds have no neighbour edges
returns nothing**, rather than falling back to a ranking over a key known to be
degenerate. An empty result is the honest answer when the graph has nothing to say.

Consumers needing vector arithmetic should use `sidcorr-lite-1`, which carries the real
58-dimension vectors in 8 MB.

## 12.1 Graph traversal

Runtime behavior uses the exported 3-edge graph plus style masks.

## 12.2 Reverse Index

Consumers SHOULD build a reverse adjacency index once at load time:

```text
reverseCount[track_count] : u16[]
reverseOffset[track_count + 1] : u32[]
reverseSource[edge_count] : u32[]
```

On the current corpus, this reverse index costs about 1,567,318 bytes of RAM.

## 12.3 Station Traversal

Single-seed traversal:

1. initialize the frontier with the seed track
2. read stored parent edges in row order
3. read the reverse-child slice from the reverse index
4. traverse breadth-first, considering parents first and then reverse children
5. admit a candidate only if its `styleMask` matches the requested filter
6. continue expansion through admitted and non-admitted nodes

Multi-seed aggregation:

```text
rankWeight(rank) = neighbors_per_track - rank
candidateScore += seedWeight * rankWeight(rank)
```

Then:

1. deduplicate by track ordinal
2. sort by `candidateScore` descending
3. tie-break by best individual parent-edge rank
4. tie-break by track ordinal ascending
5. apply style-mask admission

---

# 13. Validation Rules

Generators MUST validate:

1. `styleId == styleMaskBit`
2. `style_count <= 16`
3. `sum(fileTrackCountMinus1 + 1) == track_count`
4. every style bit set in `STYLE_MASK_TABLE` corresponds to a `STYLE_TABLE` record
5. no bits `>= style_count` are set
6. style assignment is reproducible byte-for-byte from the same inputs
7. every exported `md5_48` prefix is unique within the export corpus
8. every neighbor row contains no duplicates and only backward references
9. every populated target resolves to an in-range track ordinal
10. `0xFFFFFF` sentinels appear only after populated slots
11. track ordering matches sidcorr-1 ordering exactly
12. exported graph acyclicity holds by construction

Consumers MUST validate:

1. header magic and version
2. section offsets and sizes within file bounds
3. `style_table_version` compatibility
4. `file_id_kind` and `neighbor_ref_kind` support
5. that `md5_48` resolution never guesses when multiple local files share the same prefix
6. that reverse-index construction accounts for exactly all non-sentinel edges

---

# 14. Size Analysis

Current measured corpus:

- files: 60,571
- tracks: 87,073
- max `song_index`: 256
- styles: 9

Current sidcorr-tiny-1 size in `md5_48` mode (binary_format_version 2, the
published full-HVSC bundle):

| Section | Bytes |
|--|--:|
| Header | 64 |
| STYLE_TABLE | 942 |
| FILE_IDENTITY_TABLE (`md5_48`) | 363,426 |
| FILE_TRACK_COUNT_TABLE | 60,571 |
| STYLE_MASK_TABLE | 174,146 |
| RATING_TABLE | 174,146 |
| NEIGHBOR_TABLE (`3 x (u24 + u8)`) | 1,044,876 |
| Total | 1,818,171 |

Total current size: about 1.734 MiB. This equals the published bundle's
`bundle_bytes`. A binary_format_version 1 export of the same corpus omits the
`RATING_TABLE` and uses 9-byte neighbor rows (`NEIGHBOR_TABLE = 783,657`),
totalling 1,382,806 bytes.

Comparison:

- versus `md5_64 + 3 x u24`: saves 121,142 bytes, about 8.06%
- versus `md5_128 + 5 x u32`: saves 1,563,513 bytes, about 53.08%

Current path-mode size would be 3,793,438 bytes, about 3.618 MiB.

---

# 15. MD5 Prefix Decision

Measured current-corpus results from `Songlengths.md5`:

- 100% unique within the first 4 bytes
- 100% unique within the first 5 bytes
- 100% unique within the first 6 bytes

Projected future-growth collision probabilities for `10,000` additional files:

- first 4 bytes: about `14.16%`
- first 5 bytes: about `0.0596%`
- first 6 bytes: about `0.000233%`

Decision:

- 4 bytes is too risky
- 5 bytes is acceptable but less convenient to widen in RAM
- 6 bytes stays compact, byte-aligned, and comfortably below the requested 1% risk budget

Therefore:

- builders MUST store the first 6 raw MD5 bytes in md5 mode
- consumers MAY widen those values to `u64` in RAM
- full 128-bit MD5 storage is not used in sidcorr-tiny-1

---

# 16. Summary

sidcorr-tiny-1:

- reuses the shared style catalog and scorer
- stores style membership as a deterministic bitmask projection
- matches files across HVSC revisions by 6-byte MD5 prefix or full path
- maps tracks through per-file subsong counts rather than per-track identity arrays
- stores 3 acyclic similarity edges per track as absolute `u24` parent ordinals on disk, each carrying a quantized `u8` similarity byte in binary_format_version 2
- stores one packed `u16` compact-rating word per track in binary_format_version 2
- rebuilds reverse reachability once at load time for runtime traversal

This is the authoritative tiny-format specification for the current SIDFlow codebase.
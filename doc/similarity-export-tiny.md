# Similarity Export Tiny Specification

Schema ID: sidcorr-tiny-1
Status: Draft (normative)

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

The on-disk format is byte-aligned. The only compact fields are:

- 48-bit file identities
- 24-bit neighbor entries

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
  Canonical style scoring formulas and metadata bonus weights.
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

Where `stable_file_identity` is chosen per export as either:

- first 6 bytes of the SID file MD5 digest (`md5_48`)
- full HVSC-relative UTF-8 path

## 4.1 File Identity Mode Selection

The generator MUST choose the shorter correct representation for the current corpus:

- `md5_48` mode bytes = `6 * file_count`
- `hvsc_path_utf8` mode bytes = `8 * file_count + sum(utf8_length(path))`

`md5_48` mode MAY be used only if both are true:

1. the export corpus has no duplicate 6-byte MD5 prefixes
2. the projected probability of at least one future prefix clash stays below 1% for the next 10 years assuming 1,000 new SID files per year

Use:

```text
p_collision ~= 1 - exp(-(n * m + m * (m - 1) / 2) / 2^48)
```

Where:

- `n` = current file count
- `m` = future file additions in the budget window

Current corpus evidence:

- file_count = 60,571
- current `md5_48` bytes = 363,426
- current distinct path bytes = 2,289,954
- current path record bytes = 484,568
- projected `md5_48` collision probability for `m = 10,000` future files: about `0.000233%`

Therefore current sidcorr-tiny-1 generation MUST select `md5_48` mode.

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
| 8 | version | u16 | MUST be `1` |
| 10 | header_bytes | u16 | MUST be `64` |
| 12 | track_count | u32 | total subsongs |
| 16 | file_count | u32 | total SID files |
| 20 | style_count | u16 | current max `16` |
| 22 | neighbors_per_track | u16 | MUST be `3` |
| 24 | file_id_kind | u8 | `1 = md5_48`, `2 = hvsc_path_utf8` |
| 25 | neighbor_ref_width_bytes | u8 | MUST be `3` |
| 26 | neighbor_ref_kind | u8 | `1 = absolute_track_ordinal` |
| 27 | style_mask_width_bytes | u8 | MUST be `2` |
| 28 | style_table_version | u16 | current value `1` |
| 30 | graph_flags | u16 | bit `0` MUST be `1` for acyclic exported edges; other bits MUST be `0` |
| 32 | style_table_offset | u32 | byte offset |
| 36 | file_identity_offset | u32 | byte offset |
| 40 | file_track_count_offset | u32 | byte offset |
| 44 | style_mask_offset | u32 | byte offset |
| 48 | neighbors_offset | u32 | byte offset |
| 52 | style_table_bytes | u32 | section length |
| 56 | file_identity_bytes | u32 | section length |
| 60 | neighbors_bytes | u32 | section length |

Derived lengths:

```text
file_track_count_bytes = file_count * 1
style_mask_bytes = track_count * 2
neighbors_bytes = track_count * 3 * 3
```

## 5.3 Section Order

Sections MUST appear in this order:

1. `STYLE_TABLE`
2. `FILE_IDENTITY_TABLE`
3. `FILE_TRACK_COUNT_TABLE`
4. `STYLE_MASK_TABLE`
5. `NEIGHBOR_TABLE`

Sections MUST be tightly packed.

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

## 7.1 Section Header

| Field | Type | Notes |
|--|--|--|
| file_id_kind | u8 | matches header |
| record_width_bytes | u8 | `6` for md5 mode, `8` for path mode |
| reserved | u16 | MUST be `0` |
| payload_bytes | u32 | total bytes after this mini-header |

## 7.2 `md5_48` Mode

Payload encoding:

```text
fileMd5Prefix[file_count][6]
```

Each record is exactly 6 bytes and stores the first 6 raw bytes of the binary MD5 digest.

Builders MUST compute the full MD5 digest and truncate to the first 6 bytes.

Consumers MAY widen these values to `u64` in RAM by zero-extending the high 16 bits.

## 7.3 `hvsc_path_utf8` Mode

Payload encoding:

```text
PathRecord[file_count]
utf8_blob[variable]
```

`PathRecord` is 8 bytes:

| Field | Type | Notes |
|--|--|--|
| pathOffset | u32 | offset into `utf8_blob` |
| pathLength | u16 | UTF-8 byte length |
| reserved | u16 | MUST be `0` |

Path values MUST be HVSC-relative UTF-8 paths without a leading slash.

## 7.4 Matching Rules

Consumers resolving an export against a local HVSC installation MUST:

1. compute or load local file identities
2. match file identities from `FILE_IDENTITY_TABLE`
3. ignore local files not referenced by the export
4. allow extra local files from newer HVSC revisions

For `md5_48` mode:

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

---

# 10. NEIGHBOR_TABLE

Encoding:

```text
neighborTarget[track_count][3] : packed u24 triplets
```

Each row is exactly 9 bytes.

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

## 11.1 Required Track Context

For each track, the generator MUST construct a deterministic style context with:

- ratings: `e`, `m`, `c`
- 24D perceptual vector
- `sid_path`
- `song_index`
- normalized metadata:
  - `composer`
  - `year`
  - `category`
  - `sidModel1`
  - `chipCount`
  - `titleThemeTags` if available
  - `rarity` if available

## 11.2 Metadata Normalization Rules

The generator MUST normalize metadata as follows:

1. `composer`
   Use SID header `author`. If blank or `unknown`, fall back to the penultimate path segment. Else use `Unknown`.

2. `year`
   Parse the first 4-digit year in `released` within `[1978, 2026]`. Else `null`.

3. `category`
   First `sid_path` segment.

4. `chipCount`
   `1 + hasSecondSID + hasThirdSID` from SID header addresses.

5. `titleThemeTags`
   Deterministic upstream metadata only. If absent, use an empty list.

6. `rarity`
   Deterministic upstream normalized score in `[0,1]` if available. If absent, treat as missing.

## 11.3 Audio Metric Derivation

Use the current deterministic formulas from `packages/sidflow-play/src/persona-station.ts`.

Definitions:

```text
normalizeRating(r) = clamp01((r - 1) / 4)
normalizeSignedResidual(x) = clamp01((x + 1) / 2)
average(xs) = arithmetic mean
normalizedEntropy(xs) = entropy(xs_positive) / log2(count(xs_positive))
```

Intermediate values:

```text
waveEntropy = normalizedEntropy([vector[5], vector[6], vector[7], vector[8]])
olderYearBias = year == null ? 0.5 : clamp01((2026 - year) / 44)
categoryBias =
  1.00 if category == "GAMES"
  0.82 if category == "DEMOS"
  0.58 if category == "MUSICIANS"
  0.50 otherwise
sidModelBias =
  1.00 if sidModel1 == "MOS6581"
  0.78 if sidModel1 == "Both"
  0.52 if sidModel1 == "MOS8580"
  0.50 otherwise
chipCountNorm = clamp01((chipCount - 1) / 2)
residualEnergy = average([normalizeSignedResidual(vector[22]), normalizeSignedResidual(vector[23])])
```

Metrics:

```text
melodicComplexity = clamp01(average([
  normalizeRating(c), vector[13], vector[16], vector[4], 1 - abs(0.5 - residualEnergy)
]))

rhythmicDensity = clamp01(average([
  vector[0], vector[1], vector[3], vector[19], normalizeRating(e)
]))

timbralRichness = clamp01(average([
  waveEntropy, vector[11], vector[12], vector[20], vector[21], residualEnergy
]))

nostalgiaBias = clamp01(average([
  olderYearBias, categoryBias, sidModelBias,
  (chipCount == 1 ? 0.82 : 0.46), normalizeRating(m)
]))

experimentalTolerance = clamp01(average([
  chipCountNorm, vector[3], vector[12], vector[21], waveEntropy, residualEnergy
]))
```

If a referenced vector position is missing or non-finite, use the same fallbacks as the current implementation.

## 11.4 Style Score Formula

After metric derivation, compute style scores with the shared rules from `packages/sidflow-common/src/persona-scorer.ts`.

Audio-led score:

```text
metricContribution =
  rawMetric       if direction == +1
  1 - rawMetric   if direction == -1
  0.5             if direction == 0

metricScore = weighted_average(metricContribution, metricWeights)
ratingDistance = average([
  abs(normalizeRating(e) - normalizeRating(target_e)),
  abs(normalizeRating(m) - normalizeRating(target_m)),
  abs(normalizeRating(c) - normalizeRating(target_c))
])

audioScore = clamp01(metricScore * 0.82 + (1 - ratingDistance) * 0.18)
```

Hybrid metadata bonus:

```text
bonus += 0.05 if metadata field set includes composer and composer is present
bonus += 0.04 if metadata field set includes year and year is present
bonus += 0.02 if metadata field set includes category and category is present
bonus += min(themeTagCount * 0.03, 0.10) if titleThemeTags are requested and present
bonus += rarity * 0.10 if rarity is requested and present
bonus = clamp01(bonus)

hybridScore = clamp01(audioScore * 0.85 + bonus * 0.15)
```

## 11.5 Style Bit Assignment

Algorithm:

1. compute all continuous style scores
2. stable-sort by score descending, then `styleId` ascending
3. set the top style bit unconditionally
4. for each remaining style, set its bit if:
   - `score >= topScore - 0.08`
   - `score >= 0.60`
5. clear all other bits

Pseudocode:

```text
scores = computeAllStyleScores(trackContext)
ordered = stableSort(scores, by score desc then styleId asc)
mask = bit(ordered[0].styleId)
topScore = ordered[0].score

for each candidate in ordered[1:]:
  if candidate.score >= topScore - 0.08 and candidate.score >= 0.60:
    mask |= bit(candidate.styleId)

return mask
```

---

# 12. Runtime Consumption

sidcorr-tiny-1 does not store vectors or similarity floats. Runtime behavior therefore uses the exported 3-edge graph plus style masks.

## 12.1 Reverse Index

Consumers SHOULD build a reverse adjacency index once at load time:

```text
reverseCount[track_count] : u16[]
reverseOffset[track_count + 1] : u32[]
reverseSource[edge_count] : u32[]
```

On the current corpus, this reverse index costs about 1,567,318 bytes of RAM.

## 12.2 Station Traversal

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

Current sidcorr-tiny-1 size in `md5_48` mode:

| Section | Bytes |
|--|--:|
| Header | 64 |
| STYLE_TABLE | 470 |
| FILE_IDENTITY_TABLE (`md5_48`) | 363,434 |
| FILE_TRACK_COUNT_TABLE | 60,571 |
| STYLE_MASK_TABLE | 174,146 |
| NEIGHBOR_TABLE (`3 x u24`) | 783,657 |
| Total | 1,382,342 |

Total current size: about 1.318 MiB.

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
- stores 3 acyclic similarity edges per track as absolute `u24` parent ordinals on disk
- rebuilds reverse reachability once at load time for runtime traversal

This is the authoritative tiny-format specification for the current SIDFlow codebase.
# Portable Similarity Lite Export Specification

Schema ID: `sidcorr-lite-1`
Binary format version: `1`
Status: Draft (normative)

---

# 1. Scope

This specification defines a compact, deterministic, offline distribution format for SID track similarity data intended for resource-constrained clients (for example mobile). It includes:

- A minimal-size binary representation of track identity, compact embeddings, and optional local-neighbour edges.
- An append-only update model based on base bundles plus delta bundles.
- Deterministic identity, versioning, and reproducibility requirements.

Non-goals:

- Human readability.
- Full relational reconstruction of the upstream dataset.

---

# 2. Inputs and Source of Truth

The upstream (authoritative) export is the **Portable Similarity Export** SQLite bundle (schema `sidcorr-1`) plus its JSON manifest sidecar. The distribution format is a lossy projection of the export's vector space plus a lossless projection of track identity.

The distribution generator MUST treat the following SQLite `tracks` columns as the canonical track identity:

- `sid_path` (UTF-8 string, HVSC relative path)
- `song_index` (integer subsong index)

The distribution generator MUST treat the following SQLite `tracks` columns as the canonical embedding components:

- `e`, `m`, `c` (required)
- `p` (optional, only when `vector_dimensions = 4`)

If the SQLite export includes a `neighbors` table, it MAY be used as an input hint for neighbour generation, but the generator MUST document (in the distribution manifest) how the neighbour semantics were interpreted.

---

# 3. Terminology and Primitive Types

## 3.1 Endianness and Floats

All fixed-width integers are **little-endian**.

All floating-point values are **IEEE 754 binary32** (`float32`), little-endian.

## 3.2 Primitive Integer Types

- `u8`  - unsigned 8-bit integer.
- `u16` - unsigned 16-bit integer.
- `u24` - unsigned 24-bit integer encoded as 3 bytes, little-endian.
- `u32` - unsigned 32-bit integer.
- `u64` - unsigned 64-bit integer.

## 3.3 Varints

`uleb128` is an unsigned variable-length integer encoding compatible with Little Endian Base 128 (LEB128).

Encoding:

- Each byte contributes 7 data bits (low bits).
- The high bit (0x80) indicates continuation.

This spec uses `uleb128` only in variable-length neighbour records (not in fixed-width tables).

---

# 4. Identity Model

## 4.1 External Track Key

The external, stable track key is the tuple:

- `(sid_path, song_index)`

It is equivalent to the SQLite export's `track_id` convention of:

- `track_id = sid_path + "#" + decimal(song_index)`

## 4.2 fileId

`fileId` is a dense integer identifying a unique `sid_path`.

- Valid range: `0 .. (file_count_total - 1)`.
- Assignment:
  - In a new base bundle, `fileId` values MUST be assigned by sorting `sid_path` lexicographically (bytewise UTF-8) ascending.
  - In a delta bundle, existing `fileId` assignments MUST be preserved and new `sid_path` values MUST be appended with increasing `fileId`.

Width:

- `file_id_width_bytes` is either `2` (`u16`) or `3` (`u24`).
- The generator MUST select `2` when `file_count_total <= 65535`, otherwise `3`.
- The width is stored in the binary header and is constant for the lifetime of a model version.

## 4.3 trackId

`trackId` is an implicit, dense 0-based integer index over all tracks in the binary file.

- Valid range: `0 .. (track_count_total - 1)`.
- `trackId` is defined by concatenating all epoch track tables in order.
- `trackId` values MUST be append-only within a model version lineage:
  - existing tracks MUST retain the same `trackId`
  - new tracks MUST be appended with increasing `trackId`

A delta bundle MUST NOT reorder existing tracks.

## 4.4 songIndex

`songIndex` is the subsong index within a SID file.

Width and encoding:

- `song_index_width_bytes` is either `1` (`u8`) or `2` (`u16`).
- The generator MUST select `1` when all `song_index` values are in `0..255`, otherwise `2`.
- The chosen width is stored in the binary header and is constant for the lifetime of a model version.

Semantics:

- This value MUST match the upstream SQLite `tracks.song_index` exactly (no reindexing).

---

# 5. Vector Model and Similarities

## 5.1 Vector Dimensionality

`vector_dimensions` is the number of embedding components per track.

- Allowed values in this schema: `3` or `4`.
- `3` means `[e, m, c]`.
- `4` means `[e, m, c, p]`.

## 5.2 Normalisation

The generator MUST L2-normalise all vectors before any clustering, quantisation, or neighbour computations.

For each track vector `V`:

- `V_norm = V / ||V||`

Invalid vectors:

- If any component is NaN or ±Inf, the generator MUST fail the build.
- If `||V|| == 0`, the generator MUST fail the build.

## 5.3 Similarity Semantics

Unless stated otherwise, "similarity" refers to **cosine similarity** on L2-normalised vectors:

- `cos(V_a, V_b) = dot(V_a, V_b)`
- Range: `[-1.0, +1.0]`

---

# 6. Quantised Representation

This schema supports a compact code per track:

- Product Quantisation (PQ) with `pq_subspaces` subspaces and `pq_centroids` centroids per subspace.

Constraints:

- `vector_dimensions` MUST be divisible by `pq_subspaces`.
- For `vector_dimensions ∈ {3,4}`, the recommended default is:
  - `pq_subspaces = vector_dimensions`
  - subspace dimension = 1

## 6.1 Codebooks

A codebook is stored per subspace:

- `codebook[subspace][centroid][subspace_dim] : float32`

Recommended training for `subspace_dim = 1`:

- Deterministic quantile-based scalar quantisation:
  - sort all component values for the subspace
  - partition into `pq_centroids` buckets
  - centroid = mean of bucket values

The generator MUST record its training method in the distribution manifest.

## 6.2 Track PQ Codes

For each track and each subspace:

- `pqCode[subspace] : u8`

`pqCode[subspace]` is the index of the nearest codebook centroid for that subspace (ties broken by choosing the lower centroid index).

Approximate cosine scoring on client:

- Reconstruct an approximate vector from PQ codes by concatenating centroid values.
- Cosine similarity MAY be approximated by the dot product of reconstructed vectors.

---

# 7. Cluster Layer

Each track is assigned a `clusterId : u16`.

- Valid range: `0 .. (cluster_count - 1)`.

Cluster prototypes are stored as float32 vectors:

- `cluster_proto[clusterId][vector_dimensions] : float32`

Training:

- The base bundle generator SHOULD train cluster prototypes from the normalised vectors.
- Delta bundles MUST NOT retrain cluster prototypes:
  - new tracks MUST be assigned to the nearest existing cluster prototype (ties broken by lower `clusterId`).

The generator MUST record its cluster training method and RNG seeds in the manifest.

---

# 8. Optional Neighbour Layer

## 8.1 Neighbour List Encoding

A neighbour list per track contains up to `K_max` neighbours.

Per track:

- `neighborCount : u8` (0..16)
- repeated `neighborCount` times:
  - `deltaTrackId : uleb128`
  - `similarity_u8 : u8`

Constraints:

- neighbours MUST be sorted by absolute `trackId` ascending before delta encoding.
- delta encoding uses:
  - `prev = 0`
  - for each neighbour `n` in sorted order:
    - `delta = n - prev`
    - `prev = n`
- `neighborCount` MUST be ≤ 16.

## 8.2 Neighbour Similarity Quantisation

Neighbour similarities MUST be computed in the normalised float space, then quantised:

- Encode:
  - `similarity_u8 = round(clamp((cos + 1.0) / 2.0, 0.0, 1.0) * 255.0)`
- Decode:
  - `cos ≈ (similarity_u8 / 255.0) * 2.0 - 1.0`

---

# 9. Binary File Format

## 9.1 Overview

A distribution binary file is append-only and consists of:

- a fixed header
- immutable model tables (codebooks and cluster prototypes)
- one or more epochs containing appended file dictionary entries and appended track rows
- a trailing index and footer that describe all epochs

A delta bundle is applied by appending one additional epoch plus a new trailing index and footer.

## 9.2 File Extension

Recommended:

- uncompressed on-device file: `.sidcorr`
- transport bundle file: `.sidcorr.zst` or `.sidcorr.gz`

## 9.3 Header (Fixed Size)

`HeaderV1` (32 bytes):

- `magic` (8 bytes): ASCII `SIDCORR\0` (7 chars + NUL)
- `format_version` (`u16`): MUST be `1`
- `header_bytes` (`u16`): MUST be `32`
- `flags` (`u32`): reserved, MUST be 0 in version 1
- `vector_dimensions` (`u8`): 3 or 4
- `pq_subspaces` (`u8`)
- `pq_centroids` (`u16`): typically 256
- `cluster_count` (`u16`): typically 256..512
- `file_id_width_bytes` (`u8`): 2 or 3
- `song_index_width_bytes` (`u8`): 1 or 2
- `reserved` (`u16`): MUST be 0
- `reserved2` (`u32`): MUST be 0
- `reserved3` (`u32`): MUST be 0

## 9.4 Model Tables (Immutable, Stored Once)

Immediately after the header:

`CODEBOOKS`:

- For `subspace = 0 .. pq_subspaces-1`
  - For `centroid = 0 .. pq_centroids-1`
    - write `subspace_dim` float32 values

Where:

- `subspace_dim = vector_dimensions / pq_subspaces`

Then `CLUSTERS`:

- For `clusterId = 0 .. cluster_count-1`
  - write `vector_dimensions` float32 values

## 9.5 Epochs

An epoch appends files and tracks. Epochs are parsed using the trailing index.

### 9.5.1 Epoch Header

`EpochHeaderV1` (24 bytes):

- `magic` (8 bytes): ASCII `SIDCEPOC` (7 chars) + NUL
- `epoch_version` (`u16`): MUST be 1
- `epoch_flags` (`u16`):
  - bit 0: `NEIGHBORS_PRESENT`
  - all other bits MUST be 0
- `tracks_in_epoch` (`u32`)
- `files_in_epoch` (`u32`)
- `reserved` (`u32`): MUST be 0

### 9.5.2 File Dictionary Entries

Immediately after `EpochHeaderV1`, write `files_in_epoch` file path entries.

Encoding (front-coded, deterministic):

- First entry in an epoch:
  - `suffix_len : u16`
  - `suffix_bytes[suffix_len]`
- Subsequent entries:
  - `prefix_len : u8` (0..255)
  - `suffix_len : u16`
  - `suffix_bytes[suffix_len]`

Decoding:

- Let `prev_path_bytes` be the previous decoded path (empty for the first entry).
- For subsequent entries:
  - `path = prev_path_bytes[0:prefix_len] + suffix_bytes`

Constraints:

- All `sid_path` values MUST be valid UTF-8.
- The generator MUST ensure `prefix_len` does not exceed `len(prev_path_bytes)`.

Ordering:

- Within each epoch, file dictionary entries MUST be sorted lexicographically (bytewise UTF-8) ascending.

### 9.5.3 Track Rows

Immediately after the file dictionary entries, write `tracks_in_epoch` fixed-width track rows.

`TrackRowV1`:

- `fileId` (`u16` or `u24` depending on `file_id_width_bytes`)
- `songIndex` (`u8` or `u16` depending on `song_index_width_bytes`)
- `clusterId` (`u16`)
- `pqCode[pq_subspaces]` (`u8[pq_subspaces]`)

### 9.5.4 Neighbour Section (Optional)

If `epoch_flags & NEIGHBORS_PRESENT != 0`, append:

`NeighborOffsets`:

- `tracks_in_epoch` entries, each:
  - `offset : u32` (byte offset from start of `NeighborBlob`)
  - `length : u16` (byte length of this track's neighbour record)

Then `NeighborBlob`:

- concatenation of all neighbour records, each encoded as described under "Neighbour list encoding".

Constraints:

- `offset + length` MUST be within the epoch's `NeighborBlob` total length.
- `length` MUST be ≤ 65535.

## 9.6 Index and Footer

The file ends with:

- `IndexV1`
- `FooterV1`

### 9.6.1 IndexV1

`IndexV1` begins at `footer.index_offset` and has byte length `footer.index_length`.

Layout:

- `magic` (8 bytes): ASCII `SIDCIDX\0`
- `index_version` (`u16`): MUST be 1
- `reserved` (`u16`): MUST be 0
- `epoch_count` (`u32`)
- repeated `epoch_count` times:
  - `epoch_offset` (`u64`) - absolute file offset to the start of `EpochHeaderV1`
  - `track_base` (`u32`) - first `trackId` in this epoch
  - `track_count` (`u32`)
  - `file_base` (`u32`) - first `fileId` in this epoch
  - `file_count` (`u32`)
  - `epoch_flags` (`u16`) - copy of `EpochHeaderV1.epoch_flags`
  - `reserved` (`u16`) - MUST be 0

Constraints:

- `track_base` and `file_base` MUST be contiguous across epochs:
  - epoch[i+1].track_base = epoch[i].track_base + epoch[i].track_count
  - epoch[i+1].file_base  = epoch[i].file_base  + epoch[i].file_count

### 9.6.2 FooterV1

`FooterV1` is fixed-size (40 bytes) and is located at end-of-file.

Layout:

- `magic` (8 bytes): ASCII `SIDCFOOT\0`
- `footer_version` (`u16`): MUST be 1
- `reserved` (`u16`): MUST be 0
- `index_offset` (`u64`)
- `index_length` (`u32`)
- `track_count_total` (`u32`)
- `file_count_total` (`u32`)
- `crc32` (`u32`) - optional; if unused MUST be 0

The "active" view of the file is always the one described by the *last* footer in file order.

---

# 10. Distribution Model

## 10.1 Artefacts

A distribution release consists of:

- `manifest.json` (UTF-8 JSON)
- `base.sidcorr.zst` (or `.gz`) - compressed base `.sidcorr` file
- zero or more `delta-<n>.sidcorr.append.zst` files (or `.gz`), each containing bytes to append to an existing `.sidcorr` file

## 10.2 Manifest JSON

`manifest.json` MUST be a single JSON object with:

- `schema_version` (string): MUST be `sidcorr-lite-1`
- `binary_format_version` (number): MUST be `1`
- `model_version` (string): opaque, stable identifier for this model lineage
- `generated_at` (string): ISO 8601 timestamp (UTC recommended)
- `source_export` (object):
  - `schema_version` (string): MUST be `sidcorr-1`
  - `vector_dimensions` (number): 3 or 4
  - `include_vectors` (boolean)
  - `neighbor_count_per_track` (number)
  - `track_count` (number)
- `parameters` (object):
  - `vector_dimensions` (number)
  - `pq_subspaces` (number)
  - `pq_centroids` (number)
  - `cluster_count` (number)
  - `neighbors_enabled` (boolean)
  - `neighbors_k_max` (number)
- `base` (object):
  - `path` (string)
  - `sha256` (string, lowercase hex)
  - `content_encoding` (string): `zstd` or `gzip`
  - `bytes_uncompressed` (number)
- `deltas` (array of objects), ordered by application order:
  - `path` (string)
  - `sha256` (string)
  - `content_encoding` (string): `zstd` or `gzip`
  - `bytes_append_uncompressed` (number)
  - `from_revision` (number)
  - `to_revision` (number)

Notes:

- `from_revision`/`to_revision` are monotonically increasing integers local to `model_version`.
- Deltas MUST apply only when the local store is exactly at `from_revision`.

## 10.3 Delta Application

To update:

1. Verify the local file header and immutable model tables match the manifest `model_version` (by policy; see client section).
2. Download the next delta in order.
3. Decompress it to obtain raw append bytes.
4. Append those bytes to the local `.sidcorr` file.
5. Verify the new trailing footer is valid and that `track_count_total` and `file_count_total` match the manifest's expected `to_revision` cumulative state.

Clients MUST treat delta application as atomic (write to a temp file then rename, or use filesystem-level atomic append).

---

# 11. Export-to-Distribution Transformation

A generator MUST implement the following deterministic pipeline.

## 11.1 Base Build

1. Read the Portable Similarity Export SQLite and sidecar manifest.
2. Extract canonical identity and vectors from `tracks`.
3. Validate and L2-normalise vectors.
4. Determine deterministic base ordering:
   - sort tracks by `sid_path` ASC bytewise, then `song_index` ASC numeric.
5. Build file dictionary:
   - unique `sid_path`, sorted ascending.
6. Train:
   - cluster prototypes
   - PQ codebooks
7. Encode:
   - per track: `fileId`, `songIndex`, `clusterId`, `pqCode[]`
   - optional neighbour lists
8. Write:
   - Header + Model tables + one epoch
   - Index + Footer

## 11.2 Delta Build

Given a prior `.sidcorr` file for the same `model_version`:

1. Load the prior epoch index and decode the complete file dictionary and track identity set.
2. Load the new SQLite export.
3. Identify **new** files and tracks by `(sid_path, song_index)` that are not present in the prior distribution state.
4. Assign new `fileId` and `trackId` values by appending.
5. Quantise using the existing cluster prototypes and PQ codebooks.
6. Write a single new epoch plus a new index and footer.
7. Publish the append bytes as `*.sidcorr.append.(zst|gz)`.

Invalid updates:

- If any existing track's embedding components changed, or any `sid_path` for an existing `fileId` changed, the generator MUST NOT emit a delta; it MUST publish a new `model_version` base.

---

# 12. Client Behaviour and Recommendation

## 12.1 Minimum Client Capabilities

A client implementation MUST be able to:

- parse HeaderV1
- parse codebooks and cluster prototypes
- find and validate the trailing FooterV1
- parse IndexV1
- read any track row by `trackId`
- decode a `fileId -> sid_path` mapping by decoding file dictionary entries across epochs

## 12.2 Recommendation Outline

Given up to 10 rated tracks (weights in `[-1, +1]`):

1. Convert rated external keys to `trackId` (via dictionary lookup).
2. Aggregate per-cluster preferences from rated tracks.
3. Select candidate clusters.
4. Score candidate tracks by approximate cosine similarity from PQ codes.
5. Optionally boost scores using neighbour similarities.
6. Apply diversity constraints and filtering.
7. Return top-K.

Exact ranking functions, diversity penalties, and exploration policies are application-specific.

---

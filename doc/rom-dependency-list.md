# SID ROM Dependency List Specification

Schema ID: sidromdep-1
Status: Normative
Current binary_format_version: 1

---

# 1. Purpose

This specification defines a small, self-describing binary list of the HVSC subtunes whose
playback was **measured to differ when the C64 system ROMs are absent**, for:

- skipping such tunes in unattended playback (autoplay, radio, station queues)
- warning before explicit playback of such tunes
- distinguishing "measured incompatible" from "not measured" without ever confusing the two

It is intended for weak-device runtimes (for example an Android APK that embeds the file) and for
any other project that plays SID files with an engine that is not given KERNAL, BASIC and CHARGEN.

The list is **allow-by-default**. A file or subtune that is not listed is playable. Only listed
records change behaviour. The list is therefore a deny/warn list, not an inventory and not a
compatibility certificate.

Non-goals:

- proving that an unlisted file is compatible (§10.3)
- proving hardware fidelity or authorising indefinite playback (§9.3)
- carrying similarity, style, rating or duration data
- carrying per-subtune playback horizons (§9.2, §17.5)
- enumerating the audited collection

sidromdep-1 is completely independent of the similarity exports (`sidcorr-*`). It shares no
section, no identifier and no tooling with them, and it can be consumed without them.

Recommended filenames, where `<N>` is the HVSC release number:

- binary: `hvsc<N>-sidromdep-1.bin` (for example `hvsc85-sidromdep-1.bin`)
- manifest: `hvsc<N>-sidromdep-1.manifest.json`
- optional human-readable view: `hvsc<N>-sidromdep-1.json` (release asset only; never embedded)

The on-disk format is little-endian and byte-aligned. Consumers MAY widen fields in RAM.

---

# 2. Terminology

- **lane** = one (engine, ROM configuration) pair. There are exactly four (§5.5).
- **engine** = `sidlite` (SIDLite) or `residfp` (reSIDfp), both from the pinned `libsidplayfp-wasm`.
- **ROM configuration** = `none` (no KERNAL, BASIC or CHARGEN supplied) or `kernalBasic`
  (KERNAL and BASIC supplied, CHARGEN not supplied).
- **reference** = the same engine given all three authentic ROMs.
- **incompatible** (lane) = the audible output differed from the reference within the observation
  horizon, or playback stopped, in that lane.
- **unknown** (lane) = the lane was not resolved (pending, failed or unresolved). Never an
  incompatibility.
- **allowed** (lane) = neither incompatible nor unknown. On a listed record this means measured
  compatible; for an unlisted subtune it is the default (§10.3).
- **listed** = the (file, subtune) has a DECISION record.
- **audited** = covered by the ROM audit that produced the list. Not recorded in the binary; the
  binary carries only the audited counts (§5.2).
- **observation horizon** = how long the audit compared a subtune with its reference (§9.2).
- **source bundle** = the ROM audit's `published/` directory the list was derived from (§3).

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119.

---

# 3. Normative Sources

The following repository surfaces are normative:

- `packages/sidflow-common/src/rom-dependency-list.ts` (encoder, decoder, lookup, horizon rule)
- `scripts/rom-dependency-list/bundle.ts` (reading and interpreting the source bundle)
- `scripts/rom-dependency-list/generate.ts`
- `scripts/rom-dependency-list/verify.ts`
- `scripts/rom-audit/verify-publication.ts` (verification of the source bundle)
- `scripts/rom-audit/screen-publication.ts` (meaning of the source bundle's files and bit masks)
- `doc/research/hvsc-rom-dual-run.md`, section "Commander bundle" (audit methodology)

Source bundle files used (all inside `<audit-out>/published/`):

| File | Used for |
|--|--|
| `manifest.json` | `complete`, `releaseReady`, corpus id, document digests, engine/ROM identities, measured scope |
| `commander-exceptions.json` | incompatible lane masks per full MD5 and one-based subtune |
| `unknown.json` | subtunes with any unresolved lane (empty in a complete bundle) |
| `sha256-to-md5.json` | the audited file population (full MD5s) |
| `playback-horizons.json` | per-subtune subtune counts and the published observation horizons |

Where this document and the source code disagree, the source code is authoritative and this
document is wrong.

Anyone who needs only to **read** a list needs nothing but this document: §5 to §10 are
self-contained.

---

# 4. Identity Model

## 4.1 Files are identified by the full 16-byte MD5

A file is identified by the MD5 of its **complete file content** (the same value as the key in
HVSC `Songlengths.md5`). The binary stores all 16 raw bytes. There is no truncated form.

Rationale (§17.2): a deny/warn list must not produce false positives. A truncated prefix would
make a stranger's unrelated file match a listed record with non-zero probability, and the cost of
exactness is about 10 bytes per listed file.

## 4.2 Subtunes

A subtune is identified by its **one-based** number within the file. Valid values are 1 to 256
(the SID header `songs` field is limited to 256 by the SID file format and HVSC contains a file
with exactly 256 subtunes). On disk the value is stored minus one in a `u8` (§7).

## 4.3 No inventory

The list does not enumerate audited files. Absence has exactly one meaning: **no record**. It does
not mean "audited and compatible", and it does not mean "not audited". A file that appears in a
later HVSC release is unlisted and therefore playable by default.

---

# 5. Binary Layout

## 5.1 Endianness

- little-endian

## 5.2 Header (192 bytes)

| Offset | Field | Type | Notes |
|--|--|--|--|
| 0 | magic | 8 bytes | ASCII `SIDROMDP` |
| 8 | binary_format_version | u16 | `1`; readers MUST reject any other value |
| 10 | header_bytes | u16 | MUST be `192` |
| 12 | flags | u32 | bit `0` = `INCOMPLETE_SOURCE` (§5.4); all other bits MUST be `0` |
| 16 | hvsc_release | u32 | HVSC release number, `>= 1` (for example `85`) |
| 20 | source_files | u32 | files audited in the source bundle (informational) |
| 24 | source_subtunes | u32 | subtunes audited in the source bundle (informational) |
| 28 | file_count | u32 | FILE_TABLE records (listed files) |
| 32 | decision_count | u32 | DECISION_TABLE records (listed subtunes) |
| 36 | file_table_offset | u32 | MUST be `192` |
| 40 | file_table_bytes | u32 | MUST be `file_count * 17` |
| 44 | decision_table_offset | u32 | MUST be `192 + file_table_bytes` |
| 48 | decision_table_bytes | u32 | MUST be `decision_count * 2` |
| 52 | header_crc32 | u32 | CRC-32 of bytes `0..191` with this field taken as zero (§5.3) |
| 56 | file_record_bytes | u16 | MUST be `17` |
| 58 | decision_record_bytes | u16 | MUST be `2` |
| 60 | reserved | u32 | MUST be `0` |
| 64 | payload_sha256 | 32 bytes | SHA-256 of every byte from offset 192 to the end of the file |
| 96 | source_manifest_sha256 | 32 bytes | SHA-256 of the source bundle's `manifest.json` bytes |
| 128 | songlengths_sha256 | 32 bytes | SHA-256 of the HVSC `Songlengths.md5` the audit pinned |
| 160 | corpus_id | 32 bytes | the source manifest's `corpus` id (SHA-256 of the audited path/content listing) |

`source_files` and `source_subtunes` (61,157 and 87,868 for HVSC #85) are statements about the
audit, not about the list. Consumers MUST NOT use them to derive any playback decision.

The offsets and lengths are redundant with the counts by design: a reader MUST check that they
equal the canonical values above and MUST reject the file otherwise. The total file length MUST
equal `192 + file_table_bytes + decision_table_bytes`.

## 5.3 Integrity fields

Two independent checks are carried in the file so that truncation and corruption are detectable
without the manifest:

- `header_crc32` covers the header, including all three provenance digests and `payload_sha256`.
  CRC-32 is the standard IEEE 802.3 polynomial (`0xEDB88320` reflected, initial value and final
  XOR `0xFFFFFFFF`), as used by zlib and PNG.
- `payload_sha256` covers both sections.

A reader MUST verify both and MUST reject on mismatch. Neither field provides authenticity; an
adversary can recompute both. Authenticity comes only from pinning the manifest SHA-256 obtained
from a trusted release (§13.3).

## 5.4 Flags

| Bit | Name | Meaning |
|--|--|--|
| 0 | `INCOMPLETE_SOURCE` | The source bundle was not `complete && releaseReady`. The file is a developer artefact produced with `--allow-incomplete`. It MUST NOT be released or embedded in a product. A consumer MAY refuse to load a file with this bit set; a product build SHOULD. |

## 5.5 Lane bits

Lane masks are 4-bit values with the same meaning as the `bits` object of the source bundle's
`commander-exceptions.json`:

| Bit | Value | Lane name | Engine | ROM configuration |
|--|--:|--|--|--|
| 0 | 1 | `sidliteNone` | SIDLite | none |
| 1 | 2 | `sidliteKernalBasic` | SIDLite | KERNAL + BASIC |
| 2 | 4 | `residfpNone` | reSIDfp | none |
| 3 | 8 | `residfpKernalBasic` | reSIDfp | KERNAL + BASIC |

## 5.6 Section Order

Sections MUST appear in this order and MUST be tightly packed:

1. header (192 bytes)
2. `FILE_TABLE`
3. `DECISION_TABLE`

---

# 6. FILE_TABLE

`file_count` records of 17 bytes, **strictly ascending** by the 16 MD5 bytes compared as unsigned
bytes from the first byte (equivalently, ascending by the lowercase hex string).

| Offset | Field | Type | Notes |
|--|--|--|--|
| 0 | md5 | 16 bytes | raw full-file MD5 |
| 16 | decision_count_minus_1 | u8 | the file has `value + 1` decision records, `1..256` |

There is no per-file offset. The decisions of file `i` are the DECISION_TABLE records starting at
index `sum(decision_count_minus_1[j] + 1 for j < i)`. A reader MUST check that the per-file counts
sum to the header `decision_count`. Readers that perform repeated lookups SHOULD compute the prefix
sums once at load time (a `u32` array of `file_count + 1` entries); this is one linear pass over a
few thousand records.

Every listed file has at least one decision, so a file with zero records is not representable and
a count of 256 fits in the `u8`.

---

# 7. DECISION_TABLE

`decision_count` records of 2 bytes, grouped by file in FILE_TABLE order. Within a file the records
are **strictly ascending** by subtune.

| Offset | Field | Type | Notes |
|--|--|--|--|
| 0 | subtune_minus_1 | u8 | one-based subtune `1..256` stored minus one |
| 1 | masks | u8 | low nibble = `incompatible` lane mask, high nibble = `unknown` lane mask |

Record rules, all of which a reader MUST check:

- `incompatible & unknown == 0` (a lane has exactly one state)
- `incompatible | unknown != 0` (a record that says nothing is not representable)

A lane that is in neither mask is `allowed`. On a listed record, `allowed` means the lane was
measured compatible.

---

# 8. Matching Rules

To look up `(md5, subtune)`:

1. Reject (treat as unlisted) any `subtune` outside `1..256`.
2. Binary-search the FILE_TABLE for the 16-byte `md5`. Absent: **unlisted**.
3. Scan that file's decisions for `subtune`. Absent: **unlisted**.
4. Otherwise read `incompatible = masks & 0x0F` and `unknown = masks >> 4`.

Rules:

- Matching is on all 16 bytes. A consumer MUST NOT match on a prefix.
- Matching is on the **content** MD5 of the file as played. A consumer MUST NOT substitute a
  path, a filename, a SHA-256 or a tune title.
- A consumer that cannot compute a full-file MD5 for a file MUST treat it as unlisted.
- The state of a lane is read only for the lane that matches the consumer's actual engine and ROM
  configuration (§10.1).

Reference API (`packages/sidflow-common/src/rom-dependency-list.ts`):

```ts
decodeRomDependencyList(bytes: Uint8Array): RomDependencyList   // validates everything (§13.1)
list.lookup(md5: string | Uint8Array, subtune: number): {
  listed: boolean;
  incompatibleMask: number;
  unknownMask: number;
  lanes: Record<"sidliteNone" | "sidliteKernalBasic" | "residfpNone" | "residfpKernalBasic",
                "allowed" | "incompatible" | "unknown">;
}
```

---

# 9. Measured Scope

The statements in a record are true **only within the scope in which they were measured**. The
scope is recorded in the manifest (`measuredProfile`, §11) and summarised here. It is informative:
the binary carries no per-subtune scope data (§17.5).

## 9.1 Measured profile

Authoritative values are copied from the source bundle's `manifest.json`; this table states what
the current methodology (`rom-audit-digital-screen-2`) records.

| Property | Value |
|--|--|
| Engines | SIDLite and reSIDfp from the pinned `libsidplayfp-wasm`; identities in the manifest (`engineIds`, `engines`, `nativeHashes`) |
| Reference | the same engine with KERNAL, BASIC and CHARGEN (SHA-256 values in the manifest `referenceRoms`; `romSetId` binds them) |
| Configurations | `none`: no ROMs supplied; `kernalBasic`: KERNAL and BASIC supplied, CHARGEN not supplied |
| Absent banks | BASIC and CHARGEN zero-filled; a KERNAL shim when KERNAL is absent |
| Audio | 48 kHz, stereo |
| Power-on delay | 8191 |
| Event pulls | 256 events per pull |
| SID model | as selected by the SID header; MOS8580 where the header names none |
| Comparison | audible-output difference against the reference ("listener" comparison), plus playback stopped |

The `scope` string of the source manifest is copied verbatim into the output manifest, and the
generator refuses a bundle whose `scope` does not state the sample rate, power-on delay, event
pull size and SID-model rule above.

## 9.2 Observation horizon

Each subtune was compared with its reference for a bounded time, derived from the HVSC release's
`Songlengths.md5` as follows (the function `derivePlaybackHorizonMs`):

```text
token  = the subtune's duration token from Songlengths.md5 (m:ss or m:ss.mmm), if any
valid  = token matches ^(\d+):([0-5]\d)(?:\.(\d{1,3}))?$   and its duration D (ms) is > 0
horizon_ms = valid ? max(10000, D + 5000) : 300000
```

- "No Songlengths entry" covers a Songlengths line with fewer tokens than the file has subtunes, and
  any token that is malformed (including annotated tokens such as `3:21(G)`, minutes/seconds out of
  range, or a zero duration). Such a subtune was observed for 300 s as an exploratory fallback.
- Tokens are never partially parsed: a malformed token does not shift later subtunes.

The generator reproduces **every published horizon of the source bundle** from the pinned
`Songlengths.md5` using this rule and refuses a release output if any differs. The Songlengths
SHA-256 is recorded in the header (`songlengths_sha256`).

## 9.3 What a flag does and does not say

- **incompatible** was observed within the horizon. A divergence that appeared inside the horizon
  is a divergence of the tune; the consumer does not need to observe the horizon itself.
- **allowed on a listed record**, and the unlisted default for an audited subtune, mean "no
  divergence found within the horizon, profile and engine build". They do not cover playback
  beyond the horizon (a looping tune may diverge later), another SID model than the measured one,
  another engine build, hardware fidelity, or interactive input.
- **unknown** says nothing about compatibility.

---

# 10. Consumer Obligations

## 10.1 Selecting the lane

A consumer determines its lane from its actual configuration: engine (SIDLite or reSIDfp, built
from the pinned source) and ROM configuration (`none`, or KERNAL and BASIC supplied without
CHARGEN). A consumer whose engine build, ROM set or CHARGEN supply does not match one of the four
lanes has no applicable measurement: it MUST NOT claim compatibility from the list, and it MAY use
`incompatibleMask != 0` of any lane as a conservative hint.

## 10.2 Required behaviour

| Lane state for the consumer's lane | Autoplay / radio / queue | Explicit user selection | Notes |
|--|--|--|--|
| `incompatible` | MUST skip | MUST warn before playing; MAY allow after confirmation | measured divergence from the three-ROM reference |
| `unknown` | MAY play | SHOULD show an unverified-playback notice | MUST NOT be treated as incompatible; the consumer chooses its warning policy |
| `allowed` on a listed record | MAY play | MAY play | measured compatible within the profile and horizon (§9.3) |
| unlisted file or subtune | MAY play | MAY play | the default; not a compatibility claim |

Additional obligations:

1. A consumer MUST NOT treat `unknown` as `incompatible`, and MUST NOT treat `incompatible` as
   `unknown`.
2. A consumer MUST NOT present an unlisted or `allowed` result as proof of compatibility, and MUST
   NOT use it to authorise playback beyond the horizon as "verified".
3. A consumer SHOULD apply the list per subtune, not per file: other subtunes of a listed file are
   unlisted unless they have their own record.
4. A list with header flag `INCOMPLETE_SOURCE` is a developer artefact (§5.4).
5. A consumer SHOULD pin the manifest SHA-256 of a trusted release and compare the SHA-256 of the
   bundled binary with the manifest (§13.3).

## 10.3 Why unlisted is not "compatible"

The list cannot distinguish a file the audit found compatible from a file the audit never saw
(for example a file that is new in a later HVSC release). Both are unlisted and therefore playable
by default. This is deliberate (§17.1): the alternative would make every unseen file unplayable or
warned. The consequence is that the unlisted default is a policy, not evidence.

---

# 11. Manifest

`hvsc<N>-sidromdep-1.manifest.json` is deterministic JSON (sorted keys, `stringifyDeterministic`),
UTF-8, with a trailing newline. It contains no timestamps, so regenerating from the same inputs
yields identical bytes. Top-level fields:

| Field | Meaning |
|--|--|
| `format` | `{ id: "sidromdep-1", version: 1, specification }` |
| `hvscRelease` | HVSC release number |
| `complete` | `true` only for a release output; `false` for `--allow-incomplete` developer output |
| `releasable` | equals `complete`; a second field so that tooling cannot overlook a non-release |
| `status` | `release` or `developer-incomplete-source-NOT-RELEASABLE` |
| `semantics` | the allow-by-default rule in one sentence |
| `laneBits` | the lane bit table of §5.5 |
| `counts` | `listedFiles`, `listedSubtunes`, `sourceFiles`, `sourceSubtunes`, and per lane `{incompatible, unknown}` |
| `binary` | `file`, `bytes`, `sha256`, `payloadSha256`, record sizes and the two sections' `{offset, bytes}` |
| `humanReadable` | `file` and `sha256` of the optional JSON view (§12) |
| `provenance` | `sourceManifestSha256`, `songlengthsSha256`, `corpusId`, `sourceIdentity`, source `schema`/`methodology`, `sourceDocuments` (HVSC document digests) |
| `measuredProfile` | the source `scope` verbatim, configurations, audio/power-on/pull parameters, SID-model rule, `engineIds`, `engines`, `nativeHashes`, `romSetId`, `referenceRoms`, and `observationHorizon` (rule, constants, `reproducedFromSonglengths`) |

The manifest carries the evidence; the binary carries the decision. A consumer that embeds the
binary SHOULD also keep the manifest SHA-256 (§13.3).

---

# 12. Human-Readable JSON

`hvsc<N>-sidromdep-1.json` is an optional, deterministic release asset for people and for audit.
It MUST NOT be embedded in a product and MUST NOT be required by a consumer. Shape:

```json
{
  "format": "sidromdep-1",
  "hvscRelease": 85,
  "complete": true,
  "note": "...",
  "laneBits": { "...": 1 },
  "records": [
    { "md5": "...", "hvscPath": "MUSICIANS/X/Name.sid", "subtune": 2,
      "incompatible": ["sidliteNone"], "unknown": [],
      "lanes": { "sidliteNone": "incompatible", "sidliteKernalBasic": "allowed", "residfpNone": "allowed", "residfpKernalBasic": "allowed" } }
  ]
}
```

`records` are in binary order (MD5, then subtune). `hvscPath` is the path from the
`Songlengths.md5` comment line, or `null` when the generator was not given the file.

---

# 13. Validation and Verification

## 13.1 Decoder / consumer validation

A conforming reader MUST reject the input (and not return a partial result) unless all of:

1. length `>= 192`, magic `SIDROMDP`, `binary_format_version == 1`, `header_bytes == 192`
2. `header_crc32` matches
3. no flag bit other than bit 0, `reserved == 0`, `hvsc_release >= 1`
4. record sizes are 17 and 2, section offsets and lengths are the canonical values (§5.2), and the
   file length is exactly `192 + file_table_bytes + decision_table_bytes` (no truncation, no
   trailing bytes)
5. `payload_sha256` matches
6. file records are strictly ascending, their counts sum to `decision_count`
7. within each file, subtunes are strictly ascending
8. every decision satisfies the record rules of §7

## 13.2 Generator rules

The generator (`scripts/rom-dependency-list/generate.ts`) MUST:

1. refuse a source bundle unless its manifest has `complete == true` and `releaseReady == true`
   **and** `scripts/rom-audit/verify-publication.ts` accepts it and returns the SHA-256 of the
   manifest it read. `--allow-incomplete` is the only exception; it sets header flag bit 0 and
   writes `complete: false`, `releasable: false`
2. check the SHA-256 of the four consumed artefacts against the source manifest
3. require the source `romSetId` to equal the reference ROM set id of
   `packages/sidflow-common/src/rom-eligibility.ts`
4. require the source manifest `scope` to state the measured profile (§9.1)
5. for a release output, require `Songlengths.md5` whose SHA-256 equals the source manifest's
   document digest and reproduce every published horizon from it (§9.2)
6. emit one decision per subtune that has at least one incompatible or unknown lane, and nothing
   else
7. in a bundle that lists a subtune as unknown without saying which lane, mark every lane that is
   not known incompatible as unknown (conservative; only possible in an incomplete bundle)
8. be deterministic: the same inputs produce byte-identical binary, manifest and JSON

## 13.3 Verification procedure

`bun scripts/rom-dependency-list/verify.ts --bin hvsc85-sidromdep-1.bin --bundle <published-dir> [--songlengths <Songlengths.md5>]`

1. decode the binary with all checks of §13.1
2. check the manifest: format id/version, binary SHA-256 and size, `payloadSha256`, `complete` vs
   header flag, counts, and the three provenance digests against the header
3. load the source bundle under the same acceptance rules as the generator (§13.2 items 1-4); check
   that its manifest SHA-256, Songlengths digest and corpus id equal the header values
4. every listed file exists in the source bundle and every listed subtune is within the file's
   subtune count
5. for **every** subtune of **every** audited file: if the source has no incompatible and no unknown
   lane, the subtune MUST be unlisted (this is the proof that "absent from the list" means
   "measured compatible in all four lanes"); otherwise the list's incompatible and unknown masks
   MUST equal the source's
6. optionally (`--songlengths`) reproduce every published horizon from `Songlengths.md5`
7. if the human-readable JSON exists, its digest and records match the binary
8. print the SHA-256 of the binary and of the manifest

A consumer pins the printed manifest SHA-256 from a trusted release, then checks that the manifest's
`binary.sha256` equals the SHA-256 of the file it embeds.

---

# 14. Worked Example

A list for HVSC #85 containing two files:

- `0123456789abcdef0123456789abcdef`: subtune 1 incompatible in `sidliteNone` and `residfpNone`
  (mask `0b0101` = 5); subtune 3 unknown in `residfpKernalBasic` (mask `0b1000`, stored `0x80`)
- `fedcba9876543210fedcba9876543210`: subtune 256 incompatible in `sidliteNone` and
  `sidliteKernalBasic` (mask `0b0011` = 3)

Provenance digests are `a1…a1`, `b2…b2`, `c3…c3` (32 bytes each). Total size
`192 + 2*17 + 3*2 = 232` bytes.

```text
0000  53 49 44 52 4f 4d 44 50  magic "SIDROMDP"
0008  01 00                    binary_format_version = 1
000a  c0 00                    header_bytes = 192
000c  00 00 00 00              flags = 0
0010  55 00 00 00              hvsc_release = 85
0014  e5 ee 00 00              source_files = 61157
0018  3c 57 01 00              source_subtunes = 87868
001c  02 00 00 00              file_count = 2
0020  03 00 00 00              decision_count = 3
0024  c0 00 00 00              file_table_offset = 192
0028  22 00 00 00              file_table_bytes = 34
002c  e2 00 00 00              decision_table_offset = 226
0030  06 00 00 00              decision_table_bytes = 6
0034  ff 03 a3 59              header_crc32 = 0x59a303ff
0038  11 00                    file_record_bytes = 17
003a  02 00                    decision_record_bytes = 2
003c  00 00 00 00              reserved
0040  97 e0 a7 56 d5 6f 92 6c  payload_sha256 (32 bytes)
0048  a9 1d 65 8c c0 a7 70 0c
0050  5f 04 36 2c 4e 58 4e f4
0058  9c 01 86 ec 08 3b 58 2d
0060  a1 ... a1 (32 bytes)     source_manifest_sha256
0080  b2 ... b2 (32 bytes)     songlengths_sha256
00a0  c3 ... c3 (32 bytes)     corpus_id
00c0  01 23 45 67 89 ab cd ef  FILE_TABLE[0].md5
00c8  01 23 45 67 89 ab cd ef
00d0  01                       decision_count_minus_1 = 1 (2 decisions)
00d1  fe dc ba 98 76 54 32 10  FILE_TABLE[1].md5
00d9  fe dc ba 98 76 54 32 10
00e1  00                       decision_count_minus_1 = 0 (1 decision)
00e2  00 05                    file 0, subtune 1, incompatible 5, unknown 0
00e4  02 80                    file 0, subtune 3, incompatible 0, unknown 8
00e6  ff 03                    file 1, subtune 256, incompatible 3, unknown 0
```

(The `payload_sha256` and `header_crc32` bytes in the listing are those produced by the reference
encoder; `packages/sidflow-common/test/rom-dependency-list.test.ts` pins them.)

Lookups:

| md5 | subtune | result |
|--|--:|--|
| `0123…cdef` | 1 | listed; `sidliteNone` and `residfpNone` incompatible; the other lanes allowed |
| `0123…cdef` | 2 | unlisted (default playable) |
| `0123…cdef` | 3 | listed; `residfpKernalBasic` unknown; nothing incompatible |
| `fedc…3210` | 256 | listed; `sidliteNone` and `sidliteKernalBasic` incompatible |
| any other MD5 | any | unlisted (default playable) |

---

# 15. Versioning

- `binary_format_version` is `1`. A reader MUST reject any other value; there is no forward
  compatibility. The magic never changes between versions; the version field selects the layout.
- Any change to the header, the record layouts, the lane bit meanings or the semantics of the
  states requires a new version and a new schema id (`sidromdep-2`).
- Adding fields to the manifest or the JSON view is not a format change; consumers MUST ignore
  unknown manifest fields.
- Regenerating a list for a new HVSC release or a new audit methodology produces a new file with
  new provenance digests. The format version does not change.
- The set of HVSC subtunes (`1..256`) and the `u8` counts are format limits. Exceeding them
  requires a new version.

---

# 16. Size Analysis

Size is exact and linear:

```text
bytes = 192 + 17 * listed_files + 2 * listed_subtunes
```

| Listed files | Listed subtunes | Bytes | KiB |
|--:|--:|--:|--:|
| 1,560 | 2,636 (3 % of 87,868) | 31,984 | 31.2 |
| 1,600 | 2,700 | 32,792 | 32.0 |
| 3,000 | 5,000 | 61,192 | 59.8 |

The design target is 30 to 40 KiB for about 1,600 files and 2,700 subtunes. Doubling the number of
listed files adds about 27 KiB; each additional listed subtune adds 2 bytes.

Measured dry run against the partial census `workspace/rom-audit-dual-4` (337 of 87,868 subtunes
measured, 163 incompatible subtunes in 147 files, 87,531 subtunes unresolved), generated with
`--allow-incomplete`:

- incompatible-only content: 147 files / 163 subtunes, 3,017 bytes
- full developer output, which also lists the 87,531 pending subtunes as unknown (61,056 files /
  87,694 subtunes): 1,213,532 bytes. This is the expected cost of listing a mostly unmeasured
  corpus and is why an incomplete output is never a release.

For a complete census there are no unknown subtunes, so the list holds only incompatible
subtunes. Compared with the previous design (a 61,157-record inventory at 6 bytes per file plus
index and horizon sections, about 0.4 MB), the allow-by-default list is about 12 times smaller.

---

# 17. Design Rationale

## 17.1 Why allow-by-default

A deny/warn list needs only the exceptions. An inventory would double the size, would have to be
regenerated for every HVSC release to avoid classifying new files as "not audited", and would
force consumers to choose a policy for files absent from it. Allow-by-default makes the list
independent of the collection's growth: a new file is playable until a later list says otherwise.
The cost, stated plainly in §10.3, is that unlisted is a policy and not evidence. The manifest and
this specification state that, and the consumer obligations forbid presenting it as proof.

## 17.2 Why the full MD5

False positives are not permitted: a wrongly matched file would be skipped or warned although
nothing is wrong with it. A 48-bit prefix stored for 1,600 listed files and compared with a
collection of one million local files collides with probability about 1,600 x 10^6 / 2^48, which
is about 6 x 10^-6; small, but not zero, and avoidable. The full 16 bytes cost 10 additional bytes
per listed file, about 16 KB in total. Accidental collision of full MD5 is about 2^-128. MD5 is
used because it is the identity of HVSC `Songlengths.md5` and of C64 Commander; its known
cryptographic weakness is irrelevant here because the list is an integrity-protected input
supplied by the application, not a security boundary.

## 17.3 Why unknown is in the same record

Pending, failed or unresolved lanes exist in incomplete audits and may exist in future
methodologies. Carrying them in the same 2-byte record (4 bits each) lets a consumer choose a
warning policy without a second table, and keeps "not measured" distinguishable from "measured
incompatible". A complete release carries none.

## 17.4 Why implicit first-decision indices and `n-1` counts

An explicit `u32` decision index per file would add 4 bytes per file (about 6.4 KB at 1,600
files, 20 %). Prefix sums are computed once at load. Storing the counts and subtunes minus one
fits 1..256 into a `u8` with no `u16` penalty; HVSC contains a file with 256 subtunes, so a plain
`u8` of the one-based value would be insufficient.

## 17.5 Why no horizon table

The source bundle's `playback-horizons.json` is 6.7 MB and is a pure function of the pinned
`Songlengths.md5` (§9.2). The list therefore does not carry it. The generator proves the claim on
every published horizon, the rule is stated normatively here, and the Songlengths digest is part of
the provenance. A consumer that needs an horizon recomputes it from its own Songlengths data; a
list never needs one to answer a lookup, because a recorded divergence (`incompatible`) is
independent of the horizon (§9.3). No override section is therefore needed; if a future
methodology publishes horizons that the rule cannot reproduce, the generator refuses them, and a
new format version is the place to encode them.

## 17.6 Why a CRC-32 and a SHA-256

The header carries the payload SHA-256, so the header itself needs its own check (CRC-32), and
the payload needs a strong one. Together they detect any truncation or corruption without the
manifest. They are not authenticity (§5.3).

## 17.7 Why a manifest and a binary

The binary stays small enough to embed. The manifest carries what a human or an audit needs: engine
identities, ROM hashes, the measured scope, HVSC document digests, and the digests that bind the
list to the source bundle.

---

# 18. Summary

sidromdep-1:

- is a 192-byte header, a FILE_TABLE of full-MD5 records, and a DECISION_TABLE of 2-byte records
- is allow-by-default: only listed file/subtune records change behaviour
- identifies files by full-file MD5 and subtunes by one-based number
- records, per subtune, which of four engine/ROM lanes are incompatible or unknown
- never treats unknown as incompatible, and never presents unlisted as proof of compatibility
- carries SHA-256 provenance for the source bundle, `Songlengths.md5` and the audit corpus
- is exactly `192 + 17 * files + 2 * subtunes` bytes; about 32 KiB for the expected corpus
- is generated only from a complete, verified census and verified by an exhaustive round trip

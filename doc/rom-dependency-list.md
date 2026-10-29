# SID ROM Dependency List Specification

Schema ID: sidromdep-1
Status: Normative
Current binary_format_version: 1

---

# 1. Purpose

This specification defines a small, self-describing binary list of the HVSC subtunes whose
**playback fidelity degrades when the C64 system ROMs are absent**, expressed as a graded score
per engine and ROM configuration, for:

- skipping low-fidelity tunes in unattended playback (autoplay, radio, station queues)
- warning before explicit playback of such tunes
- letting each application choose its own fidelity threshold

It is intended for weak-device runtimes (for example an Android APK that embeds the file) and for
any other project that plays SID files with an engine that is not given KERNAL, BASIC and CHARGEN.

The list is **allow-by-default**. A file or subtune that is not listed is playable: every lane of
an unlisted subtune graded above the list's **listing ceiling** (the shipped release uses 191, i.e.
`Q >= 0.5`: only playback that is mostly wrong is listed). Only listed records can change behaviour.
The list is therefore a deny/warn list, not an inventory and not a compatibility certificate.

Non-goals:

- proving that an unlisted file is faithful (§10.3)
- proving hardware fidelity or authorising indefinite playback (§9.4)
- carrying similarity, style, rating or duration data
- carrying per-subtune playback horizons (§9.3, §17.6)
- enumerating the graded collection
- carrying the full per-subtune grades: those are published separately (the complete grading results
  in the sidflow-data release) for consumers that need more than the list's ceiling
- representing unmeasured lanes (§13.2)

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
- **reference** = the same engine given all three authentic ROMs. It is the unrestricted lane: it
  is equivalent to itself by definition and is never graded.
- **grade** = one byte `G`, 0 to 255, per (file MD5, subtune, lane). It measures playback fidelity
  against the reference over the observation horizon (§9.1). Higher is never audibly worse.
- **listed** = the (file, subtune) has a DECISION record, i.e. some lane grade is at most the
  listing ceiling.
- **listing ceiling** `C` = a per-list parameter, `1..253` (header `listing_ceiling`). A subtune is
  listed iff some lane grade is `<= C`; an unlisted subtune has every lane `> C`. The release uses
  `C = 191`.
- **recommended minimum grade** = a consumer default skip threshold recorded by the generator
  (`recommended_min_grade`, `1 <= value <= C + 1`, §5.2). Consumers MAY choose their own (§10.1).
- **graded** = covered by the grading run that produced the list. Not recorded in the binary; the
  binary carries only the graded counts (§5.2).
- **observation horizon** = how long the grading compared a subtune with its reference (§9.3).

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119.

---

# 3. Normative Sources

## 3.1 Repository surfaces

- `packages/sidflow-common/src/rom-dependency-list.ts` (encoder, decoder, lookup, horizon rule)
- `scripts/rom-dependency-list/grading.ts` (reading and interpreting grading results)
- `scripts/rom-dependency-list/generate.ts`
- `scripts/rom-dependency-list/verify.ts`
- `doc/research/hvsc-rom-fidelity-grading.md` (definition, calibration and gates of the grade)

Where this document and the source code disagree, the source code is authoritative and this
document is wrong. Anyone who needs only to **read** a list needs nothing but this document: §5 to
§10 are self-contained.

## 3.2 Grading results input

The generator consumes one UTF-8 JSONL file, `grading-results.jsonl`, with one JSON object per
line. Keys are case-sensitive; unknown keys are ignored except where stated.

Line 1, the header record:

```json
{"record":"header","schema":"sidflow-rom-grading-results-1","methodologyId":"<64 hex>","hvscRelease":85,
 "corpusId":"<64 hex>","songlengthsSha256":"<64 hex>","files":61157,"subtunes":87868,
 "profile":{"romSetId":"<64 hex>"}}
```

| Field | Meaning |
|--|--|
| `methodologyId` | the frozen grading methodology identity (SHA-256, 64 lowercase hex); copied into the header |
| `hvscRelease` | HVSC release number, integer `>= 1` |
| `corpusId` | identity of the graded path/content listing (64 hex); copied into the header |
| `songlengthsSha256` | SHA-256 of the HVSC `Songlengths.md5` the grading used; copied into the header |
| `files`, `subtunes` | the expected population; a complete input contains exactly this many files and grade records |
| `profile` | optional free-form object describing engines and settings; copied verbatim into the manifest. If it contains `romSetId` it MUST equal the reference ROM set id (`romSetId()` of `packages/sidflow-common/src/rom-eligibility.ts`) |

Every further line, a grade record:

```json
{"record":"grade","md5":"<32 hex>","song":2,"methodologyId":"<64 hex, optional>",
 "grades":{"sidliteNone":254,"sidliteKernalBasic":255,"residfpNone":120,"residfpKernalBasic":255}}
```

| Field | Meaning |
|--|--|
| `md5` | complete-file MD5, 32 lowercase hex |
| `song` | one-based subtune, integer `1..256` |
| `methodologyId` | optional; if present it MUST equal the header's |
| `grades` | exactly the four lane names of §5.5; each an integer `0..255`, or `null` for a lane that is not measured |

Rules: `(md5, song)` is unique; the songs of a file are exactly `1..n`; the file digest of the
whole JSONL (SHA-256) is stored as `source_sha256`. A grade record with any `null` lane, a file or
subtune count that differs from the header, or a gap in the subtune numbers makes the input
**incomplete**. A release requires a complete input (§13.2).

---

# 4. Identity Model

## 4.1 Files are identified by the full 16-byte MD5

A file is identified by the MD5 of its **complete file content** (the same value as the key in
HVSC `Songlengths.md5`). The binary stores all 16 raw bytes. There is no truncated form.

Rationale (§17.3): a deny/warn list must not produce false positives. A truncated prefix would
make a stranger's unrelated file match a listed record with non-zero probability, and the cost of
exactness is about 10 bytes per listed file.

## 4.2 Subtunes

A subtune is identified by its **one-based** number within the file. Valid values are 1 to 256
(the SID header `songs` field is limited to 256 by the SID file format and HVSC contains a file
with exactly 256 subtunes). On disk the value is stored minus one in a `u8` (§7).

## 4.3 No inventory

The list does not enumerate graded files. Absence has exactly one meaning: **no record**. For a
graded file it means every lane graded above the listing ceiling. For a file the grading never saw (for example a
file that is new in a later HVSC release) it means nothing is known, and the file is playable by
default.

---

# 5. Binary Layout

## 5.1 Endianness

- little-endian

## 5.2 Header (224 bytes)

| Offset | Field | Type | Notes |
|--|--|--|--|
| 0 | magic | 8 bytes | ASCII `SIDROMDP` |
| 8 | binary_format_version | u16 | `1`; readers MUST reject any other value |
| 10 | header_bytes | u16 | MUST be `224` |
| 12 | flags | u32 | bit `0` = `INCOMPLETE_SOURCE` (§5.4); all other bits MUST be `0` |
| 16 | hvsc_release | u32 | HVSC release number, `>= 1` (for example `85`) |
| 20 | source_files | u32 | files in the grading input (informational) |
| 24 | source_subtunes | u32 | subtunes in the grading input (informational) |
| 28 | file_count | u32 | FILE_TABLE records (listed files) |
| 32 | decision_count | u32 | DECISION_TABLE records (listed subtunes) |
| 36 | file_table_offset | u32 | MUST be `224` |
| 40 | file_table_bytes | u32 | MUST be `file_count * 17` |
| 44 | decision_table_offset | u32 | MUST be `224 + file_table_bytes` |
| 48 | decision_table_bytes | u32 | MUST be `decision_count * 5` |
| 52 | header_crc32 | u32 | CRC-32 of bytes `0..223` with this field taken as zero (§5.3) |
| 56 | file_record_bytes | u16 | MUST be `17` |
| 58 | decision_record_bytes | u16 | MUST be `5` |
| 60 | listing_ceiling | u8 | `C`, `1..253`: a subtune is listed iff some lane grade is `<= C` (§7) |
| 61 | recommended_min_grade | u8 | consumer default skip threshold, `1 <= value <= listing_ceiling + 1` (§10.1) |
| 62 | reserved | u16 | MUST be `0` |
| 64 | payload_sha256 | 32 bytes | SHA-256 of every byte from offset 224 to the end of the file |
| 96 | source_sha256 | 32 bytes | SHA-256 of the grading results JSONL (§3.2) |
| 128 | songlengths_sha256 | 32 bytes | SHA-256 of the HVSC `Songlengths.md5` the grading pinned |
| 160 | corpus_id | 32 bytes | the grading input's `corpusId` |
| 192 | grading_methodology_sha256 | 32 bytes | the frozen grading methodology identity (`methodologyId`) |

`source_files` and `source_subtunes` (61,157 and 87,868 for HVSC #85) are statements about the
grading input, not about the list. Consumers MUST NOT use them to derive any playback decision.

The offsets and lengths are redundant with the counts by design: a reader MUST check that they
equal the canonical values above and MUST reject the file otherwise. The total file length MUST
equal `224 + file_table_bytes + decision_table_bytes`.

## 5.3 Integrity fields

Two independent checks are carried in the file so that truncation and corruption are detectable
without the manifest:

- `header_crc32` covers the header, including all four provenance digests, the thresholds and
  `payload_sha256`. CRC-32 is the standard IEEE 802.3 polynomial (`0xEDB88320` reflected, initial
  value and final XOR `0xFFFFFFFF`), as used by zlib and PNG.
- `payload_sha256` covers both sections.

A reader MUST verify both and MUST reject on mismatch. Neither field provides authenticity; an
adversary can recompute both. Authenticity comes only from pinning the manifest SHA-256 obtained
from a trusted release (§13.3).

## 5.4 Flags

| Bit | Name | Meaning |
|--|--|--|
| 0 | `INCOMPLETE_SOURCE` | The grading input was incomplete. Subtunes with an unmeasured lane were **excluded** from the list, so for them "unlisted" says nothing (§13.2). The file is a developer artefact produced with `--allow-incomplete`. It MUST NOT be released or embedded in a product. A consumer MAY refuse to load a file with this bit set; a product build SHOULD. |

## 5.5 Lanes

The four grade bytes of a DECISION record are in this order:

| Byte | Lane name | Engine | ROM configuration |
|--:|--|--|--|
| 0 | `sidliteNone` | SIDLite | none |
| 1 | `sidliteKernalBasic` | SIDLite | KERNAL + BASIC |
| 2 | `residfpNone` | reSIDfp | none |
| 3 | `residfpKernalBasic` | reSIDfp | KERNAL + BASIC |

## 5.6 Section Order

Sections MUST appear in this order and MUST be tightly packed:

1. header (224 bytes)
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

`decision_count` records of 5 bytes, grouped by file in FILE_TABLE order. Within a file the records
are **strictly ascending** by subtune.

| Offset | Field | Type | Notes |
|--|--|--|--|
| 0 | subtune_minus_1 | u8 | one-based subtune `1..256` stored minus one |
| 1 | grade_sidlite_none | u8 | grade `0..255` (§9.1) |
| 2 | grade_sidlite_kernal_basic | u8 | grade `0..255` |
| 3 | grade_residfp_none | u8 | grade `0..255` |
| 4 | grade_residfp_kernal_basic | u8 | grade `0..255` |

Record rule, which a reader MUST check: **at least one of the four grades is `<= C`**
(`listing_ceiling`). A record whose four grades are all above `C` is not representable. This is
what makes "unlisted" mean "every lane above `C`" (§17.2). `C` is at most 253 because grades 254
and 255 both mean "same music" and are never listed.

There is no value reserved for "unknown" or "not measured". A lane that was not measured has no
grade and cannot be encoded (§13.2).

---

# 8. Matching Rules

To look up `(md5, subtune)`:

1. Reject (treat as unlisted) any `subtune` outside `1..256`.
2. Binary-search the FILE_TABLE for the 16-byte `md5`. Absent: **unlisted**.
3. Scan that file's decisions for `subtune`. Absent: **unlisted**.
4. Otherwise read the four grade bytes.

An unlisted subtune has, for every lane, a grade **above `C`**; the list does not say which, and
a consumer MUST NOT assume a value. Reference implementations report `C + 1` for every lane of an
unlisted subtune, as a lower bound.

Rules:

- Matching is on all 16 bytes. A consumer MUST NOT match on a prefix.
- Matching is on the **content** MD5 of the file as played. A consumer MUST NOT substitute a
  path, a filename, a SHA-256 or a tune title.
- A consumer that cannot compute a full-file MD5 for a file MUST treat it as unlisted.
- The grade of a lane is read only for the lane that matches the consumer's actual engine and ROM
  configuration (§10.1).

Reference API (`packages/sidflow-common/src/rom-dependency-list.ts`):

```ts
decodeRomDependencyList(bytes: Uint8Array): RomDependencyList   // validates everything (§13.1)
list.lookup(md5: string | Uint8Array, subtune: number): {
  listed: boolean;
  grades: Record<"sidliteNone" | "sidliteKernalBasic" | "residfpNone" | "residfpKernalBasic", number>;
  minGrade: number;                    // listing_ceiling + 1 when unlisted (lower bound)
}
romDepBelowThreshold(lookup, lane, threshold): boolean   // grade < threshold
```

---

# 9. Grades and Measured Scope

The statements in a record are true **only within the scope in which they were measured**. The
scope is recorded in the manifest (`measuredProfile`, §11) and summarised here. It is informative:
the binary carries no per-subtune scope data (§17.6). The authoritative definition, calibration
corpus and acceptance gates of the grade are in `doc/research/hvsc-rom-fidelity-grading.md`.

## 9.1 Grade meaning

| G | Meaning | Evidence |
|--:|--|--|
| 255 | Bit-exact: identical (chip, register, value, cycle) write trace | trace |
| 254 | Same music, re-timed: identical (chip, register, value) sequence and count; every write within the calibrated tolerance of the reference after the constant start offset | trace |
| 1–253 | Graded: `max(1, round(253 · Q))` with `Q = 1 − mean severity` over spectrally analysed windows, used only when the trace is neither 255 nor 254 | audio |
| 0 | No playback: for example only initialisation writes, an immediate CPU jam, or silence where the reference plays | trace or audio |

Higher is never audibly worse within the calibration corpus. Grades 254 and 255 both mean "the
same music"; neither is a reason to skip, warn or list.

## 9.2 Measured profile

Authoritative identities (engine builds, ROM hashes, methodology) are recorded in the manifest and
in the header (`grading_methodology_sha256`); this table states the configuration.

| Property | Value |
|--|--|
| Engines | SIDLite and reSIDfp from the pinned `libsidplayfp-wasm` |
| Reference | the same engine with the authentic KERNAL, BASIC and CHARGEN (SHA-256 values in the manifest `referenceRoms`; `romSetId` binds them) |
| Configurations | `none`: no ROMs supplied; `kernalBasic`: KERNAL and BASIC supplied, CHARGEN not supplied |
| Absent banks | BASIC and CHARGEN zero-filled; a KERNAL shim when KERNAL is absent |
| SID model | as selected by the SID header; MOS8580 where the header names none |
| Free-form detail | the grading input's `profile` object, copied verbatim into the manifest as `sourceProfile` |

## 9.3 Observation horizon

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

The Songlengths SHA-256 is part of the provenance (`songlengths_sha256`). A generator given the
`Songlengths.md5` file checks its digest against the one the grading pinned.

## 9.4 What a grade does and does not say

- A **low grade** was observed within the horizon. A divergence that appeared inside the horizon is
  a divergence of the tune; the consumer does not need to observe the horizon itself.
- A **high grade** (including the unlisted default for a graded subtune) means "no divergence found
  within the horizon, profile and engine build". It does not cover playback beyond the horizon (a
  looping tune may diverge later), another SID model than the measured one, another engine build,
  hardware fidelity, or interactive input.

---

# 10. Consumer Obligations

## 10.1 Selecting the lane and the threshold

A consumer determines its lane from its actual configuration: engine (SIDLite or reSIDfp, built
from the pinned source) and ROM configuration (`none`, or KERNAL and BASIC supplied without
CHARGEN).

A consumer that supplies all three ROMs with SHA-256 values equal to the manifest's
`referenceRoms` runs the **reference configuration** itself. Every subtune is equivalent to the
reference by definition, so the list imposes no restriction and the consumer MUST NOT skip or warn
because of it.

A consumer whose engine build, ROM images or ROM subset match neither the reference nor one of the
four lanes has no applicable measurement: it MUST NOT claim measured fidelity from the list, and it
MAY use the lowest grade across the four lanes as a conservative hint.

A consumer chooses a **skip threshold** `t`: a lane grade below `t` is "low fidelity". The list
can honour any `t` with `1 <= t <= C + 1`, because every grade below `C + 1` is either recorded or
(unlisted) at least `C + 1`. The header's `recommended_min_grade` is the generator's calibrated
default (the release uses 128, `Q >= 0.5`, which skips only playback that is mostly wrong); a
consumer MAY pick any `t <= C + 1`. A consumer that needs a threshold above `C + 1`, or per-subtune
grades above the ceiling, uses the full grading results published separately in the sidflow-data
release; this list cannot express them.

## 10.2 Required behaviour

| Grade `G` of the consumer's lane | Autoplay / radio / queue | Explicit user selection |
|--|--|--|
| `G < t` (including 0) | MUST skip | MUST warn before playing; MAY allow after confirmation |
| `t <= G <= C` (listed) | MAY play | MAY play; MAY show a fidelity notice |
| unlisted (`G > C`) | MAY play | MAY play |
| consumer runs the reference ROM set | MUST NOT skip because of the list | MUST NOT warn because of the list |

Additional obligations:

1. A consumer MUST NOT treat a missing grade as a low grade: there is no "unknown" value in this
   format, and an unlisted subtune is not a restriction.
2. A consumer MUST NOT present an unlisted or high-grade result as proof of fidelity, and MUST NOT
   use it to authorise playback beyond the horizon as "verified".
3. A consumer SHOULD apply the list per subtune, not per file: other subtunes of a listed file are
   unlisted unless they have their own record.
4. A list with header flag `INCOMPLETE_SOURCE` is a developer artefact (§5.4).
5. A consumer SHOULD pin the manifest SHA-256 of a trusted release and compare the SHA-256 of the
   bundled binary with the manifest (§13.3).

## 10.3 Why unlisted is not "faithful"

The list cannot distinguish a file the grading found faithful (a grade above `C`) from a file the grading
never saw (for example a file that is new in a later HVSC release). Both are unlisted and therefore
playable by default. This is deliberate (§17.1): the alternative would make every unseen file
unplayable or warned. The consequence is that the unlisted default is a policy, not evidence.

---

# 11. Manifest

`hvsc<N>-sidromdep-1.manifest.json` is deterministic JSON (sorted keys, `stringifyDeterministic`),
UTF-8, with a trailing newline. It contains no timestamps, so regenerating from the same inputs
yields identical bytes. Top-level fields:

| Field | Meaning |
|--|--|
| `format` | `{ id: "sidromdep-1", version: 1, specification }` |
| `hvscRelease` | HVSC release number |
| `complete` | `true` only for a release output; `false` for `--allow-incomplete` output from incomplete grading |
| `releasable` | equals `complete`; a second field so that tooling cannot overlook a non-release |
| `status` | `release` or `developer-incomplete-source-NOT-RELEASABLE` |
| `semantics` | the allow-by-default rule in one sentence |
| `lanes` | the lane order of §5.5 |
| `listingCeiling`, `recommendedMinGrade` | the thresholds of the header |
| `counts` | `listedFiles`, `listedSubtunes`, `subtunesBelowRecommended` (any lane below `recommendedMinGrade`), `excludedUnmeasuredSubtunes`, `sourceFiles`, `sourceSubtunes`, and per lane `{belowRecommended, bands}` where `bands` counts listed grades in `0`, `1-63`, `64-127`, `128-191`, `192-253` (listed grades are at most `listingCeiling`) |
| `binary` | `file`, `bytes`, `sha256`, `payloadSha256`, record sizes and the two sections' `{offset, bytes}` |
| `humanReadable` | `file` and `sha256` of the optional JSON view (§12) |
| `provenance` | `sourceSha256`, `songlengthsSha256`, `corpusId`, `gradingMethodologySha256` |
| `measuredProfile` | `gradingDesign`, reference and configuration descriptions, `referenceRoms`, `romSetId`, `observationHorizon` (rule and constants), `songlengthsFileVerified`, and `sourceProfile` (verbatim from the grading input) |

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
  "recommendedMinGrade": 128,
  "listingCeiling": 191,
  "lanes": ["sidliteNone", "sidliteKernalBasic", "residfpNone", "residfpKernalBasic"],
  "records": [
    { "md5": "...", "hvscPath": "MUSICIANS/X/Name.sid", "subtune": 2, "minGrade": 120,
      "belowRecommended": true,
      "grades": { "sidliteNone": 255, "sidliteKernalBasic": 255, "residfpNone": 120, "residfpKernalBasic": 255 } }
  ]
}
```

`records` are in binary order (MD5, then subtune). `hvscPath` is the path from the
`Songlengths.md5` comment line, or `null` when the generator was not given the file.

---

# 13. Validation and Verification

## 13.1 Decoder / consumer validation

A conforming reader MUST reject the input (and not return a partial result) unless all of:

1. length `>= 224`, magic `SIDROMDP`, `binary_format_version == 1`, `header_bytes == 224`
2. `header_crc32` matches
3. no flag bit other than bit 0, `reserved == 0`, `hvsc_release >= 1`
4. record sizes are 17 and 5, `listing_ceiling` in `1..253`, `recommended_min_grade` in
   `1..listing_ceiling + 1`, section
   offsets and lengths are the canonical values (§5.2), and the file length is exactly
   `224 + file_table_bytes + decision_table_bytes` (no truncation, no trailing bytes)
5. `payload_sha256` matches
6. file records are strictly ascending, their counts sum to `decision_count`
7. within each file, subtunes are strictly ascending
8. every decision has at least one grade `<= listing_ceiling` (§7)

## 13.2 Generator rules

The generator (`scripts/rom-dependency-list/generate.ts`) MUST:

1. parse the grading results strictly (§3.2) and refuse any input in which a lane is unmeasured
   (`null`), a file or subtune count differs from the header, a subtune number is missing, or a
   record repeats. `--allow-incomplete` is the only exception: subtunes with an unmeasured lane are
   **excluded** (neither listed nor claimed to be above the ceiling), header flag bit 0 is set, and the
   manifest says `complete: false`, `releasable: false`
2. take `listing_ceiling` from a required command-line argument (`--listing-ceiling`, `1..253`) and
   `recommended_min_grade` from a required argument (`--recommended-min-grade`,
   `1..listing_ceiling + 1`); there are no defaults, because both are release decisions
3. emit one decision per subtune that has some lane grade `<= listing_ceiling`, and nothing else
4. when given `Songlengths.md5`, require its SHA-256 to equal the digest pinned in the input
5. require a `profile.romSetId`, if present, to equal the reference ROM set id
6. be deterministic: the same inputs produce byte-identical binary, manifest and JSON

## 13.3 Verification procedure

`bun scripts/rom-dependency-list/verify.ts --bin hvsc85-sidromdep-1.bin --results grading-results.jsonl [--songlengths <Songlengths.md5>]`

1. decode the binary with all checks of §13.1
2. check the manifest: format id/version, binary SHA-256 and size, `payloadSha256`, `complete` vs
   header flag, thresholds, counts, and the four provenance digests against the header
3. load the grading results under the same rules as the generator (§13.2 item 1); check that their
   SHA-256, methodology id, Songlengths digest, corpus id, HVSC release and population equal the
   header values
4. every listed subtune exists in the grading results
5. for **every** subtune of **every** graded file: if all four graded lanes are `> listing_ceiling` the
   subtune MUST be unlisted (this is the proof that "absent from the list" means "every lane at
   above the ceiling"); if some lane is `<= listing_ceiling` the list's four grades MUST equal the input's; an
   unmeasured subtune (developer output only) MUST be unlisted
6. optionally (`--songlengths`) check the file's digest and the HVSC paths in the JSON view
7. if the human-readable JSON exists, its digest and records match the binary
8. print the SHA-256 of the binary and of the manifest

A consumer pins the printed manifest SHA-256 from a trusted release, then checks that the manifest's
`binary.sha256` equals the SHA-256 of the file it embeds.

---

# 14. Worked Example

A list for HVSC #85 with `listing_ceiling = 191` and `recommended_min_grade = 128`, containing two files:

- `0123456789abcdef0123456789abcdef`:
  - subtune 1: grades `0, 254, 120, 253` (`sidliteNone` no playback; `residfpNone` degraded)
  - subtune 3: grades `255, 255, 150, 255` (`residfpNone` degraded)
- `fedcba9876543210fedcba9876543210`:
  - subtune 256: grades `191, 255, 254, 255` (exactly at the ceiling, so it is listed)

Provenance digests are `a1…a1` (source), `b2…b2` (Songlengths), `c3…c3` (corpus) and `d4…d4`
(grading methodology), 32 bytes each. Total size `224 + 2*17 + 3*5 = 273` bytes.

```text
0000  53 49 44 52 4f 4d 44 50  magic "SIDROMDP"
0008  01 00                    binary_format_version = 1
000a  e0 00                    header_bytes = 224
000c  00 00 00 00              flags = 0
0010  55 00 00 00              hvsc_release = 85
0014  e5 ee 00 00              source_files = 61157
0018  3c 57 01 00              source_subtunes = 87868
001c  02 00 00 00              file_count = 2
0020  03 00 00 00              decision_count = 3
0024  e0 00 00 00              file_table_offset = 224
0028  22 00 00 00              file_table_bytes = 34
002c  02 01 00 00              decision_table_offset = 258
0030  0f 00 00 00              decision_table_bytes = 15
0034  41 f6 c4 55              header_crc32 = 0x55c4f641
0038  11 00                    file_record_bytes = 17
003a  05 00                    decision_record_bytes = 5
003c  bf                       listing_ceiling = 191
003d  80                       recommended_min_grade = 128
003e  00 00                    reserved
0040  10 d1 e7 a3 eb bc 93 0c  payload_sha256 (32 bytes)
0048  77 96 ca e6 b4 eb 8f 8b
0050  d0 8e 1c 16 18 64 db b9
0058  0d c2 ad 7c ef 4d a5 bc
0060  a1 ... a1 (32 bytes)     source_sha256
0080  b2 ... b2 (32 bytes)     songlengths_sha256
00a0  c3 ... c3 (32 bytes)     corpus_id
00c0  d4 ... d4 (32 bytes)     grading_methodology_sha256
00e0  01 23 45 67 89 ab cd ef  FILE_TABLE[0].md5
00e8  01 23 45 67 89 ab cd ef
00f0  01                       decision_count_minus_1 = 1 (2 decisions)
00f1  fe dc ba 98 76 54 32 10  FILE_TABLE[1].md5
00f9  fe dc ba 98 76 54 32 10
0101  00                       decision_count_minus_1 = 0 (1 decision)
0102  00 00 fe 78 fd           file 0, subtune 1: grades 0, 254, 120, 253
0107  02 ff ff 96 ff           file 0, subtune 3: grades 255, 255, 150, 255
010c  ff bf ff fe ff           file 1, subtune 256: grades 191, 255, 254, 255
```

(The `payload_sha256` and `header_crc32` bytes in the listing are those produced by the reference
encoder; `packages/sidflow-common/test/rom-dependency-list.test.ts` pins them.)

Lookups, with skip threshold `t = 128`:

| md5 | subtune | lane | grade | result |
|--|--:|--|--:|--|
| `0123…cdef` | 1 | `sidliteNone` | 0 | listed; skip in autoplay, warn on explicit play |
| `0123…cdef` | 1 | `residfpNone` | 120 | listed; `120 < 128`, skip |
| `0123…cdef` | 1 | `residfpKernalBasic` | 253 | listed (its other lanes are low); this lane is not below `t`, play |
| `0123…cdef` | 2 | any | — | unlisted (every lane `> 191`; decoders report 192); play |
| `0123…cdef` | 3 | `residfpNone` | 150 | listed; not below `t`, play |
| `fedc…3210` | 256 | `sidliteNone` | 191 | listed; not below `t`, play |
| any other MD5 | any | any | — | unlisted; play |

---

# 15. Versioning

- `binary_format_version` is `1`. A reader MUST reject any other value; there is no forward
  compatibility. The magic never changes between versions; the version field selects the layout.
- Any change to the header, the record layouts, the lane order, the meaning of a grade or the
  listing ceiling requires a new version and a new schema id (`sidromdep-2`).
- Adding fields to the manifest or the JSON view is not a format change; consumers MUST ignore
  unknown manifest fields.
- Regenerating a list for a new HVSC release or a new grading methodology produces a new file with
  new provenance digests. The format version does not change.
- The range of subtunes (`1..256`) and the `u8` counts are format limits. Exceeding them requires a
  new version.

---

# 16. Size Analysis

Size is exact and linear:

```text
bytes = 224 + 17 * listed_files + 5 * listed_subtunes
```

| Listed files | Listed subtunes | Bytes | KiB |
|--:|--:|--:|--:|
| 1,560 | 2,636 (about 3 % of 87,868) | 39,924 | 39.0 |
| 1,600 | 2,700 | 40,924 | 40.0 |
| 3,000 | 5,000 | 76,224 | 74.4 |

The design target is about 40 KiB. Each additional listed file adds 17 bytes and each additional
listed subtune 5 bytes. The listing ceiling is what bounds the count of listed subtunes: the
calibration showed that ceiling 253 would list about 7 % of HVSC (about 90 KiB), mostly
near-perfect grades of 250 to 253. With the release ceiling of 191 (`Q >= 0.5`) about 2 % of the
subtunes are listed, which is about 40 KiB. Lowering the ceiling shrinks the file, raising it grows
it; the full per-subtune grades stay available in the separately published grading results.

Test coverage at scale: a synthetic grading of 61,157 files and about 80,000 subtunes with a 3 %
listed share, spread uniformly over files, generates and verifies in well under a second
(ceiling 191: 2,121 files, 2,152 subtunes, 47,041 bytes; real data clusters subtunes in fewer files).

Compared with the earlier 4-bit mask design (2-byte decision records), grades cost 3 more bytes
per listed subtune, about 8 KB at 2,700 subtunes.

---

# 17. Design Rationale

## 17.1 Why allow-by-default

A deny/warn list needs only the exceptions. An inventory would double the size, would have to be
regenerated for every HVSC release to avoid classifying new files as "not graded", and would force
consumers to choose a policy for files absent from it. Allow-by-default makes the list independent
of the collection's growth: a new file is playable until a later list says otherwise. The cost,
stated plainly in §10.3, is that unlisted is a policy and not evidence.

## 17.2 Why grades 0–255 and a listing ceiling parameter

A binary verdict mixed two different things: tunes that play the same music at slightly shifted
timing, and tunes that play different music or nothing. A one-byte grade (§9.1) separates them, and
lets each consumer choose its own tolerance. 255 and 254 both mean "same music", so neither
requires a record; 253 is the largest value that denotes a measured, graded difference, hence the
upper bound of the ceiling. Listing exactly the subtunes with some lane at most `C` gives the
invariant "unlisted implies every lane above `C`" with no extra table. The ceiling is a generator
parameter rather than a constant because the calibration showed that listing every difference
(`C = 253`) would add thousands of near-perfect 250 to 253 grades that no consumer wants to skip
and would double the size; the release picks `C = 191` and publishes the full grades separately.
One byte per lane keeps a decision at 5 bytes. No value is reserved
for "unknown": an unmeasured lane is not a fidelity statement, so it cannot be a grade and the
generator refuses it (§13.2).

## 17.3 Why the full MD5

False positives are not permitted: a wrongly matched file would be skipped or warned although
nothing is wrong with it. A 48-bit prefix stored for 1,600 listed files and compared with a
collection of one million local files collides with probability about 1,600 x 10^6 / 2^48, which
is about 6 x 10^-6; small, but not zero, and avoidable. The full 16 bytes cost 10 additional bytes
per listed file, about 16 KB in total. Accidental collision of full MD5 is about 2^-128. MD5 is
used because it is the identity of HVSC `Songlengths.md5` and of C64 Commander; its known
cryptographic weakness is irrelevant here because the list is an integrity-protected input
supplied by the application, not a security boundary.

## 17.4 Why a recommended threshold in the header, and why at most ceiling + 1

Consumers need a sensible default, but the right cut-off is a calibration result, not a constant of
the format; the generator therefore takes it as a required argument. The format cannot express
thresholds above `C + 1`, because grades above the ceiling are indistinguishable once unlisted.

## 17.5 Why implicit first-decision indices and `n-1` counts

An explicit `u32` decision index per file would add 4 bytes per file (about 6.4 KB at 1,600
files). Prefix sums are computed once at load. Storing the counts and subtunes minus one fits
1..256 into a `u8`; HVSC contains a file with 256 subtunes, so a plain `u8` of the one-based value
would be insufficient.

## 17.6 Why no horizon table

The horizon is a pure function of the pinned `Songlengths.md5` (§9.3), whose digest is part of the
provenance, and a grade is a statement about a divergence that already happened inside it. The
list therefore carries no horizon data. A consumer that needs one recomputes it from its own
Songlengths data.

## 17.7 Why a CRC-32 and a SHA-256

The header carries the payload SHA-256, so the header itself needs its own check (CRC-32), and the
payload needs a strong one. Together they detect any truncation or corruption without the
manifest. They are not authenticity (§5.3).

## 17.8 Why a manifest and a binary

The binary stays small enough to embed. The manifest carries what a human or an audit needs: ROM
hashes, the measured scope, the grade distribution, and the digests that bind the list to the
grading input.

---

# 18. Summary

sidromdep-1:

- is a 224-byte header, a FILE_TABLE of full-MD5 records, and a DECISION_TABLE of 5-byte records
- is allow-by-default: a subtune is listed iff some lane grade is at most the list's listing ceiling
  `C` (1..253; the release uses 191); unlisted means every lane above `C`
- identifies files by full-file MD5 and subtunes by one-based number
- records, per listed subtune, one fidelity grade (0 no playback ... 254 re-timed, 255 bit-exact)
  for each of four engine/ROM lanes
- has no "unknown" value; unmeasured lanes are refused (or, in developer output, excluded and flagged)
- carries SHA-256 provenance for the grading results, `Songlengths.md5`, the corpus and the grading
  methodology, plus the generator's recommended skip threshold
- is exactly `224 + 17 * files + 5 * subtunes` bytes; about 40 KiB for the expected corpus
- is generated only from complete grading results and verified by an exhaustive round trip

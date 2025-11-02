# SID File Metadata Spec

This specification describes all **metadata-relevant header fields** of SID files used in the **High Voltage SID Collection (HVSC)**.  

It is based on the [SID File Format Description](https://www.hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt) by LaLa, 2023.

---

## 1. General

- **File extensions:** `.sid`  
- **Supported types:** `PSID`, `RSID`  
- **Encoding:** All text fields use **Windows-1252 (Extended ASCII)**.  
- **Endian:** All multi-byte integers are **big-endian** (`WORD` = 16-bit, `LONGWORD` = 32-bit).  
- **Versions:** 1 – 4.  
- **Binary data offset:**  
  - v1 → `0x0076`  
  - v2–v4 → `0x007C`

---

## 2. Header Structure Summary

| Offset | Size | Field | Type | Description |
|--------:|------|--------|------|-------------|
| `+00` | 4 | **magicID** | STRING | `"PSID"` or `"RSID"`. Identifies file type. RSID files require true C64 runtime environment. |
| `+04` | 2 | **version** | WORD | Valid: 0x0001–0x0004. Versions ≥ 2 add extended header fields. |
| `+06` | 2 | **dataOffset** | WORD | Offset to C64 binary data: 0x0076 (v1) / 0x007C (v2–v4). |
| `+08` | 2 | **loadAddress** | WORD | Memory load address. 0 → take from file data. For RSID, must be ≥ `$07E8`. |
| `+0A` | 2 | **initAddress** | WORD | Routine initializing playback (A = song number). RSID: must not be in ROM, and ≥ `$07E8`. |
| `+0C` | 2 | **playAddress** | WORD | Routine to be called repeatedly for playback. RSID requires `0` (handled by IRQ). |
| `+0E` | 2 | **songs** | WORD | Number of songs/subtunes. Valid range: `1–256`. |
| `+10` | 2 | **startSong** | WORD | Default song (1-based index). Default: 1. |
| `+12` | 4 | **speed** | LONGWORD | Per-song bitmask: `0` = VBlank, `1` = CIA Timer. RSID = `0`. |
| `+16` | 32 | **name** | STRING | Song title (Windows-1252). Zero-terminated if < 32 bytes. |
| `+36` | 32 | **author** | STRING | Composer / musician (Windows-1252). Zero-terminated if < 32 bytes. |
| `+56` | 32 | **released** | STRING | Release / copyright info (Windows-1252). Zero-terminated if < 32 bytes. |
| `+76` | — | — | — | End of v1 header; v2+ continues below. |

---

## 3. Extended Header Fields (v2, v3, v4)

| Offset | Size | Field | Type | Description |
|--------:|------|--------|------|-------------|
| `+76` | 2 | **flags** | WORD | Bitfield controlling environment and SID model. Bits 10–15 must be `0`. |
| | | **Bit 0 – musPlayer** | 0 = Built-in player; 1 = Compute!’s SIDplayer MUS data. |
| | | **Bit 1 – psidSpecific / C64BASIC** | PSID: 1 = PlaySID-specific; RSID: 1 = contains BASIC portion (init = 0). |
| | | **Bits 2–3 – clock (video standard)** | `00 = Unknown`, `01 = PAL`, `10 = NTSC`, `11 = PAL + NTSC`. |
| | | **Bits 4–5 – sidModel #1** | `00 = Unknown`, `01 = 6581`, `10 = 8580`, `11 = Both`. |
| | | **Bits 6–7 – sidModel #2** | (v3+) Same encoding; 00 = Unknown → same as #1. |
| | | **Bits 8–9 – sidModel #3** | (v4+) Same encoding; 00 = Unknown → same as #1. |
| `+78` | 1 | **relocStartPage** | BYTE | (v2NG+) Start of largest free page range: 0 = clean; 0xFF = none. |
| `+79` | 1 | **relocPages** | BYTE | (v2NG+) Length (in pages) of free range; 0 if `relocStartPage` = 0 or 0xFF. |
| `+7A` | 1 | **secondSIDAddress** | BYTE | (v3+) `$Dxx0` base of 2nd SID. Valid even values 0x42–0x7E, 0xE0–0xFE. 0 = none. |
| `+7B` | 1 | **thirdSIDAddress** | BYTE | (v4+) `$Dxx0` base of 3rd SID. Valid even values 0x42–0x7E, 0xE0–0xFE. Must differ from 2nd SID. 0 = none. |
| `+7C` | — | **data** | — | Start of C64 binary data block. |

---

## 4. Character Encoding Notes

- All text fields (`name`, `author`, `released`) use **Windows-1252**, not strict 7-bit ASCII.  
- Players and extractors should normalize to UTF-8 for modern use.  
- Null bytes (`0x00`) mark string termination when shorter than 32 bytes; unused trailing bytes may contain padding.

---

## 5. RSID-Specific Constraints

| Field | Constraint |
|--------|-------------|
| `magicID` | Must equal `"RSID"`. |
| `version` | 2, 3, or 4 only. |
| `loadAddress` | Must be 0; actual load address derived from first two bytes of data. |
| `initAddress` | Must not be in ROM ($A000–$BFFF, $D000–$FFFF) or below $07E8. |
| `playAddress` | Must be 0. |
| `speed` | Must be 0. |
| `flags.bit1` | Interpreted as C64 BASIC flag; if set → `initAddress = 0`. |
| **Environment** | RSID assumes full C64 power-on state before load. |

---

## 6. Core Metadata Fields for Extraction

| Field | Offset | Length | Type | Example | Notes |
|--------|--------|--------|------|----------|-------|
| **Title** | `+16` | 32 B | STRING | `“Delta (Theme)”` | Song title. |
| **Author** | `+36` | 32 B | STRING | `“Rob Hubbard”` | Musician / composer. |
| **Released** | `+56` | 32 B | STRING | `“1987 Thalamus”` | Publisher / copyright. |
| **Version** | `+04` | 2 B | WORD | `0x0002` | Determines header variant. |
| **Type** | `+00` | 4 B | STRING | `"PSID"` / `"RSID"` | File format identifier. |
| **Songs** | `+0E` | 2 B | WORD | `3` | Number of subsongs. |
| **Start Song** | `+10` | 2 B | WORD | `1` | Default starting song. |
| **Clock** | `flags bits 2–3` | — | ENUM | PAL / NTSC / Both / Unknown | Playback standard. |
| **SID Model(s)** | `flags bits 4–9` | — | ENUM | 6581 / 8580 / Both | Primary, secondary, tertiary models. |
| **Second SID Address** | `+7A` | 1 B | BYTE | `$D420` | Optional stereo SID. |
| **Third SID Address** | `+7B` | 1 B | BYTE | `$D500` | Optional third SID. |

---

## 7. Parser Implementation Guidelines

1. **Read** first `0x7C` bytes (124 B) of the file.  
2. **Validate**:
   - `magicID` = `PSID` or `RSID`.  
   - `version` ∈ {1, 2, 3, 4}.  
   - `dataOffset` ≥ `0x0076`.  
3. **Extract** textual fields (convert Windows-1252 → UTF-8).  
4. **Interpret** numeric values as big-endian.  
5. **Decode flags** (if version ≥ 2) to obtain:
   - clock (PAL/NTSC)  
   - SID model(s)  
   - psidSpecific / BASIC flag  
6. **Apply RSID rules** if `magicID = RSID`.  
7. **Return structured object** with metadata fields below.

---

## 8. Example Metadata Object (JSON)

```json
{
  "type": "PSID",
  "version": 2,
  "title": "Sanxion (Loader)",
  "author": "Rob Hubbard",
  "released": "1986 Thalamus",
  "songs": 2,
  "startSong": 1,
  "clock": "PAL",
  "sidModels": ["MOS6581"],
  "secondSID": null,
  "thirdSID": null
}
```

---

## 9. Validation Summary

- Strings: must not exceed 32 bytes; null-terminated if shorter.
- Reserved bits (10–15) in flags must always be 0.
- Addresses must respect RSID restrictions (≥ $07E8, outside ROM range).
- Endian conversion required for all multi-byte fields.
- Version 1 files lack flags and multi-SID info.
- DataOffset dictates where binary program data begins.
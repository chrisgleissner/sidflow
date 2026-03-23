# SID File Worked Example: Ta-Boo by Ninja

## 1. Overview

- **File path:** `test-data/C64Music/MUSICIANS/N/Ninja/Ta-Boo.sid`
- **File type:** PSID, version 2
- **Total file size:** 185 bytes
- **Number of songs:** 1
- **Default song:** 1
- **Load address:** $0887 (embedded in data payload; header `loadAddress` = $0000)
- **Init address:** $08A0
- **Play address:** $08AD
- **Speed:** VBlank (PAL raster, 50 Hz)
- **SID model:** 8580 (from flags)
- **Video standard:** PAL (from flags)
- **Author:** Wolfram Sang (Ninja)
- **Copyright:** 2024 The Dreams

**Memory layout summary:**

| Region | C64 Address Range | Size | Role |
|---|---|---|---|
| SID init table | $0887–$089F | 25 bytes | Initial SID register values ($D400–$D418) |
| Init routine | $08A0–$08AC | 13 bytes | Bulk-copy init; falls through to play |
| Play routine | $08AD–$08C1 | 21 bytes | Per-frame SID register update |
| Zero page mirror | $0087–$00C1 | 59 bytes | Written by init; acts as pointer/counter table |

---

## 2. Header — Byte-Accurate Table

All multi-byte fields are big-endian unless noted. File byte offsets are hexadecimal.

| Offset | Size | Raw Bytes | Value | Meaning |
|---|---|---|---|---|
| $00 | 4 | `50 53 49 44` | `PSID` | Magic identifier — PSID format |
| $04 | 2 | `00 02` | 2 | Version — v2 (extended header present) |
| $06 | 2 | `00 7C` | 124 | `dataOffset` — payload starts at file byte 124 |
| $08 | 2 | `00 00` | 0 | `loadAddress` — 0 means first two payload bytes carry the load address |
| $0A | 2 | `08 A0` | $08A0 | `initAddress` — call once with song number (0-based) in A |
| $0C | 2 | `08 AD` | $08AD | `playAddress` — call every frame |
| $0E | 2 | `00 01` | 1 | `songs` — 1 sub-song |
| $10 | 2 | `00 01` | 1 | `startSong` — default song index (1-based) |
| $12 | 4 | `00 00 00 00` | 0 | `speed` — bit 0 = 0: song 1 uses VBlank timing (50 Hz PAL) |
| $16 | 32 | `54 61 2D 42 6F 6F 21 00…` | `Ta-Boo!` | Title string — NUL-padded ASCII, 32 bytes |
| $36 | 32 | `57 6F 6C 66 72 61 6D 20…` | `Wolfram Sang (Ninja)` | Author string — NUL-padded ASCII, 32 bytes |
| $56 | 32 | `32 30 32 34 20 54 68 65…` | `2024 The Dreams` | Copyright string — NUL-padded ASCII, 32 bytes |
| $76 | 2 | `00 24` | $0024 | `flags` (v2 extended) — see below |
| $78 | 1 | `00` | 0 | `startPage` — 0: no reserved free page needed |
| $79 | 1 | `00` | 0 | `pageLength` — 0 pages reserved |
| $7A | 1 | `00` | 0 | `secondSIDAddress` — not used (single SID) |
| $7B | 1 | `00` | 0 | `thirdSIDAddress` — not used |
| $7C | 2 | `87 08` | $0887 | Embedded load address (little-endian) — payload loads at C64 $0887 |
| $7E–$B8 | 59 | … | — | 6502 machine code and SID init data |

**`flags` field ($0024) bit interpretation:**

| Bits | Value | Meaning |
|---|---|---|
| 1–0 | `00` | Built-in player; C64-compatible PSID |
| 3–2 | `01` | Video standard: PAL |
| 5–4 | `10` | Primary SID model: 8580 |
| 15–6 | `00` | Reserved |

---

## 3. Memory Map

**Payload load range:** $0887–$08C1 (59 bytes)

```
$0887–$089F  [25 bytes]  SID register initialization table
$08A0–$08AC  [13 bytes]  Init routine (LDX/LDA/STA loop + DEX/BMI)
$08AD–$08C1  [21 bytes]  Play routine (ends with RTS)
```

**Zero page usage ($0087–$00C1):**
Init writes a verbatim copy of the entire payload ($0887–$08C1) into ZP $87–$C1 using `STA $07,X`. This creates a pointer/counter table embedded in zero page. Effective pointer pairs used at runtime (little-endian, X=$05 offset applied):

| ZP Address | Bytes | Points to | Role |
|---|---|---|---|
| $87:$88 | $1B $D4 | $D41B | OSC3 read-back (source) |
| $8F:$90 | $03 $D4 | $D403 | Voice 1 Pulse Width HI (dest) |
| $91:$92 | $01 $D4 | $D401 | Voice 1 Frequency HI (dest) |
| $97:$98 | $0B $D4 | $D40B | Voice 2 Control (dest) |
| $9A:$9B | $16 $D4 | $D416 | Filter Cutoff HI (dest) |
| $9D | $05 | — | Counter seed (LAX source, constant $05) |
| $96 | $00 | — | Frame counter (incremented each play call by ISC) |

**SID register space touched:** $D400–$D418 (all 25 registers written by init); $D41B read each frame (OSC3).

---

## 4. Code Structure

### 4.1 Init Routine — $08A0

```
$08A0  A2 BA     LDX #$BA          ; X = 186 ($BA)
$08A2  BD 07 08  LDA $0807,X       ; A = mem[$0807+X] (reads $0887–$08C1 as X: $80→$BA)
$08A5  9D 80 D3  STA $D380,X       ; write to SID space ($D380+X: $D400–$D43A)
$08A8  95 07     STA $07,X         ; write to ZP ($07+X: $87–$C1)
$08AA  CA        DEX
$08AB  30 F5     BMI $08A2         ; loop while X >= $80 (bit 7 set); exits when X = $7F
                                   ; falls through to play at $08AD
```

**Loop mechanics:**
- Runs for X = $BA, $B9, …, $80 — 59 iterations.
- `$0807 + X` with X ∈ [$80..$BA] spans $0887–$08C1: the entire loaded payload.
- `$D380 + X` with X ∈ [$80..$BA] spans $D400–$D43A:
  - $D400–$D418: 25 valid SID registers receive the init table bytes ($0887–$089F).
  - $D419–$D43A: mirrors/read-back area; writes are ignored.
- Zero page $87–$C1 receives an identical copy.
- After the loop, execution falls through directly into the play routine at $08AD. No RTS separates init from play; the first play call is implicit.

### 4.2 Play Routine — $08AD

Uses unofficial 6502 opcodes: LAX ($A7), ISC ($E7), SAX ($83). All indirect-X pointer dereferences use the ZP pointer table populated by init, with X permanently = $05.

```
$08AD  A7 9D     LAX $9D           ; unofficial: A = X = ZP[$9D] = $05 (constant)
$08AF  E7 96     ISC $96           ; unofficial: ZP[$96]++; A = A − ZP[$96] − borrow(~C)
$08B1  0A        ASL A             ; C = old bit 7 of A; A <<= 1 (result discarded next)
$08B2  A9 03     LDA #$03          ; A = $03
$08B4  2A        ROL A             ; A = ($03 << 1) | C_from_ASL → $06 or $07
$08B5  83 8C     SAX ($8C,X)       ; unofficial: store A&X → [$D401] (V1 Freq HI)
$08B7  81 95     STA ($95,X)       ; store A → [$D416] (Filter Cutoff HI)
$08B9  49 26     EOR #$26          ; A = A ^ $26 → $20 or $21
$08BB  81 92     STA ($92,X)       ; store A → [$D40B] (V2 Control)
$08BD  A1 82     LDA ($82,X)       ; A = [$D41B] (OSC3 noise read-back)
$08BF  81 8A     STA ($8A,X)       ; store A → [$D403] (V1 PW HI)
$08C1  60        RTS
```

**Register state entering play:**
- A, X, C: set by LAX and ISC from ZP table. Not caller-defined.
- ZP$96: frame counter, increments once per call. Wraps at 256; period = 256 frames ≈ 5.12 s at 50 Hz.

---

## 5. SID Register Interaction

### 5.1 Initialization Values

Written by init loop. Each byte in the SID init table ($0887–$089F) maps directly to one SID register ($D400–$D418).

| Address | Init Byte | Decoded Value | Role |
|---|---|---|---|
| $D400 | $1B | — | Voice 1 Frequency LO |
| $D401 | $D4 | — | Voice 1 Frequency HI → FREQ = $D41B → ~3187 Hz PAL¹ |
| $D402 | $80 | — | Voice 1 Pulse Width LO |
| $D403 | $D3 | PW = $380 (~21.9 % duty) | Voice 1 Pulse Width HI (lower nibble: $3) |
| $D404 | $41 | PULSE=1, GATE=1 | Voice 1 Control — pulse wave, gate open (playing) |
| $D405 | $3C | A=3 (~24 ms), D=12 (~750 ms) | Voice 1 Attack/Decay |
| $D406 | $5F | S=5/15, R=15 (~24 s) | Voice 1 Sustain/Release |
| $D407 | $1C | — | Voice 2 Frequency LO |
| $D408 | $03 | — | Voice 2 Frequency HI → FREQ = $031C → ~46.7 Hz (~F♯1) PAL |
| $D409 | $D4 | — | Voice 2 Pulse Width LO |
| $D40A | $01 | PW = $1D4 (~11.4 % duty) | Voice 2 Pulse Width HI (lower nibble: $1) |
| $D40B | $D4 | NOISE\|PULSE\|TRI\|RING, GATE=0 | Voice 2 Control — complex init state; GATE off |
| $D40C | $3C | A=3, D=12 | Voice 2 Attack/Decay |
| $D40D | $3F | S=3/15, R=15 | Voice 2 Sustain/Release |
| $D40E | $07 | — | Voice 3 Frequency LO |
| $D40F | $00 | — | Voice 3 Frequency HI → FREQ = $0007 → ~0.41 Hz (sub-audio) |
| $D410 | $0B | — | Voice 3 Pulse Width LO |
| $D411 | $D4 | PW = $40B (~25.1 % duty) | Voice 3 Pulse Width HI (lower nibble: $4) |
| $D412 | $80 | NOISE=1, GATE=0 | Voice 3 Control — noise generator, gate off |
| $D413 | $16 | A=1 (~2 ms), D=6 (~94 ms) | Voice 3 Attack/Decay |
| $D414 | $D4 | S=13/15, R=4 (~6 ms) | Voice 3 Sustain/Release |
| $D415 | $40 | Bits 2:0 = 0 | Filter Cutoff LO (lower 3 bits; $40 bits 2:0 = 0) |
| $D416 | $05 | Cutoff 11-bit = $28 = 40 | Filter Cutoff HI → 11-bit cutoff: ($05 << 3)\|0 = 40/2047 (low cutoff) |
| $D417 | $F3 | Res=15 (max), V1+V2 routed | Filter Resonance/Routing |
| $D418 | $9F | LP, vol=15, V3 off mixer | Mode/Volume: LP mode, max volume, Voice 3 disconnected |

¹ $D401 = $D4 at init is immediately overwritten by the first play call (which runs as init falls through).

**Note on V1 Freq HI:** Init writes $D4, but the loop falls through to play before returning, so the effective post-init V1 Freq HI is $04 or $05 (see §5.2).

### 5.2 Per-Frame Register Writes (Play Routine)

X is permanently $05 on every play call (set by LAX $9D where ZP[$9D] = $05 is never modified).

| Address | Written Value | Source | Musical Role |
|---|---|---|---|
| $D401 | A & $05 ∈ {$04, $05} | Counter-derived; ROL result ANDed with X | Voice 1 Frequency HI — toggles between two pitches |
| $D416 | $06 or $07 | Same ROL result (before AND) | Filter Cutoff HI — slight per-frame sweep |
| $D40B | $20 or $21 | ROL result EOR $26 | Voice 2 Control — SAW waveform; GATE bit toggles (rhythmic trigger) |
| $D403 | OSC3 read | $D41B read-back | Voice 1 Pulse Width HI — randomized each frame |

**$D401 detail:** ROL produces $06 or $07; SAX stores (A & X) = ($06\|$07) & $05 ∈ {$04, $05}.
- $04 → V1 FREQ = $041B → ~62 Hz PAL (~B1)
- $05 → V1 FREQ = $051B → ~77 Hz PAL (~D♯2/E♭2)

**$D40B detail:** $20 = `0010_0000` = SAW, GATE=0; $21 = `0010_0001` = SAW, GATE=1. The gate bit causes V2 to retrigger its ADSR envelope when set.

**$D403 detail:** Voice 3 runs as a noise oscillator at FREQ=$0007 (~0.41 Hz), disconnected from the output mixer (bit 7 of $D418 = 1). Its LFSR output is read via $D41B (OSC3) and written to $D403, modulating V1 pulse width with slowly-changing pseudo-random values. The noise LFSR advances at a rate proportional to V3 frequency; at $0007 PAL the waveform state changes rarely, producing near-static random values.

---

## 6. Timing Model

**Frame rate:** 50 Hz (PAL VBlank). Encoded in `speed` field = $00000000; all bits zero indicate VBlank for all songs.

**VBlank source:** The external player (not this code) installs a VBlank IRQ handler and calls `playAddress` ($08AD) once per interrupt.

**Init call:** Called once, with A = 0 (song 0, the only song). No sub-song branching is present; A is not read by the init routine.

**Play call frequency:** 50 Hz. Period = 20 ms per frame.

**Pattern period:** ZP$96 is the only mutable state, incrementing once per frame. It wraps at 256, giving a period of 256 frames = 5.12 seconds.

**Interrupt type:** VBlank (not CIA1 timer). No interrupt handler is installed by the SID code itself; the player is expected to call `playAddress` from its own IRQ service routine.

---

## 7. Data Regions

### 7.1 SID Register Init Table — $0887–$089F

25 contiguous bytes. One byte per SID register, $D400 through $D418 in order. No compression or encoding; values are written directly to SID registers by the init loop.

| File Offset | C64 Address | Byte | SID Register |
|---|---|---|---|
| $7E | $0887 | $1B | $D400 V1 Freq LO |
| $7F | $0888 | $D4 | $D401 V1 Freq HI |
| $80 | $0889 | $80 | $D402 V1 PW LO |
| $81 | $088A | $D3 | $D403 V1 PW HI |
| $82 | $088B | $41 | $D404 V1 CTRL |
| $83 | $088C | $3C | $D405 V1 AD |
| $84 | $088D | $5F | $D406 V1 SR |
| $85 | $088E | $1C | $D407 V2 Freq LO |
| $86 | $088F | $03 | $D408 V2 Freq HI |
| $87 | $0890 | $D4 | $D409 V2 PW LO |
| $88 | $0891 | $01 | $D40A V2 PW HI |
| $89 | $0892 | $D4 | $D40B V2 CTRL |
| $8A | $0893 | $3C | $D40C V2 AD |
| $8B | $0894 | $3F | $D40D V2 SR |
| $8C | $0895 | $07 | $D40E V3 Freq LO |
| $8D | $0896 | $00 | $D40F V3 Freq HI |
| $8E | $0897 | $0B | $D410 V3 PW LO |
| $8F | $0898 | $D4 | $D411 V3 PW HI |
| $90 | $0899 | $80 | $D412 V3 CTRL |
| $91 | $089A | $16 | $D413 V3 AD |
| $92 | $089B | $D4 | $D414 V3 SR |
| $93 | $089C | $40 | $D415 Filter LO |
| $94 | $089D | $05 | $D416 Filter HI |
| $95 | $089E | $F3 | $D417 Res/Route |
| $96 | $089F | $9F | $D418 Mode/Vol |

### 7.2 Pointer Table (ZP, implicit)

The init loop copies the entire payload verbatim to ZP $87–$C1. The lower 25 bytes (ZP $87–$9F) encode data that doubles as indirect-X pointer targets for the play routine. The pointer pairs, resolved by adding X=$05 to the base ZP offset in each `($nn,X)` instruction, are:

| Play instruction base | + X offset | ZP pair | Target address |
|---|---|---|---|
| `($82,X)` | $82+$05=$87 | ZP$87:$88 = {$1B,$D4} | $D41B OSC3 |
| `($8A,X)` | $8A+$05=$8F | ZP$8F:$90 = {$03,$D4} | $D403 V1 PW HI |
| `($8C,X)` | $8C+$05=$91 | ZP$91:$92 = {$01,$D4} | $D401 V1 Freq HI |
| `($92,X)` | $92+$05=$97 | ZP$97:$98 = {$0B,$D4} | $D40B V2 CTRL |
| `($95,X)` | $95+$05=$9A | ZP$9A:$9B = {$16,$D4} | $D416 Filter Cutoff HI |

The high bytes of all five pointer pairs are $D4, the SID page. The low bytes are the specific register offsets. These are not an explicit encoded table; they arise from the data values in the SID init table coinciding with valid low bytes of SID register addresses ($00, $01, $03, $0B, $16) paired with the SID page $D4.

---

## 8. Notable Patterns

### 8.1 Dual-Use Payload: Code as Data

The init loop reads the entire 59-byte payload (data table + code itself) and writes it to:
- SID $D400–$D43A: bytes $0887–$089F initialize valid SID registers; bytes $08A0–$08C1 land in unimplemented/mirror space ($D419–$D43A) and are ignored by the hardware.
- ZP $87–$C1: verbatim copy serves as the pointer/counter table for the play routine.

A single loop initializes SID, builds the ZP pointer table, and populates the frame counter — using no separate data structure.

### 8.2 Pitch Toggling (Arpeggio-Like)

V1 Frequency HI alternates between $04 and $05 each frame based on bit 0 of the carry-derived ROL result. The corresponding frequencies (~62 Hz and ~77 Hz, approximately B1 and D♯2) form a minor-third interval repeated at 50 Hz. This is not a sub-frame arpeggio; the pitch is held for exactly one frame then toggled.

### 8.3 Pseudo-Random Pulse Width Modulation (V1)

V3 operates as a sub-audio noise source (FREQ=$0007, ~0.41 Hz). Its LFSR state is read via $D41B (OSC3) each frame and stored to $D403 (V1 Pulse Width HI, lower nibble). This randomizes the 12-bit pulse width of V1 — specifically the upper nibble of the pulse width — producing a slowly-drifting timbre change on the pulse wave.

Because V3 frequency is near-static at audio timescales, the noise value changes at approximately the LFSR cycle rate divided by the oscillator period, which is very slow (many seconds between perceptible state changes). The effect is a subtle long-period PWM drift rather than rapid randomness.

### 8.4 Rhythmic Voice 2 Gating

V2 CTRL ($D40B) is written each frame with either $20 (SAW, GATE=0) or $21 (SAW, GATE=1). The GATE bit is derived from the low bit of the ROL result, which is itself determined by the carry out of ASL applied to the ISC result. This produces an irregular rhythmic pattern governed by the wrapping arithmetic of ZP$96. V2 ADSR triggers when GATE transitions low→high.

### 8.5 Filter Configuration

LP filter, resonance=15 (maximum), cutoff 11-bit ≈ 40–48, V1+V2 routed through filter. The high resonance and low cutoff heavily color the output. The play routine increments Filter Cutoff HI ($D416) between $06 and $07, a minimal sweep that has small but nonzero effect on sound character.

### 8.6 Voice 3 Disconnected

Bit 7 of $D418 = 1 disconnects V3 from the output mixer. V3 is used solely as a noise source for PWM randomization; it produces no audible output.

### 8.7 Unofficial Opcodes

The play routine uses three unofficial 6502/6510 opcodes for compactness:

| Opcode | Mnemonic | Effect |
|---|---|---|
| $A7 | LAX zp | Load A and X simultaneously from zero page |
| $E7 | ISC zp | Increment zero page byte; subtract from A with borrow |
| $83 | SAX (izx) | Store A AND X to indirect address |

---

## 9. Minimal Execution Model

### 9.1 Load

1. Read header: verify magic `PSID`, extract `dataOffset`=$007C, `loadAddress`=$0000, `initAddress`=$08A0, `playAddress`=$08AD.
2. Seek to file offset $7C.
3. Read 2 bytes: $87 $08 → load address = $0887 (little-endian).
4. Read remaining 59 bytes into C64 RAM at $0887.

### 9.2 Init Call

Caller: `JSR $08A0` with A = 0 (song 0), X and C undefined.

Execution:
1. X ← $BA.
2. Loop 59 times (X = $BA → $80):
   a. Load byte from $0807+X (= $0887–$08C1).
   b. Write byte to $D380+X (= $D400–$D43A; SID registers $D400–$D418 receive init table values).
   c. Write byte to ZP $07+X (= ZP$87–$C1; zero page mirror populated).
   d. DEX; if X still ≥ $80 (bit 7 set) repeat.
3. X = $7F; BMI not taken; fall through to play routine at $08AD.
4. Play routine executes once (ZP$96 advances from $00 to $01; SID registers $D401, $D403, $D40B, $D416 receive first-frame values).
5. RTS returns to caller.

**Post-init SID state:**
- V1: pulse wave, GATE=1, FREQ ≈ $041B–$051B, AD=$3C, SR=$5F, PW randomized.
- V2: saw wave, GATE=$20 or $21 (see §8.4), FREQ=$031C, AD=$3C, SR=$3F.
- V3: noise, GATE=0, FREQ=$0007, AD=$16, SR=$D4, disconnected from output.
- Filter: LP, resonance=15, cutoff≈40–48/2047, V1+V2 routed.
- Volume: 15.

### 9.3 Repeated Play Calls

Caller invokes `JSR $08AD` at 50 Hz (PAL VBlank).

Each call:
1. A ← X ← ZP[$9D] = $05 (constant).
2. ZP[$96] incremented; A ← $05 − ZP[$96] − borrow.
3. Carry from ASL A feeds ROL of $03 → A = $06 or $07.
4. Write A&$05 (= $04 or $05) to $D401 (V1 Freq HI).
5. Write A (= $06 or $07) to $D416 (Filter Cutoff HI).
6. Write A^$26 (= $20 or $21) to $D40B (V2 CTRL).
7. Read $D41B (OSC3); write to $D403 (V1 PW HI).
8. RTS.

**Mutable state:** Only ZP$96 changes across frames. All other ZP values are constant. The full sound pattern repeats every 256 frames (5.12 s at 50 Hz).

### 9.4 Stop / Silence

No explicit stop routine. To silence:
- Write $00 to $D404 (clear V1 GATE and waveform).
- Write $00 to $D40B (clear V2 GATE and waveform).
- Write $00 to $D418 (zero volume).

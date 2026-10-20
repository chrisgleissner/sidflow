# SIDLite native buffer overflow encountered during the ROM audit

Observed with the exact complete source distributed in `libsidplayfp-wasm` 1.0.1,
libsidplayfp 3.0.2, and independently with package 1.1.0 / libsidplayfp 3.1.1.
Primary tracker: [libsidplayfp-wasm #14](https://github.com/chrisgleissner/libsidplayfp-wasm/issues/14).
Consumer containment: [Commander #538](https://github.com/chrisgleissner/c64commander/issues/538).

## Reproduction input

- HVSC 85: `MUSICIANS/A/Andy/Justincase_part_6.sid`, subtune 1.
- Title: Justincase (part 6).
- Header composer: Adám Dávidovics & Balázs Farkas.
- Release string: `1991 Graffity`.
- Complete-file MD5: `9aa41c08faa2c16ce75fb9f2c65233fd`.
- SHA-256: `c71f6df2c987f591dc82f61d8e69180c05229c7cce4bdc04c1c6474eecd5d68c`.
- SIDLite, 8 kHz stereo, power-on delay 5,000, supplied KERNAL/BASIC/CHARGEN.
- Calling `play(20000)` overflows the SIDLite sample allocation and can crash
  during destruction of the player. A fresh process reproduces it.

## AddressSanitizer evidence

The allocation is `ceil(freq / 1000 * 20)` samples in
`src/builders/sidlite-builder/sidlite-emu.cpp:127`: 160 `short`s / 320 bytes at
8 kHz. The first invalid write is exactly after that allocation.

```text
ERROR: AddressSanitizer: heap-buffer-overflow
WRITE of size 2
SIDLite::SID::clock(unsigned int, short*)                 SID.cpp:45
libsidplayfp::SIDLiteEmu::clock()                         sidlite-emu.cpp:84
libsidplayfp::SIDLiteEmu::write(unsigned char, unsigned char)
libsidplayfp::sidemu::writeReg(unsigned char, unsigned char)
libsidplayfp::MOS6510::sta_instr()
libsidplayfp::EventScheduler::clock()
libsidplayfp::Player::play(unsigned int)                  player.cpp:258
0 bytes after 320-byte region
```

`play()` counts event-scheduler steps. They are not a strict elapsed PHI1 cycle
limit when CPU events become sparse due to video DMA. Even a literal 20,000
PAL-cycle window would exceed 20 ms. The method's internal 20,000-step cap does
not make the 20 ms allocation safe.

## Audit containment and regression

The audit now uses 256-event pulls and retains PCM in memory. No production SID
engine source is changed by that choice. Native and locked WASM outputs are
cross-checked using the same pulls. The real input passes under ASAN; restoring
20,000-event pulls makes the required real-input regression fail with the heap
overflow. The simple synthetic PAL, NTSC and busy-loop inputs alone pass even
with the unsafe pull and are therefore insufficient regression coverage.

```sh
ROM_AUDIT_SANITIZE=1 bash scripts/rom-audit/build-native.sh
bun scripts/rom-audit/native-regression.ts \
  workspace/rom-audit-native-asan/render /path/roms /path/C64Music
```

The complete sanitizer trace and the deliberately failing test log are retained
under `workspace/rom-audit-validation/`. All preliminary measurements taken with
the unsafe pull were discarded; they do not contribute to the ROM statistics.

## Shipped WASM and consumer relevance

`check-large-pulls.ts` isolates each engine/rate/pull in a fresh process. In both
installed package versions (1.0.1 and 1.1.0), SIDLite returns the requested number
of samples with different PCM for 256 versus default 100,000-event pulls at both
8 and 48 kHz. reSIDfp is bit-identical across pulls on these controls. This is
observable pull-dependent output from shipped WASM, not an ASAN trace of WASM
or a demonstrated phone crash.

For 1.1.0 at 48 kHz, the two-second stereo PCM SHA-256s are:

- 256: `a57a59cb27ed49aae1ac77332efa2e9dba73803a2e8738c79f1283b833085bb8`
- Default: `163a4e465c6250380bb22a184c44380c88087fca2b9985e39c0a529e8d471381`

The application source at Commander `c99f2dd2adf2f95efb823d9ffee5cc73e5047277`
uses `renderSeconds(seconds)` in live rendering, `offline.renderSeconds(want)`
in prerendering and default `seekSeconds(positionSeconds)` in seeking. All inherit
the unsafe default. The separate libSidplayEZ native renderer has not been
implicated. No application patch is included in this research branch; the linked
consumer issue tracks coordinated containment and the eventual corrected dependency.

The standalone [overflow reproducer](../../scripts/rom-audit/overflow-repro.cpp)
also reproduces under ASAN with the SID-write observer disabled: 1.1.0 source,
48 kHz stereo, two seconds, 20,000-event pull, first invalid write immediately
following the 1,920-byte allocation. The same standalone program completes with
256. Its nullable trace symbol resolves the distribution's trace patch; the
extra BASIC-counter symbol only permits linking the audit-instrumented build.
The counter is passive, and no SID trace callback runs in this reproducer.
Earlier `minimal-unsafe-48k.log` / `minimal-safe-48k.log` contain invalid invocations
(missing executable), so they are **not evidence**. Actual successful controls and
ASAN reproduction are `minimal-safe-resumed.log` / `minimal-unsafe-resumed.log`.

The original GDB trace crashed in `free()` during `sidplayfp` destruction, which
located the symptom but not the bad write. ASAN identified the earlier SIDLite
buffer write. Restoring the old pull in the required real-input regression fails
again; synthetic fixtures alone pass. Neither allocator survival nor synthetic
coverage substitutes for the real failing input. The 256-event workaround passes
these controls and the complete corpus sweep, but is not a proof of a universal
maximum-safe scheduler-event count.

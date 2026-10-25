# Listener-relevant ROM audit (methodology 4)

This is the historical SIDLite-only methodology-4 workflow. Use the
[dual-engine census](hvsc-rom-dual-run.md) for the current 14600K run and Commander bundle.

The audit compares each HVSC subtune with a full-ROM render on the pinned
`libsidplayfp-wasm` 1.1.1 SIDLite engine. Its question is whether missing ROMs
change playback for an ordinary listener. It does not judge the artistic or
historical fidelity of the reference engine itself.

The previous methodology required identical PCM and cycle-timed writes. That
made almost every ROM-free tune `unknown` because the engine's interrupt shim
moves writes by a few cycles. Those results are superseded, not reinterpreted.
Methodology 4 uses new checkpoint and engine-profile identities and a fresh run.

## Decisions

- `compatible`: playback remains listener-equivalent throughout the documented
  duration plus five seconds.
- `incompatible`: a material audio difference was measured, including music lost when the decoder stops. The record identifies the first affected window.
- `unknown`: a measurement is absent, failed, corrupt, has no documented duration,
  or does not cover the requested engine/configuration/time. It is a last resort
  for inadequate evidence, never the result of a tiny timing difference.

Decisions apply individually to subtunes and ROM configurations. Nothing is
inferred from the PSID/RSID flag or a short introduction. Every reference runs
through its complete horizon, including long tunes and late dependencies.

## Listener comparison

There are three players: full-ROM reference, KERNAL+BASIC with CHARGEN zeroed,
and no supplied ROMs with BASIC/CHARGEN zeroed and the engine's KERNAL shim.
A deterministic sample also repeats the reference. SIDLite players use separate
C64 states in a shared WASM module; regression controls compare this with fresh
instances. reSIDfp retains independent instances in the research helpers.

The fast path compares continuous SID register streams, independently of render
chunk boundaries. Every chip, address and value must match, with a constant
startup offset of at most 20,000 PHI1 cycles and subsequent drift of at most
2,000 cycles (about 20 ms and 2 ms respectively). Such small timing differences
are accepted. This path avoids expensive spectral work for unchanged music.

Dense digi/sample write streams also use the audio path: millisecond timing
tolerance can affect their sound. A changed/missing write or larger timing change
activates an audio comparison,
including the preceding 256 ms. It compares each stereo channel independently
in 21.3 ms windows: DC removal, 2:1 downsampling, Hann window, FFT magnitudes.
Phase changes alone do not imply changed music. A window differs when normalized
spectral distance exceeds 15% and its absolute level exceeds -60 dBFS.
Approximately third-octave bands are also compared independently (30% local
spectral distance, with differences above both -60 dBFS and 3% of the overall
level), so a loud bass cannot hide a missing quieter melody. Two
consecutive differing windows, or three overall, establish an audible difference.
A single strongly different window also counts when distance exceeds 80% and
absolute difference exceeds 0.03 full scale, so a brief loud sound effect is not
missed. A short changed passage cannot be diluted by the rest of a long song. Silent
register changes remain compatible. Differences below these thresholds are
accepted; these are tested engineering thresholds, not a calibrated model of
human hearing or a substitute for a listening study.

The worker bounds retained PCM to the comparison window; it streams complete
PCM and timed-write hashes into 64 KiB hash buffers. It never retains an entire
song. Once a variant has a confirmed audible difference, its emulation stops;
the reference and other variants continue. If a decoder stops, its subsequent
audio is modelled as silence and compared with the continuing reference. An
inaudible stop remains compatible; a missing held note is incompatible. The
record preserves `stoppedAtSample`, and its hashes include the modelled silence.
Final FFT padding preserves channel means so DC cannot invent a click. The reference repeat must match
exactly when sampled.

## Scope and consumer contract

The profile is WASM 1.1.1 SIDLite, 48 kHz stereo, engine-default power-on delay
8191, start-song header rewrite, and the default 100,000-event API request
(internally clamped to 20,000). The [1.1.1 capacity fix](https://github.com/chrisgleissner/libsidplayfp-wasm/releases/tag/v1.1.1)
permits these pulls; the unsafe 1.1.0 build is no longer the audit target.
[Commander commit 2d14559](https://github.com/chrisgleissner/c64commander/tree/2d145590d86f4053dc78c6936d3dce181169fd39)
pins 1.1.1 and removed its 256-event containment. The exact engine hashes remain recorded.

**Absent BASIC and CHARGEN banks must be zeroed before each new player.** This
makes the tested state reproducible and avoids arbitrary stale heap contents.
An existing consumer that leaves those banks uninitialised must implement this
initialisation before using this catalogue. The profile identity encodes it.
This contract does not silently claim coverage of Commander's current cached,
uninitialised players, reSIDfp, SidplayEZ, another engine build, or another SID
fallback model. If a header does not specify every chip model, the measured
fallback is MOS8580; a MOS6581 consumer needs its own measurement.

`createRomEligibilityLookup` takes the file SHA-256, one-based subtune, actual
ROM image hashes, profile, engine hashes and elapsed emulated time. Supported
ROM masks are 0 and 3 (KERNAL=1, BASIC=2, CHARGEN=4). Other ROM sets are outside
this audit. Missing entries deny; every compatible decision expires at its
measured horizon. Loops require a fresh restart. The header/model and identity
checks remain enforced.

## Pipeline and rollout

```sh
bun scripts/rom-audit/select-pilot.ts workspace/hvsc/C64Music workspace/rom-audit-v4-selection.json
bun scripts/rom-audit/audit.ts --hvsc workspace/hvsc/C64Music --roms workspace/roms \
  --out workspace/rom-audit-v4 --workers 7 --rollout pilot \
  --selection workspace/rom-audit-v4-selection.json --extended-every 5
bun scripts/rom-audit/publish.ts --production workspace/rom-audit-v4 doc/research/hvsc-rom-catalogue/v4
```

The durable content-keyed ledger limits unqualified work to 5% of both subtunes
and files across runs and benchmarks. Reservations precede dispatch; kernel
locks serialize parents. Checkpoints reject incompatible manifests and preserve
truncated tails. A failed worker affects its job and is restarted. A full run
requires a certificate binding the reviewed sources, pilot, reproducibility,
decision regression and three clean full test suites. The pilot must cover the complete canonical selection, with no failed jobs and
no unresolved measured decisions for the supported masks. Qualification clears
the regression debug filter and verifies repeat sampling against the manifest.

Publication emits every HVSC subtune, including pending work, research evidence,
raw census, deny list and checksums. The maintained snapshot is
`doc/research/hvsc-rom-catalogue/v4/`; its manifest gives actual coverage.
Historical v2/v3 measurements do not grant methodology-4 eligibility.

## Validation and performance

`rom-listener.test.ts` exercises timing/phase/DC tolerance, silence, missing
music, pitch/volume changes, missing stereo channels, high-frequency changes,
late short passages, streaming boundaries, invalid evidence and weighted timing
projections. `listener-regression.ts` runs synthetic and real SID controls through
the engine, assessment, deny tuple and production lookup. It participates in the
hardening decision digest alongside the earlier exact-engine regressions.

The target is all 87,868 HVSC 85 subtunes in less than 16 hours on a 14600K.
The benchmark measures the actual classifier on the executing machine, samples
all duration/format strata from the complete release-verified corpus, and weights
mean job times by their actual populations. It adds a 15% margin and checks a
15-hour census budget. This is an estimate, not proof of full-run duration;
setup, qualification and publication take additional time. The 6700K result is
not extrapolated into a promise about a 14600K. See
[run instructions](hvsc-rom-full-run.md) and the benchmark JSON for measurements.

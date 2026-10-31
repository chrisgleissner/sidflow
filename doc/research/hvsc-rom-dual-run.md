# Dual-engine HVSC85 ROM classification

This workflow prepares a complete census on the faster machine. Development on
the 6700K uses bounded, previously counted inputs; it does not classify all HVSC.
The launcher qualifies its exact sources and binaries before a full run. Do not
treat partial output as a completed catalogue or its budget gate as a measured
14600K runtime.

From this checkout on the 14600K:

```sh
bash scripts/rom-audit/run-dual.sh
```

The launcher installs locked dependencies, fetches and verifies the pinned HVSC85 archive and ROM inputs,
builds both native screens from the pinned 1.1.1 source archive, qualifies them,
benchmarks the actual target machine, runs the census and writes the Commander
bundle. Linux prerequisites: Bun, Node/npm, git, g++, make, autoconf/automake,
libtool, Python 3, GNU coreutils (`timeout`, `nproc`), pkg-config and xa65 (`xa`). Allow at least 16 GB RAM; 32 GB provides
headroom for dense multi-SID audio fallbacks. No Docker is used.

`ROM_AUDIT_WORKERS=N` selects processes (default logical CPUs minus one).
`ROM_AUDIT_MAX_HOURS` defaults to a hard 12-hour command budget; it can be raised
to 24 hours, but larger values are rejected. `ROM_AUDIT_OUT=workspace/rom-audit-dual` selects the checkpoint directory.
`ROM_AUDIT_BENCHMARK_JOBS` selects the target-machine benchmark size (default 320,
minimum 80); the default sample uses less than 1.5% of HVSC85.
`ROM_AUDIT_STAGE_ONLY=setup|qualify|bench|full` runs one stage. Repeating the command
resumes compatible checkpoints; renderer/decision, engine, native-binary or corpus changes
require a new output directory. Qualification is reused only when source/binary
identities and all recorded validation logs still match. Publication/qualification
changes invalidate qualification but preserve the separately bound measurements.

The benchmark covers 320 hash-selected subtunes across every format/duration
stratum of the complete inventory. It includes both engines, digital screens,
native audio fallbacks, sampled reference repeats, hashing and checkpoint writes.
Population weights convert measured process CPU costs to total census CPU work.
Dividing by aggregate CPU capacity actually delivered during the complete sample
accounts for host contention. The original wall-weighted projection is retained
for inspection; it would double-charge ordinary jobs for the deliberately
oversampled multi-process BASIC/multi-SID neighbours. Native process counters and
coordinator CPU time are recorded. A **25% margin** is applied.
Setup, qualification and benchmark time are subtracted from
the command budget before full execution. A larger projection refuses the full
run. Scheduling and in-flight workers stop at the remaining census deadline;
interrupted work stays pending/failed and is resumable. Failed and unknown
measurements are retried on resume. A projection is evidence
for the machine/load measured, not a guarantee of completion on another CPU.

## Why both engines

[Source analysis and counterexamples](hvsc-rom-engine-dependency.md) show that SID
readback can make ROM dependency differ in either direction. No complete-HVSC
superset or less-than-10% size difference has been established. Both SIDLite and
reSIDfp therefore run independently; a result is never transferred between them.
The historical `run-full.sh` / methodology-4 `audit.ts` remain SIDLite-only. The
new command above uses `screen-census.ts`, not that restricted legacy launcher.

## Correctness scope and optimization

Each engine is compared with its own authentic KERNAL+BASIC+CHARGEN reference.
Mask 0 means the engine's absent-KERNAL shim and zeroed BASIC/CHARGEN; mask 3
means authentic KERNAL+BASIC and zeroed CHARGEN. Thus a CHARGEN dependency can be
found even though Commander currently supplies only KERNAL/BASIC. Individual
KERNAL-versus-BASIC attribution and other ROM combinations are not implied.
Every subtune uses the full Songlengths.md5 duration plus five seconds, with a
minimum ten-second horizon. Infinite loops and real-C64 fidelity are outside this
finite comparison. The SID model follows the header, with MOS8580 fallback.

The fast screen runs the real C64 CPU/MMU and each engine's own SID readback.
The initial bus-only screen retains each engine's actual bus read behavior and
reSIDfp bus decay. It aborts before returning any OSC3/ENV3 read. That immutable
input/configuration first reruns with real digital emulation through 1,024,000
PHI1 cycles, then switches to bus-only clocking. This covers initialization-only
random seeds without assuming that later reads will be absent: a subsequent
OSC3/ENV3 read aborts and forces a complete detailed rerun. It never supplies a
made-up oscillator/envelope value. SIDLite's other register reads are constant
zero in this engine release; reSIDfp's actual bus/POT read methods are retained.
Detailed SIDLite uses normal synthesis. Detailed reSIDfp uses upstream
`clockSilent()`, whose contract preserves OSC3/ENV3 and bus behavior while
omitting audio production.
This is not a dummy SID and does not replace SID readbacks with constants.
Screens run 100 ms beyond the requested horizon to cover output latency and
rounding. Only complete, exactly cycle-timed register streams accepted by the listener-v1
fast path can grant compatibility. The audio-free screen does not use the audio
comparator's timing tolerance: even a few cycles of displacement can move a final
write across the finite PCM cutoff. Dense digi streams, different tails, changed
writes, any timing difference, errors and truncation require native audio.
A screen difference never proves an audible dependency. Audio fallback renders only
unresolved configurations; sampled cross-checks still render both. No synthetic
PCM hashes or pretend comparison windows are created for screened configurations.

An unread CHARGEN bank in a successful full-reference run cannot change that
same deterministic execution when replaced, so its mask-3 comparison may be
omitted. This implication is per engine and horizon. Screen/audio controls bind
the source and both native binaries; sampled audio runs also check screening
results and repeat independent full-ROM references.

Audio fallbacks use a fresh native process per lane, 48 kHz stereo, power-on
delay 8191, explicit zeroed absent banks and safe 256-event engine pulls.
Lossless PCM/timed-trace transport coalesces those pulls into approximately 85 ms
blocks; the existing TypeScript listener comparator receives every sample/event.
The pinned archive's inline filter-table initialization is selected for native
reSIDfp as it is for WASM, eliminating scheduling-dependent dither. The emulator's
filter math and noise generation are retained. Qualification checks native PCM
against fresh WASM in separate cold Node processes under the upstream engine
project's parity limits (SIDLite
exact; reSIDfp correlation >=0.9999, error RMS <=-60dBFS and tighter quiet-signal
bounds), plus exact absolute SID-write traces and exact native reference repeats.
Native and WASM identities and this backend's separate engine IDs are explicit.
Resource/engine errors remain failed measurements; only a diagnosed emulated
CPU halt may contribute silence after its last actual sample. This rule applies
to references, reference repeats and variants alike. The reference records its
`stoppedAtSample` and diagnostic; PCM hashes include the explicit silence tail,
and independently repeated references must agree on the stop position. An early
clean EOF, dropped trace or truncated terminal packet cannot authorize padding.
The full-horizon ending controls compare the halted native PCM, absolute writes
and stop positions with cold official WASM for all three consumer/reference masks.
The fallbacks retain the established listener-v1 comparator and its
[engineering thresholds](hvsc-rom-production.md#listener-comparison). This has a
separate methodology/profile identity from the older 100,000-event v4 results.
It measures bounded listener equivalence on the qualified native backend, not
universal human audibility or a per-input WASM render. Native parity controls are
finite qualification evidence; the manifest does not relabel native PCM as WASM
measurements.

Native builds use `-O3 -march=native -flto -ffp-contract=off`. The build cache
includes the compiler's resolved target features, so moving a workspace to a
different CPU rebuilds it. Floating-point contraction remains disabled; the
same PCM/trace controls qualify the resulting binaries on the executing host.

## Commander bundle

Output: `workspace/rom-audit-dual/published/`.

- `manifest.json`: engine IDs, ROM-set ID, native/source/WASM identities, corpus
  and document hashes, measured/pending/failed/unknown counts, checksums and
  explicit `complete` and `releaseReady`. Completeness requires every subtune,
  both engines and both consumer configurations to have a measured decision.
  `releaseReady` additionally requires the full-run qualification and benchmark
  evidence, copied into checksummed `qualification.json` and `benchmark.json`.
- `commander-exceptions.json`: complete-file MD5 -> one-based subtune -> bit mask.
  Bits 1/2 mean SIDLite differs without ROMs/with KERNAL+BASIC; bits 4/8 mean
  reSIDfp differs in those configurations. Only measured incompatibilities appear.
- `commander-exceptions.bin`: the same exceptions in a small packed format below.
- `unknown.json`: complete-file MD5 -> subtunes with any pending/failed/unresolved
  decision. These are never encoded as incompatible. They may later become
  compatible or incompatible after measurement.
- `sha256-to-md5.json`: identities for every file, including pending ones.
- `playback-horizons.json`: MD5 -> per-subtune measured-profile horizon and SID
  model scope. Consumers must match the profile/model and stop or restart at the
  horizon; an absent exception alone is not a proof of indefinite compatibility.

The binary starts with 12 bytes: ASCII `SIDR`, little-endian uint16 version 1,
uint16 record size 11, uint32 record count. Each record contains the first eight
raw MD5 bytes, a little-endian uint16 one-based subtune and one state byte using
the JSON bit meanings. Records sort by MD5 then subtune. Generation rejects
any collision between distinct MD5s sharing the first eight bytes. Pin the
accompanying manifest's IDs/checksum; the binary alone carries no provenance.

A mask-3 difference means KERNAL+BASIC are insufficient in that profile. It does
not prove the engine cannot play the tune with CHARGEN as well. No automatic
release/tag/upload is performed. The local bundle is ready for review and for
Commander's generator after a complete qualified census.

### Embeddable dependency list

For applications that embed the result (for example the C64 Commander APK), complete
ROM fidelity grades (one byte per subtune and engine/ROM lane; see
[hvsc-rom-fidelity-grading.md](hvsc-rom-fidelity-grading.md)) are condensed into the
allow-by-default **SID ROM Dependency List** (`sidromdep-1`; 19,228 bytes for HVSC #85, committed as `data/exports/hvsc85-sidromdep-1.bin`): full-MD5
keyed records of the subtunes with a lane graded at or below the listing ceiling (191 in the release), no inventory and no
horizon table. The generator refuses incomplete grading results, and the verifier
round-trips every graded subtune (every unlisted subtune must have all four lanes above the
listing ceiling). The format is specified in
[doc/rom-dependency-list.md](../rom-dependency-list.md).

## Verify and distribute

The full launcher finishes with:

```sh
bun scripts/rom-audit/verify-publication.ts workspace/rom-audit-dual/published
```

This refuses partial/unqualified publications, validates artifact hashes and
qualification bindings, and re-encodes the packed table from JSON to check every
record and aggregate count. Checksums establish consistency, not authenticity:
consumers must pin the manifest hash obtained from a trusted release. Source
qualification logs must be archived alongside the bundle for an evidence audit.
No complete bundle from this pass/fail audit was released: graded ROM fidelity
superseded it before a full census ran. The published HVSC #85 result is the
graded one; the [main README](../../README.md#where-results-are-published) lists
its sidflow-data release.

For Commander, an exception is a measured incompatibility only for its selected
engine, ROM configuration, model and horizon. Autoplay should skip those entries;
manual playback should warn. An unresolved/missing/mismatched/expired decision
is unknown and needs an unverified-playback warning, never a compatibility claim.
An unset bit grants compatibility only from a verified complete qualified bundle
and a valid inventoried file/subtune in the matching measured scope.

## October 2026 ending/screen correction

Methodology `rom-audit-digital-screen-2` supersedes version 1. The earlier
reference path incorrectly treated diagnosed end-of-tune CPU halts as failed
references, although the variant path already compared their silence tails.
`Mexico_86.sid` and `New_Scener.sid` exercise this asymmetry. A separate control,
`Its_Hip_to_be_Cool.sid`, exposed a timing-tolerant screen grant whose finite
audio trace ended at a different write boundary. Version 2 requires exact timed
writes to bypass audio and retains the screen/audio disagreement assertion.

Keep version-1 checkpoints as evidence, but do not reuse or relabel their
screened grants. Use a new `ROM_AUDIT_OUT`, rerun qualification and benchmark,
then measure the new census. Stricter screening can increase audio work; the
previous 12.12h/15.14h projection is not a version-2 runtime promise. The budget
gate still applies. A compatible-with-ROMs result and a no-ROM incompatibility
mean a measured difference against the full-ROM reference, not that the tune
cannot produce recognizable music without ROMs.

Run the real full-horizon regression independently with:

```sh
node scripts/run-bun.mjs scripts/rom-audit/ending-regression.ts
```

The normal qualification transport gate includes these controls automatically.

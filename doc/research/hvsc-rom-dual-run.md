# Dual-engine HVSC85 ROM classification

This workflow prepares a complete census on the faster machine. Development on
the 6700K uses bounded, previously counted inputs; it does not classify all HVSC.
The implementation is undergoing qualification. Do not treat its pending output
as a completed catalogue or its budget gate as a measured 14600K runtime.

From this checkout on the 14600K:

```sh
bash scripts/rom-audit/run-dual.sh
```

The launcher installs locked dependencies, fetches and verifies the pinned HVSC85 archive and ROM inputs,
builds both native screens from the pinned 1.1.1 source archive, qualifies them,
benchmarks the actual target machine, runs the census and writes the Commander
bundle. Linux prerequisites: Bun, Node/npm, git, g++, make, autoconf/automake,
libtool, pkg-config and xa65 (`xa`). Allow at least 16 GB RAM; 32 GB provides
headroom for dense multi-SID audio fallbacks. No Docker is used.

`ROM_AUDIT_WORKERS=N` selects processes (default logical CPUs minus one).
`ROM_AUDIT_MAX_HOURS=12` requests the preferred budget; the default maximum is
16 hours. `ROM_AUDIT_OUT=workspace/rom-audit-dual` selects the checkpoint directory.
`ROM_AUDIT_STAGE_ONLY=setup|qualify|bench|full` runs one stage. Repeating the command
resumes compatible checkpoints; renderer/decision, engine, native-binary or corpus changes
require a new output directory. Qualification is reused only when source/binary
identities and all recorded validation logs still match. Publication/qualification
changes invalidate qualification but preserve the separately bound measurements.

The benchmark covers 80 hash-selected subtunes across every format/duration
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
interrupted work stays pending/failed and is resumable. A projection is evidence
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
rounding. Only complete register streams accepted by the existing listener-v1
fast path can grant compatibility. Dense digi streams, different tails, changed
writes, excessive timing drift, errors and truncation require native audio.
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
  explicit `complete`. Completeness requires every subtune, both engines and both
  consumer configurations to have a measured decision.
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

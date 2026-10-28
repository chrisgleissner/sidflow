# Bounded native ROM audit performance investigation

This investigation does not authorize a full census. All real inputs are reused
from the durable ledger. The new programs produce research reports, never
Commander eligibility bundles. Existing working-tree ROM correctness fixes and
checkpoints are preserved separately from this PR.

## What is being measured

The existing dual-engine hot path is already native C++, compiled with `-O3`,
`-march=native` and LTO from the pinned engine sources. WASM is an independent
qualification reference, not the bulk classifier. This machine's installed
`sidplayfp` is 2.16.0, whose CLI offers reSIDfp/reSID but no SIDLite. Substituting
that installed version would change the machine being measured. The instrumented
native executables also expose exact writes and mapped ROM reads that the stock
CLI does not expose.

The existing 320-job benchmark projects 32.86 hours before its 25% margin,
41.07 hours including that margin, at 17.75 effective CPU cores. That is measured
CPU work divided by observed aggregate capacity, not a promise of runtime.
Among those 320 rows, 315 per engine fall back to audio. Recorded CPU seconds:

| Engine | Total | Audio fallback |
|---|---:|---:|
| SIDLite | 2,282.56 | 1,336.03 |
| reSIDfp | 9,280.39 | 8,085.34 |

Thus audio accounts for 81.48% of these sampled process costs. These are raw
sample costs, not population-weighted contributions: the benchmark deliberately
oversamples rare format/duration strata. Optimizing screens alone cannot plausibly
remove most of the total work.

## Header and static-analysis limits

The primary specification is the pinned HVSC85
`workspace/hvsc/C64Music/DOCUMENTS/SID_file_format.txt`, also reachable through
[HVSC's format FAQ](https://www.hvsc.c64.org/faq).

- An RSID BASIC flag declares interpreter support. Preserve this as **declared**
  evidence; it is not a measurement that the listener comparator detects a
  difference. RSID alone does not declare an individual ROM dependency.
- PSID is not a ROM-free declaration. Load/init/play addresses identify entry
  points and memory layout. Clock, speed and chip flags select the correct
  machine. Relocation pages constrain the driver. None describes all subsequent
  control flow, indirect accesses, IRQ/NMI paths or decompressed code.
- Scanning address operands includes data and unreachable code, misses indirect
  and indexed crossings and ignores banking. Executing RAM at `$e000` is not
  a KERNAL read; `$d000` can be SID/VIC I/O, RAM or CHARGEN. Writes under ROM
  normally reach RAM. Observe MMU-dispatched reads, including instruction fetches.
- Arbitrary self-modifying 6502 programs have no universal cheap static ROM-use
  certificate. A conservative abstract interpreter could prove a subset safe,
  but must return unknown for unresolved addresses, banking and dynamic code.
  No corpus coverage or speed claim for that approach has been measured here.

ROM *access*, dependence of execution on ROM bytes, and audibly different
playback are different endpoints. A read whose result is discarded can change
execution evidence without changing the music. Conversely a late data read can
change a note long after startup. No passing short prefix certifies the tail.

## Sound shortcuts and their proof obligations

The existing unread-CHARGEN shortcut is sound within a deterministic engine and
finite horizon: replacing an unread bank cannot change that execution, including
initialization. It already removes most mask-3 comparisons. Read counters include
engine setup, which is necessary for soundness but makes unread-KERNAL shortcuts
less useful (even Arkanoid records four KERNAL reads in a short reference).

A stronger future witness could compare every mapped read with the **effective**
replacement bank, allowing accesses to identical bytes. It must include reset,
ROM patches, driver installation, initial RAM differences, instruction/dummy
reads and asynchronous devices. In particular, absent KERNAL is an engine shim,
not a zero-filled original C64 ROM. Comparing only pristine ROM files or starting
observation after tune init is insufficient. Different read bytes still mean
unknown, not audible incompatibility. This requires instrumented native support
and independent adversarial controls before it can grant anything.

Cycle detection could close a finite-state execution proof only if the complete
relevant CPU, RAM, banking, device and event-scheduler state repeats. A repeated
SID register pattern alone is insufficient: a hidden countdown can cause a later
ROM read. SID state can be omitted only with a separately justified no-readback
condition. Hash collisions and absolute-time handling must also be addressed.

Until those proof obligations are implemented and checked, retain full-horizon
native execution. Do not restore the previously rejected timing-tolerant screen:
a few cycles can move final writes across the PCM boundary. Nor can reSIDfp
results be transferred from SIDLite: register readback can change control flow.

## Adaptive screen experiment

`adaptive-screen.ts` starts a variant with the reference's successful clocking
mode. This is only a scheduling hint: the variant still runs independently and
can escalate to detailed emulation. No execution values are fabricated.

Pilots of 4 then 16 already-counted subtunes compared both engines. Every final
write, completion flag, error and CHARGEN count matched. The 16-job prefix needed
32 attempts per engine with either policy, so there was no useful saving:
SIDLite CPU 15.749s versus 15.768s, reSIDfp 23.195s versus 23.198s. These small
unreplicated differences are noise. The sample is a completion-ordered benchmark
prefix, not a representative estimate of the corpus.

Synthetic native controls exercise the actual optimization: early OSC3 goes
from four attempts to three and late ENV3 from six to four. Late CHARGEN still
runs all three masks. Exact final evidence matched in both engines. These controls
show correctness on those cases, not widespread corpus savings. Leave production
scheduling unchanged until representative benefit is demonstrated.

## Sustained scheduling and libSidplayEZ

The same 16 previously counted subtunes were repeated four times (64 full-horizon
comparisons) per configuration. Every non-cost result, including PCM/trace hashes,
matched both within runs and across configurations.

| Dispatch | Workers | Elapsed | Mean busy logical CPUs |
|---|---:|---:|---:|
| Original order | 8 | 81.023s | 9.91 |
| Original order | 19 | 63.421s | 15.44 |
| Prior CPU cost, descending | 19 | 50.992s | 19.62 |

With 19 workers, the full original queue held roughly 19.9 CPUs busy. Its last
slow jobs drained with only one to four CPUs active. Starting expensive jobs
first shortened this batch by 19.6%. This is a measured **bounded-batch** saving,
not a 19.6% whole-corpus runtime prediction; a very large queue has a smaller
relative drain tail. More than one renderer process can run per worker, so the
8-worker case can consume more than eight CPUs.

Production dispatch now applies the job limit **before** sorting. It uses exact
matching benchmark costs where available and CPU-per-horizon-second averages
within format/duration strata otherwise. Without a benchmark it orders by
horizon. It does not enlarge the selected set or alter comparator policy,
reference repeats, horizons, independent engines or checkpoint identity.
Qualification still binds the dispatcher and the new scheduling helper.

Per-core samples are taken every 250ms; host occupancy includes unrelated work,
whereas reported process CPU time is scoped to the classifier. Median sampled
frequencies during the cost-ordered run were about 4.71 GHz on P-core logical
CPUs and 3.90 GHz on E-cores. Both readable package power limits were 181 W;
thermal-throttle counters read zero. Package energy counters were inaccessible,
so this experiment does **not** establish the cause of the reported historical
300-to-170 W drops. Wattage alone cannot distinguish worker idleness from power
limits. The clean cost-ordered run excluded simultaneous builds and tests; an
earlier build-contended run was discarded from the comparison.

The primary [libSidplayEZ source](https://github.com/Toddler-Boy/libSidplayEZ)
identifies it as a modified libsidplayfp/reSIDfp engine. The Linux probe pins
Commander’s upstream revision `4c8664c80df8d363049e1a3eadf59cd9e52afd1f`, archive
SHA-256 `b74103101f95e1635a064147d9b83c54a6f128a28e2ded043e70779513075590`.
It uses native Clang 21, `-O3 -march=native -ffp-contract=off`, 48 kHz stereo and
header SID-model selection with 8580 fallback. It omits Commander’s patch and
analogue profile deliberately: this is an upstream timing probe, **not** proof
about Commander’s patched backend. EZ has its own startup warm-up and declick,
which differ from the audited native reSIDfp profile.

Four, then eight real inputs covered PSID, RSID, BASIC and multi-SID, up to 110s.
Every full reference repeated exactly within each backend. All 13 comparable
ROM-mask outcomes agreed under the forced spectral comparator. Three absent-ROM
BASIC lanes stopped in EZ, and one also halted in the raw native probe; those
are retained as errors/unknowns, never silently promoted to equivalence. The
production native classifier separately has diagnosed-halt handling; this probe
intentionally does not infer that from an unspecific EZ failure.

For the eight full-reference lanes, native reSIDfp used 15.906 CPU seconds and
EZ 13.779 (13.4% less CPU, 1.15x throughput). Individual examples varied: 98s RSID
was 4.567 versus 3.199 CPU seconds, whereas a 10s BASIC case was 0.643 versus
0.743. No factor-of-two improvement over the **current optimized native**
baseline was established. This is a small nonrepresentative pilot, not a new
weighted census projection. CPU cost is the reported endpoint because ordinary
unit validation ran concurrently with the eight-input timing pilot. The separate
utilization experiments were run without those tests.

A second native experiment preconstructs reSIDfp filter tables once and forks
fresh isolated children. No player, SID state, RAM or mutable filter state is
reused between children. Parent construction follows the normal 6581/8580 order;
each child gets its own copy-on-write state and dies if its parent exits.
Exact PCM bytes, timed traces, ROM-read counters and summaries matched cold
processes for 4, then 16 full references, including multi-SID. Four references
took 4.084s cold versus 3.424s forked; sixteen took 59.465s versus 55.919s (6.0%
less elapsed, including prewarm and writing controls). This is full-reference
proof-of-concept coverage, not qualification of mask variants, the streaming
transport or stateful-read screening. Keep the production cold-process isolation.

Neither experimental backend changes published eligibility. The evidence does
not justify a sub-30-hour whole-HVSC promise. The defensible production change
here is improved dispatch; broader speed gains require representative backend
qualification and/or stronger read witnesses before any full run.

## Sample-clock register-screen experiment

This remains an experimental reSIDfp-only path. The isolated native probe uses
the upstream SINC resampler's readiness count to report measured output frames
alongside the exact timed SID-write packets. `RegisterClockComparator` reuses
the listener register predicate and its limits, but advances comparison windows
from those measured frame counts. It does not create samples or PCM. A bus-only
execution that makes a stateful SID read is retried in detailed sample-clock
mode. Uncertain ROM sets still require the separate native audio renderer.

The implementation has a direct readiness control: for four PAL/NTSC clock
values, four rates (16, 44.1, 48 and 96 kHz), and 200 varying/reset batches per
pair, batched `advanceClock()` results matched repeated calls to upstream
`Resampler::input()` exactly (3,200 checks). This proves the count path's
resampler readiness for those inputs. It does not establish amplitude or PCM
parity. Synthetic and real controls also compared frame counts and timed writes:
24 rows completed exact parity and six bus-only rows aborted for stateful SID
reads. In the four-subtune real pilot, all eight detailed/bus-mode rows completed
that parity; six additional synthetic rows aborted conservatively.

The standalone sample-screen reports checked four and then sixteen
already-counted subtunes **before** the unread-CHARGEN shortcut correction.
Treat these as the earlier conservative raw-register-screen stage: dense,
identical reference streams could be rejected for the full-ROM comparison
(`full=false`). Against the historical dual-engine census there were zero false
compatibility grants; all grants also passed separate measured native audio
verification. At four subtunes, this stage granted/rejected 1/3 no-ROM cases and
3/1 full-ROM cases. At sixteen, those counts were 5/11 and 10/6. The old
standalone full-set counts are historical and are not expected to reproduce
with the corrected `bench-sample-screen.ts`.

The controller A/B retained full-horizon native audio for unresolved sets and
required matching state decisions for every row. This final pipeline stage uses
the corrected sound unread-CHARGEN shortcut; its sixteen-input run granted all
16 full-ROM screens, compared with 10/16 in the earlier conservative standalone
stage. The polished four-input run
matched the previous controller's four row states (8.802s exact-screen versus
7.542s sample-screen native child-process CPU work). A frozen-source
sixteen-input run matched all states and measured 121.715 CPU seconds for the
exact-screen controller versus 82.064 seconds for the sample-screen controller,
a 32.60% reduction in native child-process CPU work for this batch. These sums
exclude controller, JSON and FFT CPU cost; they are not elapsed-time speedups.
The sixteen-input prefix is small and completion ordered, so this does not
support a whole-HVSC runtime estimate. The sample screen has not qualified for
production. Before making a runtime promise or enabling it by default, require a
representative stratified benchmark at target worker load that includes
coordinator CPU cost.

Three boundary controls further constrain interpretation. Its_Hip_to_be_Cool
had a clean reSIDfp reference; both sample-screen grants matched the separate
native audio result. Mexico86 and New_Scener halted with illegal-instruction
reference errors and received no grants. These controls do not qualify SIDLite
or any optimization that relies on behavior after a halted reference.

Reports bind the benchmark, renderer identity, the sample pipeline, comparator,
patch and build-script hashes. The controller snapshots these sources before
dispatch and aborts if they drift while results are being collected. Evidence
and further limitations are summarized in
[`hvsc-rom-performance-pilot.json`](hvsc-rom-performance-pilot.json). No PCM is
generated by the clock-count path, no eligibility bundle is changed, and the
production full-horizon audio path remains the correctness boundary.

## Reproduction

Run through the repository's pinned Bun launcher. All native executables must
have been built from the intended source profile; report hashes identify them.
The profiling commands reuse inputs and take the corpus scope lock.

```sh
node scripts/run-bun.mjs scripts/rom-audit/bench-adaptive-screen.ts \
  workspace/rom-audit-dual-3/benchmark.json workspace/roms workspace/adaptive.json 16
node scripts/run-bun.mjs scripts/rom-audit/verify-adaptive-screen.ts \
  workspace/roms workspace/rom-audit-screen-sidlite/render \
  workspace/rom-audit-screen-residfp/render workspace/adaptive-controls.json
node scripts/run-bun.mjs scripts/rom-audit/bench-utilization.ts \
  workspace/rom-audit-dual-3/benchmark.json workspace/roms workspace/utilization.json 19 16 4 cost
bash scripts/rom-audit/setup-local-clang.sh  # Ubuntu helper, no system install
CXX="$PWD/workspace/rom-audit-clang/usr/bin/clang++-21" \
  bash scripts/rom-audit/build-ez-probe.sh
node scripts/run-bun.mjs scripts/rom-audit/bench-ez.ts \
  workspace/rom-audit-dual-3/benchmark.json workspace/roms \
  workspace/rom-audit-ez-probe/render workspace/ez.json 4
bash scripts/rom-audit/build-sample-clock.sh
node scripts/run-bun.mjs scripts/rom-audit/verify-sample-clock.ts \
  workspace/roms workspace/rom-audit-sample-clock/native/render \
  workspace/sample-clock-controls.json
node scripts/run-bun.mjs scripts/rom-audit/verify-sample-clock.ts \
  workspace/roms workspace/rom-audit-sample-clock/native/render \
  workspace/sample-clock-pilot-4.json \
  workspace/rom-audit-dual-3/benchmark.json 4
node scripts/run-bun.mjs scripts/rom-audit/bench-sample-screen.ts \
  workspace/rom-audit-dual-3/benchmark.json workspace/roms \
  workspace/rom-audit-sample-clock/native/render workspace/sample-screen-4.json 4
node scripts/run-bun.mjs scripts/rom-audit/bench-sample-pipeline.ts \
  workspace/rom-audit-dual-3/benchmark.json workspace/roms \
  workspace/rom-audit-sample-clock/native/render workspace/sample-pipeline-4.json 4
node scripts/run-bun.mjs scripts/rom-audit/bench-sample-pipeline.ts \
  workspace/rom-audit-dual-3/benchmark.json workspace/roms \
  workspace/rom-audit-sample-clock/native/render workspace/sample-pipeline-16.json 16
```

These are bounded experiments. A new backend must retain engine/profile identity,
full horizons, errors and unknowns, and independently pass correctness gates.
Do not relabel existing reSIDfp measurements as EZ or original-C64 proof.

### Follow-up: the exact C64 Commander EZ profile

The upstream probe above did not use C64 Commander's wrapper and profile. To
address that limitation, the same eight previously measured HVSC inputs were
also rendered with C64 Commander's `EzSession` and `ez_render` harness from
Commander commit `fd7c461383718902f7c1bfc5c172cc05c137c939`, using its verified
libSidplayEZ revision `4c8664c80df8d363049e1a3eadf59cd9e52afd1f`, archive
SHA-256 `b74103101f95e1635a064147d9b83c54a6f128a28e2ded043e70779513075590`,
and the Commander patch/profile. The host probe used Clang 21 `-O3
-march=native -ffp-contract=off`, 48 kHz stereo and the app's 8580 fallback.
`workspace/ez-commander-profile-eight-o3.json` retains per-input CPU times and
hashes locally; the raw tune paths and audio are not part of this repository.

Across these same eight full-ROM references, the Commander-profile EZ process
used 13.600 CPU seconds versus 15.906 seconds for the optimized native reSIDfp
screen renderer: 14.5% less CPU (1.17x throughput). Individual inputs ranged
from a small EZ slowdown to a roughly 30% saving. This is stronger evidence
about the actual Commander profile than the upstream-only probe, and it supports
treating EZ as a modestly faster candidate. It still does not establish a
whole-corpus speedup: this is eight repeated, nonrepresentative inputs; the
Commander host harness writes PCM without the native screen's timed-write
transport; and it did not test the full/no-ROM decision matrix. The exact
Commander profile therefore remains unqualified for eligibility publication.
A separate representative, matched comparison of all ROM masks and stopped
lanes is required before an EZ-backed census can replace or supplement the
existing per-engine export.

The host build script also attempted to link its sanitizer test binaries, but
this environment's local Clang package lacks compiler-rt sanitizer archives.
The `ez_render` profiling executable itself built and ran successfully; the
full Commander host test build was not qualified by this experiment.

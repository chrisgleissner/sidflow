# HVSC playback and C64 ROM requirements

Investigation date: 20 October 2026. Corpus: **HVSC release 85, 28 June 2026**.
This research belongs to branch `research/hvsc-rom-requirements`, based on
`origin/main` at `d893e32`. The complete controlled census covers **61,157 files / 87,868 subtunes**.
The results below describe measured ROM sensitivity in bounded windows, not a
proof of perpetual ROM necessity or independence.


## Completed execution census

The longest validated observation for each subtune gives:

| Removal changes execution | Files / 61,157 | % files | Subtunes / 87,868 | % subtunes |
|---|---:|---:|---:|---:|
| KERNAL (including both-sensitive) | 1,578 | 2.5802% | 2,619 | 2.9806% |
| BASIC (including both-sensitive) | 555 | 0.9075% | 1,210 | 1.3771% |
| Both, each removed separately | 534 | 0.8732% | 1,189 | 1.3532% |
| Either removal: distinct union | **1,599** | **2.6146%** | **2,640** | **3.0045%** |

The two marginal rows overlap. A file is counted when at least one subtune
qualifies; different subtunes of one file can enter different categories.
“Both” means each separate removal changes execution, not that two complete
original 8 KB images are the minimal possible implementation. These are screening
counts of execution dependence in this emulator, not counts of tunes judged
unlistenable. Changed tables, notes or timing can leave substantial music.

All subtunes are accounted for below. Zero combined-removal-only, reference-error
or unstable-reference cases occurred in the retained observations.

| Evidence | Files (overlap) | % files | Subtunes | % subtunes |
|---|---:|---:|---:|---:|
| basic-sensitive | 21 | 0.0343% | 21 | 0.0239% |
| both-sensitive | 534 | 0.8732% | 1189 | 1.3532% |
| identical-in-window | 1601 | 2.6179% | 2379 | 2.7075% |
| insufficient-reference-activity | 344 | 0.5625% | 1233 | 1.4032% |
| kernal-sensitive | 1044 | 1.7071% | 1430 | 1.6274% |
| pcm-difference-with-similar-write-sequence | 58089 | 94.9834% | 81615 | 92.8836% |
| quiet-reference | 1 | 0.0016% | 1 | 0.0011% |

File percentages above overlap; subtune categories partition the census.
There are **1,234 inconclusive subtunes in 345 files** (1.4044% / 0.5641%).
They are not included as either demonstrated dependence or independence.
There were no failed reference renders. Removal outcomes retained **308
KERNAL-only errors, 22 BASIC-only errors and 128 neither-ROM errors**; these
are per-outcome counts and can overlap within a subtune. Errors are reported
in catalogue rows, including the illegal instruction and address.

The full initial census contains 82,682 two-second and 5,186 ten-second rows.
The final aggregation replaces selected rows with longer controlled runs:
**82,637 at 2 s, 5,153 at 10 s, 45 at 30 s and 33 at 60 s**. The 49-subtune
thirty-second selection overlaps four sixty-second checks. All five outcomes
cover the full stated interval; 171,716 redundant outcomes have explicit
zero-read derivations. No discarded preliminary run contributes a row.

The sixty-second selection includes BASIC-only sensitivity candidates,
short/inactive BASIC references, and important examples. It is a targeted
follow-up, not a random sample or an estimate of how many late dependencies
remain. Nine initially insufficient references become both-sensitive; three
BASIC-sensitive cases become both-sensitive; one becomes quiet under the
whole-window RMS threshold. Great Giana Sisters #1 changes from identical at
two seconds to KERNAL-sensitive in the longer checks. All transitions and
manifest/checkpoint hashes are in [machine-readable results](hvsc-rom-catalogue/results.json).
The 1,233 remaining low-write references may include intentional sound effects,
finished jingles, delayed starts or failed initialization; they remain unresolved.
The quiet sixty-second reference is `MUSICIANS/B/Blues_Muz/Roestoeen_Kristian/In_Memoriam_BHF.sid` #1.
No assertion of a new player defect follows merely from these categories.

## Complete catalogues and evidence

The [catalogue index](hvsc-rom-catalogue/index.md) links paginated Markdown with
HVSC paths, one-based subtunes, literal title/author/release strings, complete-file
hashes, tested duration, reference activity, all three removal outcomes and full
available file/directory STIL notes. Missing metadata is explicitly identified. The catalogue contains 59,631
files and 85,687 subtune rows across 200 detail pages.
It covers every execution-sensitive or inconclusive file, every PCM-only affected
file, and BASIC-declared files even when otherwise identical. Every subtune of an
included file is listed. Exclusively sample-identical, non-BASIC files are omitted
from the affected catalogue; their population is still accounted for above.

The [notable selection](hvsc-rom-notable.md) lists all 49 longer-tested subtunes,
including sample-identical examples omitted from the affected catalogue. Full
local measurements are retained in `workspace/rom-audit-final/execution.jsonl`,
`workspace/rom-audit-notable-final/execution.jsonl` and
`workspace/rom-audit-extended-final/execution.jsonl`. These checkpoints are not
committed corpus data. Their SHA-256 identities and portable manifests accompany
the published result, so a fresh run can be checked against the same inputs.

## What the complete headers establish

Every one of the **61,157 SID files** was read and checked with SIDFlow's SID
header conformance checker. Every relative path, complete-file MD5, and subtune
count also matched the release's independent `DOCUMENTS/Songlengths.md5` index.
There are **87,868 subtunes**. These denominators include jingles and sound effects
represented as subtunes; they are not a count of uniquely composed musical works.

| Header class | Files | % of files | Subtunes | % of subtunes |
|---|---:|---:|---:|---:|
| PSID | 57,233 | 93.5837% | 80,594 | 91.7217% |
| RSID, BASIC flag clear | 3,335 | 5.4532% | 5,884 | 6.6964% |
| RSID, BASIC flag set | 589 | 0.9631% | 1,390 | 1.5819% |
| Total | 61,157 | 100% | 87,868 | 100% |

The flag test is `magic == "RSID" && (bigEndianWordAt(0x76) & 0x0002) != 0`.
The same bit in a **PSID** means PlaySID-specific, not BASIC. The
[HVSC format specification](https://www.hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt)
defines RSID BASIC as executing the embedded BASIC program. There is **no KERNAL
requirement bit**, and a clear BASIC flag does not prohibit machine code from
reading BASIC ROM tables or calling its routines. RSID does not mean "requires
both ROMs". PSID does not mean "never uses ROM".

Thus 589 files / 1,390 subtunes are explicitly declared BASIC programs. Headers
alone cannot supply exact KERNAL-only, BASIC-only or both-ROM requirement totals.

## Execution method and the claims it permits

The audit uses **SIDLite from libsidplayfp 3.0.2**, built natively for speed from
the complete source shipped in SIDFlow's locked `libsidplayfp-wasm` **1.0.1**.
It uses the existing classification engine's C64/SID implementation, not a new
6502 emulator. Seven native processes handle independent subtunes. PCM remains
in memory; it is not written as hundreds of gigabytes of duplicate WAVs.

Each subtune has five controlled outcomes: both ROMs, both again as a repeat
control, neither, KERNAL only, and BASIC only. CHARGEN is supplied identically in every experiment.
The C64 and SID model declarations are honoured; unspecified models use the
library defaults. Power-on delay is fixed at 5,000 cycles. Audio is stereo at
8 kHz; `digiBoost` is enabled and `RESAMPLE_INTERPOLATE` requested. The full
CPU-side SID register-write sequence is also observed. The
sample rate is sufficient to detect execution and gross output changes, not
to certify full-bandwidth audio fidelity.

PCM is pulled in **256-scheduler-event chunks**. An AddressSanitizer investigation
found that the initial 20,000-event pull can overflow SIDLite 3.0.2's 20 ms
sample buffer on `MUSICIANS/A/Andy/Justincase_part_6.sid`: the API's argument is
not a reliable elapsed-PHI1-cycle bound when video DMA stalls CPU execution.
All preliminary measurements from that setup were discarded. The regression
requires that real input in addition to synthetic PAL, NTSC and busy-loop tunes;
the simpler synthetic tunes alone did not reproduce the overflow. The same
real input passes with small pulls under AddressSanitizer.

To avoid redundant emulation, a passive observer counts every CPU read of the
mapped BASIC bank, including initialization. If a successful both-ROM run reads
that bank zero times, the KERNAL-only result is provably identical over that
window: changing bytes the CPU never observes cannot change this deterministic
execution. Likewise, a successful BASIC-only run with zero BASIC-bank reads
proves the neither-ROM result. Other cases are actually rendered. JSON records
mark every inferred result with `derivedFrom`; zero reads is a concrete
causal criterion, not a filename or header heuristic. The final manifest has no seed. All earlier experimental checkpoints are excluded. The optimized renderer is independently
cross-checked against actual WASM renders of all four configurations.

The baseline window is two seconds from start. BASIC-flagged files receive at
least ten seconds. Execution-sensitive, quiet, unstable or insufficiently active
baseline references are rerun for ten seconds. Selected recognisable tunes and
files with STIL competition-result notes receive a separate thirty-second check.
Each evidence row records its actual duration.

This is a **complete census of subtunes over bounded execution windows**. It is
not full-duration playback of every composition. A dependency first encountered
later can be missed. "No change observed" must never be exported as a guaranteed
ROM-free flag for the entire song. A non-looping jingle and a tune that needs
interaction also require care when interpreting a quiet or inactive reference.

### What "without ROM" means here

Without KERNAL, libsidplayfp provides a small synthetic interrupt/reset handler;
it does not provide the complete Commodore KERNAL. See the pinned
[KernalRomBank implementation](https://github.com/libsidplayfp/libsidplayfp/blob/v3.0.2/src/c64/Banks/SystemROMBanks.h).
These results therefore describe *this player's missing-ROM behaviour*, not a
physical C64 with an empty ROM socket or every other SID player.

Without BASIC, the bank is explicitly zero-filled. The upstream null BASIC
setter leaves the previous allocation untouched. Merely setting a previously
used context's BASIC pointer to null can therefore accidentally test stale ROM
bytes. Clearing it makes absence deterministic and prevents that confound. Normal
libsidplayfp driver/trap and subtune patches are retained; “zero-filled”
describes the supplied BASIC image, not a claim that the library never patches
that bank during tune setup.

The supplied ROM filenames and SHA-256 hashes, corpus manifest, document hashes,
renderer binary hash and complete-source archive hash are recorded in the run
manifest. ROM dumps and copyrighted SID binaries are not added to Git.

### Evidence categories

1. **Reference error / unstable reference / quiet reference / insufficient
   reference activity:** inconclusive, never counted as proof of independence.
2. **KERNAL-sensitive:** removing KERNAL changes execution; removing BASIC does
   not cross the execution-change criteria. BASIC-only is the experiment that
   tests removal of KERNAL.
3. **BASIC-sensitive:** the converse; KERNAL-only tests removal of BASIC.
4. **Both-sensitive:** each ROM's separate removal changes execution.
5. **Combined-removal-sensitive:** each ROM alone passes the execution comparison,
   but removing both changes it; this is not two independently proven needs.
6. **PCM difference with similar write sequence:** audio samples differ, but the
   register-value sequence remains a matching common prefix and timing/count
   changes stay within the stated bounds. This includes startup/oscillator phase
   effects and is not automatically called broken playback.
7. **Identical in window:** sample-identical across all configurations in the
   measured window; no claim is made about the rest of the tune.

An execution change means an emulation error, incomplete output, a changed SID
chip/register/value inside the common write sequence, write-count difference
greater than `max(32, 2% of reference writes)`, or relative event-time drift
greater than 5,000 C64 cycles after removing a fixed startup offset. References
with AC RMS below −60 dBFS or fewer than 64 SID writes are inconclusive. These
thresholds are explicit, reproducible screening rules, not hearing tests. Full
measurements preserve boundary differences and exact sample equality separately.

"Sensitive" means the ROM changes measured execution. It can mean a halt,
missing music, different generated notes, or timing changes. It is a broader
statement than "this song is entirely unplayable without this ROM". A true
perpetual necessity claim is not obtainable from these short windows alone.

## Why waveform comparison alone would overstate the problem

In the controlled two-second check of Rob Hubbard's **Commando**, removing KERNAL
changes PCM substantially, yet all **1,044 register writes** match in value and
order. Maximum relative write-time drift is only **13 cycles** after removing
the startup offset. This is not evidence that Commando becomes unplayable.

Martin Galway's **Arkanoid** is sample-identical in all four ROM configurations
in that same two-second control, despite being RSID. Laxity's **A Trace of Space**
has the same 2,423 register writes, with only 13 cycles of relative drift, despite
different PCM. These are useful counterexamples to both "all RSID needs ROMs"
and "any PCM difference proves a ROM requirement".

## Recognisable music and competition highlights

The [49-row notable table](hvsc-rom-notable.md) keeps exact paths and metadata,
including covers with similar filenames. It must not be used as a song-name
lookup: Rob Hubbard's original Commando and another musician's Commando cover
are different inputs. Hubbard discusses Commando and Monty on the Run in this
[composer interview](https://remix64.com/interviews/interview-rob-hubbard.html).
Chris Hülsbeck's own [biography](https://www.huelsbeck.com/biography) and
[Giana Sisters recording](https://chrishuelsbeck.bandcamp.com/track/the-great-giana-sisters-suite)
support the choice of Giana Sisters as a recognisable composer example.

| Original composer / tune | Subtunes checked longer | Result |
|---|---|---|
| Rob Hubbard — Commando | 1–3, 30 s | PCM differences; similar register sequences. #1 has 15,240 matching writes, 13 cycles relative drift without KERNAL. |
| Rob Hubbard — Monty on the Run | 1–3, 30 s | PCM differences; similar sequences. |
| Martin Galway — Arkanoid | 1–3, 30 s | Sample-identical across configurations. RSID is not a universal ROM dependency declaration. |
| Martin Galway — Wizball | 1–3, 30 s | PCM differences; similar sequences. |
| Matt Gray — Last Ninja 2 | 1–3, 30 s | PCM differences; similar sequences. |
| Jeroen Tel — Cybernoid II | 1–2, 30 s | PCM differences; similar sequences. |
| Chris Hülsbeck — The Great Giana Sisters | 1, 60 s; 2–3, 30 s | #1 KERNAL-sensitive; #2/#3 PCM differences with similar sequences. |

Giana Sisters #1 has 410,821 reference writes versus 410,820 without KERNAL,
but the sequence diverges after write 1,239. Its first PCM difference is at
**2.083375 seconds**, beyond the initial two-second window. KERNAL-only is
sample-identical to the full reference throughout sixty seconds and has zero
mapped BASIC reads. Removing KERNAL changes output while retaining substantial
audio (AC RMS 0.05246 versus 0.05236); this is not evidence of total silence.

Competition notes below are attributed specifically to HVSC 85 STIL, whose
full entries are in the catalogue and notable appendix. They establish results,
not a subjective ranking of musical quality. Each selected subtune is #1 at 30 s.

| Tune / header composer | Result recorded in STIL | ROM observation |
|---|---|---|
| Catalysis / Abyxus | Revision 2026 oldskool music, first | Identical PCM |
| Bass Themes / Sergey Sharov (Riskej) | Arok 2008 mixed music, first | PCM-only difference |
| Body / Steven Diemer (A-Man) | Silesia Party 1 sampled music, first | Identical PCM |
| All in the Past / Matt Simmonds (4-Mat) | Like It's '83 online competition 2021, first | PCM-only difference |
| Pocket Universe / Matt Simmonds (4-Mat) | Unofficial Tiny SID Compo 2022, 256-byte category, first | PCM-only difference |
| Smooth Evening (short version) / A-Man | Forever 2007, first | PCM-only difference |
| Fade from Blue / André Buerger (AEG) | Wired 1997, as “Aetsch”, first | PCM-only difference |
| Elastic / Timo Taipalus (Abaddon) | Zoo'98, first | PCM-only difference |
| Asylum of Love / Tero Rönnqvist (Apollyon) | Forndata 2022, shared first | PCM-only difference |
| Chaos 2000 / Dwayne Bakewell & G. Gallefoss | Mekka & Symposium 2000, first | PCM-only difference |
| House 93 / Dwayne Bakewell (Morbid) | TSR Party 1993, first | PCM-only difference |
| New Song / Peter Berghoff | Happy-Computer shortest sound program, first | PCM-only difference |

Catalysis's result is independently confirmed by the
[Revision organiser's 2026 archive](https://archive.revision-party.net/2026/).
No selected competition winner showed execution sensitivity within thirty seconds;
that is a bounded observation, not evidence that winning tunes form a ROM-free class.

## SIDLite fallback feasibility

**Changing from reSIDfp to SIDLite cannot generally repair missing C64 system
ROMs.** They are alternative SID chip emulations inside the same libsidplayfp
C64/6510 execution environment. The
[pinned player implementation](https://github.com/libsidplayfp/libsidplayfp/blob/v3.0.2/src/player.cpp)
configures the SID builder and the shared C64 separately; both use the same
KERNAL and BASIC bank implementations. SIDLite is not an alternate BASIC
interpreter or a replacement KERNAL.

This audit deliberately tests SIDLite, so its ROM-sensitive results are direct
counterexamples to a universal SIDLite fallback. In **128 Byte Blues BASIC**,
the both-ROM reference writes 241 SID registers during the two-second control;
without either ROM it writes only one. KERNAL-only writes 44, and BASIC-only
writes 601 with a register sequence that diverges after the seventh write.
Producing nonzero PCM is not equivalent to executing the intended music.

### A viable routing design

- **Make available ROMs the normal path.** Load and verify them once when the
  audio worker starts, then keep them resident. Supplying them to tunes that
  happen not to need them avoids per-song requirement detection and fallback
  delay. Persist actual injection status; a requested ROM is not necessarily an
  applied ROM.
- **Use a versioned capability manifest, not a filename deny list.** Index by
  complete-file cryptographic hash plus one-based subtune. Record the HVSC
  release, engine/library version, ROM hashes, tested duration, CPU/model settings
  and evidence class. Renames remain resolvable, altered files do not inherit a
  stale result, and different subsongs can have different results. Header BASIC
  flags are immediate positive hints; clear flags are not negative guarantees.
- **If ROMs are absent, route a known affected subtune to an actually capable
  backend:** verified prerendered audio from the existing classification cache,
  a supplied audio service, or a connected C64 Ultimate with its system ROMs.
  A cache needs a source hash, subtune, engine/ROM provenance, coverage and time
  offsets. A short classification excerpt is not a complete-track fallback;
  missing intros, fades and unfinished endings must not be hidden.
- **Resolve before playback.** Prefetch the next playlist item, its manifest row,
  chosen backend and initial audio buffers while the current item plays. Keep
  the audio worker warm. Manifest lookup and a header read do not require seconds
  of synchronous emulation at every start.
- **For unknown/local files, background probing is advisory.** A limited probe
  without a valid reference cannot reliably distinguish a legitimate rest from
  a stalled player, and successful startup cannot rule out later ROM calls.
  Probe during import or next-track preparation and cache the result. Do not
  promise a seamless dynamic switch after a tune has already started incorrectly.
  If no capable backend or complete cached recording exists, accurately expose
  that limitation rather than claim that a SIDLite switch fixes it.

The cached WAV sidecars inspected during this investigation record neither ROM
hashes nor fixed power-on delay; the example is sidecar version 1 for Commodore
Users Guide PAL BASIC. Even version 4's declared fields omit ROM hashes and
startup delay. Those files can support listening and candidate triage, but cannot
replace a controlled reference in this experiment without additional provenance.

## Reproduction

From the SIDFlow worktree, after `bun install --frozen-lockfile`:

```sh
bash scripts/rom-audit/build-native.sh
bun scripts/rom-audit/verify-native.ts /path/C64Music /path/roms
bun scripts/rom-audit/audit.ts \
  --hvsc /path/C64Music --roms /path/roms \
  --out workspace/rom-audit-final --workers 7 --seconds 2
```

The exact command resumes completed rows only when the manifest matches. Source
changes, ROM changes, corpus changes or window changes require a separate output
directory. A native worker timeout or abnormal exit fails the run; checkpointed
rows remain available. Unknown paths or subtunes in an explicit `--selection`
are rejected. Per-variant CPU errors are retained as measurements, not silently
discarded or treated as silence.

The renderer's SID-write observer is copied from the existing
`libsidplayfp-wasm/scripts/apply-sid-write-hook.py`, with its provenance and
modification notice preserved. It observes the value actually passed to the SID
emulator, without replacing the emulation object.


### Routing mechanisms compared

| Mechanism | Coverage / error modes | Startup and maintenance | Unknown files / unavailable ROMs |
|---|---|---|---|
| BASIC header flag | Immediate positive declaration for 589 files; no general KERNAL flag. Clear flags miss machine-code dependencies. Flagged, inactive references can be inconclusive. | Tiny header read, no emulation delay; maintain format parsing. | Never infer safety from a clear flag; report declared BASIC need when no capable backend exists. |
| Versioned HVSC release metadata | Complete paths/subtunes for a fixed release; renames/modifications invalidate path-only lookup. Finite-window results miss late calls. | Local indexed lookup can be prepared at import; regenerate on corpus/engine/ROM changes. | Hash-check a file before trusting release membership. |
| Content-hash catalogue | Exact bytes/subtune; robust to rename. Sensitivity includes harmless changes, while observed matches can miss later need. | Hash during import/playlist preparation; cache the hash. Catalogue and version policy need maintenance. | Unknown hashes remain unknown; choose a capable backend or expose limited playback. |
| Cached controlled analysis | Reuses previous measurements for local files. Invalid without full engine/ROM/settings identity; short-window negatives remain uncertain. | Avoids repeating probes at play time; invalidate changed inputs or engine. | Probe in background; absence of a valid reference prevents reliable correctness detection. |
| Bounded dynamic check | Detects gross halts or differences when a valid ROM reference exists; rests cause false alarms, delayed calls cause false negatives. | A synchronous 2/10/60-second emulation check adds CPU work and variable latency. Perform before selection, not on every Play press. | No-ROM probing cannot manufacture a reference or firmware; keep unknown status explicit. |
| Verified alternate backend / full audio cache | Works only where that backend actually supports the input and full duration. Another SID chip model is insufficient. | Warm connection/worker and prebuffer next track; backend availability, audio provenance and full-track storage require maintenance. | If unavailable, report the limitation; do not silently replace the tune with startup noise. |

These are design options, not an implemented fallback or measured end-to-end
latency guarantee. A local manifest lookup plus precomputed hash avoids a
mandatory startup probe; import-time analysis and next-track prefetch move the
expensive work out of the playback transition. For a first unknown file, instant
correct playback cannot be guaranteed without either a capable engine/backend
or supplied system routines. No verified general ROM-free alternative execution
engine was established in this study. Replacing only the routines/tables actually
used might be possible per tune, but neither a ROM read nor this audit proves
that a substitute implementation is sufficient.

### Current-package controls and sustained activity

The installed Commander package remains **1.1.0 / libsidplayfp 3.1.1**; SIDFlow
remains **1.0.1 / 3.0.2**. `check-fallback.ts` tests three actual inputs through
both SIDLite and reSIDfp at ten seconds with 256-event pulls, fixed power-on
delay, full ROMs versus explicit missing ROMs. It retains PCM/sequence hashes,
first/last write cycles and one-second AC RMS bins. For 128 Byte Blues, both
engines produce **1,176 reference writes versus one without either ROM**.
The reference writes span cycles 272,822–10,109,716; the missing-ROM outcome's
only write is at 272,822. SIDLite's reference RMS remains about 0.077 throughout;
the missing-ROM startup transient has RMS 0.00653 in second one and exactly zero
in seconds two through ten. reSIDfp likewise decays to below 0.00001. This is
sustained-reference versus initialization-only evidence, not a nonzero-RMS test.

The full census screens activity by total writes and whole-window AC RMS;
it does not have per-second activity bins for every subtune. Short jingles,
legitimate rests and long intros therefore remain a methodological limitation.
The detailed controls support the specific failures, not an auditory judgement
of every execution-sensitive row. No claim is made that the counts measure
perceptible degradation, or that 8 kHz preserves full SID fidelity.

## Confirmed software defects and disposition

| Tracker | Confirmed evidence | Disposition |
|---|---|---|
| [libsidplayfp-wasm #14](https://github.com/chrisgleissner/libsidplayfp-wasm/issues/14) | Native SIDLite heap overflow in bundled libsidplayfp 3.0.2 and 3.1.1; shipped WASM output depends on pull size in both package versions. | Open primary engine/wrapper issue; real-input hashes, standalone ASAN reproducer, safe/unsafe controls and remediation surface supplied. |
| [Commander #538](https://github.com/chrisgleissner/c64commander/issues/538) | Actual live/prerender/seek code at `c99f2dd2adf2f95efb823d9ffee5cc73e5047277` inherits unsafe package defaults. | Open linked consumer containment/dependency-update issue. No Android crash claimed. |
| [Commander #539](https://github.com/chrisgleissner/c64commander/issues/539) | Actual dispatcher/core opens BASIC-dependent 128 Byte Blues with `romRequired: false` and only one write without ROMs, versus 1,177 with ROMs. | Open application integration/status issue, including real-path reproduction and regression requirements. |

These existing trackers were checked rather than duplicated. The
[overflow investigation](sidlite-20ms-buffer-overflow.md) distinguishes native,
shipped-WASM and reachable application evidence. All three remain open; no
engine correction has landed as part of this branch. Detailed issues are the
chosen disposition rather than a consumer-only patch: fixing engine capacity
is authoritative, and live rendering, prerendering, seeking, status reporting
and unknown-file routing need coordinated tests. A smaller pull is local
containment, not a universal capacity proof. Changing fallback product behavior
is outside this research implementation. No application code is changed here,
so no device deployment or UI/screenshot refresh is part of this software-only study.

## Reproducing follow-ups and publication

Use the full-census command above, then run the retained exact selections:

```sh
bun scripts/rom-audit/audit.ts --hvsc /path/C64Music --roms /path/roms \
  --out workspace/rom-audit-notable-final --workers 7 --seconds 30 \
  --selection scripts/rom-audit/notable-selection.json
bun scripts/rom-audit/audit.ts --hvsc /path/C64Music --roms /path/roms \
  --out workspace/rom-audit-extended-final --workers 7 --seconds 60 \
  --selection scripts/rom-audit/extended-selection.json
bun scripts/rom-audit/publish.ts workspace/rom-audit-final \
  workspace/rom-audit-notable-final workspace/rom-audit-extended-final \
  /path/C64Music doc/research/hvsc-rom-catalogue
bun scripts/rom-audit/check-fallback.ts /path/Commander/node_modules/libsidplayfp-wasm/dist/index.js \
  /path/C64Music /path/roms
bun scripts/rom-audit/check-commander.ts /path/Commander /path/C64Music /path/roms
bun scripts/rom-audit/check-large-pulls.ts /path/package /path/C64Music /path/roms
```

Publication checks unique, complete coverage; known subtune identities; adaptive
window minimums; finite measurements; error accounting; independent zero-read
source/derived equality; corpus/document hashes; renderer and source archive
identity; and that no discarded seed is present. The full-census resume also
re-reads every SID/ROM and compares the release index and manifest before doing
any work. Portable manifests and execution checkpoint SHA-256s are retained in
`hvsc-rom-catalogue/results.json`. Exact compiler flags and inputs are recorded
by `build-native.sh` and local build stamps. Rebuilding with another compiler may
change the binary hash: use fresh run directories, never relabel old evidence.

The test commands and results are recorded in [validation](hvsc-rom-validation.md).
The report's unresolved cases are genuine finite-window/reference limitations,
not omitted subtunes. Longer whole-song rendering, perceptual assessment,
additional ROM revisions, other CPU/model defaults and a corrected engine
release could change the measured categories; version and reproduce such work
rather than overwriting this census's meaning.

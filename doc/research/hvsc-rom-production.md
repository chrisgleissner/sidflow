# Full-song ROM audit and offline eligibility (methodology 3)

## Summary

This document describes how SIDFlow decides, per HVSC subtune, whether the subtune may be
played with the ROM sets C64 Commander can create, and how a player consumes that decision
offline.

- The policy is strict: `compatible` allows, `incompatible` and `unknown` deny. A missing
  entry, an unsupported catalogue or engine identity, an unsupported ROM set, a profile
  mismatch and any inadequate evidence all deny.
- A `compatible` bit means one thing: on `libsidplayfp-wasm` 1.1.0 (the exact build C64
  Commander ships), configured as Commander configures it, a fresh playback with that ROM
  set produced the same PCM and the same cycle-timed SID writes as the full-ROM reference
  for the whole documented duration plus a 5 s margin. It is not a statement about other
  engines or versions, sample rates, ROM images, looping or musical correctness. A
  full-ROM render is an operational reference, not an artistic or historical fidelity
  certificate.
- **Renderer coverage.** The census qualifies **SIDLite** only. C64 Commander's default renderer
  depends on the build variant: SidplayEZ (Android native, a different CPU core) where it exists,
  reSIDfp on web and iOS; SIDLite is used only when selected. **Most Commander users therefore get
  no coverage from this census**: the lookup built for their renderer denies everything. reSIDfp
  lanes are refused (`audit.ts` rejects `--engines residfp`) because a second reSIDfp player in
  one WASM instance renders different PCM for identical input (the SID write traces are equal;
  reproduction in `scripts/rom-audit/residfp-instance-state.ts`, upstream report not yet filed),
  while Commander plays every tune in one shared instance, and because a reSIDfp lane costs about
  six times as much as a SIDLite lane. Transferring SIDLite results to reSIDfp via "no SID
  reads" was evaluated and rejected: only 7% of the pilot subtunes never read a SID register
  (dummy reads of indexed stores count). SidplayEZ would need its own build and harness.
- There is one engine for both measurement and grant: the shipping WASM build. An earlier
  design screened natively and confirmed on WASM; it cost more, needed an equivalence
  argument between two compilations, and could not follow Commander's configuration, so it
  was dropped. The native renderer remains in the repository as a research and regression
  tool only.
- The full-corpus census is not finished. The maintained dataset
  (`doc/research/hvsc-rom-catalogue/v3/`) contains every subtune; unmeasured work is
  `unknown`. Its manifest is authoritative for coverage. The methodology 2 snapshot
  (`catalogue/v2/`) is superseded and must not be used for decisions.
- Expansion beyond 5% of HVSC (4,393 subtunes **and** 3,057 files, whichever is reached
  first) is gated by a hardening certificate from `scripts/rom-audit/harden.ts`; see
  [Rollout gate](#rollout-gate). The architect review is in
  [hvsc-rom-adversarial-review.md](hvsc-rom-adversarial-review.md). Instructions for a
  full run on another machine are in [hvsc-rom-full-run.md](hvsc-rom-full-run.md).

## Consumer profile

`romConsumerProfile(engine)` in `packages/sidflow-common/src/rom-eligibility.ts` is hashed,
with the engine's source and WASM hashes, into the engine id. It records what Commander
does (`src/lib/playback/sidRenderer/wasmRendererCore.ts`, read-only):

| Setting | Value | Source |
|---|---|---|
| Engine | `libsidplayfp-wasm` 1.1.0 (the audit pins it as the aliased dev dependency `libsidplayfp-wasm-audit`; SIDFlow's classifier keeps 1.0.1) | Commander `package.json` |
| Sample rate | 48,000 Hz stereo | `localSidEngine.ts` `DEFAULT_SAMPLE_RATE` |
| Power-on delay | the engine default (8191, deterministic); Commander never sets it | `bindings.cpp` default |
| Pull size | 256 cycles for SIDLite, the engine default for reSIDfp | `pullSize()` |
| Subtune selection | start-song header rewrite before load | `SidAudioEngine.patchStartSong` |
| ROM sets | KERNAL and BASIC supplied together with CHARGEN `null`, or nothing supplied | `prepare()` / `open()` |
| SID model | from the header; where the header names none, the fallback model. The census fallback is MOS8580 (the engine default). Commander passes its own fallback, by default learned from the connected device, so it can be MOS6581 | `applySidModel()`, `localSidEngine.ts` |

A bank the consumer passes as `null` keeps whatever the engine heap held: Commander plays every tune
in one cached engine instance, so the bank can hold bytes from an earlier player, including the
authentic BASIC image. Each ROM set is therefore rendered with the null banks filled with zeros,
0xFF and a fixed pseudo-random pattern, and the "nothing supplied" set additionally with the
authentic BASIC left behind; a decision requires identical output for **every** fill. This is
evidence about those contents, not a proof for every possible content. Fresh instances are
equivalent to Commander's shared instance for SIDLite: `decision-regression.ts` plays tunes as the
Nth player of one instance after players with other ROM sets and compares them bit for bit with
fresh instances. The SID model is handled by a per-entry flag (see the contract below).

## Critical review of methodology 1 (historical)

`audit.ts` previously extended BASIC-flagged subtunes to ten seconds. After rendering, only
results outside `identical-in-window` and `pcm-difference-with-similar-write-sequence`
received a ten-second rerun, so an apparently successful introduction received no further
scrutiny. The published measurements comprise 82,637 two-second, 5,153 ten-second, 45
thirty-second and 33 sixty-second observations; they are not full-song coverage. Great
Giana Sisters #1 first diverges at about 2.083 s, which demonstrates the selection bias.

`analysis.ts` remains a historical diagnostic classifier. It tolerates a write suffix of
max(32, 2%), aligns startup timestamps and accepts 5,000 cycles of drift. Those thresholds
can hide a changed note or rhythm and never establish production eligibility. The BASIC
zero-read optimisation proved an equivalence only for a measured window with the same
KERNAL state. Methodology 3 renders every variant explicitly; reintroducing causal
inference requires window-wide access monitoring, identical initial conditions, accounting
for non-CPU engine uses of ROM bytes and regression against all explicit masks.

## Correctness model

Per subtune and engine the worker renders nine instances in lockstep from fresh WASM
instances (a second reSIDfp player in one instance produces different PCM for identical input,
so instances are never shared):

| Lane | ROMs | Role |
|---|---|---|
| reference | KERNAL, BASIC, CHARGEN authentic | the operational reference |
| repeat | same | determinism of the engine for this subtune |
| full/zero, full/ff, full/random | KERNAL and BASIC authentic, CHARGEN filled with 0x00 / 0xFF / pseudo-random | Commander's "supplied" set (mask 3) |
| none/zero, none/ff, none/random | KERNAL `null`, BASIC and CHARGEN filled likewise | Commander's "nothing supplied" set (mask 0) |
| none/stale-basic | KERNAL `null`, BASIC authentic (left behind by an earlier player), CHARGEN zero | the same set after a playback that supplied ROMs |

Each pull of a lane is compared with the reference's pull exactly: sample count, every PCM
sample and every packed SID write including its PHI1 cycle. A lane is `identical` only if
every pull through the horizon matched, so it also ends with the same number of writes.
Identical output with different internal pulls (as happens when the engine's interrupt
shim replaces the KERNAL) is reported `different`; that is conservative and never grants.
A diverged lane is not run on.

Decisions (`assessMask` in `methodology.ts`):

- mask 7: `compatible` if the reference is clean, complete and reproducible.
- mask 3 / mask 0: `compatible` only if every fill matches the reference through the horizon; otherwise
  `unknown` (`depends-on-null-bank-content`, `variant-stopped`, `output-diverges`, `non-tune-error`).
- **`incompatible` is never produced.** The engine reports an illegal opcode inconsistently (sometimes with its message,
  sometimes as an exception without one, for identical input), so a stopped variant is recorded as `stopped` and decided
  `unknown`. Deny is the outcome either way; the research record keeps where each lane first differed.
- every other ROM set is not something Commander can create: `unknown`.
- a documented duration is required; unknown lengths, short observations, an invalid horizon
  and a failed or timed-out job stay `unknown`.

Without the KERNAL the engine runs its own interrupt shim, which shifts every SID write by a
few cycles, so mask 0 is `unknown` for nearly every program. This is measured behavior (see the
decision regression), not a shortcut. Engine errors other than a stop (`trace-dropped`, a failed
reference) are infrastructure. A job that times out or throws is recorded as a failure and every
decision for it is `unknown`; the census continues.

## Observation policy

`Songlengths.md5` is joined by verified complete-file MD5 and path, keeping each subtune's
token by position (the convenience parser drops invalid tokens and would shift later
songs). For a valid positive duration the horizon is `max(--seconds, documented + 5 s)`, in
integer milliseconds. Invalid or missing lengths use a 300 s exploratory horizon and stay
`unknown`. Horizons above 3,600 s are never clamped; they stay pending. Durations are
playback metadata, not control-flow bounds: they do not prove loop recurrence,
interactive paths or endings.

## Pipeline

```
select-pilot.ts  ->  audit.ts (census-worker.ts processes, lockstep lanes)  ->  census.jsonl
                                                                              |
                                              publish.ts --production  ->  catalogue/v3/
```

`audit.ts` verifies the corpus against the release index, takes the kernel scope lock,
reserves each job durably in the ledger before dispatch, sends the SID bytes (checksum-verified
immutable payloads) to worker processes holding private read-only copies of the hashed ROMs,
fsyncs each result, and resumes from `census.jsonl`. A torn final record is preserved and
requeued; only the lock holder repairs a file. Publication emits the research JSONL (every
subtune, all lanes, assessments), one deny list per engine, a manifest and the raw census, then
re-checks every decision through the production lookup.

## Rollout gate

- Pilot runs require `--selection`; `select-pilot.ts` builds the reproducible stratified
  selection (long horizons, RSID/BASIC, multi-SID, non-default subtunes, static OSC3 readers).
- Every dispatch is preceded by a durable reservation in the corpus ledger
  `workspace/rom-audit-ledger-<corpus>.jsonl`, keyed by file content SHA-256 and subtune,
  appended and fsynced, with a per-record checksum. A different `--out` directory or a copy
  of a file elsewhere gets no new allowance. The ledger imports earlier audit runs and the
  300-file integration subset. Re-rendering a counted identity is free; a reservation is
  never removed. A torn final record (never acknowledged, so never dispatched) is preserved
  and ignored; interior damage or a failed checksum refuses to run.
- A kernel `flock` scope lock (released by the kernel even on `SIGKILL`) serialises audit
  parents per corpus.
- `--rollout full` needs `--hardening <certificate.json>`. `validateHardening` checks its
  structure against the recomputed source identity and `verifyHardeningEvidence` re-hashes every
  cited log and the architect approval. The source identity covers every file under
  `scripts/rom-audit`, the engine package, the lock file and the ROM-audit tests; it
  deliberately excludes git HEAD so that committing the approval does not change the
  identity it approves. `harden.ts` checks the approval first (the LAST `Approved-source-identity` and
  `Reviewer-model` lines of the review document) and writes a certificate only after all of its steps
  ran on one source identity. The certificate binds the approval text, not the whole review document,
  and requires exactly the logs harden writes (`REQUIRED_LOGS`).

## Test strategy

- `decision-regression.ts` (run by `harden.ts`): synthetic programs and real subtunes through
  lanes, `assessMask()`, the deny tuple and the lookup (deadline and unsupported ROM sets
  included). Classes: dependencies read at ~70 s observed at 80 s and beyond a 65 s horizon,
  a CHARGEN read inside (63 s) and just after (66 s) the 5 s margin, silent divergence (PCM
  equal, writes differ), a variant that stops writing at volume 0 (must never be identical),
  sparse effects, silence, a program that executes an illegal opcode without BASIC, a 2M+ write
  program, an OSC3 reader, dependencies on a second and third SID, and two real subtunes on
  which the pilot's earlier comparator reported the full-ROM configuration as different from
  itself (engine output is a view into memory the next call overwrites).
- Unit tests: `rom-eligibility.test.ts` (lookup, profile, assessments, record validation,
  synthetic programs, checkpoint recovery, publication, the maintained dataset),
  `rom-audit-adversarial.test.ts`, `rom-audit-ledger.test.ts`.
- The native renderer (`render.cpp`, `build-native.sh`, `verify-native.ts`,
  `native-regression.ts`) is a research and sanitizer tool for the engine's 20 ms buffer
  overflow and ROM-read counters. It is no longer part of the decision path.

## Publication and C64 Commander contract

`deny-list.<engine>.json` (`sidflow-rom-deny-4`) maps complete-file SHA-256 to one tuple per
subtune `[compatibleMaskBits, incompatibleMaskBits, maxPlaybackMs, documentedMs, modelFixed]`
(bit M describes ROM mask M; only masks 0, 3 and 7 are ever set). `modelFixed` is 1 when the SID
header names the model of every chip: the decision then holds for any fallback model. Otherwise it
was measured with the MOS8580 fallback, and a lookup created with `fallbackSidModel: "MOS6581"`
denies it (`depends-on-fallback-sid-model`). `manifest.json` records profiles,
engine hashes, ROM and document hashes, counts per mask with reasons, coverage, failures and
the SHA-256 of each artifact. No SID, ROM or PCM is distributed.

```ts
const lookup = createRomEligibilityLookup(denyList, {
  sourceSha256, wasmSha256,                 // of the engine build you actually run
  profile: romConsumerProfile("sidlite"),   // your actual configuration; any difference denies
  methodology: "rom-audit-3",
  fallbackSidModel: "MOS8580",              // the model you force where the header names none
});
const answer = lookup(fileSha256, oneBasedSong,
  { kernal: kernalSha256OrNull, basic: basicSha256OrNull, chargen: null }, elapsedSeconds);
// answer.eligible, answer.state, answer.reason, answer.maxPlaybackSeconds, answer.documentedSeconds
```

Consumer obligations:

1. Verify the artifact checksums against a trusted manifest before loading.
2. Pass the SHA-256 of each present ROM and `null` for an absent one. Any present image other
   than the reference ROMs, and any ROM set other than {nothing, KERNAL+BASIC with CHARGEN
   `null`, all three}, denies.
3. Use the engine build, sample rate, default power-on delay and pull configuration of the
   profile. A different engine version (for example a newer `libsidplayfp-wasm`) is a
   different engine id and needs a new census.
4. Start every eligible playback from a new player and reset with that ROM set. ROM changes
   apply between executions, never during one.
5. Elapsed time is emulated time since reset. Stop at `maxPlaybackSeconds`; the lookup
   denies at and after the deadline. Seeking is emulated fast-forward. Repetition is allowed
   only as a fresh restart. `documentedSeconds` is the musical duration; the remainder up to
   the deadline is margin.
6. Filter individual subtunes, not whole multi-song files. Re-evaluate cached eligibility when
   the ROM set changes.

No Commander code has been changed. A renderer other than the one named in the deny list is not
covered. Where Commander derives its fallback SID model from the connected device, it must pass that
model to the lookup.

## Known limitations

- Finite equality is not perpetual independence; loops, interactive input and endings beyond
  the horizon are unproven.
- reSIDfp and SidplayEZ are not covered (see the summary).
- A bank left `null` is covered by the fills above, not by every possible content.
- Full instruction traces and CPU state snapshots are not implemented.
- Throughput: see [hvsc-rom-full-run.md](hvsc-rom-full-run.md). The census takes days on a
  workstation and resumes from its checkpoint.

## Authoritative references

- [HVSC SID format specification](https://www.hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt),
  with the exact release document hashes in the manifest.
- [HVSC download/documentation page](https://www.hvsc.c64.org/downloads) and release
  `DOCUMENTS/Songlengths.faq`, `HVSC.txt`, `STIL.txt` and `BUGlist.txt`.
- [libsidplayfp ROM API](https://libsidplayfp.github.io/libsidplayfp/html/classsidplayfp.html)
  and the package's complete-source archive: `src/c64/mmu.cpp`,
  `src/c64/Banks/SystemROMBanks.h`, `src/player.cpp`, `src/psiddrv.cpp` and the SIDLite
  builder. The pinned implementations define the tested fallback and memory mapping.

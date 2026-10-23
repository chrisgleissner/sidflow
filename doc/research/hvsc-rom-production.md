# Full-song ROM audit and offline eligibility (methodology 3)

## Summary

This document describes how SIDFlow decides, per HVSC subtune, whether the subtune
may be played without some of the three C64 system ROMs (KERNAL, BASIC, CHARGEN), and
how a player consumes that decision offline.

- The policy is strict: `compatible` allows, `incompatible` and `unknown` deny. A missing
  entry, an unsupported catalogue or engine identity, an unknown ROM image, a profile
  mismatch and any evidence that is inadequate all deny.
- A `compatible` bit means one thing: on the pinned engine (`libsidplayfp-wasm` 1.0.1,
  SIDLite), configured exactly as the **consumer profile** below, a fresh playback with that
  ROM set produced the same PCM and the same cycle-timed SID writes as the full-ROM
  reference for the whole documented duration plus a 5 s margin. It is not a statement about
  other engines, sample rates, power-on delays or ROM images, about looping, or about
  musical correctness. A full-ROM render is an operational reference, not an artistic or
  historical fidelity certificate.
- Evidence has two stages. A fast native renderer built from the engine's own source
  **screens**: it can deny and it nominates candidates. Only the **shipping engine** (the WASM
  package, run under the consumer profile) can **grant**. `scripts/rom-audit/confirm.ts`
  replays every nominated candidate against the reference in lockstep through the whole
  horizon and records the outcome.
- The full-corpus census is not finished. The maintained dataset
  (`doc/research/hvsc-rom-catalogue/v3/`) contains every subtune; unmeasured experiments are
  `unknown`. Its manifest is authoritative for coverage counts. The older methodology 2
  snapshot (`catalogue/v2/`) is superseded and must not be used for decisions.
- Expansion beyond 5% of HVSC (4,393 subtunes **and** 3,057 files, whichever is reached
  first) is gated by a hardening certificate produced by `scripts/rom-audit/harden.ts`; see
  [Rollout gate](#rollout-gate). The architect review is in
  [hvsc-rom-adversarial-review.md](hvsc-rom-adversarial-review.md).

## Consumer profile

The profile is `ROM_CONSUMER_PROFILE` in `packages/sidflow-common/src/rom-eligibility.ts`
and is hashed, with the engine's source and WASM hashes, into the engine id.

| Setting | Value | Why it is part of the contract |
|---|---|---|
| Engine | SIDLite in `libsidplayfp-wasm` 1.0.1 (libsidplayfp 3.0.2) | Other engines or versions are different machines. |
| Sample rate | 48,000 Hz, stereo | C64 Commander's local player requests 48 kHz (`localSidEngine.ts`, `DEFAULT_SAMPLE_RATE`). SIDLite refreshes the OSC3 register once per output sample, so a program that reads `$D41B`/`$D41C` follows a rate-dependent CPU path. |
| Power-on delay | 5000 (fixed) | The library default is a random delay seeded from the clock. A random delay changes the CIA/VIC phase at start; evidence for one phase does not cover another. |
| Models | SID/C64 model from the header | Forcing a model changes behaviour. |
| Subtune selection | start-song header rewrite before load | Same mechanism for reference and variants. |
| Absent KERNAL | `null` (engine interrupt shim) | Deterministic upstream fallback. |
| Absent BASIC / CHARGEN | explicit zero banks (8,192 / 4,096 bytes) | Passing `null` leaves an uninitialised member array in place. |

**Commander does not currently pin the power-on delay**, and it must do so before any
`compatible` decision can describe its playback; otherwise its lookup is built from a profile
that differs from the one used for the evidence, and the profile check below denies every
query. This repository does not modify Commander.

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

| Concept | Representation |
|---|---|
| Declared requirement | SID header incl. the RSID BASIC flag (PSID's same bit means something else). No separate KERNAL/CHARGEN declaration exists. |
| Actual access | Per-experiment CPU reads of mapped KERNAL/BASIC/CHARGEN, incl. instruction fetches; reads are not proof of musical dependence. |
| Feedback reads | CPU reads of SID registers `$19–$1C` (`sidReadbackReads`). Non-zero means the program's CPU path depends on sampled oscillator/envelope state and therefore on the sample rate; such rows are why allow evidence is produced at the profile rate. |
| Execution failure | `errorKind` `cpu-halt` (illegal opcode) is the only error that is evidence about a tune. `resource` and `engine` errors are infrastructure and can never produce `incompatible`. |
| SID output | Exact timed writes `[chip, register, value, PHI1 cycle]`, counts, startup offset, drift, first divergence, trace hash and truncation flag (cap 2,000,000 events). |
| Audio output | Sample-by-sample equality, first differing sample, difference and AC RMS. |
| Observed compatibility | Exact PCM and exact timed-write equality through the horizon on the shipping engine. |
| Unresolved | Unrun, under-observed, unconfirmed, unstable, trace-truncated, unexplained divergence, unknown lengths. |

Without the KERNAL the engine runs its own interrupt shim, which shifts every SID write by
a few cycles. Cycle-exact equality therefore does not hold for masks without KERNAL, whatever
the program does; those masks are `unknown`. This is measured behaviour (see the decision
regression below), not a shortcut.

`exactWrites` tolerates no count, order, startup or timing difference. Perceptual
comparison, aggregate RMS thresholds, loop-state proofs and instruction-level CPU traces are
not used to grant eligibility.

## Observation policy

`Songlengths.md5` is joined by verified complete-file MD5 and path, keeping each subtune's
token by position (the convenience parser drops invalid tokens and would shift later songs).
For a valid positive duration the horizon is `max(--seconds, documented + 5 s)`, in integer
milliseconds. Invalid or missing lengths use a 300 s exploratory horizon and stay `unknown`.
Horizons above 3,600 s are never clamped; they stay pending. Durations are playback metadata,
not control-flow bounds: they do not prove loop recurrence, interactive paths or endings.

## Pipeline

```
select-pilot.ts / full  ->  audit.ts (native, 8 masks + repeat)  ->  confirm.ts (shipping engine)
                                    |                                       |
                              execution.jsonl                        confirmation.jsonl
                                              \                       /
                                               publish.ts --production  ->  catalogue/v3/
```

1. **Native screening** (`audit.ts`, `render.cpp`). Built from the exact source in the locked
   package by `build-native.sh` (stamp over inputs, toolchain and flags; output hash recorded
   and re-verified; fresh tree per stamp). Per subtune: full-ROM reference, a repeat, and
   seven removals; only reference plus one variant are in memory. Jobs travel as
   checksum-verified immutable hex payloads, workers run private read-only copies of the
   hashed binary and ROMs. Native rows are fsynced; a torn tail is preserved and requeued.
   Native `compatible`/`incompatible` are **candidates**.
2. **Shipping-engine confirmation** (`confirm.ts`). For each candidate mask the WASM engine
   runs the reference and the variant from fresh modules at 48 kHz with the profile's
   power-on delay. The pulls of 256 scheduler events differ in size between runs with
   identical output, so streams are compared by absolute sample and write index. A candidate
   `compatible` needs `identical` through the horizon; a candidate `incompatible` needs the
   variant to halt on an illegal opcode while the reference continues. Results are bound to
   the exact native rows by SHA-256; a re-measured row invalidates its confirmation.
3. **Publication** (`publish.ts --production`) emits the research JSONL (every subtune, eight
   experiments, native measurement, shipping-engine result, assessment), the deny list and a
   manifest, then re-checks every decision through the production lookup.

Decisions: `assess()` returns `compatible`/`incompatible` only for a native candidate that the
shipping engine reproduced; a disagreement is `unknown` with reason
`shipping-engine-disagrees-with-native-screen`. Deny decisions need no confirmation.

## Rollout gate

- `audit.ts` pilot runs require `--selection` (a pilot without one takes the shortest tunes
  first and says nothing about long horizons). `select-pilot.ts` builds the reproducible
  stratified selection.
- Every dispatch is preceded by a durable reservation in the corpus ledger
  `workspace/rom-audit-ledger-<corpus>.jsonl`: keyed by file content SHA-256 and subtune,
  appended and fsynced before the job is sent, with a per-record checksum. A different
  `--out` directory or a copy of a file elsewhere does not obtain a new allowance. The ledger
  imports prior audit runs and the 300-file integration subset; `verify-native.ts` and
  `native-regression.ts` reserve their real-HVSC controls too. Re-rendering a counted
  identity is free; a reservation is never removed, so the count can only over-estimate.
  A torn final record (never acknowledged, so never dispatched) is preserved and ignored;
  interior damage or a failed checksum refuses to run.
- A kernel `flock` scope lock (released by the kernel even on `SIGKILL`) serialises audit
  parents per corpus and is taken before any shared build output is touched.
- `--rollout full` needs `--hardening <certificate.json>`: `validateHardening` checks its
  structure against the recomputed source identity and native hash, and
  `verifyHardeningEvidence` re-hashes every cited log and the architect approval.
  `harden.ts` writes the certificate only after all of its steps ran on one source identity
  (see its header comment); a handwritten certificate fails evidence verification.

## Test strategy

- `native-regression.ts`: PAL/NTSC, an RSID busy loop, the real Justincase overflow input,
  delayed dependencies, dependencies first read at ~70 s in a non-default subtune (invisible
  at 65 s and 69 s, detected at 75 s), and the native input protocol (path/payload
  equivalence, a deleted label path, malformed and trailing fields rejected).
- `decision-regression.ts`: synthetic programs through screening, shipping-engine
  confirmation, `assess()`, the deny tuple and the lookup deadline, on both the release and the
  ASan+UBSan binaries, which must produce a byte-identical digest. Classes: per-ROM and
  combined dependencies read at 70 s observed at 80 s and beyond a 65 s horizon, a trigger
  inside (63 s) and just after (66 s) the 5 s margin, combined-only and exactly-one (no
  inference across masks), silent divergence (PCM equal, writes differ), sparse effects,
  pure silence, a CPU halt that depends on BASIC, trace overflow, an OSC3 reader (flagged by
  the readback counter), and a dependency on a second or third SID.
- `verify-native.ts`: exact native/WASM PCM and timed-write comparison on controls. It is a
  consistency check that stops the census on any mismatch; it no longer grants decisions.
- Unit tests: `rom-eligibility.test.ts`, `rom-audit.test.ts`, `rom-audit-adversarial.test.ts`,
  `rom-audit-ledger.test.ts`.

## Publication and C64 Commander contract

`deny-list.json` (`sidflow-rom-deny-3`) maps complete-file SHA-256 to one tuple per subtune
`[compatibleMaskBits, incompatibleMaskBits, maxPlaybackMs, documentedMs]` (bit M describes
ROM mask M; KERNAL=1, BASIC=2, CHARGEN=4). `manifest.json` records the profile, engine,
screening protocol, ROM and document hashes, counts per mask with reasons, coverage and the
SHA-256 of each artifact and of `confirm.ts`. No SID, ROM or PCM is distributed.

```ts
const lookup = createRomEligibilityLookup(denyList, {
  sourceSha256, wasmSha256,              // of the engine you actually run
  profile: ROM_CONSUMER_PROFILE,         // your actual configuration; any difference denies
  methodology: "rom-audit-3",
});
const answer = lookup(fileSha256, oneBasedSong,
  { kernal: kernalSha256OrNull, basic: basicSha256OrNull, chargen: chargenSha256OrNull }, elapsedSeconds);
// answer.eligible, answer.state, answer.reason, answer.maxPlaybackSeconds, answer.documentedSeconds
```

Consumer obligations:

1. Verify the artifact checksums against a trusted manifest before loading.
2. Pass the SHA-256 of each present ROM and `null` for an absent one. Any present image other
   than the reference ROMs denies (JiffyDOS and other revisions are different machines).
3. Pass absent BASIC and CHARGEN to the engine as zero banks and absent KERNAL as `null`.
4. Start every eligible playback from a new player and reset with that ROM set. ROM changes
   apply between executions, never during one.
5. Elapsed time is emulated time since reset. Stop at `maxPlaybackSeconds`; the lookup denies
   at and after the deadline. Seeking is emulated fast-forward. Repetition is allowed only as
   a fresh restart, which reproduces the audited prefix; never continue past the deadline.
   `documentedSeconds` is the musical duration; the remainder up to the deadline is margin.
6. Filter individual subtunes, not whole multi-song files. Re-evaluate cached eligibility
   when the ROM set changes, keeping content identities so denied entries can be restored.

No Commander code has been changed. Items 3 and the power-on delay (see the profile table)
require Commander configuration changes before its playback matches the evidence.

## Known limitations

- Finite equality is not perpetual independence; loops, interactive input and endings beyond
  the horizon are unproven.
- The trace cap (2,000,000 events) leaves very write-dense tunes permanently `unknown`.
- PCM is buffered by the native renderer (a 3,600 s render pair is a few hundred MB per
  worker); the shipping-engine confirmation is streaming.
- Full instruction traces, CPU state snapshots and sustained-activity analysis are not
  implemented.
- CHARGEN instrumentation describes mapped CPU access; the pinned VIC does not fetch
  character graphics through that bank.
- The native binary is built with `-ffp-contract=off` but is a different compilation of the
  engine from the WASM build. That is why it cannot grant decisions.
- Full-corpus execution takes days. The census resumes from its checkpoints; see the
  maintained manifest for exact outstanding counts.

## Authoritative references

- [HVSC SID format specification](https://www.hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt),
  with the exact release document hashes in the manifest.
- [HVSC download/documentation page](https://www.hvsc.c64.org/downloads) and release
  `DOCUMENTS/Songlengths.faq`, `HVSC.txt`, `STIL.txt` and `BUGlist.txt`.
- [libsidplayfp ROM API](https://libsidplayfp.github.io/libsidplayfp/html/classsidplayfp.html)
  and the package's complete-source archive: `src/c64/mmu.cpp`,
  `src/c64/Banks/SystemROMBanks.h`, `src/player.cpp`, `src/psiddrv.cpp` and the SIDLite
  builder. The pinned implementations define the tested fallback and memory mapping.

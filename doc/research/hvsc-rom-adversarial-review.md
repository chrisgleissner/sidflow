# HVSC ROM audit: adversarial architecture review (methodology 3)

- Reviewer role: architect / adversarial reviewer, model Opus 5.5 (`claude-opus-5-5`), as required by
  `doc/hvsc-rom-audit-handover.md`.
- Date: 2026-10-23.
- Scope: the uncommitted working tree on `main` (HEAD `a605279`). Other agents edited files while this
  review ran. File:line references are to the working tree as of 09:44 BST.
- Method: independent reading of `scripts/rom-audit/{audit,methodology,checkpoint,inputs,rollout,
  publish-production,publish,verify-native,native-regression,fixtures,analysis}.ts`, `render.cpp`,
  `apply-*-hook.py`, `build-native.sh`, `packages/sidflow-common/src/rom-eligibility.ts` and the
  `rom-*` tests. The pinned libsidplayfp 3.0.2 sources in
  `workspace/rom-audit-native/libsidplayfp-wasm-1.0.1-complete-source/` were also read. No audit, render,
  build or test was run. The only commands run were a strict `tsc` check of `scripts/rom-audit/*.ts`, which
  passes, and a read-only byte scan of the HVSC files.

## Summary

The core comparison rule in `assess()` is sound for the case it actually measures. It allows a
(subtune, mask) pair only when all of the following hold:

- The reference render was repeated, and both reference renders are clean and identical.
- The variant has exactly the same timed SID-write trace as the reference: chip, register, value and
  PHI1 cycle, with no truncation.
- The variant's PCM matches the reference sample for sample.
- The comparison window reaches the documented Songlengths duration plus 5 s.
- A parity certificate exists for that exact case.

I found no path by which a malformed checkpoint row produces `compatible`. `validateMatrix()` and
`assess()` reject every contradictory or partial structure I constructed.

However, the evidence is collected under one engine configuration: SIDLite at 8 kHz with a fixed
power-on delay, explicit zero banks and reference ROM images. Neither the production lookup nor the
consumer contract requires a consumer to run under the same configuration. SIDLite updates the OSC3
register at the output sample rate, so the CPU path of any tune that reads `$D41B`/`$D41C` depends on
the consumer's sample rate. The decisive weakness is therefore what a `compatible` bit means at the
consumer, not the comparison rule itself.

The 5% rollout gate can be bypassed by choosing an `--out` directory outside `workspace/`. The gate also
does not count control renders or durably reserve identities before dispatch. The hardening certificate
is a boolean predicate that can be written by hand.

Verdict: **do not expand beyond 5%**. The pilot may continue only after findings B1 and H3 are fixed and
the pilot selection follows the curated plan in Architect decision 8.

Blocker and high findings:

| ID | Severity | Topic |
|---|---|---|
| B1 | BLOCKER | 5% ceiling is scoped to `workspace/*`, keyed by path, and not reserved before dispatch |
| B2 | BLOCKER (publication) | `compatible` does not transfer to consumer sample rate or power-on delay; OSC3/ENV3 feedback |
| B3 | BLOCKER (>5%) | Hardening certificate is a hand-writable boolean predicate; `harden.ts` is missing; source identity is incomplete |
| H1 | HIGH | Any renderer error, including `std::bad_alloc`, is published as `incompatible` |
| H2 | HIGH | Lookup trusts a caller-supplied ROM mask: no ROM identity, no zero-bank requirement |
| H3 | HIGH | `scopeLock` stale-lock race, unconditional unlink, build before lock, not used by other renderers |
| H4 | HIGH | Native freshness: stamp does not bind the output binary; incremental rebuild over an old tree; verify-native does not snapshot inputs |
| H5 | HIGH | Pilot queue is shortest-first, so the pilot is unrepresentative (v2 pilot median horizon 10 s; corpus median 98 s) |
| H6 | HIGH | `parity.json` is an unauthenticated file whose validity is field equality |

Handover item 1 (TypeScript) is resolved: the strict check exits 0. In the reviewed TypeScript, every
`catch` block either rethrows/rejects or logs. The C++ `render()` catch logs to stderr and records the
error. I found no violation of the repository's catch rule.

## Findings

### B1 — BLOCKER: the 5% ceiling is not corpus-scoped, not content-keyed and not durable

Location: `rollout.ts:62-80` (`pilotHistory`), `rollout.ts:27-39` (`pilotQueue`), `audit.ts:198`,
`verify-native.ts:19-33,42`, `native-regression.ts`.

The previous history is collected only from `workspace/<dir>/execution.jsonl` files whose
`manifest.json` has the same `corpusSha256`. This creates five gaps:

1. **Bypass through `--out`.** A run with `--out /tmp/a` renders up to 4,393 new subtunes. A second
   run with `--out /tmp/b` cannot see `/tmp/a` and is allowed another 4,393. The same happens for any
   output directory nested deeper than one level below `workspace/`.
2. **Control renders are not counted.** Renders by `verify-native.ts` (built-in HVSC cases plus an
   arbitrary `extra-cases.json`), `native-regression.ts` (Justincase) and the real-HVSC integration test
   are not recorded anywhere the gate reads.
3. **Identity is the path, not the content.** `verify-native.ts` accepts any file path. A copy of an
   HVSC file under `/tmp` is a distinct identity to a path-keyed gate.
4. **No reservation before dispatch.** Identities are recorded only when a finished row is appended.
   A crash, timeout or `SIGKILL` after the worker received the job and before the append leaves a
   rendered identity uncounted. The torn-tail lines that `pilotHistory` skips (`rollout.ts:70`) are also
   uncounted.
5. **No serialisation for non-audit renderers.** Only `audit.ts` takes the scope lock.

Failure scenario: two operators, or two agent sessions, each run a "pilot" with a different `--out`.
Both pass the gate, and the user's release condition is violated without any error.

Required fix: the corpus-scoped reservation ledger specified in Architect decision 4. It must be keyed
by content SHA-256 and subtune, appended and fsynced before dispatch, and used by every HVSC renderer.

### B2 — BLOCKER for production publication: the `compatible` evidence does not transfer to the consumer's engine configuration

Location: `methodology.ts:4-8` (`AUDIT_PROTOCOL`), `publish-production.ts:51` (`engineId`),
`rom-eligibility.ts:131-159`. Engine sources: `builders/sidlite-builder/sidlite/SID.cpp` (the
`generateSample` loop and `read()`), `sidlite/WavGen.cpp:374-375`, `sidlite-emu.cpp:68-85`,
`sidplayfp/SidConfig.h:89`.

The audit proves equality only under its own protocol: 8,000 Hz, `powerOnDelay` 5000, SIDLite,
explicit zero banks for absent BASIC and CHARGEN, and engine defaults for everything else. Two
properties of the pinned engine prevent this result from transferring to a consumer that uses
different settings:

1. **SID read feedback depends on the sample rate.** `SIDLiteEmu::read()` clocks the SID to the current
   cycle. Inside `SID::clock()`, however, only the ADSR is clocked per cycle. The waveform generator,
   which updates the value read back from OSC3 (`oscReg`, `WavGen.cpp:375`), runs once per output sample
   ("Samplerate-based part of emulations"). The noise LFSR and phase stepping are also updated per
   sample. A tune that reads `$D41B` or `$D41C` (for random numbers, drums, or as the source comment
   says, "even for timing") therefore follows a CPU path that depends on the output sample rate. A
   consumer at 44.1 kHz or 48 kHz executes a CPU path that was never compared under masked ROMs.

   A static scan of HVSC 85 for absolute-addressed reads of `$D41B`/`$D41C` found **847 files / 2,489
   subtunes**. This is a lower bound: indexed reads such as `LDA $D400,X` and relocated SID bases are not
   matched, and some matches may be data rather than code. The same feedback applies to a forced SID
   model and to reSIDfp.

2. **Power-on delay and the other machine settings change the CPU path.** The library default
   `DEFAULT_POWER_ON_DELAY = MAX_POWER_ON_DELAY + 1` selects a random delay. A consumer that keeps the
   default executes from a different CIA/VIC phase than the audit. Forcing the C64 model, the CIA model
   or the SID model has the same effect.

`engineId` hashes the protocol constants, but the lookup only checks that the caller passes the same
string. Nothing checks the consumer's actual configuration.

Failure scenario: Commander plays at 48 kHz with the default random power-on delay and no BASIC ROM. A
tune reads OSC3 to choose a branch that calls into `$A000`. At 8 kHz the branch never occurs within the
horizon, so the tune is published as `compatible` for mask 5. At 48 kHz the branch occurs, and the tune
executes zeros.

Required fix: Architect decisions 2 and 3. Allow evidence must be produced under a declared consumer
profile. The lookup must verify the caller's actual profile. A native counter for SID-register reads
must be added so that the research catalogue can identify feedback-dependent tunes.

### B3 — BLOCKER for expansion beyond 5%: the hardening certificate can be forged and can go stale

Location: `rollout.ts:7-26`.

`validateHardening` checks string equality and booleans only: `passed:true`, `exactParity:true`,
`adversarialReview:true`, and run counts of at least 3. Anyone, including an agent, can call
`hardeningIdentity()` and write a passing certificate without any evidence. Further problems:

- `harden.ts` does not exist. `hardeningIdentity()` therefore throws ENOENT. This currently fails
  closed, but only by accident.
- `HARDENING_SOURCES` omits files that affect decisions or provenance: `publish.ts`,
  `native-regression.ts`, `packages/sidflow-common/src/json.ts` (deterministic serialisation),
  `sid-header-conformance.ts`, `system-roms-fetch.ts` (reference ROM hashes),
  `packages/sidflow-common/src/index.ts`, `test/rom-audit-fixtures.ts`, `bun.lock`, and
  `packages/sidflow-classify/package.json` (which pins `libsidplayfp-wasm`). It also omits the WASM
  engine files themselves.
- The certificate does not bind the ASAN binary, the WASM or source tarball hashes, the ROM hashes, the
  corpus, the parity report, the suite logs or the review approval.
- `nativeSha256` binds the binary bytes but not the sources the binary was built from (see H4).

Required fix: Architect decision 7.

### H1 — HIGH: resource and engine-anomaly errors are published as `incompatible`

Location: `methodology.ts:60`; `render.cpp:86-129` (`catch (const std::exception&)` records any
exception), `render.cpp:113-121`.

Any non-empty `m.error` becomes `incompatible / execution-failure` once the reference is valid and
parity is satisfied. The only error that represents a property of the tune is a CPU halt:
`Player::play` returns -1 with the `haltInstruction` message (`player.cpp:273-276`). The following
errors are infrastructure or engine anomalies, but are treated the same way:

- `std::bad_alloc` or `std::length_error` from `pcm.reserve` or trace growth on long horizons under
  memory pressure.
- `"64 consecutive empty renders"`.
- `"mixer returned no samples"`.
- A negative return from `play()` other than a halt.

Because checkpoint rows are immutable and are reused on resume, one memory-pressure event becomes a
permanent research result. Separately, `m.samples !== ref.samples` with an empty error cannot occur with
the current renderer, but it is classified as `incompatible` rather than as invalid evidence.

Required fix: emit an `errorKind` from the renderer. `cpu-halt` is the only kind that may produce
`incompatible`. Load or reset failures that occur only in the variant must be reviewed explicitly before
they are given any meaning. Every other kind must make `assess()` return `unknown`, and the parent must
abort the run instead of checkpointing the row. Add a fixture that halts only without KERNAL, and a
fault-injection test (for example an environment-controlled allocation failure in a test build) that
must produce `unknown` or an abort, never `incompatible`.

### H2 — HIGH: the lookup trusts a caller-supplied mask and does not express the bank normalisation

Location: `rom-eligibility.ts:133,149-153`; `SystemROMBanks.h:58` (`uint8_t rom[N];` is not
initialised); `render.cpp:240,266,272-273`.

A bit in the mask means "this slot contains the byte-identical reference image". A consumer with a
JiffyDOS KERNAL, a different KERNAL revision or a patched BASIC would still set the bit and receive
`compatible`. "Absent" in the audit means:

- KERNAL: `nullptr`. Upstream then fills the bank with NOPs plus a minimal shim, which is deterministic.
- BASIC: an explicit 8,192-byte zero bank.
- CHARGEN: an explicit 4,096-byte zero bank.

A consumer that passes `null` for BASIC or CHARGEN leaves an uninitialised member array in place. In a
reused WASM heap its contents are not defined.

Required fix: change the API to accept the SHA-256 of each present ROM, or the bytes, and derive the
mask inside the library. Any present slot whose hash is not the reference hash must deny. Document, and
add a regression test for, the requirement that absent BASIC and CHARGEN are passed as zero banks. The
bank normalisation must be part of the consumer profile (decision 3).

### H3 — HIGH: `scopeLock` has stale-lock, ownership and coverage defects

Location: `rollout.ts:44-58`; `audit.ts:148` versus `audit.ts:156`.

1. **Stale-recovery race.** Processes A and B both read the same dead PID and both `unlinkSync`. A then
   links its new lock. If B's unlink runs after A's link, B removes A's live lock and links its own.
   Both processes now hold the scope.
2. **No ownership check on release.** The `exit` handler unlinks the path unconditionally. After
   situation 1, it deletes the other holder's lock. If the file is already missing, it throws during
   exit.
3. **PID reuse and namespaces.** A reused PID makes a stale lock look live; this fails closed. A
   process in another PID namespace (a container or a separate sandbox) returns ESRCH while it is still
   alive; this fails open.
4. **Lifetime.** `SIGINT` and `SIGTERM` do not run `exit` handlers, so the lock always goes stale on a
   signal. Recovery then depends on race 1.
5. **Build before lock.** `freshNativeRenderer()` runs `build-native.sh` in the shared cache directory
   before the lock is taken. Two concurrent launches can build in the same directory.
6. **Coverage.** `verify-native.ts`, `native-regression.ts` and `harden.ts` do not take the lock.

Required fix: use a kernel advisory lock, which the kernel releases when the process dies, so there is
no stale state. Call `flock(fd, LOCK_EX|LOCK_NB)` through `bun:ffi` on
`workspace/rom-audit-scope-<corpus>.lock`, which avoids a new dependency. Alternatively, have a
`scripts/rom-audit/with-scope-lock.sh` wrapper use util-linux `flock` and export the locked file
descriptor. The audit then verifies that the descriptor is held. Write the owner's PID, start time
(`/proc/<pid>/stat` field 22), host and run id into the file for diagnostics only. Take the lock before
building, and have every HVSC renderer take it.

### H4 — HIGH: native binary freshness and input snapshots are only partly enforced

Location: `build-native.sh:99-126`, `inputs.ts:51-59`, `verify-native.ts:36-43`, `audit.ts:141-148,201-203`.

What is correct: `audit.ts` reads the ROMs, rejects any ROM whose hash differs from `SYSTEM_ROMS`,
hashes the native bytes, and executes private read-only copies of exactly those bytes from a
`mkdtemp` directory. This closes the time-of-check/time-of-use gap between hashing and worker launch for
the audit itself.

What is missing:

- **The stamp does not bind the output.** The stamp is computed from the input files only. Replacing
  `workspace/rom-audit-native/render`, for example with `renderer-original`, does not invalidate it.
  `freshNativeRenderer()` then returns the foreign binary, and the manifest records its hash as if it
  were current.
- **The stamp omits toolchain and options.** `g++ --version`, `ROM_AUDIT_JOBS` and the configure output
  are not included.
- **Incremental build over an old tree.** `tar -xf` extracts over a tree that still contains object
  files. Files restored by tar keep the archive's (old) mtimes, so `make` may keep stale objects when
  the archive changes.
- **`verify-native` does not snapshot inputs.** It executes the build-path binary directly, reads the
  ROMs in TypeScript and again in the native process (two independent reads), and does not compare them
  with `SYSTEM_ROMS`. Its before/after asset hashing detects most changes, but not a change that is
  reverted within the window.

Required fix:

- Build into a fresh directory named by the input stamp.
- Record `{inputs, toolchain, flags, outputSha256}` in the stamp.
- Have `freshNativeRenderer()` return both the path and the verified bytes. Callers must execute only a
  private copy of those bytes.
- Apply the same ROM snapshot and `SYSTEM_ROMS` check in `verify-native.ts` and `native-regression.ts`.
- Add UBSan to the sanitizer build: `-fsanitize=address,undefined -fno-sanitize-recover=undefined`.

### H5 — HIGH: the default pilot ordering selects the shortest tunes

Location: `audit.ts:197-198`.

`runnable` is sorted by ascending horizon before `pilotQueue` applies the ceiling. A pilot without
`--selection` therefore takes the roughly 4,393 shortest subtunes. The existing v2 checkpoint shows the
effect: its median observed duration is 10 s and its maximum is 559 s, while the corpus median horizon
is 98 s, the 90th percentile is 238 s and the maximum is 2,031 s.

Such a pilot cannot exercise long horizons, delayed dependencies, memory bounds or trace truncation,
which is exactly what hardening needs to test.

Required fix: when `--rollout pilot` is used, refuse to run without `--selection`. The selection file
must be the reviewed, seeded selection described in Architect decision 8, and its hash must be recorded
in the ledger.

### H6 — HIGH: `parity.json` is unauthenticated and records no protocol

Location: `publish-production.ts:47-50,66-68`; `verify-native.ts:92-94`.

Publication accepts any `run/parity.json` whose schema, comparison string, native, source and WASM
hashes, and ROM hashes equal the manifest. The case hashes it binds (`measurementSha256`,
`referenceSha256`) are SHA-256 values of rows that are already in the checkpoint, so they can be
computed by anyone. The certificate does not record the `verify-native` source identity, the WASM
configuration calls, or whether every case in the run passed. Today, only passing runs write a
certificate.

Required fix: under decision 2, `parity.json` is no longer a qualification input for allow decisions.
Its replacement, the WASM confirmation log, must be produced only by a confirmation tool whose source
hash is part of the hardening identity. Publication must check that hash. The published manifest must
include the confirmation log hash and the number of confirmed cases.

### M1 — MEDIUM: `verify-native` buffers every case's evidence on disk before comparing

Location: `verify-native.ts:42-43,56,88`.

All cases run in one `spawnSync`, with a one-hour total timeout. All PCM and trace files are written
before the first comparison starts. One 2,031 s case produces 8 × 65 MB of PCM plus up to 8 × 64 MB of
trace data. Because `/tmp` is often tmpfs, a long-horizon parity set exhausts RAM or times out.

Required fix: run one case per native invocation, or stream the evidence, and set a per-case timeout
derived from the horizon.

### M2 — MEDIUM: parent memory and whole-file reads at full-corpus scale

Location: `checkpoint.ts:89-97`, `publish-production.ts:29-44`, and the `rows` map in `audit.ts`.

v2 rows average 6,185 bytes, so a complete checkpoint is about 543 MB. It is currently read as one
string, split into lines, and every parsed row is retained. The legacy aliases (`neither`, `kernal`,
`basic`) duplicate three of the eight matrix entries in every row, about 27% of the row size.

Required fix: stream lines. In `audit.ts`, retain only the key and seconds of each row. Publish while
streaming.

Per-worker native memory is bounded and acceptable. For the longest horizon, 2,031 s, the reference and
variant PCM take about 130 MB and two traces at the cap take about 100 MB, so roughly 230 MB per
worker and about 1.4 GB for six workers. The pilot must measure the peak RSS of the longest selected
horizons.

### M3 — MEDIUM: checkpoint rows are not bound to a manifest; recovery details

Location: `audit.ts:173-180`, `checkpoint.ts:84-105`.

- An `execution.jsonl` without a `manifest.json` is accepted. A fresh manifest is written next to rows
  that were produced by an unknown binary.
- `.interrupted-tail` is overwritten on each recovery, so earlier tails are lost.
- The parent directory is not fsynced when the checkpoint file is created.
- `readCheckpoint` truncates the file, but nothing establishes that the caller holds the scope lock.

What is correct:

- Torn-tail recovery is sound, because each row is appended in one write and fsynced before the next
  job is sent.
- Interior damage and duplicate rows fail closed.
- On resume, rows are validated with `validateMatrix`, against the job key set and against the expected
  seconds.

Required fix:

- Refuse to use an existing checkpoint when no manifest exists.
- Begin each checkpoint with a header line that carries the manifest SHA-256, and verify it on resume.
- Name tail files by their content hash.
- Fsync the directory when the file is created.
- Assert that the scope lock is held before truncating.

### M4 — MEDIUM: the trace cap makes digi and long tunes permanently `unknown`

Location: `render.cpp:74,79`.

The cap of 2,000,000 writes is reached after about 26 minutes at 1,250 writes per second, and after
seconds for 4-bit `$D418` digi playback. This fails closed, but it is a silent coverage limit.

Required fix: count and report truncation per mask in `publication.counts`. Consider storing the
reference trace compactly to raise the cap without more memory: pack chip, register and value into
4 bytes and store the cycle as a varint delta. The variant can then be compared as it is streamed.

### M5 — MEDIUM: the delayed-dependency regressions do not exercise the production decision path

Location: `native-regression.ts:80-95`.

The late fixtures (dependency triggered at about 70 s, observed at 75 s) assert value-only prefixes
through `matches`. They never pass through `assess()`, `publishProduction()` or the lookup.

Required fix: feed the resulting rows through `assess()` with synthetic horizons, and assert both
`incompatible`/`unknown` for masks missing the dependency and the published `maxPlaybackSeconds`.
Also add the cases listed in decision 8.

### M6 — MEDIUM: process-order independence is assumed

Location: `render.cpp:245-288`.

One worker renders many jobs in sequence in one process. The globals that `render.cpp` owns are reset,
but nothing shows that library static state is independent of the previous tune. The repeat control
runs in the same process, so it cannot detect such a leak.

Required fix: as a pilot control, re-render a seeded random 2% of rows, each in a fresh process, and
require byte-identical rows.

### M7 — MEDIUM: the essentia change affects classification data and is out of scope

Location: `essentia-frame-features.ts:224-233`.

The change keeps individual finite contrast bands instead of discarding frames that contain an extreme
band. This changes the composition of the pooled mean: a tune whose band 6 is always extreme is now
averaged over bands 0–5 only. This is a data-affecting classifier change, and the regenerated
`station-analysis/*` files reflect it.

Required fix: move it to a separate change with its own evidence, measuring the before/after feature
deltas on the integration subset. If kept, aggregate per band rather than pooling.

### M8 — MEDIUM: subtune selection differs between WASM and native

Location: `verify-native.ts:52`.

The WASM side selects the subtune by rewriting the header's `startSong` field. The native side calls
`SidTune::selectSong` on the unmodified bytes. The two are probably equivalent, but this is an
assumption.

Required fix: state the assumption, add a test showing that the two methods give identical traces, and
require the consumer profile to use one of them.

### L1 — LOW: the native protocol parser is lenient

Location: `render.cpp:250-256`.

`std::stoul` and `std::stod` accept leading whitespace and `+`/`-` signs. `stod` accepts `inf`, `nan`
and hexadecimal floats; non-finite values are later rejected. Converting `stoul` to `unsigned` truncates
values above `UINT_MAX`, so `4294967297` becomes song 1. The parent rejects any identity mismatch, so
this cannot be exploited today.

Required fix: reject anything that is not `[1-9][0-9]{0,2}` for the song, or a canonical decimal for
the duration. Echo the payload length and a digest so the parent binds each result to the bytes it sent.

### L2 — LOW: smaller issues

- Publication writes `deny-list.json` and `manifest.json` non-atomically (`publish-production.ts:99,107`).
- The `exit` handler throws if the lock file is already missing (`rollout.ts:57`).
- The hex decoder itself is sound: it checks the prefix and even length, accepts lowercase only, and
  bounds the input to 1 MiB on both sides. An empty payload produces a reference error and therefore
  `unknown`. Trailing fields, uppercase, `\r` and odd lengths abort the worker.

## Answers to the review questions not covered by decisions

**Q1. Correctness model.** The comparison is sound under the audit protocol:

- The `unknown`, `incompatible` and `compatible` states are ordered correctly.
- The horizon is re-derived from the token and cannot be shortened (`methodology.ts:44-48`).
- `exactWrites` is equivalent to cycle-exact trace equality. `firstWriteDivergence === null` is emitted
  only when every cycle matches and the lengths are equal (`render.cpp:206-213`), and `validateMatrix`
  cross-checks the trace hash (`methodology.ts:88`).
- PCM equality is checked sample by sample (`render.cpp:183`).

An unsafe `compatible` can arise only outside the measured configuration (B2, H2) or through a forged
parity file (H6). Wrongly `incompatible` results arise from H1.

**Q5. Immutable inputs.** The C++ decoder is sound (L2). SID payloads are verified against the census
hash immediately before sending (`inputs.ts:61-65`). Path/payload equivalence, a deleted label path and
malformed records are covered by `native-regression.ts:96-113`. The audit snapshots its ROMs and binary.
The remaining gaps are listed in H4.

**Q6. Checkpoints.** Covered in M3: recovery is correct; the manifest binding and tail preservation are
missing.

## Architect decisions

### Decision 2 — Qualification model: per-case evidence on the production engine; native results only screen

I reject extending native results to WASM by an engine-level argument plus sampled controls.

The native and WASM builds differ in:

- compiler (g++ versus emscripten/clang);
- target word sizes (`long` and `size_t` are 64-bit natively and 32-bit in wasm32);
- optimisation level (`-O3` for production, `-O1` for ASAN);
- instrumentation (the read counters exist only in the native build).

Equality of the two engines is therefore a hypothesis. A sample with zero mismatches gives a statistical
bound, not per-decision evidence. The strict policy ("inadequate evidence must fail closed") does not
allow that bound to grant `compatible`.

The exact-case model is kept, but the evidence is moved onto the engine that ships. The WASM package
already exposes exact timed write traces (`setSidWriteTraceEnabled`, `getAndClearSidWriteTracesPacked`,
`getDroppedSidWriteTraceCount`), so this is now practical:

1. **Native census = screen and research evidence.** The native census can produce `incompatible`
   (after H1), `unknown`, or *candidate* compatible. On its own it can never produce an allow bit.
   Deny decisions need no WASM confirmation, because denying is always safe.
2. **WASM confirmation = allow evidence.** For each native candidate (subtune, mask), run the pinned
   WASM under the declared consumer profile (decision 3) for mask 7 and mask m, from fresh modules,
   through the horizon. Require all of the following:
   - zero dropped trace events;
   - an identical timed write sequence (chip, register, value, cycle);
   - identical PCM at the profile's sample rate;
   - a clean mask-7 reference.

   Compute the WASM mask-7 render once per subtune. For masks 0–6 the cost is at most 1 + k renders on
   the WASM engine per subtune, where k is the number of candidate masks.
3. **Native/WASM parity becomes a consistency control.** Run it on a seeded stratified sample: every
   mask, every failure class, PSID, RSID, BASIC, 2SID and 3SID, OSC3 readers, and long horizons. Any
   mismatch stops the census and must be investigated. Parity no longer grants decisions, which removes
   H6 as a qualification risk.
4. **The cost is accepted and measured.** Measure WASM throughput in the pilot. If full WASM
   confirmation does not finish, the unconfirmed candidates stay `unknown` and are reported with exact
   counts. Remaining `unknown` is an acceptable result; a loosened rule is not.

Proof obligations if an engine-level model is proposed again later:

- identical source apart from passive hooks, proven by a diff of the patched trees;
- an audit of compiler flags: no `-ffast-math`, no `-march=native`, `-ffp-contract=off` on both
  targets;
- a type-width audit of the CPU, MMU, VIC, CIA and SIDLite code for 32/64-bit dependent arithmetic;
- ASAN and UBSan clean over the pilot;
- at least 3,000 stratified exact cases with zero mismatches, including failure parity;
- explicit user approval of a statistical rather than per-case claim.

### Decision 3 — Finite-window semantics: approved only with an enforced consumer profile

The deadline lookup expresses complete-documented-composition eligibility correctly. The horizon is the
Songlengths duration plus 5 s, rejected at or after `maxPlaybackMs`, with unknown lengths always denied.
This is correct only if the consumer executes the same machine the evidence describes. A finite result
never authorises indefinite looping.

Consumer obligations, which must be stated in the API and in `hvsc-rom-production.md`:

1. **Profile.** The engine (`libsidplayfp-wasm` 1.0.1, SIDLite), sample rate, `powerOnDelay` 5000,
   unforced C64, SID and CIA models (from the header), the subtune-selection mechanism, and the
   absent-bank normalisation (KERNAL `null`; BASIC and CHARGEN as zero banks). The profile is hashed
   into `engineId`.

   The lookup must accept the consumer's *actual* profile object and recompute the hash, instead of
   comparing caller-supplied strings. Determine the sample rate from Commander's source by reading it,
   without modifying Commander. Publish one deny list per supported profile. Rate-independence may be
   claimed only for rows whose SID-register read counter (new, from B2) is zero in both executions, and
   only as a research annotation until it is confirmed under the second profile.
2. **ROM identity.** The consumer passes hashes of the present ROMs (H2). A non-reference ROM denies.
3. **Fresh execution.** Each eligible playback starts from a new player and reset with the chosen ROM
   set. A ROM-mask change applies only between executions, never during one.
4. **Elapsed time.** Elapsed time is emulated C64 time since the post-reset start. Pause does not count.
   Seek means emulated fast-forward. The consumer schedules a hard stop at `maxPlaybackSeconds`, and
   should schedule the musical end and fade at the documented duration.
5. **Looping.** Repetition is allowed only as a fresh restart, which deterministically reproduces the
   audited prefix. Continuing past the deadline is not allowed.
6. **Lookup output.** The lookup must also return `documentedSeconds`, so consumers do not treat the
   5 s margin as music.

### Decision 4 — Durable rollout accounting: a corpus-scoped write-ahead reservation ledger

File: `workspace/rom-audit-ledger/<corpusSha256>.jsonl`. It is independent of `--out` and is written
only while the scope lock (H3) is held.

Record format: one deterministic JSON line per record, in this form:

```json
{"v":1,"seq":N,"run":"<uuid>","kind":"audit|wasm-confirm|parity|regression|integration|import","sha256":"<file sha256>","song":k,"path":"<relative>","ts":"<iso>","crc":"<first 16 hex of sha256 of the line without crc>"}
```

A batch is written as a single `write()` of several lines.

Rules:

1. **Identity.** The identity is (content SHA-256, song). Map paths to content through the census, so
   copies of HVSC files outside the HVSC root are still counted. The ledger also tracks distinct
   SHA-256 values, which is the file count. Renders of non-HVSC synthetic fixtures are not recorded.
2. **Write-ahead.** In `nextJob`, if the identity is not already in the ledger:
   - check the ceilings (4,393 subtunes and 3,057 files, unless a valid certificate is present);
   - append the reservation;
   - `fsync` the file (and the directory when the file is created);
   - only then write the job to the worker.

   Reservations may be batched (for example 2 × workers) to amortise fsync. A reservation is never
   removed, even if the render is cancelled, so the count can only over-estimate.
3. **Torn-record recovery.** A dispatch happens only after fsync returns. A torn or CRC-failing *final*
   record therefore belongs to a batch that was never dispatched. Drop it, after preserving its bytes in
   `<ledger>.torn.<sha256-of-bytes>`. A CRC failure or parse failure on an *interior* record fails
   closed: refuse to run until an operator tool rebuilds the ledger from all sources, counting
   conservatively.
4. **Historical import.** Run once, idempotently, with records of kind `import` that cite the source
   file's SHA-256:
   - every `workspace/**/execution.jsonl` with a matching corpus;
   - the parseable prefix of any torn tail; an unattributable torn tail counts as one placeholder
     subtune and one placeholder file;
   - `.interrupted-tail` files;
   - `workspace/rom-audit-v3-parity.json` and `workspace/rom-audit-v2/parity*.json`;
   - the built-in `verify-native` cases;
   - Justincase;
   - the deterministic 300-file real-HVSC integration subset (enumerated from its selection code or
     `workspace/hvsc-e2e-subset-cache`);
   - any surviving `/tmp/sidflow-*` run directories.

   The expected union is at least 2,004 subtunes and 663 files. Import must report its exact result
   before any new pilot work starts.
5. **Interaction with existing code.**
   - `pilotHistory` is replaced by `readLedger()`.
   - `pilotQueue` stays a pure planning function. It computes which jobs *could* run against the ledger
     set and keeps the current rule that a re-render of an already-counted identity is free. The
     binding check moves into the reservation step, because `--budget-seconds` and `--limit` mean that
     not every queued job is dispatched.
   - `verify-native`, `native-regression`, WASM confirmation, `harden.ts` and the integration test
     reserve through the same `reserveIdentities(kind, list)` helper, under the same lock.
6. **Concurrent launch.** Writers are serialised by the kernel lock. A second launch fails immediately
   with the holder's diagnostic content. Readers, such as reporting tools, may read without the lock,
   and must ignore a torn final line without truncating anything.

### Decision 7 — `harden.ts`: a reproducible validator whose certificate binds evidence

`harden.ts` runs under the scope lock and refuses to start if the working tree contains untracked files
under `scripts/rom-audit/`. It then performs these steps in order:

1. **Initial source identity S0.** Hash every file under `scripts/rom-audit/`, enumerated rather than
   taken from a fixed list, so that new files cannot be left out. Add:
   - `rom-eligibility.ts`, `index.ts`, `json.ts`, `sid-header-conformance.ts`, `system-roms-fetch.ts`;
   - all `rom-*` tests and fixtures;
   - `bun.lock` and `packages/sidflow-classify/package.json`;
   - every file in `libsidplayfp-wasm/dist` (all engine WASM files plus the source tarball);
   - the git HEAD.
2. **Clean builds.** Build the production native renderer and an ASAN+UBSan renderer in fresh
   directories. Record the output hashes, `g++ --version` and the flags. Verify that the production
   binary is byte-identical to the one the census will execute.
3. **Regressions.** Run `native-regression.ts` with the sanitizer binary, using
   `halt_on_error=1` for both ASAN and UBSan, and then with the production binary. Require byte-identical
   result JSON from the two binaries for the regression set. A difference indicates behaviour that
   depends on optimisation.
4. **Parity and confirmation.** Run exact native/WASM parity on the required control set and the
   stratified pilot sample, and the WASM confirmation tool on its fixtures. Each step writes a report
   that `harden.ts` re-parses to verify the required case list, the pass status, and the bound hashes.
5. **Tests.** Run the focused and adversarial `rom-*` tests three times, then three consecutive full
   `bun run test` runs. Capture the logs, and parse them to require `0 fail`, 0 unexpected skips, and a
   pass count no lower than the recorded baseline.
6. **Final source identity S1.** Recompute the identity. Require S0 = S1, unchanged binaries and an
   unchanged HEAD. Any difference voids the run.
7. **Certificate.** Emit a certificate containing:
   - S and the per-file hash list;
   - the native, ASAN, WASM, source tarball, ROM and corpus hashes;
   - the SHA-256 and summary line of every evidence log and report;
   - tool versions and timestamps;
   - the SHA-256 of an architect approval file for S. This replaces `adversarialReview:true`: the
     approval file states the S it approves, and approval is invalid for any other S.

`validateHardening` must do more than compare fields:

- recompute S from the files on disk;
- check that every cited evidence file exists, has the cited hash, and parses as passing;
- confirm that `nativeSha256` is the binary the audit is about to execute and is bound to the current
  build stamp.

In addition, `--rollout full` re-runs a live spot check of about one minute at startup: the protocol
regression plus two parity cases. Handwritten logs therefore cannot substitute for a working engine. A
determined local forger cannot be stopped, but this design makes accidental or agent-written
certificates fail.

### Decision 8 — Delayed-dependency fixtures and the real pilot corpus

**Synthetic fixtures.** These are required and must be asserted through `assess()`, publication and the
lookup:

1. Per-ROM (1, 2, 4) and combined (7) triggers at 70 s, observed at 65, 69 and 75 s (these exist
   natively; they need M5). Add a 1,500 s trigger observed at 1,505 s for one ROM, to exercise long
   horizons and memory.
2. A trigger inside the 5 s ending margin (Songlengths 60 s, trigger at 63 s): must not be `compatible`.
   A trigger just after the margin (66 s): must be `compatible` with `maxPlaybackSeconds` 65 and denied
   at 65.
3. **Combined-only:** the output changes only when both KERNAL and BASIC are absent (masks 1, 2 and 3
   equal; mask 0 differs). **Non-monotonic:** the output changes when exactly one of the two is present.
   These guard against any future inference across masks.
4. **Silent divergence:** volume 0, and a ROM byte written to a voice register, so PCM is equal but the
   trace differs. Must be `unknown`.
5. **One-cycle shift:** an identical write sequence whose timing shifts by one cycle through the KERNAL
   IRQ path versus the shim. Must not be `compatible`.
6. **Sparse SFX:** a single write at 50 s. **Pure silence:** no writes at all. Both must be `compatible`
   when they are equal.
7. **Multi-SID:** a 2SID and a 3SID fixture whose dependency affects only the second or third chip.
8. **Non-default subtune** with `startSong` ≠ 1, selected through both the native and the WASM
   selection paths (M8).
9. **OSC3/ENV3 reader:** branches into a ROM read depending on `$D41B`. It must be flagged by the new
   SID-read counter and must show a different decision at 8 kHz than under the consumer profile, or the
   profile rule (decision 3) must keep it `unknown`.
10. **Trace overflow:** more than 2,000,000 writes, so `traceComplete` is false. Must be `unknown`.
11. **CPU halt without KERNAL only:** must be `incompatible`. An injected resource failure must never
    produce `incompatible` (H1).
12. **Unknown or invalid Songlengths tokens:** must be `unknown`. **Incorrect header assumptions:** a
    PSID whose code relies on KERNAL IRQ despite PSID semantics, and an RSID with a misleading BASIC
    flag.

**Real pilot corpus.** The ceilings are 4,393 subtunes and 3,057 files in total. The ledger import must
first establish the counted union (expected at least 2,004 / 663). The pilot then consists of:

- **Free re-renders.** All already-counted identities under methodology 3, including all 1,653 v2
  subtunes. Re-rendering a counted identity does not use any allowance.
- **New identities,** capped at **1,600 subtunes and 900 files.** This leaves at least about 789
  subtunes in reserve for re-runs and missing strata after fixes. Use a seeded stratified selection
  with the seed recorded:
  - all 21 historically BASIC-sensitive files;
  - 80 both-sensitive and 80 KERNAL-sensitive files from the old catalogue;
  - 120 RSID BASIC-flagged files (of 589) and 120 RSID machine-code files (of 3,335), stratified by
    horizon decile;
  - all 27 3SID files and 60 of the 337 2SID files;
  - 60 static OSC3/ENV3 readers;
  - 40 high write-rate (digi) tunes;
  - 15 files with 10 to 20 subtunes, for non-default subtunes;
  - the 40 longest-horizon subtunes (up to 2,031 s);
  - Great Giana Sisters and Justincase;
  - PSIDs drawn uniformly by horizon decile to fill the remainder.

  Cap each file's subtunes so that the subtune ceiling holds. Use full documented horizons.
- **Profile coverage.** Run WASM confirmation on all pilot candidates under the consumer profile.
- **Measurements to record.** Wall time, per-core busy time from `/proc/stat`, peak RSS per worker for
  the longest horizons, trace-truncation counts, and WASM confirmation throughput.

## Approval conditions for expansion beyond 5%

I will approve expansion only when all of the following evidence exists for one source identity S:

1. B1, B2, B3 and H1–H6 are fixed, and each fix has a regression test that fails when the fix is
   reverted. The commit or diff that was reverted to demonstrate the failure must be stated.
2. The ledger has been imported. Its report states the exact counted union, and that union plus all
   pilot work stays at or below 4,393 subtunes and 3,057 files. A test shows that a run with
   `--out /tmp/x` and a `verify-native` extra case are both counted.
3. A two-process launch test shows that only one process holds the kernel lock, and a `SIGKILL` test
   shows that the lock is free immediately afterwards.
4. The consumer profile has been taken from Commander's source and recorded. The deny list has been
   generated for that profile. Lookup tests cover profile mismatch, non-reference ROM hashes, `null`
   versus zero banks, and the deadline.
5. The pilot has run on the decision-8 selection with methodology 3 and rebuilt binaries. The report
   contains, for each mask:
   - the counts of `compatible`, `incompatible` and `unknown`, with `unknown` reasons;
   - the WASM confirmation result for every candidate, with zero unexplained mismatches;
   - stratified parity with zero mismatches;
   - fresh-process re-render equality (M6);
   - the peak RSS and throughput measurements.

   Every mismatch, `incompatible` result and execution error in the pilot is explained individually in
   the review document.
6. All synthetic fixtures in decision 8 pass through `assess()`, publication and the lookup, under both
   the production and the ASAN+UBSan binaries.
7. The methodology 3 publication exists under `doc/research/hvsc-rom-catalogue/v3/` as a complete
   inventory, with pending rows explicit, and the exhaustive projection test passes against it.
8. `harden.ts` has produced a certificate that `validateHardening` accepts. The certificate cites the
   literal logs of three consecutive full-suite runs, each showing `0 fail`. The architect approval file
   names the same S.
9. The essentia change (M7) has been either removed from this change set or justified separately with
   before/after feature evidence, and the `station-analysis/*` and `test-workspace-phase/` test residue
   has been restored or removed.

## Re-review after implementation (2026-10-23)

- Reviewer: Opus 5.5 (`claude-opus-5-5`), same role as above.
- Scope: branch `feat/hvsc-rom-audit-methodology-3` at `e16df75` plus the uncommitted working tree
  (`rollout.ts` modified; `run-full.sh` and `doc/research/hvsc-rom-full-run.md` untracked).
- Method: reading only. Files: `scripts/rom-audit/{audit,confirm,decision-regression,fixtures,harden,
  inputs,ledger,methodology,publish-production,rollout,select-pilot,verify-native,native-regression,
  checkpoint}.ts`, `render.cpp`, `apply-basic-read-hook.py`, `build-native.sh`, `run-full.sh`,
  `rom-eligibility.ts`, the `rom-*` tests, `hvsc-rom-production.md`, `hvsc-rom-full-run.md`, the
  1.0.1 engine bindings in `workspace/rom-audit-native/build-4493dcb8481cda84/`, and C64 Commander's
  `src/lib/playback` (read-only). I also tallied the pilot's partial
  `workspace/rom-audit-v3/confirmation.jsonl` (296 of 558 subtunes at the time of reading). No build,
  render, audit or test was run.
- File:line references are to the files as they stand in the working tree.

### Status of the earlier findings

| ID | Status | Evidence | Remaining hole |
|---|---|---|---|
| B1 | PARTIAL (sufficient for the full run) | `ledger.ts:68-140`: content-keyed identity (sha256, song), reservation fsynced before dispatch (`audit.ts:212-221`), independent of `--out`. `verify-native.ts:35-36` and `native-regression.ts` reserve. | (a) `RolloutLedger` constructor calls `load()` without the lock (`ledger.ts:72-75`), and `load()` truncates a torn tail (`ledger.ts:93-100`). A process that opens the ledger while another is mid-append can cut a record that the writer then fsyncs and dispatches. (b) `importHistory` scans only `workspace/<dir>/` one level deep (`ledger.ts:158-178`); `/tmp` runs, `.interrupted-tail` files and parity JSON files are not imported. (c) `verify-native` and `native-regression` reserve without a ceiling. (d) The ledger is per clone, so a second machine starts from zero. None of this matters once a valid certificate exists, because `--rollout full` has no ceiling. |
| B2 | PARTIAL | Allow evidence now comes from the WASM engine at 48 kHz with power-on delay 5000 (`confirm.ts:67-75`, `methodology.ts:84-91`). The native SID read-back counter exists (`apply-basic-read-hook.py:116-135`) and is published (`publish-production.ts:92-93`). | (a) The comparator in `confirm.ts` is defective (N1, N2 below). (b) The profile does not describe C64 Commander's actual playback (N3). (c) `createRomEligibilityLookup` types `profile` as the literal `RomConsumerProfile` constant (`rom-eligibility.ts:39,81`), so a consumer can only pass the constant. The "verify the actual profile" step is therefore a self-declaration. |
| B3 | PARTIAL | `harden.ts` exists and runs real checks. The certificate binds log hashes (`harden.ts:98-101`), sources are enumerated (`rollout.ts:24-31`), and approval is bound to the identity (`harden.ts:204-208`). | `verifyHardeningEvidence` re-hashes logs but does not re-parse them as passing (`rollout.ts:73-80`). The live spot check at `--rollout full` startup (decision 7) is not implemented. The identity does not cover transitive imports: `system-roms-fetch.ts` imports `@sidflow/common`, and only some of its files are listed. `shippingEngine.mismatches` is accepted at any value (`rollout.ts:69`). |
| H1 | PARTIAL (fail-closed) | `render.cpp:132-144` classifies errors as `cpu-halt`, `resource` or `engine`. `screen()` treats only `cpu-halt` as tune evidence (`methodology.ts:77`). | Resource and engine errors are still checkpointed as permanent `unknown` rows instead of aborting or being retried. |
| H2 | FIXED (SIDFlow side) | `romMask` derives the mask from ROM hashes and denies any non-reference image (`rom-eligibility.ts:70-79`). | The only consumer passes `null` for CHARGEN in every configuration and `null` for absent BASIC (N3). |
| H3 | FIXED, with one residual | Kernel `flock` through `bun:ffi` (`ledger.ts:27-57`). The lock is taken before the build (`audit.ts:153-154`). A SIGKILL test exists (`rom-audit-ledger.test.ts:111`). | `dlopen("libc.so.6")` limits this to glibc Linux. `confirm.ts`, `harden.ts` and `publish-production.ts` call `readCheckpoint`, which truncates a torn tail (`checkpoint.ts:11-15`), without holding the scope lock. |
| H4 | FIXED, with minor gaps | The stamp binds the inputs, `g++ --version`, the flags and the job count. Each stamp builds into a fresh tree, and the output hash is re-verified (`build-native.sh:16-22,26-29,48-50`). UBSan is added. | `verify-native`, `native-regression`, `decision-regression` and the `harden` reproducibility step execute the build-path binary rather than a private copy. Neither these tools nor `confirm.ts` check the ROMs against `SYSTEM_ROMS`. |
| H5 | FIXED | A pilot requires `--selection` (`audit.ts:54`). `select-pilot.ts` is deterministic and stratified. | The quotas are smaller than decision 8 (for example 10 longest subtunes instead of 40), and most strata exclude horizons above 400 s. This is acceptable for qualification. |
| H6 | PARTIAL | Parity no longer grants decisions. | Its replacement, `confirmation.jsonl`, is equally unauthenticated. It records neither the engine hash, the ROM hashes, the `confirm.ts` hash nor the profile hash. `publish-production.ts:132` hashes `confirm.ts` at publication time, not at confirmation time (N5). |
| M1 | PARTIAL | Each case's evidence is deleted after it is compared (`verify-native.ts:89`). | All cases still run in one `spawnSync` and are written before the first comparison (`verify-native.ts:43-44`). |
| M2 | NOT FIXED | `audit.ts:187,234`, `publish-production.ts:30-45` | The parent keeps every row in memory and reads the whole file as one string. At full scale that is about 0.6 GB of JSON text plus the parsed objects. |
| M3 | NOT FIXED | `audit.ts:180-187` writes a fresh manifest next to an existing checkpoint that has none. `checkpoint.ts:13` overwrites `.interrupted-tail`. | As before. |
| M4 | NOT FIXED (fail-closed) | — | Truncation is not counted in the publication counts. |
| M5 | FIXED | `decision-regression.ts:44-51,90-116` passes the late and margin fixtures through `screen`, `confirmMasks`, `assess` and the lookup, including the deadline. | The OSC3 fixture only checks the counter (`:68`). It does not show a rate-dependent decision. There is no non-default-subtune case. |
| M6 | PARTIAL | `harden.ts:166-175` | Six rows are rendered in one fresh process, not one process per row, and not 2% of the rows. |
| M7 | NOT FIXED | `essentia-frame-features.ts` is still in the branch diff. | `test-workspace-phase/` is still present as untracked residue. |
| M8 | PARTIAL | `verify-native.ts` compares native `selectSong` against the WASM header rewrite on Tusari #10 and on second-subtune fixtures. | Commander's `patchStartSong` is the same header rewrite, so the profile entry is accurate. |

### New defects

**N1 — BLOCKER: `confirm.ts` keeps WASM memory views and reads them after the engine has overwritten them.**
`SidPlayerContext.render()` returns a view into WASM linear memory. The engine's own `.d.ts`
states that the next `render()` overwrites it, that heap growth detaches it, and that the caller
must copy it before calling anything else (`libsidplayfp.d.ts:180-191`; `bindings.cpp:776-783`).
`confirm.ts` breaks this contract in two places:

- `Lane.pull` calls `getAndClearSidWriteTracesPacked()` (which allocates) and
  `getDroppedSidWriteTraceCount()` before it consumes the PCM view (`confirm.ts:79-89`). If the
  heap grows, the view is detached, `take` becomes 0 (`:166`), that chunk is never compared, and
  every later comparison is offset by one chunk.
- `extendReference` pushes the uncopied reference view into `History` (`:143`). Each further
  reference pull overwrites the memory behind every earlier `History` chunk. If `mixBuffer` is
  reallocated, the earlier views point at freed memory. Whenever a lane needs reference samples
  from an earlier pull, the comparison reads the wrong data. This happens whenever pull sizes
  differ between lanes, which `hvsc-rom-production.md:120` describes as normal.

Evidence from the running pilot: the reference configuration itself (mask 7, compared with a
fresh mask-7 reference) is reported `different` in 2 of 296 jobs.

- `sha256 456fe347bd0e…` song 8: every mask, including 7, is reported different at sample
  145,290, which is also the lane's own sample count.
- `sha256 3f179fc28043…` song 1: masks 3 and 7 are reported different at sample 118,774.

A deterministic engine cannot produce a mask-7 difference. Either the comparator is wrong, as the
code reading above predicts, or the engine is not deterministic. Either explanation invalidates
`identical` as allow evidence until it is resolved. The visible failures are fail-closed (a false
`different`). However, a comparator whose result depends on buffer reuse provides no guarantee in
the other direction: a detached chunk is skipped silently, and over silent or constant passages
the one-chunk offset is invisible.

Required fix:

- Copy every PCM chunk (`chunk.slice()`) immediately after `render()` and before any other call
  on that context.
- Store only copies in `History`.
- Re-run the two jobs above. Mask 7 must be `identical` in both. If it is not, stop and treat the
  engine as non-deterministic.
- Add a unit test with a fake context whose `render()` reuses one buffer and whose pull sizes
  differ between lanes. The test must fail against the current code.

**N2 — BLOCKER: a variant that omits writes the reference makes within the horizon can be
confirmed `identical`.**
`confirmMasks` compares each variant chunk's writes with the reference at the same absolute
write index (`confirm.ts:173`). It declares `identical` as soon as the variant has `wanted`
samples (`:158`). Nothing checks that the reference made no further writes before the horizon.

Example: under the 48 kHz profile, the variant stops writing near the end, for example because
its interrupt handler hangs in a zero-filled bank. Meanwhile the reference keeps rewriting
unchanged register values over a silent ending. The variant's writes are a prefix of the
reference's writes, its PCM is equal, and it is confirmed `identical`.

The native screen would catch this case at 8 kHz, because `exactWrites` requires equal counts.
A false allow therefore needs a divergence that appears only at 48 kHz. That is exactly the case
the WASM confirmation exists to catch. The code comment "event counts beyond the horizon may
legitimately differ" (`:125-126`) also hides this gap; the actual over-strictness runs the other
way, because writes after the horizon in the final pull are compared too.

Required fix: when a lane reaches `wanted`, compare the number of writes whose PHI1 cycle falls
before the horizon (the cycle of the last sample inside the horizon) in both streams, and require
them to be equal.

A related defect: `extendReference` advances the reference until it has as many writes as the
variant (`:139`). A variant that writes in a fast loop drives the reference far past the horizon
with no bound. The reference must be advanced by samples only, and a variant with more writes
than the reference at the same sample position must be reported as `different`. Add a
"variant stops writing in a silent tail" fixture to `decision-regression.ts`.

**N3 — BLOCKER for the value of the run: the consumer profile is not C64 Commander's
configuration.**
Read from `c64commander/src/lib/playback` (not modified):

- Commander depends on `libsidplayfp-wasm` `^1.1.0`, and 1.1.0 is installed
  (`package.json:210`). The census pins 1.0.1, and `engineId` hashes the 1.0.1 WASM and source.
- Commander never sets `powerOnDelay` (`wasmRendererCore.ts:69-73` sets only `sidModel`).
  `SidPlayerContext`'s default is `MAX_POWER_ON_DELAY` = 0x1FFF (`bindings.cpp:372`, 1.0.1
  source), not 5000.
- Commander passes `null` for CHARGEN even when it has ROMs, and `null` for BASIC when it has
  none (`wasmRendererCore.ts:106-110,132-136`). The profile requires zero banks, and with `null`
  libsidplayfp leaves the bank contents uninitialised.
- Commander forces `sidModel` for tunes whose header model is unknown (`:69-73`). The profile
  says "from header".
- Commander lets the user choose reSIDfp, SIDLite or sidplay-ez. The census covers SIDLite only.

`hvsc-rom-production.md:48-51,208-209` admits the power-on delay and bank differences, but not the
engine version. If Commander moves to the evidence, it must downgrade the engine or the census
must be repeated. If the profile moves to Commander, the census has to change before it runs.
Either way, the decision has to be made before about two weeks of CPU time are spent. Also
change the lookup so that it takes the consumer's actual configuration object (N3 belongs with
B2(c)).

**N4 — HIGH (operational): a single slow or failing job stops a whole stage, and on resume the
stage stops on the same job again.**

- Confirmation timeout: `max(180 s, seconds × (1 + k) × 0.4 s)` (`confirm.ts:266`), and a timeout
  rejects every worker (`:260,284`). In the pilot so far, confirmation processes about
  10.7 horizon-seconds per second on 7 workers, with about 4.8 lanes per job. That is roughly
  7 lane-seconds of emulation per wall-clock second per worker, so the margin against the
  2.5× real-time requirement is under 3×. A 3SID subtune with a long horizon, or a loaded
  machine, can exceed the limit.
- Jobs are sorted shortest first, both on resume and in `audit.ts:204`. The failing job is
  therefore retried at the same position every time, and the pipeline cannot pass it without
  manual intervention.
- The native audit behaves the same way (`audit.ts:97,117,121`).

Required fix: record a timeout or an engine exception on one job as a per-job `unknown` result
with a reason, and continue. Derive the timeouts from the pilot's measured throughput with a
margin of at least 10×.

**N5 — HIGH: confirmation provenance is not bound to what produced it.**

- `JobResult` (`confirm.ts:41-44`) carries no engine hash, ROM hashes, tool hash or profile hash.
- The worker reads the ROM files without checking them against `SYSTEM_ROMS` (`confirm.ts:220-221`).
- Publication checks only `sampleRate` and `powerOnDelay` (`publish-production.ts:54`), and labels
  every result with the audit manifest's engine (`:58-59`).

A `bun install` of a different engine between `audit` and `confirm`, or a replaced KERNAL file,
yields confirmations that are published as evidence for the 1.0.1 reference ROMs.

Required fix: have the worker verify the ROM hashes and record the engine, ROM, `confirm.ts` and
profile hashes in every line. Publication must require all of them to equal the manifest and the
certificate.

**N6 — MEDIUM: the ledger cost grows quadratically.**
`reserve()` re-reads, re-parses and re-hashes every ledger line on each dispatch
(`ledger.ts:118-120`, `load()`). For 87,868 dispatches that is about 3.9 × 10⁹ record parses on
the parent thread, which works out to hours of event-loop time. With many workers the parent
becomes the bottleneck. Required fix: read incrementally from the last known file offset.

**N7 — MEDIUM: `run-full.sh` and its documentation do not work as written on a fresh machine.**

- `run-full.sh` and the `rollout.ts` change are uncommitted. A `git checkout` of the branch does
  not contain them.
- `node` and `npm` are required (`roms:fetch`, `bun run test` → `npm run build`), but
  `run-full.sh:38` does not check for them, and the documentation does not list them.
- `scripts/sidflow-fetch` fetches the latest HVSC base archive. Once HVSC 86 is released, setup
  fails on the corpus check (fail-closed, but the run cannot start).
- `bun@1.3.1` is not enforced. The engine path in the identity depends on bun's install layout.
- `harden.ts` checks the approval line last (`:204-208`), after hours of work. It should check it
  first.
- The claim that "a finished stage is skipped" (`run-full.sh:7-8`) is false. `harden` repeats
  everything, including three full suites, on every invocation.
- The `harden.ts:24-25` comment still says the identity includes git HEAD.
- `hvsc-rom-full-run.md` says confirmation takes "a comparable time" to native screening. The
  pilot measures about 3× slower per horizon-second (10.7 versus 32 horizon-seconds per second).
  On the development machine that is about 88 h for native screening plus about 260 h for
  confirmation, not about 8 days in total. This estimate is provisional, because short jobs are
  dominated by module start-up.

**N8 — LOW.**

- `Uint32Array.from` truncates the Float64 trace scalars (`confirm.ts:87`). The values fit for
  horizons up to 3,600 s, but the code does not check this.
- A `WebAssembly.Exception` produces the message `[object WebAssembly.Exception]`, as seen in
  pilot job `50c0032b7402…` song 83, mask 0. The exception is not decoded.
- An empty `render()` result (the engine's `produced == 0` case, which native rendering treats
  as normal) ends a lane as `variant-error` (`confirm.ts:86`).
- A confirmed halt does not check that the WASM reference stays clean up to the horizon.
- Mask 7 is sent for confirmation, which costs time. It is a useful control (it exposed N1), so
  keep it, but report it as a control rather than as a decision.

### Answers to the specific questions

1. **Lockstep comparison.** It is not sound as written (N1, N2). Comparing by absolute index is
   the right idea, but the stored history aliases engine memory, and an index-prefix match is
   accepted as equality. Halt-expecting lanes behave acceptably, because a halt only denies.
   `WebAssembly.Exception` handling fails closed.
2. **Publication without confirmation.** `assess()` cannot return `compatible` or `incompatible`
   without `verdictFromConfirmation(...) === true`, and that function requires hashes equal to
   the current native rows (`confirm.ts:199-207`, `methodology.ts:84-91`). Every publication path
   goes through `publishProduction`. The weak points are the authenticity and provenance of
   `confirmation.jsonl` (N5) and the correctness of the `identical` outcome itself (N1, N2).
3. **Ledger and flock.** The kernel lock is correct, and the descriptor lives for the life of the
   process. The ceilings use both denominators. Identity is keyed by content. The unlocked
   truncate in the constructor (B1(a)) and the quadratic reload (N6) remain.
4. **Harden and rollout.** A certificate cannot be obtained without running the checks through
   `harden.ts`. A hand-written certificate plus hand-written logs still validates, because the
   logs are hashed but not parsed and there is no live spot check. Removing git HEAD from the
   identity is correct for the approval workflow. However, files outside the enumerated set can
   then change without voiding the certificate, because `@sidflow/common` is a transitive import.
   The approval line is a tamper-evident marker against accidents, not an authentication
   mechanism. Stale items are listed in N7.
5. **Fresh machine.** The stages run in the right order, the corpus identity check is correct,
   and the pilot directory satisfies harden's requirement, because `select-pilot.ts` is
   deterministic and the native hash is re-derived locally. The blockers there are N7. A different
   compiler or CPU changes only the native screen. The WASM engine remains the authority, and
   `-ffp-contract=off` reduces the cross-compiler differences. On a non-x86-64 or non-glibc host,
   expect the parity controls or `dlopen` to fail; that is fail-closed. The difference between the
   8 kHz screen and the 48 kHz profile costs coverage, not soundness.
6. **Consumer profile.** It does not match Commander (N3).
7. **Threats to the claim that a `compatible` bit is sound.** In priority order: N1, N2, N5, N3,
   and the earlier limits (finite window, Songlengths accuracy, SIDLite only).

### Verdict: NOT READY

Running the full census now would spend roughly two weeks of CPU time (88 h native plus about
260 h of confirmation on the development machine; less on a faster machine) to produce allow
evidence from a comparator that is defective and contradicted by its own mask-7 control, under a
profile that the only consumer does not use. Every required fix changes the hardening identity.
A run started now could not be resumed under a certificate issued after the fixes, so the fixes
must come first.

Conditions, in order:

1. Fix N1: copy each chunk and keep only copies in `History`. Add a failing-then-passing test.
   Re-run the two mask-7 jobs and require `identical`.
2. Fix N2: require equal write counts within the horizon, advance the reference by samples only,
   and add the silent-tail fixture to `decision-regression.ts`.
3. Decide the profile and engine version against Commander (N3) before the run: 1.0.1 or 1.1.x,
   the power-on delay, and CHARGEN/BASIC zero banks versus `null`. Make the lookup take the
   consumer's actual configuration.
4. Fix N4: isolate per-job failures and derive the timeouts from measured pilot throughput.
5. Fix N5: bind each confirmation line to the engine, ROM, tool and profile hashes, verify the
   ROMs in the worker, and check all of them at publication.
6. Fix B1(a) and N6: no unlocked truncation, and incremental ledger reads. Also stop readers
   (`confirm.ts`, `harden.ts`, `publish-production.ts`) from truncating checkpoints.
7. Fix N7: commit `run-full.sh` and all edits; add the `node`/`npm` and `bun@1.3.1` checks; pin
   HVSC 85; check the approval line first in `harden.ts`; correct the stale comments and the
   duration estimate.
8. Complete the pilot confirmation with the fixed `confirm.ts`. Review every `different`,
   `variant-error` and mismatch individually, record peak RSS for the longest horizons, and
   re-measure confirmation throughput.
9. Then freeze the sources, compute the identity, have the review approve that identity, and run
   `harden` on the target machine before `full`.

Recommended but not blocking for the census: M2 (parent memory; until it is fixed, provide at
least 16 GB of RAM for the parent), M3, M6, re-parsing the logs in `verifyHardeningEvidence`,
and removing M7 from the branch.

### What the user must be told about residual risk

- Even after these fixes, a `compatible` bit means one thing only. A fresh SIDLite playback on
  the pinned engine build, under the declared profile, with byte-identical reference ROMs and
  zero banks, matched the full-ROM reference in PCM and in timed SID writes, from reset through
  the Songlengths duration plus 5 s. It says nothing about other engines or versions, other
  sample rates or power-on delays, `null` banks, looping, user interaction, or an incorrect
  Songlengths entry.
- The case Commander cares most about, playback without ROMs, will be almost entirely `unknown`.
  In the pilot so far, masks without KERNAL (0, 2, 4, 6) were candidates in only 11 to 14 of 296
  confirmed subtunes, because the engine's interrupt shim shifts SID writes by a few cycles. The
  run will mainly qualify "KERNAL present" configurations.
- The certificate and the approval line detect accidental or agent-made changes. They do not
  stop a deliberate local forger.
- Confirmation is per-case evidence on the shipping engine. Its correctness rests on
  `confirm.ts`, which has had less adversarial testing than `assess()`. The mask-7 control must
  stay in the run, and any mask-7 non-`identical` result must stop publication.

## Third review (2026-10-23)

- Reviewer: Opus 5.5 (`claude-opus-5-5`), same role as above.
- Scope: commit `8cdeef0` on `feat/hvsc-rom-audit-methodology-3` (the working tree had no tracked
  changes at the time of the final check). The design changed after the second review: native
  screening and WASM confirmation were replaced by one WASM 1.1.0 engine that measures and grants.
- Method: reading only. Files: `scripts/rom-audit/{wasm-lanes,methodology,audit,census-worker,
  checkpoint,publish-production,ledger,rollout,harden,decision-regression,inputs}.ts`, `run-full.sh`,
  `rom-eligibility.ts`, the `rom-*` tests, `hvsc-rom-production.md`, `hvsc-rom-full-run.md`; the
  engine package `node_modules/libsidplayfp-wasm-audit/dist/{index.js,player.js}` and its
  `complete-source.tar.gz` (`bindings.cpp`, `SystemROMBanks.h`, `player.cpp`, `SidConfig.cpp`,
  `apply-sid-write-hook.py`); C64 Commander at `fd7c46138` (`wasmRendererCore.ts`,
  `appSettings.ts`, `src/generated/variant.json`), read-only. I also tallied the running pilot's
  `workspace/rom-audit-v3/census.jsonl` (233 to 252 rows while reading) and `horizons.json`, and
  read worker RSS with `ps`. No build, render, audit or test was run.
- Engine file references below are to the 1.1.0 source archive.

### 1. Lockstep comparator (`wasm-lanes.ts`)

The comparator is sound for the `identical` outcome. N1 and N2 from the second review are fixed.

- Each pull is copied out of WASM memory before any other call on that context
  (`wasm-lanes.ts:96-97`). Nothing keeps a view.
- Each lane pull is compared with the reference pull for equal sample count, every PCM sample and
  every packed write including its PHI1 cycle (`:108-113`). A variant that omits or adds a write in
  any pull is `different`. A prefix is never accepted, and the reference advances by pulls only.
  This closes N2.
- `identical` is assigned only when the reference has reached the horizon (`:151`).
  `validateRecord` then requires each identical lane's PCM hash, trace hash and write count to
  equal the reference's (`methodology.ts:118`). The final pull is compared beyond the horizon,
  which is stricter than necessary and therefore safe.
- Each lane is a fresh module instance (`:54-57`), and the repeat lane checks reproducibility for
  every subtune. `assessMask` refuses every decision unless `repeat === "identical"`
  (`methodology.ts:76`).
- The trace hook only reads the scheduler time (`apply-sid-write-hook.py:79-87`). Tracing
  therefore does not change emulation, so a traced lane can stand in for Commander's untraced
  playback.
- A halt produces only `incompatible`, which denies, so its soundness does not affect allow
  decisions. A reference failure makes every mask `unknown`.
- The ROM order (configure, trace, ROMs, load, reset) and the start-song rewrite match
  `SidAudioEngine.loadPatchedBuffer` and `patchStartSong` (`player.js:116-152,224-235`). The 1-based
  census song equals Commander's `songIndex + 1`. Pull sizes match: 256 cycles for SIDLite, and the
  `renderSeconds` default of 100000 cycles for reSIDfp (`player.js:455`).

Defects found:

- **C1 (MEDIUM): a legitimate record can stop the census.** The repeat lane can leave the active
  set (`different` or `error`) while all four variants have already diverged. The loop at
  `wasm-lanes.ts:150` then ends with `reference.samples < wanted` and outcome `clean`.
  `validateRecord` rejects that combination (`methodology.ts:109`). `save()` validates the record
  (`audit.ts:207`), and the exception rejects `Promise.all` and ends the whole census. On resume,
  jobs are sorted shortest first, so the same job is retried first. This needs fresh-instance
  non-determinism to occur, which has not been observed. Fix: let the reference run to `wanted`
  while any lane or the reference itself is unresolved, or record the reference as `failed`, and
  turn a validation error in `save()` into a per-job failure record.
- **C2 (LOW): trace-drop detection never fires.** `getAndClearSidWriteTracesPacked()` calls
  `clearSidWriteTrace()`, which sets `droppedTraces = 0` (`bindings.cpp:910,1239-1243`).
  `Lane.pull` reads the counter after draining (`wasm-lanes.ts:97-98`), so it always reads 0. The
  cap is 2^20 records per drain (`bindings.cpp:84`), and a pull of at most 100000 cycles cannot
  reach it, so no false `identical` can result today. Read the counter before draining.
- **C3 (MEDIUM): one worker process runs for the whole census.** It is replaced only after a
  failure (`audit.ts:226`). Each job instantiates six modules. After about 35 jobs each worker held
  380 to 630 MB RSS and about 74 GB of virtual address space, with no clear upward trend between two
  samples. A full run gives each worker about 12,500 jobs. Recycle workers every few hundred jobs
  and log peak RSS.
- **C4 (LOW):** a `WebAssembly.Exception` is still reported as `[object WebAssembly.Exception]`.
  The pilot shows it on `none/ff` where `none/zero` halted at `$BF54`. No unit test runs `runEngine`
  against a fake context whose `render()` reuses one buffer, because `loadModule` cannot be
  injected. The real-subtune controls in `decision-regression.ts:112-124` partly cover this.

### 2. Null banks, KERNAL `null`, CHARGEN `null`

- **KERNAL `null` is modelled correctly.** `KernalRomBank::set(nullptr)` overwrites the whole bank
  with NOPs plus a fixed stub (`SystemROMBanks.h:173-219`). The `Player` constructor already calls
  it (`player.cpp:84`). The bank is therefore deterministic whether or not `setSystemROMs` is ever
  called, and `setSystemROMs(null, fill, fill)` leaves the same KERNAL as Commander's skipped call
  (`player.js:198-206`). `decision-regression.ts:125-143` checks this in a fresh instance.
- **BASIC and CHARGEN `null` keep whatever the bank's memory held** (`romBank::set` ignores
  `nullptr`, `SystemROMBanks.h:80`). Passing a CHARGEN fill for the `full` set is equivalent to
  Commander's `setSystemROMs(K, B, null)` only to the extent that the fill matches that unknown
  content. For `full`, three contents are effectively tested: 0x00, 0xFF and the authentic image
  (through the reference). For `none`, BASIC and CHARGEN are tested only at 0x00 and 0xFF.
- **The fills are a heuristic, and the design document overstates them.** In Commander, every
  `SidAudioEngine` uses the same cached module instance: `loadLibsidplayfp({engine})` is
  memoised (`index.js:88-101`), and Commander constructs engines with only `engine` as a loader
  option (`wasmRendererCore.ts:129,184`). A new context's `null` banks therefore hold memory reused
  from earlier players. After a playback with ROMs, that can be the authentic BASIC image; otherwise
  it can be any leftover bytes. `hvsc-rom-production.md:60-61` says "output that does not depend on
  the fill does not depend on the bank's content". That is not established; line 232 states the
  limitation correctly. Recommended change: add a third, fixed pseudo-random fill. For the `none`
  set, also add a lane with KERNAL `null` and authentic BASIC.

### 3. Decision logic and what the deny list can be trusted for

`assessMask` (`methodology.ts:65-88`) is fail-closed. A decision requires a valid canonical
horizon, a clean and reproducible reference that reached the horizon, both fills `identical` to the
horizon for `compatible`, and both fills `halt` for `incompatible`. Masks other than 0, 3 and 7 are
`unknown`, and the lookup denies them (`rom-eligibility.ts:214-224`). Mask 7 is the reference
itself. Commander cannot create it, because it never supplies CHARGEN.

The `compatible` bit can be trusted only for SIDLite on 1.1.0, 48 kHz stereo, 256-cycle pulls,
fallback SID model MOS8580, a fresh module instance, the reference ROM images, and playback from
reset up to `maxPlaybackSeconds`. The documentation does not state three Commander differences:

- **D1 (BLOCKER for the documentation): Commander's default renderer is not reSIDfp.**
  `DEFAULT_SID_EMULATION_ENGINE` comes from the variant, and the variant is `"sidplayez"`
  (`appSettings.ts:630-640`, `src/generated/variant.json:183`). reSIDfp is used only where
  SidplayEZ does not exist (web, iOS). SIDLite is used only when a user selects it or a variant
  names it. `hvsc-rom-production.md:19-22` and `hvsc-rom-full-run.md:23,72-74` call reSIDfp the
  default. In practice, the default census covers a renderer that most Commander users do not run.
  For them the lookup denies everything, because the engine id differs. That is safe, but it
  provides no coverage for those users.
- **D2 (BLOCKER for the claim "configured as Commander"): instance lifetime.** The census uses a
  fresh instance per lane, and its own measurement shows that a second reSIDfp player in one
  instance produces different PCM. Commander always plays in one shared instance (see section 2),
  so every playback after the first runs in a state the census never measured.
  `hvsc-rom-production.md:82-84` presents fresh instances as a design choice and does not mention
  this. Required work:
  - Measure SIDLite. Render pilot subtunes as the Nth context in one instance, after varied earlier
    tunes and ROM sets, and compare PCM and traces with the census reference. Bit-identical results
    close D2 for SIDLite.
  - Root-cause the reSIDfp divergence and report it upstream, as `AGENTS.md` requires.
  - Do not run reSIDfp lanes until this is resolved, because they would describe a state Commander
    does not produce.
- **D3 (HIGH): SID model.** Commander always passes a fallback `sidModel` (`localSidEngine.ts:890`).
  By default that model is learned from the connected device (`DEFAULT_LOCAL_SID_MODEL_FROM_DEVICE =
  true`, `appSettings.ts:776`), so it can be 6581. The census uses the engine default MOS8580
  (`SidConfig.cpp:30`). The profile string "engine default where the header does not name one"
  does not identify this, and a consumer cannot express its model to the lookup. A tune whose header
  says UNKNOWN or ANY and which reads SID registers can take a different program path under 6581.
  This is the same transfer argument that was rejected for SIDLite to reSIDfp. Fix: name MOS8580 in
  the profile, and make the lookup take the consumer's fallback model. It must deny when the model is
  not 8580 and the header does not fix the model; that needs the header model, or a per-entry flag,
  in the deny tuple. Alternatively, render both models for those tunes.

The rest of the documentation about reSIDfp is accurate. The reSIDfp build cannot prove a halt
(`hvsc-rom-production.md:113-115`). The rejection of the transfer argument via "no SID reads" is
stated with the measured figure. Mask 0 is `unknown` for nearly every program, and the partial pilot
agrees: 224 of 233 `none` lanes were `different` per fill. All 233 `full` lanes were `identical` for
both fills, and the repeat lane was `identical` in all 233 rows.

### 4. Ledger, checkpoint, failure isolation, resume, ETA

- Fixed: incremental ledger reads from a stored offset (`ledger.ts:93-121`, N6). The unlocked
  constructor no longer truncates (`:74`, B1(a)). Repair runs only under the lock (`:106`, and
  `checkpoint.ts` `repair` used only by `audit.ts:170` under the scope lock). Content keys and
  `flock` are as before. Readers (`harden.ts`, `publish-production.ts:36-37`) do not repair.
- Per-job isolation: worker exceptions become failure records (`census-worker.ts:25-28`). Parent
  timeouts and worker crashes become failure records and the worker is replaced (`audit.ts:222-228`).
  The remaining fatal paths are C1 and a result-identity mismatch (`audit.ts:229`).
- Timeout: `max(300 s, 12 s × horizon × engines)` (`audit.ts:122`). For SIDLite the measured cost
  is about 0.4 to 0.55 s per horizon-second, which is more than 20× margin. For reSIDfp the cost
  derived from the 1.7× real-time figure is about 2.4 to 3.5 s, which is under 5× margin. Use a
  per-engine factor.
- Resume: the manifest must be byte-equal (`audit.ts:165`), and it binds the engines, the tool hash,
  the corpus and the selection. `--retry-failures` works in `audit.ts` (`:181,230`).
- **R1 (HIGH): retrying is not reachable through `run-full.sh` without voiding the certificate.**
  The documentation says to add `--retry-failures` by editing `run-full.sh`
  (`hvsc-rom-full-run.md:55`). That file is part of the source identity (`rollout.ts:30`), and
  `harden` requires 0 failed pilot jobs. Fix: add an environment variable such as
  `ROM_AUDIT_RETRY_FAILURES=1`.
- ETA (`audit.ts:212-215`) is computed from horizon-seconds per second since the start, with
  shortest jobs first. Short jobs run all six lanes to the horizon, because the halt probe is capped
  by the horizon, while long jobs stop diverged lanes early. The ETA therefore starts high. The
  horizon of failed jobs is counted as done. This is acceptable as a progress indicator.

### 5. `harden.ts` and `rollout.ts`

- **H1 (BLOCKER): a certificate written by `harden.ts` can never pass `validateHardening`.**
  `validateHardening` requires `Object.keys(c.logs).length >= 9` (`rollout.ts:68`). `harden.ts`
  records exactly 8 logs: `typecheck`, `decision-regression`, `focused-1..3` and `full-suite-1..3`
  (`harden.ts:93,97,134,143`). The reproducibility run is not logged. `--rollout full` is therefore
  always refused, after the pilot and several hours of hardening. The unit test passes because it
  builds a fake certificate with 10 logs (`rom-audit-adversarial.test.ts:41`). Fix: require the
  exact set of log names instead of a count, log the reproducibility step, and add a test that
  builds the certificate from `harden.ts`'s own step list.
- A certificate still cannot be obtained without the checks except by forging it.
  `verifyHardeningEvidence` now re-parses the focused and full-suite totals and the regression
  digest (`rollout.ts:84-90`). It does not parse `typecheck.log`, and the pilot and reproducibility
  results are structural fields only. That is acceptable for detecting accidental changes.
- Identity: every file under `scripts/rom-audit`, the listed extras, the engine `dist` and
  `bun.lock` (`rollout.ts:14-31`). `bun.lock` now contains the alias (`bun.lock:24,1470`). The
  identity does not cover the Bun runtime version or `@sidflow/common` beyond the listed files
  (`system-roms-fetch.ts` imports it). The impact is low, because the ROMs are verified by hash in
  `audit.ts:139-142` and in the worker (`census-worker.ts:30-38`).
- Approval-first ordering works (`harden.ts:72-78`, `run-full.sh:39-42`). The two checks parse
  differently. `harden.ts` takes the first `Approved-source-identity` line in the file (`.exec` on a
  multiline regex), while `run-full.sh:41` accepts any line. With two approval lines in the file,
  setup passes and harden fails. Use the same rule in both places, preferably the last line.
- The certificate binds the SHA-256 of the whole review file (`rollout.ts:91-92`). Any later edit to
  this document, including another review section, invalidates the certificate and blocks resuming
  `full`. The documentation must say that this file is frozen from `harden` until `publish`, or the
  certificate should bind only the approval line.
- Stale: `rollout.ts:1-3` still mentions the native renderer.

### 6. `run-full.sh` on a fresh machine

1. `bun install --frozen-lockfile`: the lockfile now contains the alias, so this should succeed.
   `bun@1.3.x` is not enforced.
2. `bash scripts/sidflow-fetch` fetches the latest HVSC base archive (`manifest.ts:5`). Once HVSC 86
   is released, the corpus check stops the run. That is fail-closed, but the run cannot start.
3. `bun run roms:fetch` runs `node scripts/run-bun.mjs` (`package.json:13`), and `bun run test` runs
   `npm run build` (`package.json:15`). `run-full.sh:32` checks only `bun` and `git`, and
   `hvsc-rom-full-run.md:28` lists only those two (N7, not fixed).
4. The corpus identity and the approval pre-check are correct (`run-full.sh:36-42`).
   `corpusIdentity` and `audit.ts` compute the same hash, so `harden` and `audit` contend for the
   same scope lock.
5. The pilot is correct on the first pass.
6. **S1 (BLOCKER): resuming does not work.** Without `ROM_AUDIT_STAGE_ONLY`, every invocation runs
   every stage (`run-full.sh:28`). Once `full` has reserved more than 5% of the corpus, the pilot
   stage stops in `audit.ts:187-189` ("exceeds the 5% pilot ceiling"), and `set -e` aborts. The
   documented resume command (`hvsc-rom-full-run.md:20`) therefore fails. `harden` also repeats all
   of its steps, including three full suites, on every invocation. The header claim "a finished
   stage is skipped quickly" (`run-full.sh:7-8`) is false. Fix: skip stages using completion
   markers (pilot coverage shows 0 pending; a certificate that validates and verifies), or document
   `ROM_AUDIT_STAGE_ONLY=full` as the only resume command.
7. `harden` requires three complete repository suites with 0 skip on the target machine.
   Environment-dependent tests have not been tried there, so run `bun run test` once before starting
   the pilot.
8. `publish` re-publishes what `audit.ts:240` has already published. This is harmless.

Duration estimates are not derived from a measurement:

- `horizons.json` gives a total horizon of 10,176,145 s (2,827 h) for 87,868 subtunes. No duration
  is unknown and none exceeds 3,600 s. The pilot selection is 567 subtunes and 70,812 s.
- The running pilot completed 252 rows, 4,574 horizon-seconds, in about 6.3 minutes on 7 workers.
  That is about 12 horizon-seconds per second, on the shortest jobs.
- Projection for SIDLite only on the development machine: about 6 to 10 days, because long jobs
  stop diverged lanes early. `hvsc-rom-full-run.md:10` says "about 12 days". The pilot estimate of
  "about an hour" (`:37`) projects to about 1 to 1.6 h. The `harden` estimate of 1.5 h (`:38`) is
  unmeasured.
- Adding reSIDfp multiplies the cost by about 7, which is weeks on this machine.
- The memory figure "roughly 400 MB per worker" (`:28`) is at the low end of what was observed.
- Replace every estimate with figures from the finished pilot.

### 7. Remaining items

Blockers: H1, S1, D1 (documentation), D2 (instance lifetime: measure SIDLite; do not run reSIDfp).
High: D3, R1. Medium: C1, C3, the reSIDfp timeout factor, the null-bank fills, the
approval-line rule, the review-file binding. Low: C2, C4, N7 prerequisites, the HVSC 86 pin, stale
comments, `test-workspace-phase/` residue.

### Verdict: NOT READY

With the current sources, the documented pipeline cannot complete. `full` is always refused (H1),
and the documented resume command fails (S1). Whether a SIDLite census describes Commander at all
depends on a measurement that has not been made (D2). All required fixes change the source identity,
so the pilot must be re-run after them. The comparator itself is sound for allow decisions. After
the fixes and the evidence below, the verdict would be READY WITH CONDITIONS.

### Residual risks the user must be told

- The default census qualifies SIDLite. Commander's default renderer is SidplayEZ on Android and
  reSIDfp on web and iOS. Those users get no coverage: the lookup denies everything for them.
- A `compatible` bit describes a fresh module instance, a MOS8580 fallback model, the reference ROM
  images, BASIC and CHARGEN `null` banks that behave like 0x00 and 0xFF, and playback from reset to
  the documented duration plus 5 s. It does not cover a shared instance (unless D2 is measured), a
  6581 fallback, other ROM images, other uninitialised bank content, loops, or incorrect
  Songlengths entries.
- The set "nothing supplied" will be `unknown` for almost every subtune. Mask 7 is not a
  configuration Commander can create.
- The certificate and the approval line detect accidental changes. They do not authenticate anyone.
- The duration has not been measured beyond short pilot jobs.

### Evidence required before an `Approved-source-identity` line is written

1. All fixes committed. The identity printed by `harden.ts --identity` in a fresh clone of the
   commit equals the identity on the development machine.
2. A test showing that a certificate built from `harden.ts`'s real step list passes
   `validateHardening` and `verifyHardeningEvidence`. Reverting the log-count fix must make that
   test fail.
3. The D2 measurement for SIDLite in a shared instance, with the comparison method and its result.
4. A complete pilot under the final tool hash with 0 failed jobs and every repeat `identical`. Every
   `full` lane that is not `identical`, and every `error` and `halt`, listed and explained. Peak
   worker RSS and horizon-seconds per second for the longest pilot jobs.
5. The decision-regression log with its `DIGEST` line, on the engines the census will run.
6. One `harden --dry-run` and one `bun run test` on the target machine, both passing.
7. A decision on the SID model (D3), and documentation corrected for D1, D2, D3, R1, S1, the
   review-file freeze and measured durations.

## Methodology 4 continuation review (2026-10-23, Codex)

The prior NOT READY findings describe the superseded exact-equality methodology.
The user explicitly rejected `unknown` for harmless timing differences. The new
contract compares listener-relevant playback and reserves unknown for inadequate
measurement. Review is performed by the current Codex agent; no independent
Claude/Opus review is claimed. Qualification accepts a truthfully named reviewer
rather than requiring an unavailable model brand. It still binds approval to the
frozen sources and measured evidence.

Findings addressed in this continuation:

- The completed old pilot had 567 results, one worker crash and 15.552 aggregate
  horizon-seconds/second. The earlier 11–17 hour CPU projection lacked a valid
  aggregate-throughput calculation. It is withdrawn.
- CI failed because the maintained publication was absent. Methodology 4 publishes
  a new snapshot with measured and pending counts, never relabeling old results.
- Live Commander main pins engine 1.1.1 and removed 256-event containment. The audit
  now pins that exact package, records new engine/profile identities and uses the
  engine-default large pulls supported by its upstream capacity correction.
- Continuous register streams accept harmless startup/timing offsets. Spectral
  fallback distinguishes audible differences from silent/phase/DC differences.
  Dense digi/sample streams require spectra even when register values match.
- Three consumer players replace arbitrary null-bank fill lanes. Absent banks
  must be explicitly zeroed. This is a new consumer precondition recorded in the
  profile; it does not cover old players with arbitrary stale heap contents.
- SIDLite shares a WASM module while retaining separate C64/player states; exact
  and listener regressions check reference determinism. Hash updates are batched
  without changing the byte stream. Worker exit diagnostics include the signal.
- The timing benchmark samples the verified full corpus, weights format/duration
  strata by their populations, reserves jobs through the pilot ledger and applies
  a 15% margin. Budget bypass cannot hide a broken benchmark.

Residual limits: thresholds are engineering choices with synthetic/real-engine
controls, not a listening-study result. SIDLite is the qualified renderer. Another
renderer, model, engine version or absent-bank initialisation requires matching
measurements. The 14600K budget must be measured there; this host is a 6700K with
other workloads. No full census is claimed before zero pending/failed results.

Final pilot, three-suite validation, throughput and source-identity attestation
are pending below. No source approval is granted by this paragraph.

Additional review repairs: negative as well as positive results now respect the
fallback SID model; a fixed model remains recorded even when every tested set
fails. Qualification regenerates the canonical reviewed selection and requires
all its rows, rather than accepting a clean prefix. It checks repeat sampling
against the manifest and clears the inherited `ROM_DECISION_ONLY` debug filter.
New controls cover a brief loud sound and a quiet melody underneath a loud bass,
with phase-shifted tones, sawtooth and noise as acceptance controls.

Stopped decoders are now judged by their audible output: the comparison models
silence after `stoppedAtSample`. It accepts a silent halt after startup and rejects
a halt that loses a held note. The reference must still complete successfully.
A real-engine silent-halt control exposed an initial-transient mistake in the
first control, then final-window zero padding exposed an artificial DC click;
the corrected control halts after the transient and FFT padding preserves channel
means. Both have regressions. Resource/memory exceptions remain failed measurements,
and caught render exceptions are logged to stderr without corrupting worker JSON.

## Frozen methodology 4 source review and qualification

Reviewed source identity:
`6d8fbd169fc69cb0bac600fbda560812988b9e0a7383e683bd73526ec98581f7`.
The same identity was computed in a fresh checkout carrying the final sources
and a frozen-lockfile install. Review was by the current Codex agent, with the
limitations above; no independent model review is claimed.

The complete canonical pilot passed: 567 subtunes, 0 failed, 113 exact reference
repeats and no unresolved measured decisions for masks 0/3. Mask 0: 399 compatible,
168 incompatible. Mask 3: 567 compatible. Gordian Tomb #2 (the previous crash) and
the maximum 2,031.332-second horizon completed. Elapsed 1,592.253 seconds; peak
worker RSS 188 MB. The final 80-job weighted benchmark projects 62.52 h on this
loaded 6700K (71.90 h with margin). A 14600K runtime is not claimed without its
own benchmark.

This source is approved for qualification. Full rollout still requires the
machine certificate after reproducibility, decision regression, focused tests
and three full repository suites. Qualification completed successfully: three
focused runs each 82 pass / 0 fail / 0 skip and three full suites each 2,958
pass / 0 fail / 0 skip. Source identity remained unchanged; stage-status verifies
the completed certificate and intact evidence. Literal outputs are recorded in
[methodology 4 validation](hvsc-rom-validation-4.md).

Reviewer-model: codex
Approved-source-identity: 6d8fbd169fc69cb0bac600fbda560812988b9e0a7383e683bd73526ec98581f7

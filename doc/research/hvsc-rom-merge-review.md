# Dual-engine ROM workflow review for PR #109

Reviewed 2026-10-26. Scope: the dual-engine workflow entered by
`scripts/rom-audit/run-dual.sh`, its screening/audio decisions, resumable
checkpoints, qualification, target-host gate and Commander publication contract.
The full HVSC census is deliberately deferred to the user's faster machine.
The historical v4 SIDLite pilot is not a final dual-engine release.

## Findings and fixes

1. **Short sampled effects could bypass audio.** The register fast path only
   checked density when its 100,000-cycle window ended. Dense bursts shorter
   than that, including final tails, could be accepted using timing tolerances
   intended for musical control writes. Density is now checked while accumulating
   writes; three volume samples within 2,000 cycles also require audio, without
   needing 100 writes. Regression coverage includes short and final bursts.
2. **Infrastructure errors could become musical silence.** Native terminal
   packets did not carry their existing error classification into the audio
   consumer. Allocation or engine failures could be padded as though the tune
   halted. Packets now carry `errorKind`; malformed terminals and resource/engine
   failures fail the measurement. Only an explicitly diagnosed illegal-instruction
   CPU halt may contribute a silent tail, which still needs listener comparison.
   Tests distinguish resource, engine, malformed, misclassified and genuine halt
   terminals. Reference failures never establish compatibility.
3. **Unresolved checkpoints were not retried.** Resume selected failed or absent
   jobs but preserved successful jobs whose decisions remained unknown. Both
   selection and append/reload now permit replacing unresolved rows while
   protecting resolved rows from duplicate successful measurements.
4. **Publication lacked portable qualification evidence and a final verifier.**
   A full run now copies qualification and benchmark records into checksummed
   artifacts. `releaseReady` requires complete decisions plus that evidence.
   `verify-publication.ts` requires the full HVSC85 inventory, zero unresolved
   decisions, qualification/measurement binding and checksums, then independently
   re-encodes JSON exceptions to compare every packed record and aggregate count.
   Synthetic complete-bundle tests reject corruption, profile mixing and partial
   output. These fixtures are test data, never a measured catalogue.
5. **The main README did not define the operator/consumer handoff.** It now
   includes prerequisites, one-command execution, stage/resume controls, budget
   behavior, output locations, a verified post-census release command to
   `chrisgleissner/sidflow-data`, and explicit allow/hide/warn rules.
6. **The full-suite gate exposed Bun coverage/WASM instability.** The first
   final-source full run failed in Essentia's WASM indirect call; an earlier run
   also crashed the real SID worker stress test under coverage. The repository's
   existing uninstrumented phase now runs those tests with unchanged assertions
   and the same per-file process isolation as its instrumented phase. Nothing is
   skipped. Qualification also binds the test runner and runtime wrapper sources.

## Conditions a consumer must preserve

- Use the manifest and all sidecars together, with a trusted pinned manifest hash.
  Checksums prove consistency, not independent authenticity of a release.
- Match the exact engine/profile, ROM images, absent-bank initialization, sample
  rate, power-on delay, pull size, chip model and one-based subtune identity.
- An unset exception bit only supports compatibility after verifying the complete
  qualified inventory and the selected file/subtune's scope. Missing identities,
  unknowns, mismatches and exhausted horizons remain unverified.
- Stop or reset at the recorded horizon. The comparison is finite listener-policy
  equivalence against an engine's authentic three-ROM reference. Engineering
  audibility thresholds and finite native/WASM controls do not establish universal
  human audibility, real-C64 fidelity or correctness of every emulator reference.
- A KERNAL+BASIC incompatibility can indicate a CHARGEN dependency. It does not
  establish that every possible playback configuration fails.
- Preserve raw checkpoints, qualification logs, native/source identities and the
  run's source revision alongside a final release for reproduction and audit.

## Validation

The final renderer/decision sources passed 192 native digital/audio versus fresh
WASM PCM/absolute-trace controls, 32 concurrent repeated dual-engine transport
jobs, the workspace build and strict audit-script TypeScript checking. The
qualifier issued a source/binary/log-bound certificate after these literal
consecutive full-suite outputs:

```text
Full run 1: 2975 pass / 0 fail / 0 skip
Full run 2: 2975 pass / 0 fail / 0 skip
Full run 3: 2975 pass / 0 fail / 0 skip
```

Qualification identity: `812d25fac32ebb2d2ad23c36ea541c76d1ea131a889cf7dc467a924869153ea9`.
Measurement identity: `6affdd9f7ba2ffda73d79dde2b3efcfeace4a4191b48089f49df780d7479208c`.

| Evidence log | SHA-256 |
|---|---|
| `parity.log` | `80d610331b5fa1a2183e5c345aa01e6809dd6dd59e4385a68a94cc3a64c74feb` |
| `transport.log` | `efddeeabacde2af86b0c7be61d74a07f919383bd052971e69c2e7653c8bbc038` |
| `full-1.log` | `3d753337dbed9747e06bf3ed99bed00bb38dd13f420194937497f6162a1a3000` |
| `full-2.log` | `90356c8e7c8c026cc0e3a77da5a41154083b265d774fbc7febf214ded34909dc` |
| `full-3.log` | `15b842c6c5e4427d2ddd5dfa5096ae2d4a2edf98f3e8f40102358d8af55e0fbc` |

The certificate and raw logs are retained under
`workspace/rom-audit-screen-qualification/`. The launcher rechecks these before
reuse and requalifies on the target machine when sources/binaries differ.
Focused regressions passed 34/34; package, config and similarity-export fixture
checks passed. The worker-lifecycle regression implicated by CI also passed
three consecutive runs on the repository's declared Bun 1.3.1 runtime.

CI exposed a runtime mismatch: its rolling image supplied Bun 1.3.11 while
`package.json` and local qualification declared 1.3.1. The workflow now explicitly
installs the package-declared version with `oven-sh/setup-bun@v2` before building
or testing. The failed job was a native runtime crash in the worker-lifecycle
regression, not a failing classification assertion. CI must pass on the final
commit before merge; no tests were skipped to address it.

Local `bun run test:e2e` passed all 10 pipeline tests and all 122 browser tests.
The independent GitHub Codex review of classifier commit `7c8590dc1d` reported
no major issues; there are no unresolved review threads. The follow-up changes
are the CI runtime selection and this validation record. Final CI and merge
outcomes are recorded on [PR #109](https://github.com/chrisgleissner/sidflow/pull/109).
No full-corpus timing or classification result is claimed.

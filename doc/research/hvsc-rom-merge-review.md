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

Final-source qualification and complete repository validation are in progress.
Literal full-suite outcomes and the source-bound certificate will be recorded
here before merge. No full-corpus timing or classification result is claimed.

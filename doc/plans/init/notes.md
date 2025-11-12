# SIDFlow Rollout Notes

**Required reading:** `sidflow-project-spec.md`

## Assumptions

- Bun and `sidplayfp` binaries are available on developer machines and CI runners.
- HVSC base archive and update deltas remain accessible via `https://hvsc.brona.dk/`.
- Essentia.js and TensorFlow.js can run under Bun without native addon workarounds.
- Sample HVSC subset will be curated for automated tests to keep runtime manageable.

## Dependencies

- Reliable network access to download HVSC archives and apply deltas.
- Archive extraction handled by bundled `7zip-min`; ensure the package stays pinned and audited.
- Codecov account with repository token configured in CI secrets.
- Adequate storage for HVSC mirror, WAV cache, and generated models.

## Risks & Mitigations

- **Archive availability:** Mirror checksums and list alternate mirrors; fail gracefully with actionable messaging.
- **`sidplayfp` incompatibility:** Encapsulate invocation in `sidflow-common`; document fallback build instructions.
- **Model accuracy:** Start with conservative smoothing (e.g., rounding to nearest band) and expose review reports for QA sign-off.
- **JSON drift:** Provide shared serializer helper and tests that diff generated artifacts for key ordering stability.
- **Long-running tasks:** Support resume/snapshot points in fetch/classify flows and log progress for visibility.

## Open Questions

- Do we bundle or document installation for Essentia.js model dependencies (e.g., additional data files)?
- Should metadata sidecars (`*.sid.meta.json`) include parsing provenance to aid future web experiences?
- What size of HVSC subset is acceptable for CI without exceeding time limits?
- Are there licensing considerations for distributing pre-trained models alongside GPLv2 code?

## Follow-Ups

- Draft acceptance test scripts for each CLI to pair with manual QA during phase gates.
- Coordinate with future “SIDFlow Radio” stakeholders to confirm data contracts required beyond Phase 4.
- Evaluate feasibility of `sidplayfp` containerization to normalize behavior across environments.

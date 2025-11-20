# SIDFlow Rollout Plan

**Required reading:** `sidflow-project-spec.md`

## Vision

SIDFlow delivers a CLI-first toolkit for Commodore 64 SID collection management, building toward future streaming capabilities without rework. The rollout balances foundational infrastructure, manual workflows, and automation so each phase is production-ready.

## Guiding Principles

- Keep the monorepo shippable at the end of every phase with documented CLIs and reproducible artifacts.
- Centralize shared logic in `sidflow-common` to avoid divergence across packages.
- Enforce deterministic JSON output and consistent filesystem layout for tags, metadata, and WAV caches.
- Maintain ≥90% automated test coverage with Vitest and Codecov in CI.
- Treat `sidplayfp` integration as a shared contract with configurable overrides.

## Phase Overview

| Phase | Goal | Primary Deliverables |
|-------|------|-----------------------|
| 1 | Establish monorepo, shared utilities, and CI guardrails | Bun workspace, `sidflow-common`, `.sidflow.json`, Copilot guidance, CI pipeline |
| 2 | Enable resilient HVSC synchronization | `sidflow-fetch` CLI, archive/delta updater, version state tracking |
| 3 | Deliver manual tagging workflow | `sidflow-tag` CLI, playback controls, deterministic sidecar tag files |
| 4 | Automate classification on top of manual data | `sidflow-classify` CLI, WAV caching, Essentia.js feature extraction, TF.js model, aggregated auto-tag files |

## Governance

- Each phase requires updated docs (`README.md`, relevant CLI help) and passing CI prior to sign-off.
- Phase reviews validate CLI UX against a curated HVSC sample and confirm artifact determinism.
- Changes land through reviewed pull requests; Tech Lead approval required for cross-package contracts.

## Success Criteria

- All CLIs run end-to-end with configuration sourced from `.sidflow.json` or CLI overrides.
- Deterministic artifacts (tags, metadata, auto-tags) remain reproducible across environments.
- Test coverage stays at or above 90% with Codecov status gating merges.
- Documentation stays current, referencing the spec for authoritative requirements.

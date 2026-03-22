# C64U Migration Plan

## Scope

The project now treats `C64U` as the preferred short name for the Commodore 64 Ultimate in new internal fixes, new helper files, and new user-facing controls. Existing external compatibility contracts still use `ultimate64` in several places and cannot be renamed atomically without breaking users.

This document records the phased migration plan so new work stays consistent without destabilizing existing configs, APIs, and test fixtures.

## Completed

- New LED control surfaces use `c64u` naming:
  - `packages/sidflow-common/src/c64u-led.ts`
  - `packages/sidflow-play/src/c64u-led-cli.ts`
  - `/api/play/c64u-led`
- Station playback password forwarding uses `--c64u-password` consistently.
- Newly added Play tab UX copy refers to `C64U` instead of introducing new `ultimate64*` fix surfaces.

## Compatibility Constraints

The following identifiers remain intentionally unchanged for now because they are already part of persisted or documented contracts:

- Config keys:
  - `render.ultimate64.*`
- Render engine identifiers:
  - `ultimate64`
- Environment variables:
  - `SIDFLOW_ULTIMATE64_HOST`
  - `SIDFLOW_ULTIMATE64_HTTPS`
- Browser preference payload keys:
  - `ultimate64`
- Health and playback detection payload keys:
  - `ultimate64`

## Remaining Legacy Surfaces

### Internal code symbols

- `Ultimate64Client`
- `Ultimate64AudioCapture`
- `Ultimate64RenderConfig`
- internal variables such as `ultimate64Client`, `ultimate64Capture`, and `ultimateConfig`

### File names

- `packages/sidflow-common/src/ultimate64-client.ts`
- `packages/sidflow-common/src/ultimate64-capture.ts`
- related integration tests named `ultimate64-*`

### Stable public contracts

- config schema fields under `render.ultimate64`
- enum/string values such as `ultimate64` in engine selection and render matrices
- existing API payload fields and detection records exposing `ultimate64`

## Phased Migration

### Phase 1: Internal-first aliases

- Add `C64UClient` / `C64UAudioCapture` aliases alongside existing class names.
- Add internal helper/type aliases for `C64URenderConfig` while preserving `Ultimate64RenderConfig` exports.
- Prefer `c64u*` variable names in all newly touched code.

### Phase 2: Non-breaking API expansion

- Accept optional `c64u` aliases in admin/browser preference payloads while still serializing canonical legacy keys.
- Add compatibility tests that prove both legacy and alias keys map to the same runtime behavior.

### Phase 3: Breaking-contract cleanup

- Rename persisted/public identifiers only in a deliberate compatibility window with:
  - migration notes
  - config upconverters
  - API compatibility shims
  - deprecation coverage in tests and docs

## Rule For New Work

- New files, helper modules, routes, flags, and user-facing labels should use `c64u` naming unless they must match an existing stable external contract.
- When touching legacy `ultimate64*` code, prefer local variable renames to `c64u*` only when that change does not alter public payloads or persisted configuration keys.
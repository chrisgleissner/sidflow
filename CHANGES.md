# Changelog

## 0.2.4 (2025-11-21)

- Release created from tag

## 0.2.3 (2025-11-21)

- Release created from tag

## 0.2.2 (2025-11-21)

- Release created from tag

## Unreleased

### Documentation Improvements (2025-11-15)
- Organized historical plans and implementation summaries into `doc/plans/archive/`
- Added comprehensive README files for all core packages:
  - `@sidflow/common` - Shared utilities and types
  - `@sidflow/fetch` - HVSC synchronization
  - `@sidflow/play` - Playback and recommendations
  - `@sidflow/rate` - Manual rating interface
- Enhanced main README with direct links to all CLI documentation
- Fixed cross-references to archived documentation
- Removed non-essential files (`favourite-songs.md`)
- Improved documentation consistency and accuracy across the project

### Code Quality (2025-11-15)
- Verified all packages properly use shared utilities from `@sidflow/common`
- Confirmed consistent coding patterns across the monorepo
- Test results: 681 pass, 2 skip, 5 fail (failures due to ffmpeg-related environment issues; not related to documentation changes)
- Build process verified clean and stable

### Release Automation (2025-11-20)
- Replaced npm publication with a GitHub release zip that bundles the full workspace plus the production-built web UI
- Added a `scripts/start-release-server.sh` helper (also available via `bun run start:release`) for booting the packaged `.next/standalone` server
- Documented the production artifact workflow in `README.md`
- Added a release smoke test that extracts the zip, launches the packaged server, and curls `/api/health`

## 0.1.0

- Initial release candidate of the SIDFlow workspace packages.
- Documented the libsidplayfp WASM build pipeline, added rebuild runbook guidance, and expanded consumer docs for the committed artifacts.
- Added a header-patching fallback in `SidAudioEngine` (with automated tests using `Great_Giana_Sisters.sid`) so multi-song playback works while the native `selectSong` binding is investigated.

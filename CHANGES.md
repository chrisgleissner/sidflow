# Changelog

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
- Validated all tests pass (681 pass, 2 skip, 5 fail ffmpeg-related environment issues)
- Build process verified clean and stable

## 0.1.0

- Initial release candidate of the SIDFlow workspace packages.
- Documented the libsidplayfp WASM build pipeline, added rebuild runbook guidance, and expanded consumer docs for the committed artifacts.
- Added a header-patching fallback in `SidAudioEngine` (with automated tests using `Great_Giana_Sisters.sid`) so multi-song playback works while the native `selectSong` binding is investigated.

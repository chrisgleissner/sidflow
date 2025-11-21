# Changelog


## 0.1.0

- Initial release candidate of the SIDFlow workspace packages.
- Documented the libsidplayfp WASM build pipeline, added rebuild runbook guidance, and expanded consumer docs for the committed artifacts.
- Added a header-patching fallback in `SidAudioEngine` (with automated tests using `Great_Giana_Sisters.sid`) so multi-song playback works while the native `selectSong` binding is investigated.

# sidplayfp Invocation Catalog

Unique command-lines that invoke the native `sidplayfp` binary inside this repo, along with where each form lives in the code. The new WASM/browser flows mirror those signatures and are regression-tested with `test-data/C64Music/DEMOS/0-9/10_Orbyte.sid`, which plays without bundled ROMs, so every scenario works identically in remote-browser deployments.

## Basic playback (no flags)

- **Command shape:** `sidplayfp <sidFile>`
- **Purpose:** Start playback of a SID file using the default output device.
- **Call sites:**
  - `packages/sidflow-rate/src/cli.ts:186`
  - `packages/sidflow-play/src/playback.ts:169`
  - `packages/sidflow-web/app/api/rate/random/route.ts:95`

### CLI flow

- `sidplayfp` starts at `main` (see `doc/plans/wasm/cpp-references/sidplayfp/src/main.cpp:41-101`), constructs a `ConsolePlayer`, and routes all arguments through `ConsolePlayer::args` before entering the play loop.
- `ConsolePlayer::args` uses the default `SOUNDCARD` output, keeps the first positional SID path (no extra options), and loads the tune via `SidTune::load`, which is the same path followed by all playback commands (see `doc/plans/wasm/cpp-references/sidplayfp/src/args.cpp:181-229`).
- `ConsolePlayer::play` drives the loop: it ensures the tune is loaded, configures audio drivers, fast‑forwards to the start if needed, and repeatedly calls `m_engine.play` to generate PCM chunks while piping them to the selected driver (`doc/plans/wasm/cpp-references/sidplayfp/src/player.cpp:1092-1206`).

### Library bridge

- `ConsolePlayer` owns a `sidplayfp` engine instance (`doc/plans/wasm/cpp-references/sidplayfp/src/player.h:115-220`) that wraps `libsidplayfp::Player`. When `ConsolePlayer::createSidEmu` selects an emulation (e.g., the default `ReSIDfp`) it configures builders backed by `libsidplayfp` and installs them through `SidConfig` (`doc/plans/wasm/cpp-references/sidplayfp/src/player.cpp:611-710`).
- `sidplayfp::sidplayfp` delegates every operation to `libsidplayfp::Player` (`doc/plans/wasm/cpp-references/libsidplayfp/src/sidplayfp/sidplayfp.cpp:36-142`), so the actual audio generation happens in `Player::play`, which clocks the virtual C64 and SID chips, collects buffer data, and returns sample counts that the CLI mixes into the chosen driver (`doc/plans/wasm/cpp-references/libsidplayfp/src/player.cpp:214-274`).

### WASM/browser invocation

- Modern clients instantiate `SidAudioEngine`, stream the SID bytes from the server, and issue a tiny `renderSeconds(0.02)` call to obtain the first chunk. The resulting `Int16Array` is queued into the browser’s `AudioContext`, so every listener hears the tune on their own machine even if the SID asset lives on a remote server.
- `packages/libsidplayfp-wasm/test/wasm-invocations.test.ts:26-42` covers this flow end to end using `10_Orbyte.sid`, ensuring that the initial chunk size matches the sample budget needed for smooth playback.
## Offset playback for rate UI

- **Command shape:** `sidplayfp -b<MM:SS.mmm> <sidFile>` (the `-b` flag is omitted when no offset is requested)
- **Purpose:** Begin playback from a non-zero position when the web rate UI resumes a track mid-way.
- **Call site:** `packages/sidflow-web/lib/rate-playback.ts:61-69`

### CLI flow

- `ConsolePlayer::args` specially handles `-b` by parsing the human-readable time into milliseconds and storing it in `m_timer.start`, which flags the timer as valid for later use (`doc/plans/wasm/cpp-references/sidplayfp/src/args.cpp:181-220`).
- During `ConsolePlayer::play`, `m_timer.start` is added to the requested stop time and, if playback is beginning, `getBufSize` waits until `m_timer.current` has reached that start timestamp (`doc/plans/wasm/cpp-references/sidplayfp/src/player.cpp:1004-1235`), so the “[start]” value becomes the first sample that reaches the audio driver.

### Library bridge

- The fast-forward/offset logic invokes `m_engine.fastForward(...)` before the real-time loop, which is implemented inside the `sidplayfp` wrapper and ultimately inside `libsidplayfp::Player`; the player clears buffers and clocks the virtual C64 until the requested start point, so the subsequent `play` calls stream the SID from the offset rather than from zero (`doc/plans/wasm/cpp-references/sidplayfp/src/player.cpp:959-1235` and `doc/plans/wasm/cpp-references/libsidplayfp/src/player.cpp:234-274`).

### WASM/browser invocation

- The browser sets the “start song” by calling `SidAudioEngine.selectSong`, which rewrites the SID header before playback, functionally mirroring `-b`/`-o` without needing CLI flags.
- After a short warm-up we now mirror `sidplayfp -w` by rendering the tune into an in-memory PCM buffer capped by `cacheSecondsLimit` (default 600 s, settable per `SidAudioEngine`). This eager cache is a deliberate trade-off: it costs CPU once per track, but it makes slider scrubbing nearly instantaneous on every client without streaming audio from the server, just as the CLI renders a WAV before playback.
- For in-song scrubbing the UI calls `await engine.seekSeconds(positionSeconds, chunkCycles)` and then `renderSeconds`. The helper either fast-forwards through the live context (before the cache finishes) or serves PCM slices directly from the buffer, so the next `renderSeconds` call can flush samples immediately (<20 ms for cached segments).
- `packages/libsidplayfp-wasm/test/wasm-invocations.test.ts:44-65` covers both behaviors: it asserts that cached slices for `10_Orbyte.sid` exactly match the PCM returned after a seek and that near-end jumps remain sub-20 ms once the background cache completes.

## WAV rendering for classification

- **Command shape:** `sidplayfp -w<output.wav> [-o<songIndex>] <sidFile>`
- **Purpose:** Render SID audio to WAV files during WAV cache builds; `-o` is added only when a specific sub-song index is selected.
- **Call site:** `packages/sidflow-classify/src/index.ts:252-267`

### CLI flow

- `ConsolePlayer::args` turns on WAV output in response to `-w`/`--wav`, marks the driver as file-based, and tracks the optional filename/hash (`doc/plans/wasm/cpp-references/sidplayfp/src/args.cpp:400-457`), while `-o` and the related `-ol`/`-os` helpers adjust `m_track.first` so `SidTune::selectSong` loads the requested sub-song (`doc/plans/wasm/cpp-references/sidplayfp/src/args.cpp:230-260`).
- With WAV output enabled, `createOutput` instantiates a `WavFile` driver, configures sample rate/precision, and keeps a null driver ready for silence; the usual playback loop writes the PCM payload emitted by `m_engine.play` straight to that file instead of the speakers (`doc/plans/wasm/cpp-references/sidplayfp/src/player.cpp:449-607`).

### Library bridge

- Each WAV render still runs through the same `sidplayfp`/`libsidplayfp::Player` pipeline: `sidplayfp::sidplayfp` forwards `load`, `play`, and `config` calls to `libsidplayfp` (`doc/plans/wasm/cpp-references/libsidplayfp/src/sidplayfp/sidplayfp.cpp:36-142`), and `Player::play` clocks the C64/SID chips for every cycle (`doc/plans/wasm/cpp-references/libsidplayfp/src/player.cpp:214-274`), ensuring precise channel counts and sample rates for the generated WAV files.

### WASM/browser invocation

- For downloadable WAVs or cache rebuilds we spin up `SidAudioEngine` (in Node or a service worker), call `renderSeconds` with a larger duration (≈0.3 s) and a smaller `cyclesPerChunk`, and stream successive buffers into a WAV encoder. This matches the native CLI’s “render to file” semantics without spawning the binary.
- `packages/libsidplayfp-wasm/test/wasm-invocations.test.ts:64-76` demonstrates that this longer render path produces deterministic chunks from `Great_Giana_Sisters.sid`, proving the WASM pipeline can replace the native call on both servers and browsers.

## Metadata extraction fallback

- **Command shape:** `sidplayfp -t1 --none <sidFile>`
- **Purpose:** Dump textual metadata (title/author/released) when direct SID parsing fails; `-t1` limits runtime and `--none` suppresses audio output.
- **Call site:** `packages/sidflow-classify/src/index.ts:496-523`

### CLI flow

- The `-t1` flag sets `m_timer.length` to one second and marks the timer as valid, while `--none` clears both audio output and SID emulation so nothing is played (`doc/plans/wasm/cpp-references/sidplayfp/src/args.cpp:230-305`, `doc/plans/wasm/cpp-references/sidplayfp/src/args.cpp:520-594`).
- Even with no audible output, the player still loads the tune (`m_tune.load`) and invokes `menu()`/`updateDisplay()`, causing `menu.cpp` to print the metadata strings derived from `SidTuneInfo`, which the TypeScript fallback parser later scrapes from stdout (`doc/plans/wasm/cpp-references/sidplayfp/src/menu.cpp:150-210`).

### Library bridge

- Metadata parsing relies on `SidTune`, which wraps `SidTuneBase::load` for every supported format and exposes `SidTune::getInfo` to the CLI (`doc/plans/wasm/cpp-references/libsidplayfp/src/sidplayfp/SidTune.cpp:80-117`); once the file is loaded the CLI reads title/author/released directly from `SidTuneInfo`, so the interaction never reaches the PCM-generating part of `libsidplayfp`, but it still depends on the library to understand the SID headers.

### WASM/browser invocation

- In the browser we mirror `--none` by loading the SID buffer and reading `getTuneInfo` immediately, allowing the UI to show metadata before playback begins.
- `packages/libsidplayfp-wasm/test/wasm-invocations.test.ts:53-62` validates that `SidAudioEngine` exposes the title/author/release strings for `Great_Giana_Sisters.sid` without touching audio output.

## Availability check in tests

- **Command shape:** `sidplayfp --version`
- **Purpose:** Verify that the binary is installed before running end-to-end tests that depend on real playback.
- **Call site:** `test/e2e.test.ts:43`

### CLI flow

- `sidplayfp --version` walks the same `main`/`ConsolePlayer` path but immediately prints the version banner produced in `menu.cpp`, which appends the compile-time `VERSION` constant to the CLI heading before exiting (`doc/plans/wasm/cpp-references/sidplayfp/src/menu.cpp:150-210`).

### Library bridge

- Because `--version` only formats and prints static information, it never reaches the `libsidplayfp` code that generates audio; the CLI bypasses `m_engine.play` entirely whenever the version/help banner is requested.

### WASM/browser invocation

- Instead of `--version`, web bundles assert that `loadLibsidplayfp` can instantiate the WASM module and return a functioning `SidPlayerContext`. This guarantees the artifacts are wired up before any playback attempt.
- `packages/libsidplayfp-wasm/test/loader.test.ts:5-20` is the guardrail: it loads the module, configures a context, and exercises a zero-length render so regressions are caught in CI.

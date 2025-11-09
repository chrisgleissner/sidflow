# @sidflow/libsidplayfp-wasm

This package hosts the WebAssembly build pipeline and TypeScript bindings for `libsidplayfp`. It exposes a loader that instantiates the SID emulator in both Node.js (Bun) and browser runtimes.

## Structure

- `docker/` – Dockerfile and entrypoint used to compile `libsidplayfp` with Emscripten.
- `scripts/` – Thin wrappers for running the Docker build locally or in CI.
- `src/` – TypeScript bindings that locate the generated artifacts and provide the `SidAudioEngine` helper.
- `dist/` – Generated JavaScript, TypeScript, and `.wasm` artifacts produced by the Docker build.
- `examples/` – Bun demos that render SID tunes to PCM/WAV for manual testing.

## Building the WASM Bundle

```bash
cd packages/libsidplayfp-wasm
bash ./scripts/build.sh
```

The script ensures Docker is available, builds the image defined in `docker/Dockerfile`, and stores the resulting artifacts in `dist/`.

From the repository root you can also run:

```bash
bun run wasm:build
```

This helper runs the upstream check, executes the Docker build, and updates `data/wasm-build.json` with the new artifact metadata.

## Using the Loader

The TypeScript entrypoint exports two helpers:

```ts
import loadLibsidplayfp, { SidAudioEngine } from "@sidflow/libsidplayfp-wasm";

const module = await loadLibsidplayfp();
const player = new module.SidPlayerContext();

const engine = new SidAudioEngine();
await engine.loadSidBuffer(bytes);
const samples = await engine.renderSeconds(60);
```

Consumers may override `locateFile` to control how the `.wasm` file is resolved at runtime (useful when bundlers relocate assets).

## Demos

Run the Bun demo after building the artifacts:

```bash
bun run examples/demo.ts path/to/song.sid output.wav 90
```

The command renders 90 seconds of audio and writes a stereo 16-bit WAV file.

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

## Integrating in SIDFlow Packages

- Classification and training flows should import `loadLibsidplayfp` from `@sidflow/libsidplayfp-wasm` at runtime and share a single module instance per process.
- Prefer the higher-level `SidAudioEngine` helper when you only need PCM buffers or WAV emission; it encapsulates memory management and sample format conversion.
- The committed artifacts live at `packages/libsidplayfp-wasm/dist/`. When bundling for the web, copy both `libsidplayfp.js` and `libsidplayfp.wasm` or configure your bundler to treat them as assets.
- CLI utilities can rely on the default `locateFile` implementation, which resolves the `.wasm` beside the generated JS loader using `import.meta.url`.
- Browser consumers must provide their own `locateFile` that serves the `.wasm` from a static asset path. See `packages/libsidplayfp-wasm/examples/debug-render.ts` for a Bun/Node example that customizes resolution.

## Operational Runbook Snapshot

1. Run `bun run wasm:check-upstream` to compare the recorded upstream commit in `data/wasm-build.json` with the latest `libsidplayfp` default branch.
2. If the tool reports new commits or you need to refresh the artifact, execute `bun run wasm:build`. This command rebuilds the Docker image, writes refreshed outputs to `dist/`, and updates the metadata file.
3. After committing new artifacts, re-run `bun run build && bun run test` to confirm the deterministic outputs still load across the workspace.
4. CI restores the upstream clone cache automatically; if you notice cache misses, clear `.cache/upstream` locally and rerun the build to repopulate it before committing.

## Demos

Run the Bun demo after building the artifacts:

```bash
bun run examples/demo.ts path/to/song.sid output.wav 90
```

The command renders 90 seconds of audio and writes a stereo 16-bit WAV file.

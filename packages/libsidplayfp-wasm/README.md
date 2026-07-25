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

## Choosing a SID engine

Two artifacts are built from the same bindings and shipped side by side:

| Engine | Artifact | Speed | Use it for |
|--------|----------|-------|------------|
| `sidlite` (default) | `dist/sidlite/libsidplayfp.wasm` | ~30-40x realtime | Everyday use. Sounds good, and most listeners will not hear the difference. |
| `residfp` | `dist/libsidplayfp.wasm` | ~2-6x realtime | The cycle-accurate reference, when you want the last few percent of fidelity. |

Both render cleanly, multi-SID included, and both are built from the same bindings. The measured difference is DC offset: on `Commando`, reSIDfp sits at 0.003 and SIDLite at 0.10. Peaks and spectral balance are close, which is why SIDLite is the default — it is an order of magnitude cheaper for a difference that mostly matters to audiophiles and to comparison work.

Select per call, or globally with the `SIDFLOW_SID_ENGINE` environment variable:

```ts
const reference = await loadLibsidplayfp();                      // residfp
const fast      = await loadLibsidplayfp({ engine: "sidlite" });

console.log(fast.getSidEngineName()); // "WasmSIDLite"
```

An explicit `engine` argument always beats `SIDFLOW_SID_ENGINE`. Ask for the engine you depend on rather than relying on the default — a test that means reSIDfp should say so, or an environment variable can silently redirect it.

To build an artifact yourself:

```bash
SIDFLOW_SID_ENGINE=sidlite bun run build:wasm   # writes dist/
SIDFLOW_DIST_DIR=/tmp/compare bun run build:wasm  # ...or somewhere else
```

The build asserts, in both directions, that the artifact contains the builder you asked for and not the other one, so neither engine can silently become the other.

## Using this package from another program

The package is a normal ES module with no runtime dependencies. It works in Node, Bun, and browsers.

```ts
import loadLibsidplayfp, { SidAudioEngine } from "@sidflow/libsidplayfp-wasm";

// Low-level: a direct handle on the C++ player
const module = await loadLibsidplayfp();
const player = new module.SidPlayerContext();
try {
  player.configure(48000, /* stereo */ true);
  player.loadSidBuffer(new Uint8Array(sidFileBytes));
  player.selectSong(0);
  const pcm = player.render(100000); // Int16Array, interleaved
} finally {
  player.delete(); // embind objects are not garbage collected
}

// Higher-level: memory management and format conversion handled for you
const engine = new SidAudioEngine();
await engine.loadSidBuffer(bytes);
const samples = await engine.renderSeconds(60);
```

Two things catch people out:

- **Always `delete()` a `SidPlayerContext`.** Embind objects are not garbage collected; leaking one keeps its SID emulations alive inside the shared module and changes the allocation pattern seen by later renders.
- **Load the C64 ROMs if you care about accuracy.** Without them libsidplayfp initialises a tune but never advances it, and many tunes will not sound right:

  ```ts
  player.setSystemROMs(kernal, basic, chargen); // 8 KB, 8 KB, 4 KB
  ```

  The ROMs are copyrighted and are not shipped here; dump them from a real C64 or supply your own.

### Resolving the `.wasm` in a bundler

By default the loader resolves the `.wasm` beside the generated JS using `import.meta.url`, which is what you want for Node, Bun, and most CLI use. When a bundler relocates assets, override `locateFile`:

```ts
const module = await loadLibsidplayfp({
  locateFile: (asset) => `/static/wasm/${asset}`,
});
```

For a browser build, copy `dist/libsidplayfp.js` and `dist/libsidplayfp.wasm` (plus `dist/sidlite/` if you use SIDLite) into your static assets, or configure the bundler to treat them as assets. `SIDFLOW_LIBSIDPLAYFP_WASM_PATH` overrides the binary path in Node-like environments.

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

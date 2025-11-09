# libsidplayfp WebAssembly Tooling (Relocated)

The self-contained Docker workflow and TypeScript bindings previously hosted in
this `working-code/` folder now live in the workspace package
`packages/libsidplayfp-wasm/`.

That package contains:

- `docker/` – Dockerfile + entrypoint used to compile `libsidplayfp` with Emscripten.
- `scripts/` – Build helpers, including the thread-guard injection script.
- `src/` – TypeScript loader and the `SidAudioEngine` helper.
- `dist/` – Generated `libsidplayfp.js/.wasm/.d.ts` artifacts.
- `examples/` – Bun demos for rendering SID tunes to WAV.

Refer to `packages/libsidplayfp-wasm/README.md` for up-to-date build and usage
instructions. This directory is retained as a pointer so historical references
continue to resolve.

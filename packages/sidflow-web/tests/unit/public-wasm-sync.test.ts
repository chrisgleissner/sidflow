/**
 * public/wasm/ must match the artifact the workspace actually builds.
 *
 * These files are a hand-copied deployment of packages/libsidplayfp-wasm/dist,
 * and they rotted: from 2026-03-22 until this test was written they held the
 * SIDLite build that shipped by mistake, so the web player kept serving the
 * defective engine long after dist/ was fixed. Nothing noticed, because the
 * copies load and play — badly.
 *
 * The browser flattens every engine onto one URL (`/wasm/<asset>`), so exactly
 * one artifact can be deployed and both the loader glue and the binary must
 * come from the same build. Hence a byte-for-byte comparison rather than a
 * "looks about right" check.
 */

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..", "..");
const PUBLIC_WASM = path.join(WEB_ROOT, "public", "wasm");
const DIST = path.resolve(WEB_ROOT, "..", "libsidplayfp-wasm", "dist");

/**
 * The Emscripten pair must match dist/ byte-for-byte: the glue and the binary
 * are generated together and pairing them across builds aborts the module.
 */
const PAIRED_FILES = ["libsidplayfp.js", "libsidplayfp.wasm"] as const;

/**
 * The TypeScript wrappers are path-adapted copies, not byte copies — dist/index.js
 * imports "../dist/libsidplayfp.js", which does not resolve when the file is
 * served from /wasm/. So they get a served-path check rather than a checksum.
 */
const WRAPPER_FILES = ["index.js", "player.js"] as const;

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

describe("public/wasm deployment", () => {
  for (const file of PAIRED_FILES) {
    it(`${file} is byte-identical to dist/`, () => {
      const deployed = path.join(PUBLIC_WASM, file);
      const built = path.join(DIST, file);
      expect(
        sha256(deployed),
        `public/wasm/${file} is stale. Refresh it after rebuilding the WASM artifact:\n` +
          `    cp packages/libsidplayfp-wasm/dist/${file} packages/sidflow-web/public/wasm/${file}`,
      ).toBe(sha256(built));
    });
  }

  for (const file of WRAPPER_FILES) {
    it(`${file} resolves its imports inside the served directory`, () => {
      const source = readFileSync(path.join(PUBLIC_WASM, file), "utf8");
      expect(
        source.includes("../dist/"),
        `public/wasm/${file} imports from ../dist/, which does not exist under the served /wasm/ path. ` +
          `Copying dist/${file} verbatim breaks it; rewrite the specifier to "./".`,
      ).toBe(false);
    });
  }

  for (const file of PAIRED_FILES) {
    it(`sidlite/${file} is byte-identical to dist/sidlite/`, () => {
      const deployed = path.join(PUBLIC_WASM, "sidlite", file);
      const built = path.join(DIST, "sidlite", file);
      expect(
        sha256(deployed),
        `public/wasm/sidlite/${file} is stale. Re-run the worklet build to resync:\n` +
          `    cd packages/sidflow-web && bun run scripts/build-worklet.ts`,
      ).toBe(sha256(built));
    });
  }

  it("deploys SIDLite as the SIDLite build", () => {
    const binary = readFileSync(path.join(PUBLIC_WASM, "sidlite", "libsidplayfp.wasm")).toString("latin1");
    expect(binary.includes("WasmSIDLite"), "public/wasm/sidlite/libsidplayfp.wasm is not a SIDLite build").toBe(true);
    expect(binary.includes("WasmReSIDfp"), "public/wasm/sidlite/libsidplayfp.wasm contains reSIDfp").toBe(false);
  });

  it("deploys reSIDfp at the root, and only reSIDfp", () => {
    // The browser player asks for `engine: "residfp"` explicitly, so the glue it
    // loads expects the reSIDfp binary. Deploying the other one aborts the
    // module at init with "Engine not initialized" — which is exactly how this
    // surfaced in the E2E suite.
    const binary = readFileSync(path.join(PUBLIC_WASM, "libsidplayfp.wasm")).toString("latin1");
    expect(binary.includes("WasmReSIDfp"), "public/wasm/libsidplayfp.wasm is not a reSIDfp build").toBe(true);
    expect(binary.includes("WasmSIDLite"), "public/wasm/libsidplayfp.wasm still contains SIDLite").toBe(false);
  });
});

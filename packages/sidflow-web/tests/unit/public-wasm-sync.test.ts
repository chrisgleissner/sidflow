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

const DEPLOYED_FILES = ["index.js", "libsidplayfp.js", "libsidplayfp.wasm", "player.js"] as const;

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

describe("public/wasm deployment", () => {
  for (const file of DEPLOYED_FILES) {
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

  it("deploys reSIDfp, and only reSIDfp", () => {
    // The browser player asks for `engine: "residfp"` explicitly, so the glue it
    // loads expects the reSIDfp binary. Deploying the other one aborts the
    // module at init with "Engine not initialized" — which is exactly how this
    // surfaced in the E2E suite.
    const binary = readFileSync(path.join(PUBLIC_WASM, "libsidplayfp.wasm")).toString("latin1");
    expect(binary.includes("WasmReSIDfp"), "public/wasm/libsidplayfp.wasm is not a reSIDfp build").toBe(true);
    expect(binary.includes("WasmSIDLite"), "public/wasm/libsidplayfp.wasm still contains SIDLite").toBe(false);
  });
});

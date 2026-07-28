/**
 * public/wasm/ must match the artifact the workspace actually builds.
 *
 * These files are a deployment of the published libsidplayfp-wasm package's dist/,
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
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..", "..");
const PUBLIC_WASM = path.join(WEB_ROOT, "public", "wasm");
const DIST = path.join(
  path.dirname(fileURLToPath(import.meta.resolve("libsidplayfp-wasm/package.json"))),
  "dist",
);

/**
 * Everything deployed is now a byte copy, wrappers included. Up to
 * libsidplayfp-wasm 0.1.0 `index.js` imported "../dist/libsidplayfp.js", which
 * did not resolve when served from /wasm/, so it had to be rewritten on the way
 * in — and a rewritten copy is one that can drift from the package it claims to
 * be. Since 0.1.1 it resolves relative to itself.
 *
 * The Emscripten pair in particular must match: the glue and the binary are
 * generated together, and pairing them across builds aborts the module.
 */
const PAIRED_FILES = ["libsidplayfp.js", "libsidplayfp.wasm"] as const;
const ROOT_FILES = [...PAIRED_FILES, "index.js", "player.js", "upstream-versions.js"] as const;

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

describe("public/wasm deployment", () => {
  for (const file of ROOT_FILES) {
    it(`${file} is byte-identical to dist/`, () => {
      const deployed = path.join(PUBLIC_WASM, file);
      const built = path.join(DIST, file);
      expect(
        sha256(deployed),
        `public/wasm/${file} is stale. Refresh it with:\n` +
          `    cd packages/sidflow-web && bun run build:worklet`,
      ).toBe(sha256(built));
    });
  }

  /**
   * The failure this catches is a module that loads in Node but 404s in the
   * browser: `index.js` imports `./upstream-versions.js`, and the deployment
   * used to copy a hand-listed set of files that did not include it.
   */
  for (const file of ROOT_FILES) {
    if (!file.endsWith(".js")) continue;
    it(`${file} imports only files that are deployed`, () => {
      const source = readFileSync(path.join(PUBLIC_WASM, file), "utf8");
      const specifiers = [...source.matchAll(/from\s+"(\.[^"]+)"|import\("(\.[^"]+)"\)/g)].map(
        (match) => match[1] ?? match[2],
      );
      const missing = specifiers.filter(
        (specifier) => !existsSync(path.resolve(PUBLIC_WASM, specifier)),
      );

      expect(
        missing,
        `public/wasm/${file} imports ${missing.join(", ")}, which is not deployed under public/wasm/. ` +
          `Re-run: cd packages/sidflow-web && bun run build:worklet`,
      ).toEqual([]);
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

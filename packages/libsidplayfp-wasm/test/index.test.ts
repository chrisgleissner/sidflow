import { describe, expect, it, beforeAll } from "bun:test";
import loadLibsidplayfp from "../src/index.js";
import type { LoadLibsidplayfpOptions } from "../src/index.js";

describe("loadLibsidplayfp", () => {
    it("loads with default options", async () => {
        const module = await loadLibsidplayfp();
        expect(module).toBeDefined();
        expect(typeof module.SidPlayerContext).toBe("function");
    });

    it("loads with custom locateFile", async () => {
        const customPath = new URL("../dist/libsidplayfp.wasm", import.meta.url).href;
        const module = await loadLibsidplayfp({
            locateFile: () => customPath,
        });
        expect(module).toBeDefined();
        expect(typeof module.SidPlayerContext).toBe("function");
    });

    it("accepts custom SidPlayerContext options", async () => {
        const module = await loadLibsidplayfp({
            print: (msg: string) => { /* custom print */ },
            printErr: (msg: string) => { /* custom printErr */ },
        });
        expect(module).toBeDefined();
    });

    it("uses artifactBaseUrl when locateFile not provided", async () => {
        // Default behavior - should locate WASM from dist/
        const module = await loadLibsidplayfp({});
        expect(module).toBeDefined();
        const player = new module.SidPlayerContext();
        expect(player).toBeDefined();
    });

    it("handles empty options object", async () => {
        const module = await loadLibsidplayfp({});
        expect(module).toBeDefined();
    });

    it("re-exports types correctly", async () => {
        const module = await loadLibsidplayfp();
        expect(module.SidPlayerContext).toBeDefined();
        // Verify constructor exists and can be called
        const ctx = new module.SidPlayerContext();
        expect(ctx.getSampleRate).toBeDefined();
        expect(ctx.getChannels).toBeDefined();
    });
});

describe("index exports", () => {
    it("exports loadLibsidplayfp as default", () => {
        expect(typeof loadLibsidplayfp).toBe("function");
    });

    it("exports SidAudioEngine as named export", async () => {
        const { SidAudioEngine } = await import("../src/index.js");
        expect(SidAudioEngine).toBeDefined();
        expect(typeof SidAudioEngine).toBe("function");
    });

    it("exports LoadLibsidplayfpOptions type interface", async () => {
        // Type-only export, verify it compiles by using it
        const opts: LoadLibsidplayfpOptions = {
            locateFile: (asset: string) => asset,
        };
        expect(opts.locateFile).toBeDefined();
    });
});

describe("environment detection", () => {
    it("handles server-like environment checks", async () => {
        // In Bun test environment, should behave like a server
        expect(typeof globalThis).toBe("object");
        expect(typeof process).toBe("object");
        
        // Should load successfully regardless
        const module = await loadLibsidplayfp();
        expect(module).toBeDefined();
    });

    it("handles browser-like environment simulation", async () => {
        // Even though we're in Bun, the loader should work
        const module = await loadLibsidplayfp();
        expect(module).toBeDefined();
    });
});

describe("WASM path override", () => {
    it("works when no environment override is set", async () => {
        // Default case - should use artifactBaseUrl
        const module = await loadLibsidplayfp();
        expect(module).toBeDefined();
    });

    it("custom locateFile takes precedence over env vars", async () => {
        const customPath = new URL("../dist/libsidplayfp.wasm", import.meta.url).href;
        const module = await loadLibsidplayfp({
            locateFile: () => customPath,
        });
        expect(module).toBeDefined();
    });
});

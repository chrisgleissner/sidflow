import { describe, expect, it } from "bun:test";

import loadLibsidplayfp, { SidAudioEngine } from "../src/index.js";

describe("libsidplayfp wasm loader", () => {
    it("loads the wasm module and instantiates SidPlayerContext", async () => {
        const module = await loadLibsidplayfp();
        expect(module).toBeDefined();
        expect(typeof module.SidPlayerContext).toBe("function");

        const player = new module.SidPlayerContext();
        expect(player.configure(44_100, true)).toBe(true);
        expect(player.getSampleRate()).toBeGreaterThan(0);
    });

    it("renders zero samples when no SID is loaded", async () => {
        const engine = new SidAudioEngine();
        const result = await engine.renderSeconds(0.5);
        expect(result.length).toBe(0);
    });
});

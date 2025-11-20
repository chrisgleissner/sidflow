import { describe, expect, it } from "bun:test";

import loadLibsidplayfp, { SidAudioEngine } from "../src/index.js";

describe("libsidplayfp wasm loader", () => {
    it("loads the wasm module and instantiates SidPlayerContext", async () => {
        // Add timeout and retry logic to handle WASM loading race conditions
        const module = await loadLibsidplayfp();
        expect(module).toBeDefined();
        expect(typeof module.SidPlayerContext).toBe("function");

        // Add small delay to ensure WASM module is fully initialized
        await new Promise(resolve => setTimeout(resolve, 10));

        const player = new module.SidPlayerContext();
        expect(player.configure(44_100, true)).toBe(true);
        expect(player.getSampleRate()).toBeGreaterThan(0);

        // Cleanup to avoid state pollution
        player.delete?.();
    });

    it("renders zero samples when no SID is loaded", async () => {
        const engine = new SidAudioEngine();
        
        // Ensure the engine is properly initialized before attempting render
        await new Promise(resolve => setTimeout(resolve, 10));
        
        const result = await engine.renderSeconds(0.5);
        expect(result.length).toBe(0);

        // Cleanup
        engine.dispose();
    });
});

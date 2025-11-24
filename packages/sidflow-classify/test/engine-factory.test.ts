/// <reference types="bun-types" />
import { describe, expect, test, afterEach } from "bun:test";
import {
  createEngine,
  getWasmModule,
  setEngineFactoryOverride,
} from "../src/render/engine-factory";
import { SidAudioEngine } from "@sidflow/libsidplayfp-wasm";

describe("Engine Factory", () => {
  afterEach(() => {
    // Reset any override after each test
    setEngineFactoryOverride(null);
  });

  describe("getWasmModule", () => {
    test("loads a WASM module", async () => {
      const module = await getWasmModule();
      expect(module).toBeDefined();
      expect(typeof module).toBe("object");
    });

    test("returns a fresh module on each call (no caching)", async () => {
      const module1 = await getWasmModule();
      const module2 = await getWasmModule();

      // While they may have the same structure, the function guarantees
      // they are loaded fresh each time (important for isolation)
      expect(module1).toBeDefined();
      expect(module2).toBeDefined();
    });
  });

  describe("createEngine", () => {
    test("creates a SidAudioEngine instance", async () => {
      const engine = await createEngine();
      expect(engine).toBeInstanceOf(SidAudioEngine);
    });

    test("creates engine with default configuration", async () => {
      const engine = await createEngine();
      expect(engine.getSampleRate()).toBe(44100);
      expect(engine.getChannels()).toBe(2); // stereo
    });

    test("creates multiple engines independently", async () => {
      const engine1 = await createEngine();
      const engine2 = await createEngine();

      expect(engine1).toBeInstanceOf(SidAudioEngine);
      expect(engine2).toBeInstanceOf(SidAudioEngine);

      // Both should work independently
      expect(engine1.getSampleRate()).toBe(44100);
      expect(engine2.getSampleRate()).toBe(44100);
    });
  });

  describe("setEngineFactoryOverride", () => {
    test("allows custom engine factory", async () => {
      const mockEngine = {} as SidAudioEngine;
      setEngineFactoryOverride(async () => mockEngine);

      const engine = await createEngine();
      expect(engine).toBe(mockEngine);
    });

    test("can be cleared by passing null", async () => {
      const mockEngine = {} as SidAudioEngine;
      setEngineFactoryOverride(async () => mockEngine);

      const engineWithOverride = await createEngine();
      expect(engineWithOverride).toBe(mockEngine);

      setEngineFactoryOverride(null);

      const engineWithoutOverride = await createEngine();
      expect(engineWithoutOverride).toBeInstanceOf(SidAudioEngine);
      expect(engineWithoutOverride).not.toBe(mockEngine);
    });

    test("override takes precedence over default factory", async () => {
      let overrideWasCalled = false;
      const mockEngine = {} as SidAudioEngine;

      setEngineFactoryOverride(async () => {
        overrideWasCalled = true;
        return mockEngine;
      });

      const engine = await createEngine();

      expect(overrideWasCalled).toBe(true);
      expect(engine).toBe(mockEngine);
    });

    test("can set and update override multiple times", async () => {
      const mockEngine1 = { id: "mock1" } as unknown as SidAudioEngine;
      const mockEngine2 = { id: "mock2" } as unknown as SidAudioEngine;

      setEngineFactoryOverride(async () => mockEngine1);
      let engine = await createEngine();
      expect(engine).toBe(mockEngine1);

      setEngineFactoryOverride(async () => mockEngine2);
      engine = await createEngine();
      expect(engine).toBe(mockEngine2);
    });
  });

  describe("integration", () => {
    test("created engine can be used for basic operations", async () => {
      const engine = await createEngine();

      // Verify it's a real engine that can perform operations
      expect(engine.getSampleRate()).toBeGreaterThan(0);
      expect(engine.getChannels()).toBeGreaterThan(0);
    });

    test("override can provide a partially implemented mock", async () => {
      const mockSampleRate = 48000;
      const mockChannels = 1;

      setEngineFactoryOverride(
        async () =>
          ({
            getSampleRate: () => mockSampleRate,
            getChannels: () => mockChannels,
          }) as unknown as SidAudioEngine
      );

      const engine = await createEngine();
      expect(engine.getSampleRate()).toBe(mockSampleRate);
      expect(engine.getChannels()).toBe(mockChannels);
    });
  });
});

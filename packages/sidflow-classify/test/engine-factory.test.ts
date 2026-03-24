/// <reference types="bun-types" />
import { describe, expect, test, afterEach } from "bun:test";
import {
    createEngine,
    getCompiledWasmModule,
    resetWasmModuleCache,
    setEngineFactoryOverride,
} from "../src/render/engine-factory";
import { SidAudioEngine } from "@sidflow/libsidplayfp-wasm";

describe("Engine Factory", () => {
    afterEach(() => {
        // Reset any override after each test
        setEngineFactoryOverride(null);
        resetWasmModuleCache();
    });

    describe("getCompiledWasmModule", () => {
        test("compiles a WebAssembly.Module", async () => {
            const module = await getCompiledWasmModule();
            expect(module).toBeDefined();
            expect(module).toBeInstanceOf(WebAssembly.Module);
        });

        test("returns the cached module on subsequent calls", async () => {
            const module1 = await getCompiledWasmModule();
            const module2 = await getCompiledWasmModule();

            // The compiled WebAssembly.Module is stateless code and is cached
            expect(module1).toBe(module2);
        });

        test("returns a fresh module after cache reset", async () => {
            const module1 = await getCompiledWasmModule();
            resetWasmModuleCache();
            const module2 = await getCompiledWasmModule();

            expect(module1).toBeInstanceOf(WebAssembly.Module);
            expect(module2).toBeInstanceOf(WebAssembly.Module);
            // After reset, a new module is compiled
            expect(module1).not.toBe(module2);
        });
    });

    describe("createEngine", () => {
        test("creates a SidAudioEngine instance", async () => {
            const engine = await createEngine();
            expect(engine).toBeInstanceOf(SidAudioEngine);
        });

        test("creates multiple engines independently", async () => {
            const engine1 = await createEngine();
            const engine2 = await createEngine();

            expect(engine1).toBeInstanceOf(SidAudioEngine);
            expect(engine2).toBeInstanceOf(SidAudioEngine);
            // Engines are independent instances
            expect(engine1).not.toBe(engine2);
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

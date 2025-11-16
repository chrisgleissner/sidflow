import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    DEFAULT_WASM_BUILD_METADATA_PATH,
    DEFAULT_WASM_UPSTREAM_REPO,
    markWasmBuildComplete,
    readWasmBuildMetadata,
    recordWasmUpstreamCheck,
    shouldSkipWasmBuild,
    WasmBuildMetadata,
    writeWasmBuildMetadata
} from "@sidflow/common";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-wasm-metadata-");

function createSampleMetadata(): WasmBuildMetadata {
    return {
        upstreamRepo: "https://github.com/libsidplayfp/libsidplayfp",
        latestUpstreamCommit: "abc",
        lastChecked: "2025-11-01T12:00:00.000Z",
        lastSuccessfulBuild: {
            commit: "abc",
            timestamp: "2025-11-01T12:05:00.000Z",
            artifact: "packages/libsidplayfp-wasm/dist/libsidplayfp.wasm",
            notes: null
        }
    };
}

describe("wasm-build metadata helpers", () => {
    let tempDir: string;
    let metadataPath: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(TEMP_PREFIX);
        metadataPath = path.join(tempDir, "metadata.json");
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("reads metadata from disk", async () => {
        const sample = createSampleMetadata();
        await writeFile(metadataPath, JSON.stringify(sample, null, 2));

        const metadata = await readWasmBuildMetadata(metadataPath);
        expect(metadata).toEqual(sample);
    });

    it("creates default metadata when file is missing", async () => {
        const metadata = await readWasmBuildMetadata(metadataPath);
        expect(metadata.upstreamRepo).toBe(DEFAULT_WASM_UPSTREAM_REPO);
        expect(metadata.latestUpstreamCommit).toBeNull();
        expect(metadata.lastSuccessfulBuild.commit).toBeNull();

        const contents = await readFile(metadataPath, "utf8");
        const parsed = JSON.parse(contents) as WasmBuildMetadata;
        expect(parsed).toEqual(metadata);
    });

    it("serializes metadata deterministically", async () => {
        const sample = createSampleMetadata();
        await writeWasmBuildMetadata(metadataPath, sample);

        const contents = await readFile(metadataPath, "utf8");
        expect(contents.endsWith("\n")).toBe(true);
        const reparsed = JSON.parse(contents) as WasmBuildMetadata;
        expect(reparsed).toEqual(sample);
    });

    it("identifies when a build can be skipped", () => {
        const sample = createSampleMetadata();
        expect(shouldSkipWasmBuild(sample, "abc")).toBe(true);
        expect(shouldSkipWasmBuild(sample, "def")).toBe(false);
        const pending: WasmBuildMetadata = {
            ...sample,
            lastSuccessfulBuild: {
                ...sample.lastSuccessfulBuild,
                commit: null,
                timestamp: null
            }
        };
        expect(shouldSkipWasmBuild(pending, "abc")).toBe(false);
    });

    it("records upstream checks without mutating the original metadata", () => {
        const sample = createSampleMetadata();
        const updated = recordWasmUpstreamCheck(sample, "def", new Date("2025-11-08T10:00:00Z"));
        expect(updated).not.toBe(sample);
        expect(updated.latestUpstreamCommit).toBe("def");
        expect(updated.lastChecked).toBe("2025-11-08T10:00:00.000Z");
        expect(updated.lastSuccessfulBuild).toEqual(sample.lastSuccessfulBuild);
    });

    it("marks builds as complete", () => {
        const sample = createSampleMetadata();
        const completed = markWasmBuildComplete(sample, "def", new Date("2025-11-08T12:00:00Z"), "dist/libsidplayfp.wasm");
        expect(completed.lastSuccessfulBuild).toEqual({
            commit: "def",
            timestamp: "2025-11-08T12:00:00.000Z",
            artifact: "dist/libsidplayfp.wasm",
            notes: null
        });
    });

    it("exposes a default metadata path", () => {
        expect(DEFAULT_WASM_BUILD_METADATA_PATH.endsWith("data/wasm-build.json")).toBe(true);
    });
});

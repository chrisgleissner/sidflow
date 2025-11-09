#!/usr/bin/env bun
/// <reference types="bun-types" />
import { access } from "node:fs/promises";
import path from "node:path";

import {
    DEFAULT_WASM_BUILD_METADATA_PATH,
    markWasmBuildComplete,
    readWasmBuildMetadata,
    shouldSkipWasmBuild,
    writeWasmBuildMetadata
} from "../packages/sidflow-common/src/wasm-build.ts";

const ARTIFACT_PATH = path.resolve("packages/libsidplayfp-wasm/dist/libsidplayfp.wasm");
const CHECK_SCRIPT = path.resolve("scripts/check-libsidplayfp-upstream.ts");
const PACKAGE_BUILD_SCRIPT = path.resolve("packages/libsidplayfp-wasm/scripts/build.sh");

interface Options {
    metadataPath: string;
    skipCheck: boolean;
    force: boolean;
}

interface ParsedArgs {
    options: Options;
    rest: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
    const options: Options = {
        metadataPath: DEFAULT_WASM_BUILD_METADATA_PATH,
        skipCheck: false,
        force: false
    };
    const rest: string[] = [];

    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === "--metadata" || value === "-m") {
            const next = argv[index + 1];
            if (!next) {
                throw new Error("Expected path after --metadata");
            }
            options.metadataPath = path.resolve(next);
            index += 1;
            continue;
        }

        if (value === "--skip-check") {
            options.skipCheck = true;
            continue;
        }

        if (value === "--force") {
            options.force = true;
            continue;
        }

        rest.push(value);
    }

    return { options, rest };
}

async function runProcess(command: string[], cwd?: string): Promise<void> {
    const proc = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
        throw new Error(`Command ${command.join(" ")} failed with exit code ${exitCode}`);
    }
}

async function ensureUpstreamCheck(metadataPath: string): Promise<void> {
    await runProcess(["bun", CHECK_SCRIPT, "--metadata", metadataPath]);
}

async function buildPackage(): Promise<void> {
    await runProcess(["bash", PACKAGE_BUILD_SCRIPT], path.dirname(PACKAGE_BUILD_SCRIPT));
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function main(): Promise<void> {
    const { options } = parseArgs(process.argv.slice(2));

    if (!options.skipCheck) {
        await ensureUpstreamCheck(options.metadataPath);
    }

    let metadata = await readWasmBuildMetadata(options.metadataPath);
    const upstreamCommit = metadata.latestUpstreamCommit;
    if (!upstreamCommit) {
        throw new Error("No upstream commit recorded; run the upstream check first.");
    }

    const shouldSkip = shouldSkipWasmBuild(metadata, upstreamCommit);
    if (shouldSkip && !options.force) {
        console.log("[wasm] Last successful build already matches upstream; skipping rebuild.");
        return;
    }

    if (shouldSkip && options.force) {
        console.log("[wasm] Forcing rebuild despite matching upstream commit.");
    }

    const started = new Date();
    await buildPackage();

    if (!(await fileExists(ARTIFACT_PATH))) {
        throw new Error(`Expected WASM artifact at ${ARTIFACT_PATH}, but it was not produced.`);
    }

    // Refresh metadata in case another process updated it during the build.
    metadata = await readWasmBuildMetadata(options.metadataPath);
    const updated = markWasmBuildComplete(metadata, upstreamCommit, new Date(), ARTIFACT_PATH);
    await writeWasmBuildMetadata(options.metadataPath, updated);

    console.log("[wasm] Build complete.");
    console.log(`[wasm] Upstream commit: ${upstreamCommit}`);
    console.log(`[wasm] Artifact: ${ARTIFACT_PATH}`);
    console.log(`[wasm] Started at: ${started.toISOString()}`);
    console.log(`[wasm] Completed at: ${updated.lastSuccessfulBuild.timestamp}`);
}

main().catch((error) => {
    console.error(`[wasm] Build failed: ${(error as Error).message}`);
    process.exitCode = 1;
});

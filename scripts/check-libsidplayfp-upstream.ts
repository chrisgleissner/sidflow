#!/usr/bin/env bun
/// <reference types="bun-types" />
import path from "node:path";

import {
    DEFAULT_WASM_BUILD_METADATA_PATH,
    readWasmBuildMetadata,
    recordWasmUpstreamCheck,
    shouldSkipWasmBuild,
    writeWasmBuildMetadata
} from "../packages/sidflow-common/src/wasm-build.ts";

interface Options {
    metadataPath: string;
    force: boolean;
}

interface ParsedArgs {
    options: Options;
    rest: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
    const options: Options = {
        metadataPath: DEFAULT_WASM_BUILD_METADATA_PATH,
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

        if (value === "--force") {
            options.force = true;
            continue;
        }

        rest.push(value);
    }

    return { options, rest };
}

async function resolveLatestCommit(upstreamRepo: string): Promise<string> {
    const lsRemote = Bun.spawn(["git", "ls-remote", upstreamRepo, "HEAD"], { stdout: "pipe", stderr: "pipe" });
    const exitCode = await lsRemote.exited;
    const stdout = await new Response(lsRemote.stdout).text();
    const stderr = await new Response(lsRemote.stderr).text();

    if (exitCode !== 0) {
        throw new Error(`git ls-remote failed with exit code ${exitCode}: ${stderr.trim()}`);
    }

    const trimmed = stdout.trim();
    if (!trimmed) {
        throw new Error("git ls-remote returned no output");
    }

    const [commit] = trimmed.split(/\s+/);
    if (!commit || commit.length < 7) {
        throw new Error(`Unable to parse commit hash from git ls-remote output: ${stdout}`);
    }

    return commit;
}

async function main(): Promise<void> {
    if (process.env.SIDFLOW_SKIP_WASM_UPSTREAM_CHECK === "1") {
        console.warn("[wasm] SIDFLOW_SKIP_WASM_UPSTREAM_CHECK=1 — skipping upstream git ls-remote (assuming cached build is valid).");
        return;
    }
    const { options } = parseArgs(process.argv.slice(2));
    const metadata = await readWasmBuildMetadata(options.metadataPath);
    const commit = await resolveLatestCommit(metadata.upstreamRepo);
    const now = new Date();

    const skip = !options.force && shouldSkipWasmBuild(metadata, commit);
    const updated = recordWasmUpstreamCheck(metadata, commit, now);
    await writeWasmBuildMetadata(options.metadataPath, updated);

    console.log(`[wasm] Upstream repository: ${metadata.upstreamRepo}`);
    console.log(`[wasm] Latest upstream commit: ${commit}`);
    if (metadata.lastSuccessfulBuild.commit) {
        console.log(`[wasm] Last successful build commit: ${metadata.lastSuccessfulBuild.commit}`);
    } else {
        console.log("[wasm] No recorded successful builds yet.");
    }

    if (options.force) {
        console.log("[wasm] Force rebuild requested; skipping cache check.");
    }

    if (skip) {
        console.log("[wasm] No upstream changes detected; skipping WASM rebuild.");
    } else {
        console.log("[wasm] Upstream changed; WASM rebuild required.");
    }

    if (options.force) {
        console.log("[wasm] Force flag ensures downstream build scripts proceed even without upstream changes.");
    }

    if (!skip) {
        console.log("[wasm] Remember to run the WASM build pipeline and commit new artifacts.");
    }
}

main().catch((error) => {
    console.error(`[wasm] Upstream check failed: ${(error as Error).message}`);
    process.exitCode = 1;
});

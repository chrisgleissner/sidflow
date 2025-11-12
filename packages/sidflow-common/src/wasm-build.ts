import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ensureDir, pathExists } from "./fs.js";
import type { JsonValue } from "./json.js";
import { stringifyDeterministic } from "./json.js";

export interface WasmBuildRecord {
    commit: string | null;
    timestamp: string | null;
    artifact: string | null;
    notes?: string | null;
}

export interface WasmBuildMetadata {
    upstreamRepo: string;
    latestUpstreamCommit: string | null;
    lastChecked: string | null;
    lastSuccessfulBuild: WasmBuildRecord;
}

export class WasmBuildMetadataError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "WasmBuildMetadataError";
    }
}

export const DEFAULT_WASM_BUILD_METADATA_PATH = path.resolve("data/wasm-build.json");

function coerceNullableString(value: unknown, field: string): string | null {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === "string") {
        return value;
    }

    throw new WasmBuildMetadataError(`Expected "${field}" to be a string or null`);
}

function normalizeRecord(record: Partial<WasmBuildRecord> | undefined): WasmBuildRecord {
    if (!record) {
        return {
            commit: null,
            timestamp: null,
            artifact: null,
            notes: null
        };
    }

    return {
        commit: coerceNullableString(record.commit, "lastSuccessfulBuild.commit"),
        timestamp: coerceNullableString(record.timestamp, "lastSuccessfulBuild.timestamp"),
        artifact: coerceNullableString(record.artifact, "lastSuccessfulBuild.artifact"),
        notes: coerceNullableString(record.notes, "lastSuccessfulBuild.notes")
    };
}

export async function readWasmBuildMetadata(metadataPath: string): Promise<WasmBuildMetadata> {
    if (!(await pathExists(metadataPath))) {
        throw new WasmBuildMetadataError(`WASM build metadata not found at ${metadataPath}`);
    }

    let raw: string;
    try {
        raw = await readFile(metadataPath, "utf8");
    } catch (error) {
        throw new WasmBuildMetadataError(`Failed to read WASM build metadata at ${metadataPath}: ${(error as Error).message}`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new WasmBuildMetadataError(`WASM build metadata at ${metadataPath} contains invalid JSON: ${(error as Error).message}`);
    }

    if (!parsed || typeof parsed !== "object") {
        throw new WasmBuildMetadataError("WASM build metadata must be an object");
    }

    const upstreamRepo = (parsed as Record<string, unknown>).upstreamRepo;
    if (typeof upstreamRepo !== "string" || upstreamRepo.trim() === "") {
        throw new WasmBuildMetadataError("WASM build metadata requires a non-empty upstreamRepo string");
    }

    const latestUpstreamCommit = coerceNullableString((parsed as Record<string, unknown>).latestUpstreamCommit, "latestUpstreamCommit");
    const lastChecked = coerceNullableString((parsed as Record<string, unknown>).lastChecked, "lastChecked");
    const lastSuccessfulBuild = normalizeRecord((parsed as Record<string, unknown>).lastSuccessfulBuild as Partial<WasmBuildRecord> | undefined);

    return {
        upstreamRepo,
        latestUpstreamCommit,
        lastChecked,
        lastSuccessfulBuild
    };
}

export async function writeWasmBuildMetadata(metadataPath: string, metadata: WasmBuildMetadata): Promise<void> {
    await ensureDir(path.dirname(metadataPath));
    const payload = stringifyDeterministic(metadata as unknown as JsonValue);
    await writeFile(metadataPath, payload, "utf8");
}

export function recordWasmUpstreamCheck(
    metadata: WasmBuildMetadata,
    upstreamCommit: string,
    checkedAt: Date
): WasmBuildMetadata {
    return {
        ...metadata,
        latestUpstreamCommit: upstreamCommit,
        lastChecked: checkedAt.toISOString()
    };
}

export function shouldSkipWasmBuild(metadata: WasmBuildMetadata, upstreamCommit: string): boolean {
    const lastBuiltCommit = metadata.lastSuccessfulBuild.commit;
    return Boolean(lastBuiltCommit && lastBuiltCommit === upstreamCommit);
}

export function markWasmBuildComplete(
    metadata: WasmBuildMetadata,
    upstreamCommit: string,
    completedAt: Date,
    artifactPath: string
): WasmBuildMetadata {
    return {
        ...metadata,
        lastSuccessfulBuild: {
            commit: upstreamCommit,
            timestamp: completedAt.toISOString(),
            artifact: artifactPath,
            notes: metadata.lastSuccessfulBuild.notes ?? null
        }
    };
}
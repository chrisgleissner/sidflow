/// <reference path="./7zip-min.d.ts" />
import path from "node:path";

import { ensureDir } from "./fs.js";

type SevenZipModule = {
    pack(source: string, destination: string, callback: (error?: Error | null) => void): void;
    unpack(source: string, destination: string, callback: (error?: Error | null) => void): void;
};

let cachedModule: SevenZipModule | undefined;
type SevenZipLoader = () => Promise<SevenZipModule>;

const defaultLoader: SevenZipLoader = async () => {
    if (!cachedModule) {
        cachedModule = (await import("7zip-min")) as SevenZipModule;
    }
    return cachedModule;
};

let customLoader: SevenZipLoader | undefined;

async function loadSevenZip(): Promise<SevenZipModule> {
    if (customLoader) {
        return await customLoader();
    }
    return await defaultLoader();
}

async function runSevenZip(
    operation: "pack" | "unpack",
    source: string,
    destination: string
): Promise<void> {
    const module = await loadSevenZip();

    try {
        await new Promise<void>((resolve, reject) => {
            module[operation](source, destination, (error?: Error | null) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    } catch (error) {
        const context =
            operation === "unpack"
                ? `extract archive ${path.basename(source)} to ${destination}`
                : `create archive ${path.basename(destination)} from ${source}`;
        
        // Enhanced error context for debugging
        const errorDetails = [
            `7zip-min failed to ${context}`,
            `Error: ${(error as Error).message}`,
            `Source: ${source}`,
            `Destination: ${destination}`,
            `Operation: ${operation}`
        ].join('\n  ');
        
        throw new Error(errorDetails);
    }
}

export async function extractSevenZipArchive(archivePath: string, destination: string): Promise<void> {
    await ensureDir(destination);
    console.log(`Extracting ${path.basename(archivePath)} to ${destination}...`);
    await runSevenZip("unpack", archivePath, destination);
    console.log(`Extraction complete: ${path.basename(archivePath)}`);
}

export async function createSevenZipArchive(sourcePath: string, archivePath: string): Promise<void> {
    await ensureDir(path.dirname(archivePath));
    await runSevenZip("pack", sourcePath, archivePath);
}

/* c8 ignore start */
export function __setSevenZipLoaderForTest(loader?: SevenZipLoader): void {
    cachedModule = undefined;
    customLoader = loader;
}
/* c8 ignore stop */
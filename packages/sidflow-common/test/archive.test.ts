import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import {
    __setSevenZipLoaderForTest,
    createSevenZipArchive,
    extractSevenZipArchive
} from "../src/archive.js";

const packMock = mock<(source: string, destination: string) => void>();
const unpackMock = mock<(source: string, destination: string) => void>();

beforeEach(() => {
    packMock.mockReset();
    unpackMock.mockReset();
    __setSevenZipLoaderForTest(async () => ({
        pack: (source: string, destination: string, callback: (error?: Error | null) => void) => {
            packMock(source, destination);
            callback();
        },
        unpack: (source: string, destination: string, callback: (error?: Error | null) => void) => {
            unpackMock(source, destination);
            callback();
        }
    }));
});

afterEach(() => {
    __setSevenZipLoaderForTest();
});

describe("archive helpers", () => {
    it("extracts an archive using seven zip", async () => {
        await extractSevenZipArchive("/tmp/archive.7z", "/tmp/destination");
        expect(unpackMock).toHaveBeenCalledWith("/tmp/archive.7z", "/tmp/destination");
    });

    it("creates an archive from a directory", async () => {
        await createSevenZipArchive("/tmp/source", "/tmp/archive.7z");
        expect(packMock).toHaveBeenCalledWith("/tmp/source", "/tmp/archive.7z");
    });

    it("wraps errors with descriptive context", async () => {
        __setSevenZipLoaderForTest(async () => ({
            pack: (_source: string, _destination: string, callback: (error?: Error | null) => void) =>
                callback(new Error("boom")),
            unpack: (_source: string, _destination: string, callback: (error?: Error | null) => void) =>
                callback(new Error("boom"))
        }));

        await expect(extractSevenZipArchive("/tmp/archive.7z", "/tmp/destination")).rejects.toThrow(
            /failed to extract archive archive\.7z/i
        );

        await expect(createSevenZipArchive("/tmp/source", "/tmp/archive.7z")).rejects.toThrow(
            /failed to create archive archive\.7z/i
        );
    });

    it("handles null errors as success", async () => {
        __setSevenZipLoaderForTest(async () => ({
            pack: (_source: string, _destination: string, callback: (error?: Error | null) => void) =>
                callback(null),
            unpack: (_source: string, _destination: string, callback: (error?: Error | null) => void) =>
                callback(null)
        }));

        await expect(extractSevenZipArchive("/tmp/archive.7z", "/tmp/destination")).resolves.toBeUndefined();
        await expect(createSevenZipArchive("/tmp/source", "/tmp/archive.7z")).resolves.toBeUndefined();
    });

    it("handles undefined errors as success", async () => {
        __setSevenZipLoaderForTest(async () => ({
            pack: (_source: string, _destination: string, callback: (error?: Error | null) => void) =>
                callback(undefined),
            unpack: (_source: string, _destination: string, callback: (error?: Error | null) => void) =>
                callback(undefined)
        }));

        await expect(extractSevenZipArchive("/tmp/archive.7z", "/tmp/destination")).resolves.toBeUndefined();
        await expect(createSevenZipArchive("/tmp/source", "/tmp/archive.7z")).resolves.toBeUndefined();
    });

    it("caches the 7zip module between calls", async () => {
        let loadCount = 0;
        __setSevenZipLoaderForTest(async () => {
            loadCount++;
            return {
                pack: (_source: string, _destination: string, callback: (error?: Error | null) => void) => callback(),
                unpack: (_source: string, _destination: string, callback: (error?: Error | null) => void) => callback()
            };
        });

        await createSevenZipArchive("/tmp/source1", "/tmp/archive1.7z");
        await createSevenZipArchive("/tmp/source2", "/tmp/archive2.7z");
        await extractSevenZipArchive("/tmp/archive3.7z", "/tmp/dest3");

        expect(loadCount).toBe(1); // Should only load once and cache
    });

    it("includes original error message in thrown error", async () => {
        __setSevenZipLoaderForTest(async () => ({
            pack: (_source: string, _destination: string, callback: (error?: Error | null) => void) =>
                callback(new Error("disk full")),
            unpack: (_source: string, _destination: string, callback: (error?: Error | null) => void) =>
                callback(new Error("corrupted archive"))
        }));

        await expect(extractSevenZipArchive("/tmp/archive.7z", "/tmp/destination")).rejects.toThrow(/corrupted archive/);
        await expect(createSevenZipArchive("/tmp/source", "/tmp/archive.7z")).rejects.toThrow(/disk full/);
    });

    it("creates parent directories before packing", async () => {
        const nestedPath = "/tmp/deeply/nested/path/archive.7z";
        await createSevenZipArchive("/tmp/source", nestedPath);
        expect(packMock).toHaveBeenCalledWith("/tmp/source", nestedPath);
    });

    it("creates destination directory before extracting", async () => {
        const nestedDest = "/tmp/deeply/nested/destination";
        await extractSevenZipArchive("/tmp/archive.7z", nestedDest);
        expect(unpackMock).toHaveBeenCalledWith("/tmp/archive.7z", nestedDest);
    });
});
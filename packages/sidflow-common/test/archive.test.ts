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
});
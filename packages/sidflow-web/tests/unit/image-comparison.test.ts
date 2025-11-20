/**
 * Unit tests for image comparison utility
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'fs';
import path from 'path';
import { compareImages, saveScreenshotIfDifferent } from '../e2e/utils/image-comparison';

// Simple 2x2 red PNG (8 bytes signature + minimal chunks)
const RED_PNG = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10, // PNG signature
    0, 0, 0, 13, 73, 72, 68, 82, // IHDR chunk (13 bytes)
    0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0, 253, 212, 154, 115, // 2x2, RGB
    0, 0, 0, 12, 73, 68, 65, 84, // IDAT chunk (12 bytes)
    8, 153, 99, 252, 207, 192, 0, 0, 3, 1, 1, 0, 27, 179, 211, 244, // Red pixels
    0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130, // IEND
]);

// Same image but with different metadata (timestamp)
const RED_PNG_WITH_METADATA = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    Buffer.from([0, 0, 0, 13, 73, 72, 68, 82]), // IHDR chunk start
    Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0, 253, 212, 154, 115]), // 2x2, RGB
    // Add tIME chunk (timestamp metadata)
    Buffer.from([0, 0, 0, 7, 116, 73, 77, 69]), // tIME chunk (7 bytes)
    Buffer.from([7, 233, 11, 19, 10, 30, 15, 123, 45, 67, 89]), // Different timestamp
    Buffer.from([0, 0, 0, 12, 73, 68, 65, 84]), // IDAT chunk (12 bytes)
    Buffer.from([8, 153, 99, 252, 207, 192, 0, 0, 3, 1, 1, 0, 27, 179, 211, 244]), // Same red pixels
    Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]), // IEND
]);

// Different 2x2 blue PNG
const BLUE_PNG = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10, // PNG signature
    0, 0, 0, 13, 73, 72, 68, 82, // IHDR chunk
    0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0, 253, 212, 154, 115, // 2x2, RGB
    0, 0, 0, 12, 73, 68, 65, 84, // IDAT chunk
    8, 153, 99, 96, 96, 248, 15, 0, 1, 5, 1, 1, 247, 35, 95, 116, // Blue pixels (different)
    0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130, // IEND
]);

const TEST_DIR = path.join(process.cwd(), 'test-workspace', 'image-comparison-test');

describe('Image Comparison', () => {
    beforeEach(async () => {
        await fs.mkdir(TEST_DIR, { recursive: true });
    });

    afterEach(async () => {
        try {
            await fs.rm(TEST_DIR, { recursive: true, force: true });
        } catch {
            // Ignore
        }
    });

    test('should detect identical images as same', async () => {
        const path1 = path.join(TEST_DIR, 'red1.png');
        const path2 = path.join(TEST_DIR, 'red2.png');

        await fs.writeFile(path1, RED_PNG);
        await fs.writeFile(path2, RED_PNG);

        const result = await compareImages(path1, path2);

        expect(result.identical).toBe(true);
        expect(result.differentPixels).toBe(0);
    });

    test('should ignore metadata differences', async () => {
        const path1 = path.join(TEST_DIR, 'red-plain.png');
        const path2 = path.join(TEST_DIR, 'red-with-metadata.png');

        await fs.writeFile(path1, RED_PNG);
        await fs.writeFile(path2, RED_PNG_WITH_METADATA);

        const result = await compareImages(path1, path2);

        // Should be identical despite different metadata
        expect(result.identical).toBe(true);
        expect(result.differentPixels).toBe(0);
    });

    test('should detect different pixels', async () => {
        const path1 = path.join(TEST_DIR, 'red.png');
        const path2 = path.join(TEST_DIR, 'blue.png');

        await fs.writeFile(path1, RED_PNG);
        await fs.writeFile(path2, BLUE_PNG);

        const result = await compareImages(path1, path2);

        expect(result.identical).toBe(false);
        expect(result.differentPixels).toBeGreaterThan(0);
    });

    test('should handle non-existent files', async () => {
        const path1 = path.join(TEST_DIR, 'nonexistent1.png');
        const path2 = path.join(TEST_DIR, 'nonexistent2.png');

        const result = await compareImages(path1, path2);

        expect(result.identical).toBe(false);
        expect(result.error).toBeDefined();
    });

    test('saveScreenshotIfDifferent should save new file if target does not exist', async () => {
        const newPath = path.join(TEST_DIR, 'new.png');
        const targetPath = path.join(TEST_DIR, 'target.png');

        await fs.writeFile(newPath, RED_PNG);

        const saved = await saveScreenshotIfDifferent(newPath, targetPath);

        expect(saved).toBe(true);
        expect(await fs.access(targetPath).then(() => true).catch(() => false)).toBe(true);
    });

    test('saveScreenshotIfDifferent should not save if images are identical', async () => {
        const newPath = path.join(TEST_DIR, 'new.png');
        const targetPath = path.join(TEST_DIR, 'target.png');

        await fs.writeFile(targetPath, RED_PNG);
        await fs.writeFile(newPath, RED_PNG);

        const initialMtime = (await fs.stat(targetPath)).mtimeMs;

        // Wait a bit to ensure mtime would change if file is overwritten
        await new Promise(resolve => setTimeout(resolve, 10));

        const saved = await saveScreenshotIfDifferent(newPath, targetPath);

        const finalMtime = (await fs.stat(targetPath)).mtimeMs;

        expect(saved).toBe(false);
        expect(finalMtime).toBe(initialMtime); // File should not be touched
    });

    test('saveScreenshotIfDifferent should not save if only metadata differs', async () => {
        const newPath = path.join(TEST_DIR, 'new-with-meta.png');
        const targetPath = path.join(TEST_DIR, 'target-plain.png');

        await fs.writeFile(targetPath, RED_PNG);
        await fs.writeFile(newPath, RED_PNG_WITH_METADATA);

        const initialMtime = (await fs.stat(targetPath)).mtimeMs;

        // Wait a bit to ensure mtime would change if file is overwritten
        await new Promise(resolve => setTimeout(resolve, 10));

        const saved = await saveScreenshotIfDifferent(newPath, targetPath);

        const finalMtime = (await fs.stat(targetPath)).mtimeMs;

        expect(saved).toBe(false);
        expect(finalMtime).toBe(initialMtime); // File should not be touched
    });

    test('saveScreenshotIfDifferent should save if pixels differ', async () => {
        const newPath = path.join(TEST_DIR, 'blue-new.png');
        const targetPath = path.join(TEST_DIR, 'red-target.png');

        await fs.writeFile(targetPath, RED_PNG);
        await fs.writeFile(newPath, BLUE_PNG);

        const saved = await saveScreenshotIfDifferent(newPath, targetPath);

        expect(saved).toBe(true);

        // Verify the new file was copied
        const finalContent = await fs.readFile(targetPath);
        expect(finalContent.equals(BLUE_PNG)).toBe(true);
    });

    test('should detect single pixel difference', async () => {
        const path1 = path.join(TEST_DIR, 'original.png');
        const path2 = path.join(TEST_DIR, 'modified.png');

        await fs.writeFile(path1, RED_PNG);

        // Create a copy with one byte changed in IDAT
        const modifiedPng = Buffer.from(RED_PNG);
        // Change one byte in the IDAT data (pixel data)
        const idatStart = RED_PNG.indexOf(Buffer.from('IDAT')) + 4;
        if (idatStart > 4) {
            modifiedPng[idatStart + 5] ^= 0x01; // Flip one bit
        }

        await fs.writeFile(path2, modifiedPng);

        const result = await compareImages(path1, path2);

        // Should detect even a tiny difference
        expect(result.identical).toBe(false);
        expect(result.differentPixels).toBeGreaterThan(0);
    });
});

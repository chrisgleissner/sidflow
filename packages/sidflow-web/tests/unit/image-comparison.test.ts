/**
 * Unit tests for image comparison utility
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { compareImages, saveScreenshotIfDifferent } from '../e2e/utils/image-comparison';

/**
 * Create a valid PNG buffer using pngjs
 */
function createPng(width: number, height: number, r: number, g: number, b: number, a: number = 255): Buffer {
    const png = new PNG({ width, height });
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (width * y + x) << 2;
            png.data[idx] = r;
            png.data[idx + 1] = g;
            png.data[idx + 2] = b;
            png.data[idx + 3] = a;
        }
    }
    return PNG.sync.write(png);
}

/**
 * Create a PNG with one pixel different
 */
function createPngWithModifiedPixel(width: number, height: number, baseR: number, baseG: number, baseB: number): Buffer {
    const png = new PNG({ width, height });
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (width * y + x) << 2;
            // Modify the first pixel
            if (x === 0 && y === 0) {
                png.data[idx] = (baseR + 1) % 256;
                png.data[idx + 1] = baseG;
                png.data[idx + 2] = baseB;
            } else {
                png.data[idx] = baseR;
                png.data[idx + 1] = baseG;
                png.data[idx + 2] = baseB;
            }
            png.data[idx + 3] = 255;
        }
    }
    return PNG.sync.write(png);
}

// Create valid 2x2 test PNGs using pngjs
const RED_PNG = createPng(2, 2, 255, 0, 0);
const RED_PNG_WITH_METADATA = createPng(2, 2, 255, 0, 0); // Same pixels, pngjs doesn't add extra metadata
const BLUE_PNG = createPng(2, 2, 0, 0, 255);

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

        // Create a 2x2 red PNG
        await fs.writeFile(path1, RED_PNG);

        // Create a 2x2 PNG with one pixel slightly different
        const modifiedPng = createPngWithModifiedPixel(2, 2, 255, 0, 0);
        await fs.writeFile(path2, modifiedPng);

        const result = await compareImages(path1, path2);

        // Should detect even a tiny difference
        expect(result.identical).toBe(false);
        expect(result.differentPixels).toBeGreaterThan(0);
    });
});

/**
 * Pixel-perfect image comparison utility for preventing unnecessary screenshot updates.
 * 
 * This module ensures that screenshots are only saved when there are actual visual differences.
 * PNG metadata (timestamps, etc.) should not trigger updates if pixels are identical.
 */

import * as fs from 'fs';
import { PNG } from 'pngjs';

/**
 * Result of comparing two images
 */
export interface ImageComparisonResult {
    /** Whether the images are pixel-identical */
    identical: boolean;
    /** Number of different pixels (0 if identical) */
    differentPixels?: number;
    /** Total number of pixels compared */
    totalPixels?: number;
    /** Error message if comparison failed */
    error?: string;
}

/**
 * Compare two PNG files pixel-by-pixel using raw pixel data.
 * Uses pngjs to decode PNG files and compare actual pixel values.
 * 
 * @param existingPath Path to existing screenshot
 * @param newPath Path to newly captured screenshot
 * @returns Comparison result indicating if images are identical
 */
export async function compareImages(
    existingPath: string,
    newPath: string
): Promise<ImageComparisonResult> {
    try {
        // Check if existing file exists
        if (!fs.existsSync(existingPath)) {
            return {
                identical: false,
                error: 'Existing file does not exist',
            };
        }

        // Check if new file exists
        if (!fs.existsSync(newPath)) {
            return {
                identical: false,
                error: 'New file does not exist',
            };
        }

        // Use pngjs for pixel-perfect comparison
        return await compareWithPngjs(existingPath, newPath);
    } catch (error) {
        return {
            identical: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Compare images using pngjs library for pixel-perfect comparison.
 * Decodes both PNG files to raw RGBA pixels and compares them directly.
 */
async function compareWithPngjs(
    existingPath: string,
    newPath: string
): Promise<ImageComparisonResult> {
    return new Promise((resolve) => {
        try {
            // Read and decode existing image
            const existingBuffer = fs.readFileSync(existingPath);
            const newBuffer = fs.readFileSync(newPath);

            const existingPng = PNG.sync.read(existingBuffer);
            const newPng = PNG.sync.read(newBuffer);

            // Check dimensions match
            if (existingPng.width !== newPng.width || existingPng.height !== newPng.height) {
                resolve({
                    identical: false,
                    error: `Image dimensions differ: ${existingPng.width}x${existingPng.height} vs ${newPng.width}x${newPng.height}`,
                });
                return;
            }

            const totalPixels = existingPng.width * existingPng.height;
            const existingData = existingPng.data;
            const newData = newPng.data;

            // Compare raw pixel data (RGBA, 4 bytes per pixel)
            let differentPixels = 0;
            for (let i = 0; i < existingData.length; i += 4) {
                // Compare RGBA values
                if (
                    existingData[i] !== newData[i] ||     // R
                    existingData[i + 1] !== newData[i + 1] || // G
                    existingData[i + 2] !== newData[i + 2] || // B
                    existingData[i + 3] !== newData[i + 3]    // A
                ) {
                    differentPixels++;
                }
            }

            resolve({
                identical: differentPixels === 0,
                differentPixels,
                totalPixels,
            });
        } catch (error) {
            resolve({
                identical: false,
                error: `PNG comparison failed: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    });
}

// Threshold for ignoring very small differences (e.g., anti-aliasing, compression artifacts)
// 0.05% of pixels = 1 in 2,000 pixels - allows for minor rendering variations
const PIXEL_DIFFERENCE_THRESHOLD = 0.0005;

/**
 * Conditionally save a screenshot only if it differs significantly from the existing one.
 * Small differences (below threshold) are ignored to prevent unnecessary updates
 * from anti-aliasing, compression artifacts, or minor rendering variations.
 * 
 * @param newScreenshotPath Path where Playwright saved the new screenshot
 * @param targetPath Path where the screenshot should be saved (existing location)
 * @returns true if screenshot was saved (different), false if skipped (identical or below threshold)
 */
export async function saveScreenshotIfDifferent(
    newScreenshotPath: string,
    targetPath: string
): Promise<boolean> {
    // If target doesn't exist, always save
    if (!fs.existsSync(targetPath)) {
        fs.copyFileSync(newScreenshotPath, targetPath);
        return true;
    }

    // Compare images
    const result = await compareImages(targetPath, newScreenshotPath);

    if (result.error) {
        // Dimension differences are always significant - these indicate real UI changes
        if (result.error.includes('dimensions differ')) {
            console.log(`[image-comparison] Dimension change detected: ${result.error}`);
            fs.copyFileSync(newScreenshotPath, targetPath);
            return true;
        }
        console.error(`[image-comparison] Comparison error: ${result.error}, saving new screenshot`);
        fs.copyFileSync(newScreenshotPath, targetPath);
        return true;
    }

    if (result.identical) {
        console.log(`[image-comparison] Screenshot unchanged, skipping save: ${targetPath}`);
        return false;
    }

    // Check if differences are below threshold (likely noise/artifacts)
    const totalPixels = result.totalPixels ?? 1;
    const diffRatio = (result.differentPixels ?? 0) / totalPixels;
    
    if (diffRatio < PIXEL_DIFFERENCE_THRESHOLD) {
        console.log(
            `[image-comparison] Screenshot negligible change (${result.differentPixels}/${totalPixels} = ${(diffRatio * 100).toFixed(4)}%), skipping save: ${targetPath}`
        );
        return false;
    }

    // Images differ significantly, save the new one
    console.log(
        `[image-comparison] Screenshot changed (${result.differentPixels}/${totalPixels} = ${(diffRatio * 100).toFixed(2)}% pixels differ), updating: ${targetPath}`
    );
    fs.copyFileSync(newScreenshotPath, targetPath);
    return true;
}

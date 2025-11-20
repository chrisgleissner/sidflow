/**
 * Pixel-perfect image comparison utility for preventing unnecessary screenshot updates.
 * 
 * This module ensures that screenshots are only saved when there are actual visual differences.
 * PNG metadata (timestamps, etc.) should not trigger updates if pixels are identical.
 */

import * as fs from 'fs';
import * as crypto from 'crypto';

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
 * This method strips all metadata and compares only the actual pixel values.
 * 
 * Uses multiple comparison strategies for maximum reliability:
 * 1. Raw binary comparison of pixel data (fastest, catches all differences)
 * 2. SHA-256 hash comparison (reliable, metadata-independent)
 * 3. Fallback byte-by-byte comparison
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

        // Try to use sharp for precise pixel comparison (if available)
        try {
            const sharp = await import('sharp');
            return await compareWithSharp(existingPath, newPath, sharp.default);
        } catch (sharpError) {
            // Sharp not available or failed, fall back to buffer comparison
            console.warn('[image-comparison] Sharp not available, using buffer comparison');
        }

        // Fallback: Compare raw PNG data buffers
        // This strips metadata by comparing only the actual image data
        return await compareWithBuffers(existingPath, newPath);
    } catch (error) {
        return {
            identical: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Compare images using Sharp library for pixel-perfect comparison.
 * This extracts raw pixel data and compares it directly.
 */
async function compareWithSharp(
    existingPath: string,
    newPath: string,
    sharp: any
): Promise<ImageComparisonResult> {
    try {
        // Load both images and extract raw pixel data
        const [existingImage, newImage] = await Promise.all([
            sharp(existingPath).raw().toBuffer({ resolveWithObject: true }),
            sharp(newPath).raw().toBuffer({ resolveWithObject: true }),
        ]);

        // Check dimensions match
        if (
            existingImage.info.width !== newImage.info.width ||
            existingImage.info.height !== newImage.info.height ||
            existingImage.info.channels !== newImage.info.channels
        ) {
            return {
                identical: false,
                error: 'Image dimensions or channels differ',
            };
        }

        const totalPixels = existingImage.info.width * existingImage.info.height;

        // Compare raw pixel buffers
        if (existingImage.data.length !== newImage.data.length) {
            return {
                identical: false,
                differentPixels: totalPixels,
                totalPixels,
            };
        }

        // Byte-by-byte comparison of raw pixel data
        let differentPixels = 0;
        const channels = existingImage.info.channels;

        for (let i = 0; i < existingImage.data.length; i += channels) {
            // Compare all channels for this pixel
            let pixelDifferent = false;
            for (let c = 0; c < channels; c++) {
                if (existingImage.data[i + c] !== newImage.data[i + c]) {
                    pixelDifferent = true;
                    break;
                }
            }
            if (pixelDifferent) {
                differentPixels++;
            }
        }

        return {
            identical: differentPixels === 0,
            differentPixels,
            totalPixels,
        };
    } catch (error) {
        throw new Error(`Sharp comparison failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Fallback comparison using raw buffer comparison with hash verification.
 * This method compares SHA-256 hashes of the image data, which is metadata-independent.
 */
async function compareWithBuffers(
    existingPath: string,
    newPath: string
): Promise<ImageComparisonResult> {
    try {
        // Read both files
        const existingBuffer = fs.readFileSync(existingPath);
        const newBuffer = fs.readFileSync(newPath);

        // Note: Don't compare file sizes - metadata can make files different sizes
        // We'll extract and compare only the image data chunks

        // Parse PNG structure to extract IDAT chunks (actual image data)
        // This skips metadata chunks like tEXt, tIME, etc.
        const existingData = extractPngImageData(existingBuffer);
        const newData = extractPngImageData(newBuffer);

        // Compare using cryptographic hash (most reliable)
        const existingHash = crypto.createHash('sha256').update(existingData).digest('hex');
        const newHash = crypto.createHash('sha256').update(newData).digest('hex');

        if (existingHash === newHash) {
            return {
                identical: true,
                differentPixels: 0,
            };
        }

        // If hashes differ, do byte-by-byte comparison to count differences
        let differentBytes = 0;
        const minLength = Math.min(existingData.length, newData.length);

        for (let i = 0; i < minLength; i++) {
            if (existingData[i] !== newData[i]) {
                differentBytes++;
            }
        }

        // Add any extra bytes as differences
        differentBytes += Math.abs(existingData.length - newData.length);

        return {
            identical: false,
            differentPixels: differentBytes,
            totalPixels: Math.max(existingData.length, newData.length),
        };
    } catch (error) {
        throw new Error(`Buffer comparison failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Extract actual image data (IDAT chunks) from PNG file, ignoring metadata.
 * This ensures we compare only pixel data, not timestamps or other metadata.
 * 
 * PNG structure:
 * - 8-byte signature
 * - Chunks: 4-byte length + 4-byte type + data + 4-byte CRC
 * 
 * We extract only IDAT (image data) and IHDR (header) chunks.
 */
function extractPngImageData(buffer: Buffer): Buffer {
    // PNG signature: 137 80 78 71 13 10 26 10
    const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    // Verify PNG signature
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error('Invalid PNG file');
    }

    const chunks: Buffer[] = [];
    let offset = 8; // Skip signature

    while (offset < buffer.length) {
        if (offset + 12 > buffer.length) {
            break; // Not enough bytes for chunk header and CRC
        }

        // Read chunk length (4 bytes, big-endian)
        const length = buffer.readUInt32BE(offset);
        offset += 4;

        // Read chunk type (4 bytes)
        const type = buffer.subarray(offset, offset + 4).toString('ascii');
        offset += 4;

        // Read chunk data
        if (offset + length + 4 > buffer.length) {
            break; // Not enough bytes for chunk data and CRC
        }

        const data = buffer.subarray(offset, offset + length);
        offset += length;

        // Skip CRC (4 bytes)
        offset += 4;

        // Only include IHDR (header) and IDAT (image data) chunks
        // Skip all metadata chunks (tEXt, tIME, zTXt, iTXt, etc.)
        if (type === 'IHDR' || type === 'IDAT') {
            // Include type + data for deterministic comparison
            const chunkBuffer = Buffer.concat([
                Buffer.from(type, 'ascii'),
                data,
            ]);
            chunks.push(chunkBuffer);
        }

        // Stop at IEND
        if (type === 'IEND') {
            break;
        }
    }

    // Concatenate all relevant chunks
    return Buffer.concat(chunks);
}

/**
 * Conditionally save a screenshot only if it differs from the existing one.
 * 
 * @param newScreenshotPath Path where Playwright saved the new screenshot
 * @param targetPath Path where the screenshot should be saved (existing location)
 * @returns true if screenshot was saved (different), false if skipped (identical)
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
        console.error(`[image-comparison] Comparison error: ${result.error}, saving new screenshot`);
        fs.copyFileSync(newScreenshotPath, targetPath);
        return true;
    }

    if (result.identical) {
        console.log(`[image-comparison] Screenshot unchanged, skipping save: ${targetPath}`);
        return false;
    }

    // Images differ, save the new one
    console.log(
        `[image-comparison] Screenshot changed (${result.differentPixels}/${result.totalPixels} pixels differ), updating: ${targetPath}`
    );
    fs.copyFileSync(newScreenshotPath, targetPath);
    return true;
}

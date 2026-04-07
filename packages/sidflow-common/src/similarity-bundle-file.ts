import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { ensureDir } from "./fs.js";

export type SimilarityBundleContentEncoding = "identity" | "gzip";

function isGzipPayload(payload: Uint8Array): boolean {
  return payload.length >= 2 && payload[0] === 0x1f && payload[1] === 0x8b;
}

export function isGzipBundlePath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".gz");
}

export function computePortableManifestPath(outputPath: string, explicitPath?: string): string {
  if (explicitPath) {
    return explicitPath;
  }
  const withoutCompression = outputPath.replace(/\.gz$/i, "");
  return withoutCompression.replace(/\.sidcorr$/i, ".manifest.json");
}

export async function readPortableBundlePayload(
  filePath: string,
): Promise<{ payload: Buffer; contentEncoding: SimilarityBundleContentEncoding }> {
  const encoded = await readFile(filePath);
  if (isGzipPayload(encoded)) {
    return {
      payload: gunzipSync(encoded),
      contentEncoding: "gzip",
    };
  }
  return {
    payload: encoded,
    contentEncoding: "identity",
  };
}

export async function writePortableBundlePayload(
  filePath: string,
  payload: Buffer,
): Promise<{
  bytesWritten: number;
  bytesUncompressed: number;
  contentEncoding: SimilarityBundleContentEncoding;
}> {
  const contentEncoding: SimilarityBundleContentEncoding = isGzipBundlePath(filePath) ? "gzip" : "identity";
  const encoded = contentEncoding === "gzip"
    ? gzipSync(payload, { level: 9 })
    : payload;
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, encoded);
  return {
    bytesWritten: encoded.length,
    bytesUncompressed: payload.length,
    contentEncoding,
  };
}
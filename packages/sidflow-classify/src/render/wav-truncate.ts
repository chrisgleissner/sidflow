import { open, stat } from "node:fs/promises";

interface WavProbeResult {
  readonly fmtOffset: number;
  readonly dataSizeOffset: number;
  readonly dataOffset: number;
  readonly dataSize: number;
  readonly channels: number;
  readonly sampleRate: number;
  readonly bitsPerSample: number;
  readonly byteRate: number;
  readonly blockAlign: number;
}

async function probeWav(filePath: string): Promise<WavProbeResult> {
  const handle = await open(filePath, "r");
  try {
    const headerSize = 256 * 1024;
    const header = Buffer.alloc(headerSize);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const buffer = header.subarray(0, bytesRead);

    if (buffer.length < 44) {
      throw new Error("WAV file is too small to contain required headers");
    }

    if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
      throw new Error("Invalid WAV header");
    }

    let offset = 12;
    let fmtChunkOffset = -1;
    let dataChunkOffset = -1;
    let dataChunkSize = 0;

    while (offset + 8 <= buffer.length) {
      const chunkId = buffer.toString("ascii", offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const chunkStart = offset + 8;

      if (chunkId === "fmt ") {
        fmtChunkOffset = chunkStart;
      } else if (chunkId === "data") {
        dataChunkOffset = chunkStart;
        dataChunkSize = chunkSize;
        break;
      }

      offset = chunkStart + chunkSize + (chunkSize % 2);
    }

    if (fmtChunkOffset < 0) {
      throw new Error("Missing fmt chunk in WAV file");
    }

    if (dataChunkOffset < 0 || dataChunkSize <= 0) {
      throw new Error("Missing data chunk in WAV file");
    }

    const channels = buffer.readUInt16LE(fmtChunkOffset + 2);
    const sampleRate = buffer.readUInt32LE(fmtChunkOffset + 4);
    const byteRate = buffer.readUInt32LE(fmtChunkOffset + 8);
    const blockAlign = buffer.readUInt16LE(fmtChunkOffset + 12);
    const bitsPerSample = buffer.readUInt16LE(fmtChunkOffset + 14);

    const resolvedByteRate =
      byteRate > 0 ? byteRate : sampleRate * channels * (bitsPerSample / 8);
    const resolvedBlockAlign =
      blockAlign > 0 ? blockAlign : channels * (bitsPerSample / 8);

    return {
      fmtOffset: fmtChunkOffset,
      dataSizeOffset: dataChunkOffset - 4,
      dataOffset: dataChunkOffset,
      dataSize: dataChunkSize,
      channels,
      sampleRate,
      bitsPerSample,
      byteRate: resolvedByteRate,
      blockAlign: resolvedBlockAlign,
    };
  } finally {
    await handle.close();
  }
}

export async function probeWavDurationMs(filePath: string): Promise<number> {
  const info = await probeWav(filePath);
  if (info.byteRate <= 0) {
    return 0;
  }
  return Math.max(1, Math.round((info.dataSize / info.byteRate) * 1000));
}

export async function truncateWavFileToDurationMs(
  filePath: string,
  maxDurationMs: number
): Promise<{ readonly truncated: boolean; readonly durationMs: number }> {
  if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
    return { truncated: false, durationMs: 0 };
  }

  const info = await probeWav(filePath);
  const currentDurationMs = info.byteRate > 0
    ? Math.max(1, Math.round((info.dataSize / info.byteRate) * 1000))
    : 0;

  if (currentDurationMs <= 0) {
    return { truncated: false, durationMs: 0 };
  }

  // Already within limit (allow tiny rounding noise)
  if (currentDurationMs <= maxDurationMs + 10) {
    return { truncated: false, durationMs: currentDurationMs };
  }

  const maxBytesRaw = Math.floor((maxDurationMs / 1000) * info.byteRate);
  const blockAlign = Math.max(1, Math.floor(info.blockAlign));
  const maxDataBytes = Math.max(0, maxBytesRaw - (maxBytesRaw % blockAlign));
  const newDataSize = Math.min(info.dataSize, maxDataBytes);

  const newFileSize = info.dataOffset + newDataSize;
  const stats = await stat(filePath);
  if (newFileSize >= stats.size) {
    return { truncated: false, durationMs: currentDurationMs };
  }

  const handle = await open(filePath, "r+");
  try {
    const headerPatch = Buffer.alloc(8);

    // Patch RIFF chunk size at offset 4: fileSize - 8
    headerPatch.writeUInt32LE(newFileSize - 8, 0);
    await handle.write(headerPatch.subarray(0, 4), 0, 4, 4);

    // Patch data chunk size at dataSizeOffset
    headerPatch.writeUInt32LE(newDataSize, 0);
    await handle.write(headerPatch.subarray(0, 4), 0, 4, info.dataSizeOffset);

    // Truncate file to new size
    await handle.truncate(newFileSize);
  } finally {
    await handle.close();
  }

  const newDurationMs = info.byteRate > 0
    ? Math.max(1, Math.round((newDataSize / info.byteRate) * 1000))
    : 0;

  return { truncated: true, durationMs: newDurationMs };
}

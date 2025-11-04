/**
 * SID file parser for extracting metadata from SID file headers.
 * Based on the SID File Format specification documented in sid-metadata.md.
 */

import { readFile } from "node:fs/promises";

/**
 * Video standard (clock) for playback
 */
export type SidClock = "Unknown" | "PAL" | "NTSC" | "PAL+NTSC";

/**
 * SID chip model
 */
export type SidModel = "Unknown" | "MOS6581" | "MOS8580" | "Both";

/**
 * SID file type
 */
export type SidType = "PSID" | "RSID";

/**
 * Complete SID file metadata extracted from the header
 */
export interface SidFileMetadata {
  /** File type: PSID or RSID */
  type: SidType;
  /** Header version (1-4) */
  version: number;
  /** Song title (Windows-1252 encoding) */
  title: string;
  /** Composer/musician name */
  author: string;
  /** Release/copyright info */
  released: string;
  /** Number of songs/subtunes (1-256) */
  songs: number;
  /** Default starting song (1-based index) */
  startSong: number;
  /** Video standard for playback */
  clock: SidClock;
  /** Primary SID chip model */
  sidModel1: SidModel;
  /** Secondary SID chip model (v3+) */
  sidModel2?: SidModel;
  /** Third SID chip model (v4+) */
  sidModel3?: SidModel;
  /** Second SID address in $Dxx0 format (v3+) */
  secondSIDAddress?: string | null;
  /** Third SID address in $Dxx0 format (v4+) */
  thirdSIDAddress?: string | null;
  /** Load address */
  loadAddress: number;
  /** Init address */
  initAddress: number;
  /** Play address */
  playAddress: number;
}

/**
 * Parse a 16-bit big-endian word from buffer
 */
function readWord(buffer: Buffer, offset: number): number {
  return buffer.readUInt16BE(offset);
}

/**
 * Parse a null-terminated or fixed-length string from buffer
 * Converts from Windows-1252 to UTF-8
 */
function readString(buffer: Buffer, offset: number, maxLength: number): string {
  const bytes: number[] = [];
  for (let i = 0; i < maxLength; i++) {
    const byte = buffer[offset + i];
    if (byte === 0) {
      break;
    }
    bytes.push(byte);
  }
  // Windows-1252 is mostly compatible with latin1 in Node.js
  return Buffer.from(bytes).toString("latin1").trim();
}

/**
 * Decode clock (video standard) from flags bits 2-3
 */
function decodeClock(flags: number): SidClock {
  const clockBits = (flags >> 2) & 0x03;
  switch (clockBits) {
    case 0x00:
      return "Unknown";
    case 0x01:
      return "PAL";
    case 0x02:
      return "NTSC";
    case 0x03:
      return "PAL+NTSC";
    default:
      return "Unknown";
  }
}

/**
 * Decode SID model from flags bits
 */
function decodeSidModel(modelBits: number): SidModel {
  switch (modelBits) {
    case 0x00:
      return "Unknown";
    case 0x01:
      return "MOS6581";
    case 0x02:
      return "MOS8580";
    case 0x03:
      return "Both";
    default:
      return "Unknown";
  }
}

/**
 * Decode SID address from byte value
 * Returns null if address is 0 (no SID), otherwise returns $Dxx0 format
 */
function decodeSidAddress(addressByte: number): string | null {
  if (addressByte === 0) {
    return null;
  }
  return `$D${addressByte.toString(16).toUpperCase().padStart(2, "0")}0`;
}

/**
 * Parse SID file metadata from file path
 */
export async function parseSidFile(filePath: string): Promise<SidFileMetadata> {
  const buffer = await readFile(filePath);
  return parseSidFileFromBuffer(buffer);
}

/**
 * Parse SID file metadata from buffer
 */
export function parseSidFileFromBuffer(buffer: Buffer): SidFileMetadata {
  // Minimum header size is 0x76 (118 bytes) for v1, 0x7C (124 bytes) for v2+
  // Check for v1 minimum first to be able to read the version
  if (buffer.length < 0x76) {
    throw new Error("SID file too small - minimum 118 bytes required for v1 header");
  }

  // Parse magic ID (PSID or RSID)
  const magicID = buffer.toString("ascii", 0, 4);
  if (magicID !== "PSID" && magicID !== "RSID") {
    throw new Error(`Invalid SID file - magic ID must be PSID or RSID, got: ${magicID}`);
  }
  const type = magicID as SidType;

  // Parse version
  const version = readWord(buffer, 0x04);
  if (version < 1 || version > 4) {
    throw new Error(`Invalid SID version: ${version} (must be 1-4)`);
  }

  // Verify buffer is large enough for this version
  const requiredSize = version >= 2 ? 0x7c : 0x76;
  if (buffer.length < requiredSize) {
    throw new Error(
      `SID file too small for version ${version} - requires ${requiredSize} bytes (${
        version >= 2 ? '124' : '118'
      }), got ${buffer.length}`
    );
  }

  // Parse data offset
  const dataOffset = readWord(buffer, 0x06);
  if (dataOffset < 0x76) {
    throw new Error(`Invalid data offset: ${dataOffset} (must be >= 0x76)`);
  }

  // Parse addresses
  const loadAddress = readWord(buffer, 0x08);
  const initAddress = readWord(buffer, 0x0a);
  const playAddress = readWord(buffer, 0x0c);

  // Parse song counts
  const songs = readWord(buffer, 0x0e);
  if (songs < 1 || songs > 256) {
    throw new Error(`Invalid song count: ${songs} (must be 1-256)`);
  }

  const startSong = readWord(buffer, 0x10);
  if (startSong < 1 || startSong > songs) {
    throw new Error(`Invalid start song: ${startSong} (must be 1-${songs})`);
  }

  // Parse text fields (32 bytes each, Windows-1252 encoding)
  const title = readString(buffer, 0x16, 32);
  const author = readString(buffer, 0x36, 32);
  const released = readString(buffer, 0x56, 32);

  // Initialize metadata with basic fields
  const metadata: SidFileMetadata = {
    type,
    version,
    title,
    author,
    released,
    songs,
    startSong,
    clock: "Unknown",
    sidModel1: "Unknown",
    loadAddress,
    initAddress,
    playAddress
  };

  // Parse extended header fields (v2+)
  if (version >= 2) {
    const flags = readWord(buffer, 0x76);

    // Decode clock (bits 2-3)
    metadata.clock = decodeClock(flags);

    // Decode SID models (bits 4-5, 6-7, 8-9)
    metadata.sidModel1 = decodeSidModel((flags >> 4) & 0x03);

    if (version >= 3) {
      const sidModel2Bits = (flags >> 6) & 0x03;
      metadata.sidModel2 = sidModel2Bits === 0 ? metadata.sidModel1 : decodeSidModel(sidModel2Bits);

      // Parse second SID address
      const secondSIDAddressByte = buffer.readUInt8(0x7a);
      metadata.secondSIDAddress = decodeSidAddress(secondSIDAddressByte);
    }

    if (version >= 4) {
      const sidModel3Bits = (flags >> 8) & 0x03;
      metadata.sidModel3 = sidModel3Bits === 0 ? metadata.sidModel1 : decodeSidModel(sidModel3Bits);

      // Parse third SID address
      const thirdSIDAddressByte = buffer.readUInt8(0x7b);
      metadata.thirdSIDAddress = decodeSidAddress(thirdSIDAddressByte);
    }
  }

  return metadata;
}

/**
 * Convert SID metadata to JSON-serializable object
 */
export function sidMetadataToJson(metadata: SidFileMetadata): Record<string, unknown> {
  const result: Record<string, unknown> = {
    type: metadata.type,
    version: metadata.version,
    title: metadata.title,
    author: metadata.author,
    released: metadata.released,
    songs: metadata.songs,
    startSong: metadata.startSong,
    clock: metadata.clock,
    sidModel1: metadata.sidModel1
  };

  if (metadata.sidModel2) {
    result.sidModel2 = metadata.sidModel2;
  }

  if (metadata.sidModel3) {
    result.sidModel3 = metadata.sidModel3;
  }

  if (metadata.secondSIDAddress) {
    result.secondSIDAddress = metadata.secondSIDAddress;
  }

  if (metadata.thirdSIDAddress) {
    result.thirdSIDAddress = metadata.thirdSIDAddress;
  }

  // Include addresses for reference
  result.loadAddress = `$${metadata.loadAddress.toString(16).toUpperCase().padStart(4, "0")}`;
  result.initAddress = `$${metadata.initAddress.toString(16).toUpperCase().padStart(4, "0")}`;
  result.playAddress = `$${metadata.playAddress.toString(16).toUpperCase().padStart(4, "0")}`;

  return result;
}

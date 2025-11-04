import { describe, expect, it } from "bun:test";
import { parseSidFileFromBuffer, sidMetadataToJson, type SidFileMetadata } from "../src/sid-parser.js";

describe("SID parser", () => {
  it("parses a minimal v1 PSID file", () => {
    // Create a minimal PSID v1 header (118 bytes)
    const buffer = Buffer.alloc(118);
    
    // Magic ID: "PSID"
    buffer.write("PSID", 0, "ascii");
    
    // Version: 1
    buffer.writeUInt16BE(1, 0x04);
    
    // Data offset: 0x0076
    buffer.writeUInt16BE(0x0076, 0x06);
    
    // Load address: $1000
    buffer.writeUInt16BE(0x1000, 0x08);
    
    // Init address: $1000
    buffer.writeUInt16BE(0x1000, 0x0a);
    
    // Play address: $1003
    buffer.writeUInt16BE(0x1003, 0x0c);
    
    // Songs: 3
    buffer.writeUInt16BE(3, 0x0e);
    
    // Start song: 1
    buffer.writeUInt16BE(1, 0x10);
    
    // Title: "Test Song"
    buffer.write("Test Song", 0x16, "latin1");
    
    // Author: "Test Author"
    buffer.write("Test Author", 0x36, "latin1");
    
    // Released: "2025 Test"
    buffer.write("2025 Test", 0x56, "latin1");
    
    const metadata = parseSidFileFromBuffer(buffer);
    
    expect(metadata.type).toBe("PSID");
    expect(metadata.version).toBe(1);
    expect(metadata.title).toBe("Test Song");
    expect(metadata.author).toBe("Test Author");
    expect(metadata.released).toBe("2025 Test");
    expect(metadata.songs).toBe(3);
    expect(metadata.startSong).toBe(1);
    expect(metadata.clock).toBe("Unknown"); // v1 has no flags
    expect(metadata.sidModel1).toBe("Unknown");
    expect(metadata.loadAddress).toBe(0x1000);
    expect(metadata.initAddress).toBe(0x1000);
    expect(metadata.playAddress).toBe(0x1003);
  });

  it("parses a v2 PSID file with clock and SID model", () => {
    // Create a v2 PSID header (124 bytes)
    const buffer = Buffer.alloc(124);
    
    // Magic ID: "PSID"
    buffer.write("PSID", 0, "ascii");
    
    // Version: 2
    buffer.writeUInt16BE(2, 0x04);
    
    // Data offset: 0x007C
    buffer.writeUInt16BE(0x007c, 0x06);
    
    // Addresses
    buffer.writeUInt16BE(0x1000, 0x08);
    buffer.writeUInt16BE(0x1000, 0x0a);
    buffer.writeUInt16BE(0x1003, 0x0c);
    
    // Songs: 2
    buffer.writeUInt16BE(2, 0x0e);
    
    // Start song: 1
    buffer.writeUInt16BE(1, 0x10);
    
    // Title
    buffer.write("Delta Theme", 0x16, "latin1");
    
    // Author
    buffer.write("Rob Hubbard", 0x36, "latin1");
    
    // Released
    buffer.write("1987 Thalamus", 0x56, "latin1");
    
    // Flags at 0x76:
    // Bits 2-3: 01 (PAL)
    // Bits 4-5: 01 (MOS6581)
    const flags = 0b00010100; // PAL + MOS6581
    buffer.writeUInt16BE(flags, 0x76);
    
    const metadata = parseSidFileFromBuffer(buffer);
    
    expect(metadata.version).toBe(2);
    expect(metadata.title).toBe("Delta Theme");
    expect(metadata.author).toBe("Rob Hubbard");
    expect(metadata.released).toBe("1987 Thalamus");
    expect(metadata.songs).toBe(2);
    expect(metadata.clock).toBe("PAL");
    expect(metadata.sidModel1).toBe("MOS6581");
  });

  it("parses a v3 RSID file with multiple SID chips", () => {
    // Create a v3 RSID header (124 bytes)
    const buffer = Buffer.alloc(124);
    
    // Magic ID: "RSID"
    buffer.write("RSID", 0, "ascii");
    
    // Version: 3
    buffer.writeUInt16BE(3, 0x04);
    
    // Data offset: 0x007C
    buffer.writeUInt16BE(0x007c, 0x06);
    
    // Addresses
    buffer.writeUInt16BE(0, 0x08); // RSID load address must be 0
    buffer.writeUInt16BE(0x1000, 0x0a);
    buffer.writeUInt16BE(0, 0x0c); // RSID play address must be 0
    
    // Songs: 1
    buffer.writeUInt16BE(1, 0x0e);
    
    // Start song: 1
    buffer.writeUInt16BE(1, 0x10);
    
    // Title
    buffer.write("Stereo Tune", 0x16, "latin1");
    
    // Author
    buffer.write("Composer", 0x36, "latin1");
    
    // Released
    buffer.write("1990", 0x56, "latin1");
    
    // Flags at 0x76:
    // Bits 2-3: 10 (NTSC)
    // Bits 4-5: 10 (MOS8580) - primary SID
    // Bits 6-7: 10 (MOS8580) - secondary SID (same model)
    const flags = 0b00101000 | 0b10000000; // NTSC + MOS8580 primary + MOS8580 secondary
    buffer.writeUInt16BE(flags, 0x76);
    
    // Second SID address at 0x7A: 0x42 = $D420
    buffer.writeUInt8(0x42, 0x7a);
    
    const metadata = parseSidFileFromBuffer(buffer);
    
    expect(metadata.type).toBe("RSID");
    expect(metadata.version).toBe(3);
    expect(metadata.songs).toBe(1);
    expect(metadata.clock).toBe("NTSC");
    expect(metadata.sidModel1).toBe("MOS8580");
    expect(metadata.sidModel2).toBe("MOS8580");
    expect(metadata.secondSIDAddress).toBe("$D420");
  });

  it("parses a v4 PSID file with three SID chips", () => {
    // Create a v4 PSID header (124 bytes)
    const buffer = Buffer.alloc(124);
    
    // Magic ID: "PSID"
    buffer.write("PSID", 0, "ascii");
    
    // Version: 4
    buffer.writeUInt16BE(4, 0x04);
    
    // Data offset: 0x007C
    buffer.writeUInt16BE(0x007c, 0x06);
    
    // Addresses
    buffer.writeUInt16BE(0x1000, 0x08);
    buffer.writeUInt16BE(0x1000, 0x0a);
    buffer.writeUInt16BE(0x1003, 0x0c);
    
    // Songs: 5
    buffer.writeUInt16BE(5, 0x0e);
    
    // Start song: 2
    buffer.writeUInt16BE(2, 0x10);
    
    // Title
    buffer.write("Triple SID", 0x16, "latin1");
    
    // Author
    buffer.write("Artist", 0x36, "latin1");
    
    // Released
    buffer.write("2020", 0x56, "latin1");
    
    // Flags at 0x76:
    // Bits 2-3: 11 (PAL+NTSC)
    // Bits 4-5: 11 (Both) - primary SID
    // Bits 6-7: 01 (MOS6581) - secondary SID
    // Bits 8-9: 10 (MOS8580) - third SID
    const flags = (0b11 << 2) | (0b11 << 4) | (0b01 << 6) | (0b10 << 8);
    buffer.writeUInt16BE(flags, 0x76);
    
    // Second SID address at 0x7A: 0xE0 = $DE00
    buffer.writeUInt8(0xe0, 0x7a);
    
    // Third SID address at 0x7B: 0xF0 = $DF00
    buffer.writeUInt8(0xf0, 0x7b);
    
    const metadata = parseSidFileFromBuffer(buffer);
    
    expect(metadata.version).toBe(4);
    expect(metadata.songs).toBe(5);
    expect(metadata.startSong).toBe(2);
    expect(metadata.clock).toBe("PAL+NTSC");
    expect(metadata.sidModel1).toBe("Both");
    expect(metadata.sidModel2).toBe("MOS6581");
    expect(metadata.sidModel3).toBe("MOS8580");
    expect(metadata.secondSIDAddress).toBe("$DE00");
    expect(metadata.thirdSIDAddress).toBe("$DF00");
  });

  it("converts metadata to JSON format", () => {
    const metadata: SidFileMetadata = {
      type: "PSID",
      version: 2,
      title: "Test Song",
      author: "Test Author",
      released: "2025",
      songs: 3,
      startSong: 1,
      clock: "PAL",
      sidModel1: "MOS6581",
      loadAddress: 0x1000,
      initAddress: 0x1000,
      playAddress: 0x1003
    };

    const json = sidMetadataToJson(metadata);

    expect(json.type).toBe("PSID");
    expect(json.version).toBe(2);
    expect(json.title).toBe("Test Song");
    expect(json.author).toBe("Test Author");
    expect(json.released).toBe("2025");
    expect(json.songs).toBe(3);
    expect(json.startSong).toBe(1);
    expect(json.clock).toBe("PAL");
    expect(json.sidModel1).toBe("MOS6581");
    expect(json.loadAddress).toBe("$1000");
    expect(json.initAddress).toBe("$1000");
    expect(json.playAddress).toBe("$1003");
  });

  it("rejects files that are too small", () => {
    const buffer = Buffer.alloc(50); // Too small
    expect(() => parseSidFileFromBuffer(buffer)).toThrow("SID file too small");
  });

  it("rejects v2+ files that are too small", () => {
    const buffer = Buffer.alloc(118); // Big enough for v1, but not v2
    buffer.write("PSID", 0, "ascii");
    buffer.writeUInt16BE(2, 0x04); // Version 2
    buffer.writeUInt16BE(0x007c, 0x06);
    expect(() => parseSidFileFromBuffer(buffer)).toThrow(
      "SID file too small for version 2 - requires 124 bytes"
    );
  });

  it("rejects invalid magic IDs", () => {
    const buffer = Buffer.alloc(118);
    buffer.write("XXXX", 0, "ascii");
    expect(() => parseSidFileFromBuffer(buffer)).toThrow("Invalid SID file");
  });

  it("rejects invalid version numbers", () => {
    const buffer = Buffer.alloc(118);
    buffer.write("PSID", 0, "ascii");
    buffer.writeUInt16BE(99, 0x04); // Invalid version
    expect(() => parseSidFileFromBuffer(buffer)).toThrow("Invalid SID version");
  });

  it("rejects invalid song counts", () => {
    const buffer = Buffer.alloc(118);
    buffer.write("PSID", 0, "ascii");
    buffer.writeUInt16BE(1, 0x04);
    buffer.writeUInt16BE(0x0076, 0x06);
    buffer.writeUInt16BE(0, 0x0e); // Invalid: 0 songs
    buffer.writeUInt16BE(1, 0x10);
    expect(() => parseSidFileFromBuffer(buffer)).toThrow("Invalid song count");
  });
});

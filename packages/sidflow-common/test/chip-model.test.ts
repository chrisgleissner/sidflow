import { describe, it, expect } from "bun:test";
import { normalizeSidChip } from "../src/chip-model.js";

describe("normalizeSidChip", () => {
  describe("6581 variants", () => {
    it("normalizes '6581' to 6581", () => {
      expect(normalizeSidChip("6581")).toBe("6581");
    });
    it("normalizes 'MOS 6581' to 6581", () => {
      expect(normalizeSidChip("MOS 6581")).toBe("6581");
    });
    it("normalizes '6581R3' to 6581", () => {
      expect(normalizeSidChip("6581R3")).toBe("6581");
    });
    it("normalizes 'mos6581' lowercase to 6581", () => {
      expect(normalizeSidChip("mos6581")).toBe("6581");
    });
    it("extracts 6581 from complex string", () => {
      expect(normalizeSidChip("Commodore MOS 6581 SID Rev 3")).toBe("6581");
    });
  });
  describe("8580 variants", () => {
    it("normalizes '8580' to 8580", () => {
      expect(normalizeSidChip("8580")).toBe("8580");
    });
    it("normalizes 'MOS 8580' to 8580", () => {
      expect(normalizeSidChip("MOS 8580")).toBe("8580");
    });
    it("normalizes '8580R5' to 8580", () => {
      expect(normalizeSidChip("8580R5")).toBe("8580");
    });
    it("normalizes 'mos8580r5' lowercase to 8580", () => {
      expect(normalizeSidChip("mos8580r5")).toBe("8580");
    });
  });
  describe("invalid inputs", () => {
    it("returns null for empty string", () => {
      expect(normalizeSidChip("")).toBe(null);
    });
    it("returns null for whitespace", () => {
      expect(normalizeSidChip("   ")).toBe(null);
    });
    it("returns null for unrecognized chip", () => {
      expect(normalizeSidChip("2A03")).toBe(null);
    });
    it("returns null for number", () => {
      expect(normalizeSidChip(6581 as any)).toBe(null);
    });
    it("returns null for null", () => {
      expect(normalizeSidChip(null as any)).toBe(null);
    });
    it("returns null for undefined", () => {
      expect(normalizeSidChip(undefined as any)).toBe(null);
    });
    it("returns null for object", () => {
      expect(normalizeSidChip({ chip: "6581" } as any)).toBe(null);
    });
  });
  describe("whitespace handling", () => {
    it("trims leading whitespace", () => {
      expect(normalizeSidChip("  6581")).toBe("6581");
    });
    it("trims trailing whitespace", () => {
      expect(normalizeSidChip("8580  ")).toBe("8580");
    });
    it("handles tabs and newlines", () => {
      expect(normalizeSidChip("\t6581\n")).toBe("6581");
    });
  });
  describe("case insensitivity", () => {
    it("handles uppercase", () => {
      expect(normalizeSidChip("MOS 6581")).toBe("6581");
    });
    it("handles lowercase", () => {
      expect(normalizeSidChip("mos 8580")).toBe("8580");
    });
    it("handles mixed case", () => {
      expect(normalizeSidChip("mOs 6581 R3")).toBe("6581");
    });
  });
});

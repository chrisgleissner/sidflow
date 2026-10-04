import { describe, expect, it } from "bun:test";
import {
  checkSidHeader,
  createLibsidplayfpLoader,
  crossCheckLibsidplayfp,
  declaredSidChipBases,
  isValidExtraSidAddress,
  SID_HEADER_RULES,
  type SidHeaderRuleId,
} from "../src/sid-header-conformance.js";

interface SidOptions {
  magic?: "PSID" | "RSID";
  version?: number;
  /** C64 data after the header, including the embedded load address when loadAddress is 0. */
  data?: number[];
}

/** A conforming header: embedded load address $1000, init $1000, one song, 32 bytes of RTS. */
function makeSid({ magic = "PSID", version = 2, data }: SidOptions = {}): Buffer {
  const headerSize = version === 1 ? 0x76 : 0x7c;
  const body = data ?? [0x00, 0x10, ...new Array<number>(32).fill(0x60)];
  const buffer = Buffer.alloc(headerSize + body.length);
  buffer.write(magic, 0, "ascii");
  buffer.writeUInt16BE(version, 0x04);
  buffer.writeUInt16BE(headerSize, 0x06);
  buffer.writeUInt16BE(0x0000, 0x08);
  buffer.writeUInt16BE(0x1000, 0x0a);
  buffer.writeUInt16BE(magic === "RSID" ? 0x0000 : 0x1003, 0x0c);
  buffer.writeUInt16BE(1, 0x0e);
  buffer.writeUInt16BE(1, 0x10);
  buffer.write("Title", 0x16, "latin1");
  buffer.write("Author", 0x36, "latin1");
  buffer.write("2026 Test", 0x56, "latin1");
  if (version >= 2) {
    buffer.writeUInt16BE(0x0014, 0x76); // PAL, 6581
  }
  Buffer.from(body).copy(buffer, headerSize);
  return buffer;
}

function rulesOf(buffer: Buffer): SidHeaderRuleId[] {
  return checkSidHeader(buffer).findings.map((finding) => finding.rule);
}

interface RuleCase {
  rule: SidHeaderRuleId;
  /** Header that must raise the rule. */
  fires: () => Buffer;
  /** Closest header that must not raise it. */
  passes: () => Buffer;
  offset: number;
  bytes: string;
}

function edit(options: SidOptions, change: (buffer: Buffer) => void): () => Buffer {
  return () => {
    const buffer = makeSid(options);
    change(buffer);
    return buffer;
  };
}

const RSID: SidOptions = { magic: "RSID" };

const CASES: RuleCase[] = [
  { rule: "magic", fires: edit({}, (b) => b.write("XSID", 0, "ascii")), passes: edit(RSID, () => {}), offset: 0, bytes: "58 53 49 44" },
  { rule: "version", fires: edit({}, (b) => b.writeUInt16BE(5, 0x04)), passes: edit({ version: 4 }, () => {}), offset: 4, bytes: "00 05" },
  { rule: "version", fires: edit({}, (b) => b.writeUInt16BE(0, 0x04)), passes: edit({ version: 1 }, () => {}), offset: 4, bytes: "00 00" },
  { rule: "header-truncated", fires: () => makeSid().subarray(0, 0x7b), passes: () => makeSid({ version: 1 }).subarray(0, 0x78), offset: 0, bytes: "" },
  { rule: "data-offset", fires: edit({}, (b) => b.writeUInt16BE(0x76, 0x06)), passes: edit({ version: 1 }, () => {}), offset: 6, bytes: "00 76" },
  { rule: "data-offset", fires: edit({ version: 1 }, (b) => b.writeUInt16BE(0x7c, 0x06)), passes: edit({ version: 3 }, () => {}), offset: 6, bytes: "00 7c" },
  { rule: "rsid-version", fires: edit({ magic: "RSID", version: 1 }, () => {}), passes: edit({ magic: "PSID", version: 1 }, () => {}), offset: 4, bytes: "00 01" },
  {
    rule: "rsid-load-address",
    fires: () => makeSid({ magic: "RSID", data: new Array<number>(32).fill(0x60) }).fill(0x10, 0x08, 0x09),
    passes: () => makeSid({ magic: "PSID", data: new Array<number>(32).fill(0x60) }).fill(0x10, 0x08, 0x09),
    offset: 8,
    bytes: "10 00",
  },
  { rule: "rsid-play-address", fires: edit(RSID, (b) => b.writeUInt16BE(0x1003, 0x0c)), passes: edit({}, (b) => b.writeUInt16BE(0x1003, 0x0c)), offset: 0x0c, bytes: "10 03" },
  { rule: "rsid-speed", fires: edit(RSID, (b) => b.writeUInt32BE(1, 0x12)), passes: edit({}, (b) => b.writeUInt32BE(1, 0x12)), offset: 0x12, bytes: "00 00 00 01" },
  {
    rule: "rsid-actual-load-address",
    fires: () => makeSid({ magic: "RSID", data: [0xe7, 0x07, ...new Array<number>(32).fill(0x60)] }).fill(0, 0x0a, 0x0c),
    passes: () => makeSid({ magic: "RSID", data: [0xe8, 0x07, ...new Array<number>(32).fill(0x60)] }).fill(0, 0x0a, 0x0c),
    offset: 0x7c,
    bytes: "e7 07",
  },
  {
    rule: "rsid-init-address-rom",
    fires: () => makeSid({ magic: "RSID", data: [0x00, 0xc0, ...new Array<number>(0x1100).fill(0x60)] }).fill(0xd0, 0x0a, 0x0b).fill(0, 0x0b, 0x0c),
    passes: () => makeSid({ magic: "RSID", data: [0x00, 0xc0, ...new Array<number>(0x1100).fill(0x60)] }).fill(0xcf, 0x0a, 0x0b).fill(0, 0x0b, 0x0c),
    offset: 0x0a,
    bytes: "d0 00",
  },
  {
    rule: "rsid-init-outside-image",
    fires: edit(RSID, (b) => b.writeUInt16BE(0x1020, 0x0a)),
    passes: edit(RSID, (b) => b.writeUInt16BE(0x101f, 0x0a)),
    offset: 0x0a,
    bytes: "10 20",
  },
  {
    rule: "rsid-basic-init-address",
    fires: edit(RSID, (b) => b.writeUInt16BE(0x0016, 0x76)),
    passes: edit(RSID, (b) => {
      b.writeUInt16BE(0x0016, 0x76);
      b.writeUInt16BE(0, 0x0a);
    }),
    offset: 0x0a,
    bytes: "10 00",
  },
  { rule: "songs-range", fires: edit({}, (b) => b.writeUInt16BE(257, 0x0e)), passes: edit({}, (b) => b.writeUInt16BE(256, 0x0e)), offset: 0x0e, bytes: "01 01" },
  { rule: "songs-range", fires: edit({}, (b) => b.writeUInt16BE(0, 0x0e)), passes: edit({}, () => {}), offset: 0x0e, bytes: "00 00" },
  {
    rule: "start-song-above-songs",
    fires: edit({}, (b) => {
      b.writeUInt16BE(3, 0x10);
      b.writeUInt16BE(2, 0x0e);
    }),
    passes: edit({}, (b) => {
      b.writeUInt16BE(2, 0x10);
      b.writeUInt16BE(2, 0x0e);
    }),
    offset: 0x10,
    bytes: "00 03",
  },
  { rule: "start-song-zero", fires: edit({}, (b) => b.writeUInt16BE(0, 0x10)), passes: edit({}, () => {}), offset: 0x10, bytes: "00 00" },
  {
    rule: "speed-surplus-bits",
    fires: edit({}, (b) => {
      b.writeUInt16BE(3, 0x0e);
      b.writeUInt32BE(0x08, 0x12);
    }),
    passes: edit({}, (b) => {
      b.writeUInt16BE(3, 0x0e);
      b.writeUInt32BE(0x07, 0x12);
    }),
    offset: 0x12,
    bytes: "00 00 00 08",
  },
  {
    rule: "speed-surplus-bits",
    fires: edit({}, (b) => {
      b.writeUInt16BE(31, 0x0e);
      b.writeUInt32BE(0x80000000, 0x12);
    }),
    passes: edit({}, (b) => {
      b.writeUInt16BE(32, 0x0e);
      b.writeUInt32BE(0xffffffff, 0x12);
    }),
    offset: 0x12,
    bytes: "80 00 00 00",
  },
  { rule: "flags-reserved-bits", fires: edit({}, (b) => b.writeUInt16BE(0x0414, 0x76)), passes: edit({ version: 4 }, (b) => b.writeUInt16BE(0x03ff, 0x76)), offset: 0x76, bytes: "04 14" },
  { rule: "flags-model-bits-beyond-version", fires: edit({}, (b) => b.writeUInt16BE(0x0054, 0x76)), passes: edit({ version: 3 }, (b) => b.writeUInt16BE(0x0054, 0x76)), offset: 0x76, bytes: "00 54" },
  { rule: "flags-model-bits-beyond-version", fires: edit({ version: 3 }, (b) => b.writeUInt16BE(0x0114, 0x76)), passes: edit({ version: 4 }, (b) => b.writeUInt16BE(0x0114, 0x76)), offset: 0x76, bytes: "01 14" },
  { rule: "reloc-page-length", fires: edit({}, (b) => (b[0x79] = 1)), passes: edit({}, (b) => (b[0x78] = 0xff)), offset: 0x78, bytes: "00 01" },
  { rule: "reloc-page-length", fires: edit({}, (b) => ((b[0x78] = 0xff), (b[0x79] = 2))), passes: edit({}, () => {}), offset: 0x78, bytes: "ff 02" },
  { rule: "reloc-zero-pages", fires: edit({}, (b) => (b[0x78] = 0x20)), passes: edit({}, (b) => ((b[0x78] = 0x20), (b[0x79] = 1))), offset: 0x78, bytes: "20 00" },
  { rule: "reloc-wraps", fires: edit({}, (b) => ((b[0x78] = 0xc0), (b[0x79] = 0x41))), passes: edit({}, (b) => ((b[0x78] = 0xc0), (b[0x79] = 0x40))), offset: 0x78, bytes: "c0 41" },
  { rule: "reloc-overlaps-load", fires: edit({}, (b) => ((b[0x78] = 0x0f), (b[0x79] = 2))), passes: edit({}, (b) => ((b[0x78] = 0x0e), (b[0x79] = 2))), offset: 0x78, bytes: "0f 02" },
  { rule: "rsid-reloc-system-area", fires: edit(RSID, (b) => ((b[0x78] = 0x9f), (b[0x79] = 2))), passes: edit(RSID, (b) => ((b[0x78] = 0x9e), (b[0x79] = 2))), offset: 0x78, bytes: "9f 02" },
  { rule: "psid-reloc-system-area", fires: edit({}, (b) => ((b[0x78] = 0x03), (b[0x79] = 1))), passes: edit({}, (b) => ((b[0x78] = 0x04), (b[0x79] = 1))), offset: 0x78, bytes: "03 01" },
  { rule: "sid2-address-reserved", fires: edit({}, (b) => (b[0x7a] = 0x42)), passes: edit({ version: 3 }, (b) => (b[0x7a] = 0x42)), offset: 0x7a, bytes: "42" },
  { rule: "sid3-address-reserved", fires: edit({ version: 3 }, (b) => (b[0x7b] = 0x44)), passes: edit({ version: 4 }, (b) => ((b[0x7a] = 0x42), (b[0x7b] = 0x44))), offset: 0x7b, bytes: "44" },
  { rule: "sid2-address-odd", fires: edit({ version: 3 }, (b) => (b[0x7a] = 0x43)), passes: edit({ version: 3 }, (b) => (b[0x7a] = 0xfe)), offset: 0x7a, bytes: "43" },
  { rule: "sid2-address-range", fires: edit({ version: 3 }, (b) => (b[0x7a] = 0x40)), passes: edit({ version: 3 }, (b) => (b[0x7a] = 0x7e)), offset: 0x7a, bytes: "40" },
  { rule: "sid2-address-range", fires: edit({ version: 3 }, (b) => (b[0x7a] = 0xde)), passes: edit({ version: 3 }, (b) => (b[0x7a] = 0xe0)), offset: 0x7a, bytes: "de" },
  { rule: "sid3-address-odd", fires: edit({ version: 4 }, (b) => ((b[0x7a] = 0x42), (b[0x7b] = 0x45))), passes: edit({ version: 4 }, (b) => ((b[0x7a] = 0x42), (b[0x7b] = 0x46))), offset: 0x7b, bytes: "45" },
  { rule: "sid3-address-range", fires: edit({ version: 4 }, (b) => ((b[0x7a] = 0x42), (b[0x7b] = 0x80))), passes: edit({ version: 4 }, (b) => ((b[0x7a] = 0x42), (b[0x7b] = 0xe0))), offset: 0x7b, bytes: "80" },
  { rule: "sid3-equals-sid2", fires: edit({ version: 4 }, (b) => ((b[0x7a] = 0x42), (b[0x7b] = 0x42))), passes: edit({ version: 4 }, (b) => ((b[0x7a] = 0x42), (b[0x7b] = 0x44))), offset: 0x7a, bytes: "42 42" },
  { rule: "sid3-without-sid2", fires: edit({ version: 4 }, (b) => (b[0x7b] = 0x44)), passes: edit({ version: 4 }, (b) => ((b[0x7a] = 0x42), (b[0x7b] = 0x44))), offset: 0x7a, bytes: "00 44" },
  { rule: "string-undefined-cp1252", fires: edit({}, (b) => (b[0x37] = 0x81)), passes: edit({}, (b) => (b[0x37] = 0x80)), offset: 0x37, bytes: "81" },
  { rule: "no-c64-data", fires: () => makeSid({ data: [0x00, 0x10] }), passes: () => makeSid({ data: [0x00, 0x10, 0x60] }), offset: 0x7c, bytes: "" },
  {
    rule: "data-beyond-ffff",
    fires: () => makeSid({ data: [0x00, 0xff, ...new Array<number>(0x101).fill(0x60)] }),
    passes: () => makeSid({ data: [0x00, 0xff, ...new Array<number>(0x100).fill(0x60)] }),
    offset: 0x7c,
    bytes: "00 ff",
  },
];

describe("SID header conformance", () => {
  it("finds nothing in conforming PSID v1-v4 and RSID v2-v4 headers", () => {
    for (const version of [1, 2, 3, 4]) {
      expect(rulesOf(makeSid({ version }))).toEqual([]);
    }
    for (const version of [2, 3, 4]) {
      expect(rulesOf(makeSid({ magic: "RSID", version }))).toEqual([]);
    }
    const tripleSid = makeSid({ version: 4 });
    tripleSid[0x7a] = 0x42;
    tripleSid[0x7b] = 0xfe;
    expect(rulesOf(tripleSid)).toEqual([]);
  });

  it("has a firing and a non-firing case for every rule", () => {
    const covered = new Set<string>(CASES.map((testCase) => testCase.rule));
    expect([...covered].sort()).toEqual(Object.keys(SID_HEADER_RULES).sort());
  });

  for (const testCase of CASES) {
    it(`${testCase.rule}: fires at offset 0x${testCase.offset.toString(16)} on ${testCase.bytes || "no bytes"}, not on the near miss`, () => {
      const fired = checkSidHeader(testCase.fires()).findings.filter((finding) => finding.rule === testCase.rule);
      expect(fired).toHaveLength(1);
      expect(fired[0]!.offset).toBe(testCase.offset);
      expect(fired[0]!.bytes).toBe(testCase.bytes);
      expect(fired[0]!.severity).toBe(SID_HEADER_RULES[testCase.rule].severity);
      expect(rulesOf(testCase.passes())).not.toContain(testCase.rule);
    });
  }

  it("quotes every clause from the spec with line numbers", () => {
    for (const rule of Object.values(SID_HEADER_RULES)) {
      expect(rule.clause.length).toBeGreaterThan(10);
      expect(rule.specLines).toMatch(/^\d+(-\d+)?(, \d+(-\d+)?)*$/);
    }
  });

  it("stops after a fatal magic or version error", () => {
    const badMagic = makeSid();
    badMagic.write("XSID", 0, "ascii");
    badMagic.writeUInt16BE(0, 0x0e);
    expect(rulesOf(badMagic)).toEqual(["magic"]);
    expect(checkSidHeader(badMagic).fields).toBeUndefined();
    expect(rulesOf(Buffer.from("PSI"))).toEqual(["header-truncated"]);
  });

  it("evaluates an RSID initAddress of 0 as the load address", () => {
    const romLoad = makeSid({ magic: "RSID", data: [0x00, 0xa0, 0x60] });
    romLoad.writeUInt16BE(0, 0x0a);
    expect(rulesOf(romLoad)).toEqual(["rsid-init-address-rom"]);
  });

  it("accepts exactly the spec's extra SID addresses", () => {
    const valid = Array.from({ length: 256 }, (_, value) => value).filter(isValidExtraSidAddress);
    expect(valid).toHaveLength(31 + 16);
    expect(valid[0]).toBe(0x42);
    expect(valid.at(-1)).toBe(0xfe);
    expect(valid.every((value) => value % 2 === 0)).toBe(true);
    expect(valid.some((value) => value >= 0x80 && value <= 0xdf)).toBe(false);
  });
});

describe("libsidplayfp cross-check", () => {
  const conforming = checkSidHeader(makeSid({ version: 3 }));

  it("decodes declared SID chips the way the spec does", () => {
    const header = makeSid({ version: 4 });
    header[0x7a] = 0x43;
    header[0x7b] = 0x44;
    expect(declaredSidChipBases(checkSidHeader(header).fields!)).toEqual([0xd400, 0xd440]);
    header[0x7a] = 0x44;
    expect(declaredSidChipBases(checkSidHeader(header).fields!)).toEqual([0xd400, 0xd440]);
  });

  it("reports a rejection of a file without violations as a disagreement", () => {
    const result = crossCheckLibsidplayfp(conforming, { loaded: false, error: "SIDTUNE ERROR: Bad reloc data" });
    expect(result.outcome).toBe("rejected");
    expect(result.disagreements).toHaveLength(1);
  });

  it("treats a rejection of a violating file as corroboration", () => {
    const report = checkSidHeader(makeSid({ magic: "RSID", version: 1 }));
    const result = crossCheckLibsidplayfp(report, { loaded: false, error: "Unsupported RSID version" });
    expect(result).toEqual({ outcome: "rejected", details: ["Unsupported RSID version"], disagreements: [] });
  });

  it("records normalised values and SID chip disagreements", () => {
    const header = makeSid({ version: 3 });
    header.writeUInt16BE(0, 0x0e);
    const result = crossCheckLibsidplayfp(checkSidHeader(header), {
      loaded: true,
      songs: 1,
      startSong: 1,
      playAddress: 0x1003,
      relocStartPage: 0,
      relocPages: 0,
      sidChipBases: [0xd400, 0xd420],
    });
    expect(result.outcome).toBe("normalised");
    expect(result.details).toEqual(["songs 0 -> 1"]);
    expect(result.disagreements).toEqual(["SID chips: spec decoding $D400, libsidplayfp $D400 $D420"]);
  });

  it("reports an RSID violation that libsidplayfp loads anyway", () => {
    const header = makeSid({ magic: "RSID" });
    header.writeUInt16BE(0x1003, 0x0c);
    const result = crossCheckLibsidplayfp(checkSidHeader(header), { loaded: true, songs: 1, startSong: 1, sidChipBases: [0xd400] });
    expect(result.disagreements).toEqual(["libsidplayfp loads an RSID file with rsid-play-address"]);
  });

  it("agrees with the real libsidplayfp loader on synthetic headers", async () => {
    const { version, load } = await createLibsidplayfpLoader();
    expect(version).toMatch(/^\d+\.\d+/);
    const tripleSid = makeSid({ version: 4 });
    tripleSid[0x7a] = 0x42;
    tripleSid[0x7b] = 0x44;
    const accepted = crossCheckLibsidplayfp(checkSidHeader(tripleSid), load(tripleSid));
    expect(accepted).toEqual({ outcome: "accepted", details: [], disagreements: [] });

    const rsidSpeed = makeSid({ magic: "RSID" });
    rsidSpeed.writeUInt32BE(1, 0x12);
    const rejected = crossCheckLibsidplayfp(checkSidHeader(rsidSpeed), load(rsidSpeed));
    expect(rejected.outcome).toBe("rejected");
    expect(rejected.disagreements).toEqual([]);

    const wrapped = makeSid();
    wrapped[0x78] = 0xc0;
    wrapped[0x79] = 0x41;
    const disagreement = crossCheckLibsidplayfp(checkSidHeader(wrapped), load(wrapped));
    expect(disagreement.outcome).toBe("rejected");
    expect(disagreement.disagreements).toHaveLength(1);
  });
});

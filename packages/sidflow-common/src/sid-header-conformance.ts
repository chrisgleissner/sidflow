/**
 * SID header conformance checks against the HVSC "SID FILE FORMAT DESCRIPTION"
 * (C64Music/DOCUMENTS/SID_file_format.txt). Every rule quotes the sentence it
 * enforces, and every finding carries the offset and raw bytes it was decided on,
 * so a reader can confirm it with a hex dump instead of trusting this code.
 *
 * Severity follows the wording of the spec:
 * - "violation": a "must", "MUST" or a "Valid values" list excludes the value.
 * - "recommendation": the spec says "should".
 * - "undefined": the spec does not say what the value means; never counted as
 *   non-conformance.
 * Where a "Valid values" list and the prose for the same field disagree in
 * strength, the weaker wording is used and the rule says so in `note`.
 */

export type SidHeaderSeverity = "violation" | "recommendation" | "undefined";

export interface SidHeaderRule {
  severity: SidHeaderSeverity;
  /** Header field the rule reads. */
  field: string;
  /** The spec text the rule enforces, quoted verbatim. */
  clause: string;
  /** Line numbers of the clause in SID_file_format.txt (HVSC #85, MD5 277f7e25d40de7bef36c08eb9f0507c2). */
  specLines: string;
  note?: string;
}

/** MD5 of the SID_file_format.txt the clauses below were quoted from. */
export const SID_SPEC_MD5 = "277f7e25d40de7bef36c08eb9f0507c2";

export const SID_HEADER_RULES = {
  "magic": {
    severity: "violation",
    field: "magicID",
    clause: "Valid values:\n- PSID (0x50534944)\n- RSID (0x52534944)",
    specLines: "57-61",
  },
  "version": {
    severity: "violation",
    field: "version",
    clause: "Valid values:\n- 0x0001\n- 0x0002 (PSID V2NG, RSID)\n- 0x0003 (PSID V2NG, RSID)\n- 0x0004 (PSID V2NG, RSID)",
    specLines: "102-108",
  },
  "header-truncated": {
    severity: "violation",
    field: "header",
    clause: "Because of the fixed size of the header, this is either 0x0076 for version 1\nand 0x007C for version 2, 3 and 4.",
    specLines: "120-122",
  },
  "data-offset": {
    severity: "violation",
    field: "dataOffset",
    clause: "Valid values:\n- 0x0076 (Version 1)\n- 0x007C (Version 2+)",
    specLines: "114-118",
  },
  "rsid-version": {
    severity: "violation",
    field: "version",
    clause:
      "version = 2, 3 and 4 only\n[...]\nThe above fields MUST be checked and if any differ from the above then the\ntune MUST be rejected.",
    specLines: "89, 95-96",
  },
  "rsid-load-address": {
    severity: "violation",
    field: "loadAddress",
    clause:
      "loadAddress = 0 (reserved)\n[...]\nThe above fields MUST be checked and if any differ from the above then the\ntune MUST be rejected.",
    specLines: "90, 95-96",
  },
  "rsid-play-address": {
    severity: "violation",
    field: "playAddress",
    clause:
      "playAddress = 0 (reserved)\n[...]\nThe above fields MUST be checked and if any differ from the above then the\ntune MUST be rejected.",
    specLines: "91, 95-96",
  },
  "rsid-speed": {
    severity: "violation",
    field: "speed",
    clause:
      "speed = 0 (reserved)\n[...]\nThe above fields MUST be checked and if any differ from the above then the\ntune MUST be rejected.",
    specLines: "92, 95-96",
  },
  "rsid-actual-load-address": {
    severity: "violation",
    field: "data[0..1] (C64 load address)",
    clause: "Furthermore, the actual load address must NOT be less than\n$07E8 in RSID files.",
    specLines: "133-134",
  },
  "rsid-init-address-rom": {
    severity: "violation",
    field: "initAddress",
    clause:
      "In RSID files initAddress must never point to a ROM area ($A000-$BFFF or\n$D000-$FFFF) or be lower than $07E8.",
    specLines: "171-172",
    note: "An initAddress of 0 is evaluated as the effective load address (line 169: \"0 means the address is equal to the effective load address\").",
  },
  "rsid-init-outside-image": {
    severity: "violation",
    field: "initAddress",
    clause:
      "A side effect of the bank register is that init MUST NOT be located under a\nROM/IO memory area (addresses $A000-$BFFF and $D000-$FFFF) or outside the\nload image.",
    specLines: "500-502",
  },
  "rsid-basic-init-address": {
    severity: "violation",
    field: "initAddress",
    clause: "Also, if the C64 BASIC flag is set,\ninitAddress must be 0.",
    specLines: "172-173",
  },
  "songs-range": {
    severity: "violation",
    field: "songs",
    clause: "Valid values:\n- 0x0001 - 0x0100",
    specLines: "186-189",
  },
  "start-song-above-songs": {
    severity: "violation",
    field: "startSong",
    clause: "Valid values:\n- 1 - songs",
    specLines: "194-197",
  },
  "start-song-zero": {
    severity: "undefined",
    field: "startSong",
    clause: "The song number to be played by default. This value is optional. [...] It has a default of 1.",
    specLines: "199-201",
    note: "The Valid values list starts at 1, but the prose calls the field optional with a default of 1, which reads as 0 meaning \"not given\". Ambiguous, so not counted.",
  },
  "speed-surplus-bits": {
    severity: "recommendation",
    field: "speed",
    clause: "Surplus bits in 'speed' should be set to 0.",
    specLines: "231",
    note: "A bit is surplus when the tune has fewer than 32 songs and the bit number is >= songs.",
  },
  "flags-reserved-bits": {
    severity: "recommendation",
    field: "flags",
    clause: "- Bits 10-15 are reserved and should be set to 0.",
    specLines: "372",
    note: "The Valid values list for flags is 0x0000 - 0x03FF (lines 268-269), which would make this a violation; the prose for the same bits says \"should\", so the weaker wording is used.",
  },
  "flags-model-bits-beyond-version": {
    severity: "undefined",
    field: "flags",
    clause: "Bits 6-7 [...] This is a v3 specific field. [...] Bits 8-9 [...] This is a v4 specific field.",
    specLines: "339-345, 350-356",
    note: "The spec does not say these bits must be 0 in an earlier version, nor what a reader of that version does with them.",
  },
  "reloc-page-length": {
    severity: "violation",
    field: "startPage/pageLength",
    clause: "If 'startPage' is 0 or 0xFF, 'pageLength' must\nbe set to 0.",
    specLines: "399-400",
  },
  "reloc-zero-pages": {
    severity: "undefined",
    field: "startPage/pageLength",
    clause: "If 'startPage' is not 0 or 0xFF, 'pageLength' is set to the number of free\npages starting at 'startPage'.",
    specLines: "398-399",
    note: "The spec does not say what a pageLength of 0 means when startPage is neither 0 nor 0xFF.",
  },
  "reloc-wraps": {
    severity: "undefined",
    field: "startPage/pageLength",
    clause: "This is an 8 bit number indicating the number of free pages after 'startPage'.",
    specLines: "397",
    note: "The spec does not say what a range that runs past page 0xFF means.",
  },
  "reloc-overlaps-load": {
    severity: "recommendation",
    field: "startPage/pageLength",
    clause: "The relocation range indicated by 'startPage' and 'pageLength' should never\noverlap or encompass the load range of the C64 data.",
    specLines: "402-403",
  },
  "rsid-reloc-system-area": {
    severity: "recommendation",
    field: "startPage/pageLength",
    clause:
      "For RSID files, the\nrelocation range should also not overlap or encompass any of the ROM areas\n($A000-$BFFF and $D000-$FFFF) or the reserved memory area ($0000-$03FF).",
    specLines: "403-405",
  },
  "psid-reloc-system-area": {
    severity: "undefined",
    field: "startPage/pageLength",
    clause:
      "For RSID files, the\nrelocation range should also not overlap or encompass any of the ROM areas\n($A000-$BFFF and $D000-$FFFF) or the reserved memory area ($0000-$03FF).",
    specLines: "403-405",
    note: "The sentence is limited to RSID; the spec says nothing about these areas for PSID.",
  },
  "sid2-address-reserved": {
    severity: "recommendation",
    field: "secondSIDAddress",
    clause: "This is a v3 specific field. For v2NG, it should be set to 0.",
    specLines: "413",
    note: "The Valid values list gives only 0x00 for PSID V2NG (line 410); the prose says \"should\", so the weaker wording is used.",
  },
  "sid3-address-reserved": {
    severity: "recommendation",
    field: "thirdSIDAddress",
    clause: "This is a v4 specific field. For v2NG and v3, it should be set to 0.",
    specLines: "427",
    note: "The Valid values list gives only 0x00 for PSID V2NG and version 3 (line 424); the prose says \"should\", so the weaker wording is used.",
  },
  "sid2-address-odd": {
    severity: "violation",
    field: "secondSIDAddress",
    clause: "Only even values are valid. [...] Any invalid value means that no second SID\nis used, like 0x00.",
    specLines: "417-419",
  },
  "sid2-address-range": {
    severity: "violation",
    field: "secondSIDAddress",
    clause: "Ranges 0x00-0x41 ($D000-$D410) and\n0x80-0xDF ($D800-$DDF0) are invalid. Any invalid value means that no second SID\nis used, like 0x00.",
    specLines: "417-419",
    note: "0x00 itself is treated as valid: the same paragraph uses it as the value that means no second SID.",
  },
  "sid3-address-odd": {
    severity: "violation",
    field: "thirdSIDAddress",
    clause: "Only even values are valid. [...] Any invalid value means that no third SID\nis used, like 0x00.",
    specLines: "431-433",
  },
  "sid3-address-range": {
    severity: "violation",
    field: "thirdSIDAddress",
    clause: "Ranges 0x00-0x41 ($D000-$D410) and\n0x80-0xDF ($D800-$DDF0) are invalid. Any invalid value means that no third SID\nis used, like 0x00.",
    specLines: "431-433",
    note: "0x00 itself is treated as valid: the same paragraph uses it as the value that means no third SID.",
  },
  "sid3-equals-sid2": {
    severity: "violation",
    field: "thirdSIDAddress",
    clause: "The address of the third SID cannot be the same as the second SID.",
    specLines: "434",
  },
  "sid3-without-sid2": {
    severity: "undefined",
    field: "secondSIDAddress/thirdSIDAddress",
    clause: "This is an 8 bit number indicating the address of the third SID.",
    specLines: "429",
    note: "The spec does not say whether a third SID may be declared when no valid second SID is.",
  },
  "string-undefined-cp1252": {
    severity: "undefined",
    field: "name/author/released",
    clause: "These are 32 byte long Extended ASCII encoded (Windows-1252 code page) character\nstrings.",
    specLines: "247-248",
    note: "Bytes 0x81, 0x8D, 0x8F, 0x90 and 0x9D have no character in Windows-1252; the spec does not say how to treat them.",
  },
  "no-c64-data": {
    severity: "undefined",
    field: "data",
    clause: "This offset is the start of the\nbinary C64 data.",
    specLines: "438-439",
    note: "The spec does not state a minimum data length.",
  },
  "data-beyond-ffff": {
    severity: "undefined",
    field: "data",
    clause: "The C64 memory location where to put the C64 data.",
    specLines: "130",
    note: "The spec does not say what happens when load address plus data length passes $FFFF.",
  },
} as const satisfies Record<string, SidHeaderRule>;

export type SidHeaderRuleId = keyof typeof SID_HEADER_RULES;

export interface SidHeaderFinding {
  rule: SidHeaderRuleId;
  severity: SidHeaderSeverity;
  /** Byte offset into the file of the bytes the decision was made on. */
  offset: number;
  /** Raw bytes at `offset`, hex, space separated. */
  bytes: string;
  message: string;
}

export interface SidHeaderFields {
  magic: string;
  version: number;
  dataOffset: number;
  loadAddress: number;
  initAddress: number;
  playAddress: number;
  songs: number;
  startSong: number;
  speed: number;
  flags?: number;
  startPage?: number;
  pageLength?: number;
  secondSidAddress?: number;
  thirdSidAddress?: number;
  /** loadAddress, or the little-endian word at the start of the data when loadAddress is 0. */
  effectiveLoadAddress?: number;
  /** Bytes that reach C64 memory, excluding an embedded load address. */
  c64DataLength?: number;
}

export interface SidHeaderReport {
  /** Undefined when the file is too short or the magic is not PSID/RSID. */
  fields?: SidHeaderFields;
  findings: SidHeaderFinding[];
}

const V1_HEADER_SIZE = 0x76;
const V2_HEADER_SIZE = 0x7c;
const RSID_MIN_LOAD = 0x07e8;
const CP1252_UNDEFINED = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);

const FLAG_BASIC = 1 << 1;

function hexBytes(buffer: Uint8Array, offset: number, length: number): string {
  const out: string[] = [];
  for (let i = offset; i < offset + length && i < buffer.length; i++) {
    out.push(buffer[i]!.toString(16).padStart(2, "0"));
  }
  return out.join(" ");
}

function word(buffer: Uint8Array, offset: number): number {
  return (buffer[offset]! << 8) | buffer[offset + 1]!;
}

function longword(buffer: Uint8Array, offset: number): number {
  return ((buffer[offset]! << 24) | (buffer[offset + 1]! << 16) | (buffer[offset + 2]! << 8) | buffer[offset + 3]!) >>> 0;
}

function hex(value: number, digits: number): string {
  return `$${value.toString(16).toUpperCase().padStart(digits, "0")}`;
}

/** True for a $7A/$7B value that names a SID by the spec's "Valid values" list. */
export function isValidExtraSidAddress(value: number): boolean {
  if (value & 1) {
    return false;
  }
  return (value >= 0x42 && value <= 0x7f) || (value >= 0xe0 && value <= 0xfe);
}

function inRsidRomArea(address: number): boolean {
  return (address >= 0xa000 && address <= 0xbfff) || address >= 0xd000;
}

function pagesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Check one SID file against SID_file_format.txt. Pure; reads only `buffer`.
 */
export function checkSidHeader(buffer: Uint8Array): SidHeaderReport {
  const findings: SidHeaderFinding[] = [];
  const add = (rule: SidHeaderRuleId, offset: number, length: number, message: string): void => {
    findings.push({ rule, severity: SID_HEADER_RULES[rule].severity, offset, bytes: hexBytes(buffer, offset, length), message });
  };

  if (buffer.length < 6) {
    add("header-truncated", 0, buffer.length, `file is ${buffer.length} bytes, too short to hold magicID and version`);
    return { findings };
  }

  const magic = String.fromCharCode(buffer[0]!, buffer[1]!, buffer[2]!, buffer[3]!);
  if (magic !== "PSID" && magic !== "RSID") {
    add("magic", 0, 4, "magicID is neither PSID nor RSID");
    return { findings };
  }
  const rsid = magic === "RSID";

  const version = word(buffer, 0x04);
  if (version < 1 || version > 4) {
    add("version", 0x04, 2, `version ${version} is not 1-4`);
    return { findings };
  }
  if (rsid && version === 1) {
    add("rsid-version", 0x04, 2, "RSID file with version 1");
  }

  const headerSize = version === 1 ? V1_HEADER_SIZE : V2_HEADER_SIZE;
  if (buffer.length < headerSize) {
    add("header-truncated", 0, 0, `file is ${buffer.length} bytes, version ${version} header is ${headerSize}`);
    return { findings };
  }

  const fields: SidHeaderFields = {
    magic,
    version,
    dataOffset: word(buffer, 0x06),
    loadAddress: word(buffer, 0x08),
    initAddress: word(buffer, 0x0a),
    playAddress: word(buffer, 0x0c),
    songs: word(buffer, 0x0e),
    startSong: word(buffer, 0x10),
    speed: longword(buffer, 0x12),
  };

  if (fields.dataOffset !== headerSize) {
    add("data-offset", 0x06, 2, `dataOffset ${hex(fields.dataOffset, 4)} for version ${version}, expected ${hex(headerSize, 4)}`);
  }

  // The data is read where the file says it is, as a loader would.
  const dataStart = fields.dataOffset;
  if (dataStart <= buffer.length) {
    const embeddedLoad = fields.loadAddress === 0;
    if (embeddedLoad && buffer.length - dataStart < 2) {
      add("no-c64-data", dataStart, buffer.length - dataStart, "loadAddress is 0 but the data is shorter than the 2-byte load address");
    } else {
      fields.effectiveLoadAddress = embeddedLoad ? buffer[dataStart]! | (buffer[dataStart + 1]! << 8) : fields.loadAddress;
      fields.c64DataLength = buffer.length - dataStart - (embeddedLoad ? 2 : 0);
      if (fields.c64DataLength === 0) {
        add("no-c64-data", dataStart, 0, "no C64 data follows the header");
      } else if (fields.effectiveLoadAddress + fields.c64DataLength > 0x10000) {
        add(
          "data-beyond-ffff",
          embeddedLoad ? dataStart : 0x08,
          2,
          `load ${hex(fields.effectiveLoadAddress, 4)} + ${fields.c64DataLength} bytes ends at ${hex(fields.effectiveLoadAddress + fields.c64DataLength - 1, 5)}`
        );
      }
    }
  } else {
    add("no-c64-data", 0x06, 2, `dataOffset ${hex(dataStart, 4)} is past the end of the ${buffer.length}-byte file`);
  }

  if (fields.songs < 1 || fields.songs > 256) {
    add("songs-range", 0x0e, 2, `songs is ${fields.songs}`);
  }
  if (fields.startSong === 0) {
    add("start-song-zero", 0x10, 2, "startSong is 0");
  } else if (fields.startSong > fields.songs) {
    add("start-song-above-songs", 0x10, 2, `startSong ${fields.startSong} > songs ${fields.songs}`);
  }

  if (rsid) {
    if (fields.loadAddress !== 0) {
      add("rsid-load-address", 0x08, 2, `RSID loadAddress is ${hex(fields.loadAddress, 4)}`);
    }
    if (fields.playAddress !== 0) {
      add("rsid-play-address", 0x0c, 2, `RSID playAddress is ${hex(fields.playAddress, 4)}`);
    }
    if (fields.speed !== 0) {
      add("rsid-speed", 0x12, 4, `RSID speed is ${hex(fields.speed, 8)}`);
    }
  } else if (fields.songs >= 1 && fields.songs < 32 && fields.speed >>> fields.songs !== 0) {
    add("speed-surplus-bits", 0x12, 4, `speed ${hex(fields.speed, 8)} has bits set at or above bit ${fields.songs} for ${fields.songs} song(s)`);
  }

  if (version >= 2) {
    const flags = word(buffer, 0x76);
    fields.flags = flags;
    fields.startPage = buffer[0x78]!;
    fields.pageLength = buffer[0x79]!;
    fields.secondSidAddress = buffer[0x7a]!;
    fields.thirdSidAddress = buffer[0x7b]!;

    if (flags & 0xfc00) {
      add("flags-reserved-bits", 0x76, 2, `flags ${hex(flags, 4)} sets reserved bits ${hex(flags & 0xfc00, 4)}`);
    }
    const beyondMask = version === 2 ? 0x03c0 : version === 3 ? 0x0300 : 0;
    if (flags & beyondMask) {
      add("flags-model-bits-beyond-version", 0x76, 2, `flags ${hex(flags, 4)} sets SID model bits ${hex(flags & beyondMask, 4)} not defined for version ${version}`);
    }

    checkReloc(fields, rsid, add);

    const sid2 = fields.secondSidAddress;
    const sid3 = fields.thirdSidAddress;
    if (version === 2 && sid2 !== 0) {
      add("sid2-address-reserved", 0x7a, 1, `version 2 header has secondSIDAddress ${hex(sid2, 2)}`);
    }
    if (version <= 3 && sid3 !== 0) {
      add("sid3-address-reserved", 0x7b, 1, `version ${version} header has thirdSIDAddress ${hex(sid3, 2)}`);
    }
    if (version >= 3 && sid2 !== 0 && !isValidExtraSidAddress(sid2)) {
      add(sid2 & 1 ? "sid2-address-odd" : "sid2-address-range", 0x7a, 1, `secondSIDAddress ${hex(sid2, 2)} is not a valid SID address`);
    }
    if (version >= 4) {
      if (sid3 !== 0 && !isValidExtraSidAddress(sid3)) {
        add(sid3 & 1 ? "sid3-address-odd" : "sid3-address-range", 0x7b, 1, `thirdSIDAddress ${hex(sid3, 2)} is not a valid SID address`);
      }
      if (sid3 !== 0 && sid3 === sid2) {
        add("sid3-equals-sid2", 0x7a, 2, `thirdSIDAddress equals secondSIDAddress ${hex(sid2, 2)}`);
      }
      if (isValidExtraSidAddress(sid3) && !isValidExtraSidAddress(sid2)) {
        add("sid3-without-sid2", 0x7a, 2, `valid thirdSIDAddress ${hex(sid3, 2)} with no valid secondSIDAddress (${hex(sid2, 2)})`);
      }
    }
  }

  if (rsid) {
    checkRsidInit(fields, add);
  }

  for (const [offset, name] of [[0x16, "name"], [0x36, "author"], [0x56, "released"]] as const) {
    for (let i = 0; i < 32; i++) {
      const byte = buffer[offset + i]!;
      if (byte === 0) {
        break;
      }
      if (CP1252_UNDEFINED.has(byte)) {
        add("string-undefined-cp1252", offset + i, 1, `${name} contains byte ${hex(byte, 2)}, which Windows-1252 does not define`);
      }
    }
  }

  return { fields, findings };
}

type AddFinding = (rule: SidHeaderRuleId, offset: number, length: number, message: string) => void;

function checkReloc(fields: SidHeaderFields, rsid: boolean, add: AddFinding): void {
  const start = fields.startPage!;
  const length = fields.pageLength!;
  if (start === 0 || start === 0xff) {
    if (length !== 0) {
      add("reloc-page-length", 0x78, 2, `startPage ${hex(start, 2)} with pageLength ${length}`);
    }
    return;
  }
  if (length === 0) {
    add("reloc-zero-pages", 0x78, 2, `startPage ${hex(start, 2)} with pageLength 0`);
    return;
  }
  const end = start + length - 1;
  if (end > 0xff) {
    add("reloc-wraps", 0x78, 2, `pages ${hex(start, 2)}-${hex(end, 3)} run past page $FF`);
    return;
  }
  if (fields.effectiveLoadAddress !== undefined && fields.c64DataLength !== undefined && fields.c64DataLength > 0) {
    const loadStart = fields.effectiveLoadAddress >> 8;
    const loadEnd = Math.min(0xff, (fields.effectiveLoadAddress + fields.c64DataLength - 1) >> 8);
    if (pagesOverlap(start, end, loadStart, loadEnd)) {
      add("reloc-overlaps-load", 0x78, 2, `pages ${hex(start, 2)}-${hex(end, 2)} overlap load pages ${hex(loadStart, 2)}-${hex(loadEnd, 2)}`);
    }
  }
  if (pagesOverlap(start, end, 0x00, 0x03) || pagesOverlap(start, end, 0xa0, 0xbf) || pagesOverlap(start, end, 0xd0, 0xff)) {
    add(rsid ? "rsid-reloc-system-area" : "psid-reloc-system-area", 0x78, 2, `pages ${hex(start, 2)}-${hex(end, 2)} overlap $0000-$03FF, $A000-$BFFF or $D000-$FFFF`);
  }
}

function checkRsidInit(fields: SidHeaderFields, add: AddFinding): void {
  const basic = ((fields.flags ?? 0) & FLAG_BASIC) !== 0;
  const load = fields.effectiveLoadAddress;
  if (load !== undefined && load < RSID_MIN_LOAD) {
    add("rsid-actual-load-address", fields.loadAddress === 0 ? fields.dataOffset : 0x08, 2, `actual load address ${hex(load, 4)} is below $07E8`);
  }
  if (basic) {
    if (fields.initAddress !== 0) {
      add("rsid-basic-init-address", 0x0a, 2, `C64 BASIC flag set with initAddress ${hex(fields.initAddress, 4)}`);
    }
    return;
  }
  if (load === undefined) {
    return;
  }
  const init = fields.initAddress === 0 ? load : fields.initAddress;
  if (inRsidRomArea(init) || init < RSID_MIN_LOAD) {
    add("rsid-init-address-rom", 0x0a, 2, `effective initAddress ${hex(init, 4)} is in ROM or below $07E8`);
  }
  const length = fields.c64DataLength ?? 0;
  if (length > 0 && (init < load || init > load + length - 1)) {
    add("rsid-init-outside-image", 0x0a, 2, `effective initAddress ${hex(init, 4)} is outside the load image ${hex(load, 4)}-${hex(load + length - 1, 5)}`);
  }
}

/** The parts of a libsidplayfp load that the cross-check compares. */
export interface LibsidplayfpLoadResult {
  loaded: boolean;
  error?: string;
  songs?: number;
  startSong?: number;
  playAddress?: number;
  relocStartPage?: number;
  relocPages?: number;
  sidChipBases?: number[];
}

export interface LibsidplayfpCrossCheck {
  outcome: "rejected" | "normalised" | "accepted";
  /** What libsidplayfp changed or why it refused. */
  details: string[];
  /** Points where libsidplayfp and this checker reach different conclusions. */
  disagreements: string[];
}

/** SID chip bases the header declares, decoded strictly by the spec's valid-address rules. */
export function declaredSidChipBases(fields: SidHeaderFields): number[] {
  const bases = [0xd400];
  const sid2 = fields.secondSidAddress ?? 0;
  const sid3 = fields.thirdSidAddress ?? 0;
  if (fields.version >= 3 && isValidExtraSidAddress(sid2)) {
    bases.push(0xd000 | (sid2 << 4));
  }
  if (fields.version >= 4 && isValidExtraSidAddress(sid3) && sid3 !== sid2) {
    bases.push(0xd000 | (sid3 << 4));
  }
  return bases;
}

/**
 * Compare a header report with what libsidplayfp's loader made of the same file.
 * A rejection or normalisation by libsidplayfp corroborates a finding; a
 * conclusion the two do not share is returned as a disagreement, not resolved.
 */
export function crossCheckLibsidplayfp(report: SidHeaderReport, result: LibsidplayfpLoadResult): LibsidplayfpCrossCheck {
  const details: string[] = [];
  const disagreements: string[] = [];
  const violations = report.findings.filter((finding) => finding.severity === "violation");

  if (!result.loaded) {
    details.push(result.error ?? "load failed");
    if (violations.length === 0) {
      disagreements.push(`libsidplayfp rejects a file with no violation: ${result.error ?? "load failed"}`);
    }
    return { outcome: "rejected", details, disagreements };
  }

  const fields = report.fields;
  if (fields) {
    if (result.songs !== undefined && result.songs !== fields.songs) {
      details.push(`songs ${fields.songs} -> ${result.songs}`);
    }
    if (result.startSong !== undefined && result.startSong !== fields.startSong) {
      details.push(`startSong ${fields.startSong} -> ${result.startSong}`);
    }
    if (result.playAddress !== undefined && fields.playAddress === 0xffff && result.playAddress !== fields.playAddress) {
      details.push(`playAddress $FFFF -> ${hex(result.playAddress, 4)}`);
    }
    if (fields.version >= 2) {
      if (result.relocStartPage !== undefined && result.relocStartPage !== fields.startPage) {
        details.push(`startPage ${hex(fields.startPage ?? 0, 2)} -> ${hex(result.relocStartPage, 2)}`);
      }
      if (result.relocPages !== undefined && result.relocPages !== fields.pageLength) {
        details.push(`pageLength ${fields.pageLength ?? 0} -> ${result.relocPages}`);
      }
    }
    if (result.sidChipBases !== undefined) {
      const expected = declaredSidChipBases(fields);
      if (expected.join(",") !== result.sidChipBases.join(",")) {
        disagreements.push(
          `SID chips: spec decoding ${expected.map((b) => hex(b, 4)).join(" ")}, libsidplayfp ${result.sidChipBases.map((b) => hex(b, 4)).join(" ")}`
        );
      }
    }
  }

  // libsidplayfp implements these RSID rules itself, so loading such a file is a disagreement.
  const rsidRules = [...new Set(violations.filter((finding) => finding.rule.startsWith("rsid-")).map((finding) => finding.rule))];
  if (rsidRules.length > 0) {
    disagreements.push(`libsidplayfp loads an RSID file with ${rsidRules.join(", ")}`);
  }

  return { outcome: details.length > 0 ? "normalised" : "accepted", details, disagreements };
}

/**
 * Load SID files through libsidplayfp's own loader (the WASM build), for use as an
 * independent oracle. The module is imported lazily so header checks alone do not
 * pay for it.
 */
export interface LibsidplayfpLoader {
  /** libsidplayfp release inside the WASM build. */
  version: string;
  load: (buffer: Uint8Array) => LibsidplayfpLoadResult;
}

export async function createLibsidplayfpLoader(): Promise<LibsidplayfpLoader> {
  const { default: loadLibsidplayfp, LIBSIDPLAYFP_VERSION } = await import("libsidplayfp-wasm");
  const module = await loadLibsidplayfp({ engine: "sidlite" });
  const context = new module.SidPlayerContext();
  const load = (buffer: Uint8Array): LibsidplayfpLoadResult => {
    context.clearError();
    const info = context.loadSidBuffer(buffer) ? context.getTuneInfo() : null;
    if (!info) {
      return { loaded: false, error: context.getLastError() || "load failed" };
    }
    return {
      loaded: true,
      songs: info.songs,
      startSong: info.startSong,
      playAddress: info.playAddress,
      relocStartPage: info.relocStartPage,
      relocPages: info.relocPages,
      sidChipBases: [...info.sidChipBases],
    };
  };
  return { version: LIBSIDPLAYFP_VERSION, load };
}

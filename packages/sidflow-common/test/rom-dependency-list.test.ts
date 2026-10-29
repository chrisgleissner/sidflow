/**
 * Tests for the SID ROM Dependency List (sidromdep-1, doc/rom-dependency-list.md): codec, lookup,
 * generator and verifier. Uses a small synthetic but realistic ROM audit bundle written to a temp
 * directory. The "real partial bundle" test depends on a local workspace/rom-audit-dual-4 run and is
 * skipped explicitly (test.skipIf) when that evidence directory is absent; it is not a feature gap.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ROM_DEP_FLAG_INCOMPLETE_SOURCE,
  ROM_DEP_HEADER_BYTES,
  ROM_DEP_LANE_BITS,
  RomDependencyListError,
  crc32,
  decodeRomDependencyList,
  derivePlaybackHorizonMs,
  encodeRomDependencyList,
  parseSonglengthsMd5,
  sha256Hex,
  type RomDepContent,
  type RomDepEntry,
} from "../src/rom-dependency-list.js";
import { romSetId } from "../src/rom-eligibility.js";
import { stringifyDeterministic, type JsonValue } from "../src/json.js";
import { deriveEntries, loadSourceBundle, verifyHorizonRule } from "../../../scripts/rom-dependency-list/bundle.js";
import { generateRomDependencyList, outputNames } from "../../../scripts/rom-dependency-list/generate.js";
import { roundTripAgainstBundle, verifyRomDependencyListFiles } from "../../../scripts/rom-dependency-list/verify.js";

const md5Of = (text: string): string => createHash("md5").update(text).digest("hex");
const PROVENANCE = { sourceManifestSha256: "11".repeat(32), songlengthsSha256: "22".repeat(32), corpusId: "33".repeat(32) };
const content = (entries: RomDepEntry[], incompleteSource = false): RomDepContent => ({ hvscRelease: 85, sourceFiles: 61157, sourceSubtunes: 87868, incompleteSource, provenance: PROVENANCE, entries });

/** Re-sign a tampered buffer so structural validation (not the checksums) is what rejects it. */
function resign(bytes: Uint8Array): Uint8Array {
  const out = Uint8Array.from(bytes);
  const view = new DataView(out.buffer);
  out.set(Buffer.from(sha256Hex(out.subarray(ROM_DEP_HEADER_BYTES)), "hex"), 64);
  view.setUint32(52, 0, true);
  view.setUint32(52, crc32(out.subarray(0, ROM_DEP_HEADER_BYTES)), true);
  return out;
}

describe("codec", () => {
  const entries: RomDepEntry[] = [
    { md5: "ff" + "00".repeat(15), decisions: [{ subtune: 256, incompatible: 0, unknown: 15 }] },
    { md5: "00" + "ab".repeat(15), decisions: [{ subtune: 3, incompatible: 5, unknown: 0 }, { subtune: 1, incompatible: 1, unknown: 2 }] },
    { md5: "7f" + "01".repeat(15), decisions: [{ subtune: 1, incompatible: 15, unknown: 0 }] },
  ];

  test("round trips every disjoint (incompatible, unknown) combination and sorts canonically", () => {
    const all: RomDepEntry[] = [];
    let n = 0;
    for (let inc = 0; inc < 16; inc++) {
      for (let unk = 0; unk < 16; unk++) {
        if ((inc & unk) || (inc | unk) === 0) continue;
        all.push({ md5: md5Of(`combo-${n}`), decisions: [{ subtune: (n % 256) + 1, incompatible: inc, unknown: unk }] });
        n++;
      }
    }
    expect(n).toBe(80); // 3^4 - 1 non-empty disjoint pairs
    const list = decodeRomDependencyList(encodeRomDependencyList(content(all)));
    for (const entry of all) {
      const d = entry.decisions[0]!;
      const got = list.lookup(entry.md5, d.subtune);
      expect(got.listed).toBe(true);
      expect(got.incompatibleMask).toBe(d.incompatible);
      expect(got.unknownMask).toBe(d.unknown);
      expect(list.lookup(entry.md5, d.subtune === 256 ? 255 : d.subtune + 1).listed).toBe(false);
    }
    const decoded = list.entries();
    expect(decoded.map((e) => e.md5)).toEqual([...all.map((e) => e.md5)].sort());
  });

  test("lookup states, unlisted default and subtune boundaries", () => {
    const list = decodeRomDependencyList(encodeRomDependencyList(content(entries)));
    expect(list.header.fileCount).toBe(3);
    expect(list.header.decisionCount).toBe(4);
    expect(list.entries()[0]!.decisions.map((d) => d.subtune)).toEqual([1, 3]);
    const hit = list.lookup("00" + "ab".repeat(15), 1);
    expect(hit.lanes).toEqual({ sidliteNone: "incompatible", sidliteKernalBasic: "unknown", residfpNone: "allowed", residfpKernalBasic: "allowed" });
    expect(list.lookup("ff" + "00".repeat(15), 256).lanes.residfpKernalBasic).toBe("unknown");
    expect(list.lookup("ff" + "00".repeat(15), 256).incompatibleMask).toBe(0); // unknown is never incompatible
    const miss = list.lookup("00" + "ab".repeat(15), 2);
    expect(miss).toEqual({ listed: false, incompatibleMask: 0, unknownMask: 0, lanes: { sidliteNone: "allowed", sidliteKernalBasic: "allowed", residfpNone: "allowed", residfpKernalBasic: "allowed" } });
    expect(list.lookup("12".repeat(16), 1).listed).toBe(false);
    expect(list.lookup("7f" + "01".repeat(14) + "02", 1).listed).toBe(false); // full MD5, no prefix matching
    expect(list.lookup(Uint8Array.from(Buffer.from("7f" + "01".repeat(15), "hex")), 1).incompatibleMask).toBe(15);
    expect(list.lookup("7f" + "01".repeat(15), 0).listed).toBe(false);
    expect(list.lookup("7f" + "01".repeat(15), 257).listed).toBe(false);
    expect(() => list.lookup("xyz", 1)).toThrow(RomDependencyListError);
  });

  test("encoding is size-exact: 192 + 17 per file + 2 per decision", () => {
    expect(encodeRomDependencyList(content(entries)).length).toBe(192 + 17 * 3 + 2 * 4);
    expect(encodeRomDependencyList(content([])).length).toBe(192);
    expect(decodeRomDependencyList(encodeRomDependencyList(content([]))).lookup("00".repeat(16), 1).listed).toBe(false);
  });

  test("encoder rejects non-canonical input", () => {
    const base = { md5: md5Of("a"), decisions: [{ subtune: 1, incompatible: 1, unknown: 0 }] };
    expect(() => encodeRomDependencyList(content([base, base]))).toThrow(/duplicate MD5/);
    expect(() => encodeRomDependencyList(content([{ md5: base.md5.toUpperCase(), decisions: base.decisions }]))).toThrow();
    expect(() => encodeRomDependencyList(content([{ md5: base.md5, decisions: [{ subtune: 1, incompatible: 1, unknown: 1 }] }]))).toThrow(/both incompatible and unknown/);
    expect(() => encodeRomDependencyList(content([{ md5: base.md5, decisions: [{ subtune: 1, incompatible: 0, unknown: 0 }] }]))).toThrow(/no non-default lane/);
    expect(() => encodeRomDependencyList(content([{ md5: base.md5, decisions: [{ subtune: 257, incompatible: 1, unknown: 0 }] }]))).toThrow(/subtune out of range/);
    expect(() => encodeRomDependencyList(content([{ md5: base.md5, decisions: [{ subtune: 0, incompatible: 1, unknown: 0 }] }]))).toThrow(/subtune out of range/);
    expect(() => encodeRomDependencyList(content([{ md5: base.md5, decisions: [{ subtune: 1, incompatible: 16, unknown: 0 }] }]))).toThrow(/mask/);
    expect(() => encodeRomDependencyList(content([{ md5: base.md5, decisions: [base.decisions[0]!, base.decisions[0]!] }]))).toThrow(/duplicate subtune/);
    expect(() => encodeRomDependencyList(content([{ md5: base.md5, decisions: [] }]))).toThrow(/1..256/);
    expect(() => encodeRomDependencyList({ ...content([base]), provenance: { ...PROVENANCE, corpusId: "zz" } })).toThrow(/corpusId/);
  });

  test("a file may carry all 256 subtunes (count byte stores n-1)", () => {
    const decisions = Array.from({ length: 256 }, (_, i) => ({ subtune: i + 1, incompatible: 1 << (i % 4), unknown: 0 }));
    const list = decodeRomDependencyList(encodeRomDependencyList(content([{ md5: md5Of("big"), decisions }])));
    expect(list.header.decisionCount).toBe(256);
    expect(list.lookup(md5Of("big"), 256).incompatibleMask).toBe(8);
    expect(list.lookup(md5Of("big"), 1).incompatibleMask).toBe(1);
  });

  test("rejects truncated, extended, corrupted and structurally invalid binaries", () => {
    const good = encodeRomDependencyList(content(entries));
    expect(() => decodeRomDependencyList(good.subarray(0, 100))).toThrow(/truncated header/);
    expect(() => decodeRomDependencyList(good.subarray(0, good.length - 1))).toThrow(/truncated payload/);
    expect(() => decodeRomDependencyList(Uint8Array.from([...good, 0]))).toThrow(/trailing bytes/);
    const flip = (offset: number): Uint8Array => { const b = Uint8Array.from(good); b[offset] = b[offset]! ^ 0x01; return b; };
    expect(() => decodeRomDependencyList(flip(ROM_DEP_HEADER_BYTES + 2))).toThrow(/payload SHA-256/);
    expect(() => decodeRomDependencyList(flip(40))).toThrow(/header CRC-32/);
    expect(() => decodeRomDependencyList(flip(100))).toThrow(/header CRC-32/); // digest bytes are covered by the header CRC
    expect(() => decodeRomDependencyList(flip(0))).toThrow(/bad magic/);
    const patch = (fn: (b: Uint8Array, v: DataView) => void): Uint8Array => { const b = Uint8Array.from(good); fn(b, new DataView(b.buffer)); return resign(b); };
    expect(() => decodeRomDependencyList(patch((_, v) => v.setUint16(8, 2, true)))).toThrow(/unsupported format version/);
    expect(() => decodeRomDependencyList(patch((_, v) => v.setUint32(12, 2, true)))).toThrow(/unknown flag bits/);
    expect(() => decodeRomDependencyList(patch((_, v) => v.setUint32(60, 1, true)))).toThrow(/reserved/);
    expect(() => decodeRomDependencyList(patch((_, v) => v.setUint16(56, 18, true)))).toThrow(/record sizes/);
    expect(() => decodeRomDependencyList(patch((_, v) => v.setUint32(44, 300, true)))).toThrow(/canonical tightly packed/);
    // swap the first two file records -> not strictly ascending
    expect(() => decodeRomDependencyList(patch((b) => { const a = b.slice(192, 209); b.copyWithin(192, 209, 226); b.set(a, 209); }))).toThrow(/strictly ascending/);
    // per-file count that no longer sums to decision_count
    expect(() => decodeRomDependencyList(patch((b) => { b[192 + 16] = 5; }))).toThrow(/do not sum/);
    // overlapping masks in a record
    expect(() => decodeRomDependencyList(patch((b) => { b[192 + 17 * 3 + 1] = 0x11; }))).toThrow(/both incompatible and unknown/);
    // all-zero record
    expect(() => decodeRomDependencyList(patch((b) => { b[192 + 17 * 3 + 1] = 0x00; }))).toThrow(/no non-default lane/);
  });

  test("worked example from doc/rom-dependency-list.md section 14", () => {
    const bin = encodeRomDependencyList({
      hvscRelease: 85, sourceFiles: 61157, sourceSubtunes: 87868, incompleteSource: false,
      provenance: { sourceManifestSha256: "a1".repeat(32), songlengthsSha256: "b2".repeat(32), corpusId: "c3".repeat(32) },
      entries: [
        { md5: "0123456789abcdef0123456789abcdef", decisions: [{ subtune: 1, incompatible: 0b0101, unknown: 0 }, { subtune: 3, incompatible: 0, unknown: 0b1000 }] },
        { md5: "fedcba9876543210fedcba9876543210", decisions: [{ subtune: 256, incompatible: 0b0011, unknown: 0 }] },
      ],
    });
    expect(bin.length).toBe(192 + 34 + 6);
    const hex = Buffer.from(bin).toString("hex");
    expect(hex.slice(2 * 192)).toBe(
      "0123456789abcdef0123456789abcdef01" + "fedcba9876543210fedcba9876543210" + "00" + "00" + "05" + "02" + "80" + "ff" + "03");
    expect(Buffer.from(bin.subarray(0, 64)).toString("hex")).toBe(
      "53494452" + "4f4d4450" + "0100" + "c000" + "00000000" + "55000000" + "e5ee0000" + "3c570100" + "02000000" + "03000000" +
      "c0000000" + "22000000" + "e2000000" + "06000000" + "ff03a359" + "1100" + "0200" + "00000000");
    expect(Buffer.from(bin.subarray(64, 96)).toString("hex")).toBe("97e0a756d56f926ca91d658cc0a7700c5f04362c4e584ef49c0186ec083b582d");
  });
});

// ---------------------------------------------------------------------------------------------
// Synthetic ROM audit bundle
// ---------------------------------------------------------------------------------------------

interface FixtureFile {
  name: string;
  tokens: string[]; // Songlengths tokens; fewer tokens than subtunes = "no entry" subtunes
  subtunes: number;
  incompatible?: Record<number, number>;
  unknown?: number[];
}

const FILES: FixtureFile[] = [
  { name: "MUSICIANS/A/Alpha.sid", tokens: ["3:21"], subtunes: 1 },
  { name: "MUSICIANS/B/Beta.sid", tokens: ["0:04", "1:00.385", "10:00", "2:30"], subtunes: 4, incompatible: { 1: 1, 2: 5, 4: 15 } },
  { name: "GAMES/C/Gamma.sid", tokens: ["1:10", "bogus"], subtunes: 3, incompatible: { 2: 2 } },
  { name: "GAMES/D/Delta.sid", tokens: ["0:30"], subtunes: 1, incompatible: { 1: 8 } },
  { name: "DEMOS/E/Epsilon.sid", tokens: ["5:00", "5:00", "5:00"], subtunes: 3 },
  { name: "DEMOS/F/Zeta.sid", tokens: ["0:00"], subtunes: 1, incompatible: { 1: 4 } },
];

function fixtureSongs(files: FixtureFile[]): string {
  return ["[Database]", "; comment", ...files.flatMap((f) => [`; /${f.name}`, `${md5Of(f.name)}=${f.tokens.join(" ")}`])].join("\n") + "\n";
}

interface BundleOptions {
  files?: FixtureFile[];
  complete?: boolean;
  horizon?: (md5: string, ms: number[]) => number[];
  extraManifest?: Record<string, unknown>;
  exceptionsExtra?: Record<string, Record<string, number>>;
}

async function writeBundle(dir: string, options: BundleOptions = {}): Promise<{ songlengths: string }> {
  const files = options.files ?? FILES;
  const complete = options.complete ?? true;
  await mkdir(dir, { recursive: true });
  const songlengths = fixtureSongs(files);
  const identities: Record<string, string> = {};
  const horizons: Record<string, unknown> = {};
  const entries: Record<string, Record<string, number>> = { ...(options.exceptionsExtra ?? {}) };
  const unknown: Record<string, number[]> = {};
  let subtunes = 0, exceptionSubtunes = 0, unknownSubtunes = 0;
  for (const f of files) {
    const md5 = md5Of(f.name);
    identities[sha256Hex(f.name)] = md5;
    const ms = Array.from({ length: f.subtunes }, (_, i) => derivePlaybackHorizonMs(f.tokens[i]));
    horizons[md5] = { fallbackSidModel: "MOS8580", milliseconds: options.horizon ? options.horizon(md5, ms) : ms, modelFixed: false };
    subtunes += f.subtunes;
    if (f.incompatible) {
      entries[md5] = Object.fromEntries(Object.entries(f.incompatible).map(([k, v]) => [k, v]));
      exceptionSubtunes += Object.keys(f.incompatible).length;
    }
    if (f.unknown) { unknown[md5] = f.unknown; unknownSubtunes += f.unknown.length; }
  }
  const json = (v: unknown): string => stringifyDeterministic(v as JsonValue, 0);
  const artifacts: Record<string, string> = {};
  const put = async (name: string, text: string): Promise<void> => { await writeFile(path.join(dir, name), text); artifacts[name] = sha256Hex(text); };
  await put("sha256-to-md5.json", json(identities));
  await put("playback-horizons.json", json(horizons));
  await put("commander-exceptions.json", json({ schema: "sidflow-commander-rom-exceptions-1", complete, bits: { sidliteNone: 1, sidliteKernalBasic: 2, residfpNone: 4, residfpKernalBasic: 8 }, entries }));
  await put("unknown.json", json(unknown));
  const manifest = {
    schema: "sidflow-dual-rom-manifest-1", methodology: "rom-audit-digital-screen-2", complete, releaseReady: complete,
    corpus: "4b".repeat(32), files: files.length, subtunes, measuredSubtunes: subtunes - unknownSubtunes, pendingSubtunes: unknownSubtunes, failedSubtunes: 0,
    unknownSubtunes, exceptionSubtunes, counts: {}, artifacts,
    engineIds: { sidlite: "aa".repeat(32), residfp: "bb".repeat(32) },
    engines: { sidlite: { engineId: "aa".repeat(32), sourceSha256: "cc".repeat(32), wasmSha256: "dd".repeat(32) }, residfp: { engineId: "bb".repeat(32), sourceSha256: "cc".repeat(32), wasmSha256: "ee".repeat(32) } },
    nativeHashes: { sidlite: "01".repeat(32), residfp: "02".repeat(32) },
    romSetId: romSetId(), sourceIdentity: "5a".repeat(32),
    documents: { "Songlengths.md5": sha256Hex(songlengths) },
    scope: "Pinned engines; 48kHz stereo; default delay 8191; 256-event pulls; zero absent BASIC/CHARGEN; KERNAL shim when absent; header SID model/MOS8580 fallback; documented horizon plus 5s. Masks 0 and 3 against authentic three-ROM reference. Not hardware-fidelity proof or indefinite-loop authorization.",
    ...options.extraManifest,
  };
  await writeFile(path.join(dir, "manifest.json"), json(manifest) + "\n");
  return { songlengths };
}

let root = "";
let seq = 0;
const fresh = (): string => path.join(root, `case-${seq++}`);
const stubVerify = (dir: string): string => sha256Hex(readFileSync(path.join(dir, "manifest.json")));

beforeAll(async () => { root = await mkdtemp(path.join(os.tmpdir(), "romdep-")); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("horizon rule and Songlengths parsing", () => {
  test("rule: duration + 5 s, minimum 10 s, 300 s when no valid entry", () => {
    expect(derivePlaybackHorizonMs("3:21")).toBe(206_000);
    expect(derivePlaybackHorizonMs("1:00.385")).toBe(65_385);
    expect(derivePlaybackHorizonMs("0:04")).toBe(10_000);
    expect(derivePlaybackHorizonMs("0:05")).toBe(10_000);
    expect(derivePlaybackHorizonMs("0:06")).toBe(11_000);
    expect(derivePlaybackHorizonMs("0:00")).toBe(300_000);
    expect(derivePlaybackHorizonMs(undefined)).toBe(300_000);
    expect(derivePlaybackHorizonMs("1:75")).toBe(300_000);
    expect(derivePlaybackHorizonMs("3:21(G)")).toBe(300_000);
    expect(derivePlaybackHorizonMs("1:00.1")).toBe(65_100);
  });
  test("parser keeps path and tokens and rejects duplicates", () => {
    const parsed = parseSonglengthsMd5(fixtureSongs(FILES));
    expect(parsed.size).toBe(FILES.length);
    expect(parsed.get(md5Of("MUSICIANS/B/Beta.sid"))).toEqual({ path: "MUSICIANS/B/Beta.sid", tokens: ["0:04", "1:00.385", "10:00", "2:30"] });
    expect(() => parseSonglengthsMd5(fixtureSongs(FILES) + `; /dup.sid\n${md5Of("GAMES/C/Gamma.sid")}=1:00\n`)).toThrow(/duplicate/);
  });
});

describe("generator and verifier on a synthetic bundle", () => {
  test("release generation, determinism, verification and round trip", async () => {
    const bundle = fresh();
    const { songlengths } = await writeBundle(bundle);
    const songlengthsPath = path.join(bundle, "Songlengths.md5");
    await writeFile(songlengthsPath, songlengths);
    const runA = await generateRomDependencyList({ bundleDir: bundle, outDir: path.join(root, "outA"), songlengthsPath, verifyBundle: stubVerify });
    const runB = await generateRomDependencyList({ bundleDir: bundle, outDir: path.join(root, "outB"), songlengthsPath, verifyBundle: stubVerify });
    const names = outputNames(85);
    expect(names.bin).toBe("hvsc85-sidromdep-1.bin");
    expect(names.manifest).toBe("hvsc85-sidromdep-1.manifest.json");
    for (const file of [names.bin, names.manifest, names.json]) {
      expect(Buffer.compare(await readFile(path.join(root, "outA", file)), await readFile(path.join(root, "outB", file)))).toBe(0);
    }
    expect(runA.binSha256).toBe(runB.binSha256);
    expect(runA.manifestSha256).toBe(runB.manifestSha256);
    expect(runA.complete).toBe(true);
    // 5 incompatible subtunes in 4 files: Beta 1,2,4 ; Gamma 2 ; Delta 1 ; Zeta 1  => 4 files? count precisely below
    expect(runA.listedFiles).toBe(4);
    expect(runA.listedSubtunes).toBe(6);
    expect(runA.bytes).toBe(192 + 17 * 4 + 2 * 6);

    const manifest = JSON.parse(await readFile(runA.manifestPath, "utf8"));
    expect(manifest.complete).toBe(true);
    expect(manifest.releasable).toBe(true);
    expect(manifest.measuredProfile.observationHorizon.reproducedFromSonglengths).toBe(true);
    expect(manifest.measuredProfile.romSetId).toBe(romSetId());
    expect(manifest.provenance.songlengthsSha256).toBe(sha256Hex(songlengths));
    expect(manifest.binary.sha256).toBe(runA.binSha256);

    const list = decodeRomDependencyList(new Uint8Array(await readFile(runA.binPath)));
    expect(list.header.incompleteSource).toBe(false);
    const beta = md5Of("MUSICIANS/B/Beta.sid");
    expect(list.lookup(beta, 2).incompatibleMask).toBe(5);
    expect(list.lookup(beta, 3).listed).toBe(false);
    expect(list.lookup(md5Of("MUSICIANS/A/Alpha.sid"), 1).listed).toBe(false);

    const human = JSON.parse(await readFile(runA.jsonPath, "utf8"));
    expect(human.records).toHaveLength(6);
    expect(human.records.map((r: { hvscPath: string }) => r.hvscPath)).toContain("MUSICIANS/B/Beta.sid");
    expect(human.records.find((r: { md5: string; subtune: number }) => r.md5 === beta && r.subtune === 4).lanes.residfpKernalBasic).toBe("incompatible");

    const report = await verifyRomDependencyListFiles({ binPath: runA.binPath, bundleDir: bundle, songlengthsPath, verifyBundle: stubVerify });
    expect(report.binSha256).toBe(runA.binSha256);
    expect(report.manifestSha256).toBe(runA.manifestSha256);
    expect(report.checkedSubtunes).toBe(13);
    expect(report.listedSubtunes).toBe(6);
    expect(report.unlistedCompatible).toBe(7);
    expect(roundTripAgainstBundle(list, await loadSourceBundle(bundle, { allowIncomplete: false, verifyBundle: stubVerify })).unlistedCompatible).toBe(7);
  });

  test("round trip detects a dropped record, an extra record and a changed mask", async () => {
    const bundle = fresh();
    await writeBundle(bundle);
    const source = await loadSourceBundle(bundle, { allowIncomplete: false, verifyBundle: stubVerify });
    const entries = deriveEntries(source);
    const build = (e: RomDepEntry[]) => decodeRomDependencyList(encodeRomDependencyList(content(e)));
    expect(() => roundTripAgainstBundle(build(entries), source)).not.toThrow();
    expect(() => roundTripAgainstBundle(build(entries.slice(1)), source)).toThrow(/differs from the source bundle/);
    const extra = [...entries, { md5: md5Of("MUSICIANS/A/Alpha.sid"), decisions: [{ subtune: 1, incompatible: 1, unknown: 0 }] }];
    expect(() => roundTripAgainstBundle(build(extra), source)).toThrow(/measured compatible in all lanes but is listed/);
    const changed = entries.map((e, i) => (i === 0 ? { ...e, decisions: [{ ...e.decisions[0]!, incompatible: e.decisions[0]!.incompatible ^ 8 }, ...e.decisions.slice(1)] } : e));
    expect(() => roundTripAgainstBundle(build(changed), source)).toThrow(/differs from the source bundle/);
    const foreign = [...entries, { md5: md5Of("not in bundle"), decisions: [{ subtune: 1, incompatible: 1, unknown: 0 }] }];
    expect(() => roundTripAgainstBundle(build(foreign), source)).toThrow(/not in the source bundle/);
    const tooFar = [...entries, { md5: md5Of("DEMOS/E/Epsilon.sid"), decisions: [{ subtune: 4, incompatible: 1, unknown: 0 }] }];
    expect(() => roundTripAgainstBundle(build(tooFar), source)).toThrow(/exceeds the source subtune count/);
  });

  test("verifier rejects a modified binary and a mismatched bundle", async () => {
    const bundle = fresh();
    const { songlengths } = await writeBundle(bundle);
    const songlengthsPath = path.join(bundle, "Songlengths.md5");
    await writeFile(songlengthsPath, songlengths);
    const out = path.join(root, "out-tamper");
    const run = await generateRomDependencyList({ bundleDir: bundle, outDir: out, songlengthsPath, verifyBundle: stubVerify });
    const bytes = new Uint8Array(await readFile(run.binPath));
    await writeFile(run.binPath, resign(Uint8Array.from(bytes, (b, i) => (i === bytes.length - 1 ? b ^ 0x01 : b))));
    await expect(verifyRomDependencyListFiles({ binPath: run.binPath, bundleDir: bundle, verifyBundle: stubVerify })).rejects.toThrow(/manifest does not describe this binary/);
    await writeFile(run.binPath, bytes.subarray(0, bytes.length - 3));
    await expect(verifyRomDependencyListFiles({ binPath: run.binPath, bundleDir: bundle, verifyBundle: stubVerify })).rejects.toThrow(/truncated payload/);
    await writeFile(run.binPath, bytes);
    const other = fresh();
    await writeBundle(other, { files: FILES.slice(0, 5) });
    await expect(verifyRomDependencyListFiles({ binPath: run.binPath, bundleDir: other, verifyBundle: stubVerify })).rejects.toThrow(/source bundle manifest digest differs/);
  });

  test("a release output requires the Songlengths file and reproducible horizons", async () => {
    const bundle = fresh();
    const { songlengths } = await writeBundle(bundle);
    await expect(generateRomDependencyList({ bundleDir: bundle, outDir: fresh(), verifyBundle: stubVerify })).rejects.toThrow(/--songlengths is required/);
    const wrong = path.join(bundle, "Songlengths.md5");
    await writeFile(wrong, songlengths + "\n; changed\n");
    await expect(generateRomDependencyList({ bundleDir: bundle, outDir: fresh(), songlengthsPath: wrong, verifyBundle: stubVerify })).rejects.toThrow(/does not match the digest/);

    // A published horizon that the documented rule cannot reproduce (non-derivable) is refused.
    const bad = fresh();
    const { songlengths: text } = await writeBundle(bad, { horizon: (md5, ms) => (md5 === md5Of("GAMES/D/Delta.sid") ? [ms[0]! + 1] : ms) });
    const badPath = path.join(bad, "Songlengths.md5");
    await writeFile(badPath, text);
    await expect(generateRomDependencyList({ bundleDir: bad, outDir: fresh(), songlengthsPath: badPath, verifyBundle: stubVerify })).rejects.toThrow(/not reproducible from Songlengths\.md5/);
  });

  test("rejects incomplete bundles and unverified bundles, and uses the real verifier by default", async () => {
    const incomplete = fresh();
    const { songlengths } = await writeBundle(incomplete, { complete: false, files: [{ ...FILES[1]!, unknown: [3] }, FILES[0]!] });
    const songlengthsPath = path.join(incomplete, "Songlengths.md5");
    await writeFile(songlengthsPath, songlengths);
    await expect(generateRomDependencyList({ bundleDir: incomplete, outDir: fresh(), songlengthsPath, verifyBundle: stubVerify })).rejects.toThrow(/not complete && releaseReady/);
    // complete && releaseReady claims but failing verification
    const claimed = fresh();
    const { songlengths: claimedText } = await writeBundle(claimed);
    const claimedPath = path.join(claimed, "Songlengths.md5");
    await writeFile(claimedPath, claimedText);
    await expect(generateRomDependencyList({ bundleDir: claimed, outDir: fresh(), songlengthsPath: claimedPath, verifyBundle: () => { throw new Error("Invalid Commander publication: stub"); } })).rejects.toThrow(/Invalid Commander publication/);
    // default verifier is scripts/rom-audit/verify-publication.ts: a 6-file fixture is not the HVSC #85 census
    await expect(generateRomDependencyList({ bundleDir: claimed, outDir: fresh(), songlengthsPath: claimedPath })).rejects.toThrow(/Invalid Commander publication/);
    // a "complete" bundle that still lists unknown subtunes is contradictory
    const contradictory = fresh();
    await writeBundle(contradictory, { files: [{ ...FILES[1]!, unknown: [3] }] });
    await expect(loadSourceBundle(contradictory, { allowIncomplete: false, verifyBundle: stubVerify })).rejects.toThrow(/cannot carry unknown/);
    // tampered artifact: checksum mismatch
    const tampered = fresh();
    await writeBundle(tampered);
    await writeFile(path.join(tampered, "unknown.json"), "{ }\n");
    await expect(loadSourceBundle(tampered, { allowIncomplete: true })).rejects.toThrow(/checksum mismatch for unknown\.json/);
    // exception bit meaning drift
    const drift = fresh();
    await writeBundle(drift, { exceptionsExtra: { [md5Of("MUSICIANS/A/Alpha.sid")]: { "9": 1 } } });
    await expect(loadSourceBundle(drift, { allowIncomplete: true })).rejects.toThrow(/invalid exception/);
  });

  test("--allow-incomplete output is flagged non-releasable in header and manifest, carries unknown, and needs the flag to verify", async () => {
    const bundle = fresh();
    const files: FixtureFile[] = [{ ...FILES[1]!, unknown: [3] }, { ...FILES[0]!, unknown: [1] }, FILES[4]!];
    await writeBundle(bundle, { complete: false, files });
    const out = path.join(root, "out-incomplete");
    const run = await generateRomDependencyList({ bundleDir: bundle, outDir: out, allowIncomplete: true });
    expect(run.complete).toBe(false);
    const manifest = JSON.parse(await readFile(run.manifestPath, "utf8"));
    expect(manifest.complete).toBe(false);
    expect(manifest.releasable).toBe(false);
    expect(manifest.status).toContain("NOT-RELEASABLE");
    expect(manifest.measuredProfile.observationHorizon.reproducedFromSonglengths).toBe(false);
    const bin = new Uint8Array(await readFile(run.binPath));
    expect(new DataView(bin.buffer).getUint32(12, true) & ROM_DEP_FLAG_INCOMPLETE_SOURCE).toBe(1);
    const list = decodeRomDependencyList(bin);
    expect(list.header.incompleteSource).toBe(true);
    const beta = md5Of("MUSICIANS/B/Beta.sid");
    // Beta#1 is incompatible in sidliteNone and #4 in all; #3 is unknown in every lane; unknown is never incompatible
    expect(list.lookup(beta, 3)).toMatchObject({ listed: true, incompatibleMask: 0, unknownMask: 15 });
    expect(list.lookup(beta, 1).incompatibleMask).toBe(1);
    expect(list.lookup(md5Of("MUSICIANS/A/Alpha.sid"), 1)).toMatchObject({ incompatibleMask: 0, unknownMask: 15 });
    await expect(verifyRomDependencyListFiles({ binPath: run.binPath, bundleDir: bundle })).rejects.toThrow(/allow-incomplete/);
    const report = await verifyRomDependencyListFiles({ binPath: run.binPath, bundleDir: bundle, allowIncomplete: true });
    expect(report.complete).toBe(false);
  });
});

describe("size model", () => {
  test("a list of ~1,600 files / ~2,700 subtunes is ~32 KiB, well inside the 30-40 KiB target", () => {
    const entries: RomDepEntry[] = [];
    for (let i = 0; i < 1600; i++) {
      const count = i < 1100 ? 2 : 1; // 1,100 x 2 + 500 x 1 = 2,700 subtunes
      entries.push({ md5: md5Of(`size-${i}`), decisions: Array.from({ length: count }, (_, s) => ({ subtune: s + 1, incompatible: 1, unknown: 0 })) });
    }
    const subtunes = entries.reduce((s, e) => s + e.decisions.length, 0);
    const bin = encodeRomDependencyList(content(entries));
    expect(subtunes).toBe(2700);
    expect(bin.length).toBe(192 + 17 * 1600 + 2 * subtunes);
    expect(bin.length).toBe(32_792);
    expect(bin.length).toBeLessThan(40 * 1024);
    expect(bin.length).toBeGreaterThan(30 * 1024);
  });
});

const REAL = "/mnt/data/dev/c64/sidflow/workspace/rom-audit-dual-4/published";
describe("dry run against the partial real bundle", () => {
  // Skipped explicitly when the local evidence directory is not present (CI, other machines).
  test.skipIf(!existsSync(path.join(REAL, "manifest.json")))("--allow-incomplete dry run and size extrapolation", async () => {
    const out = path.join(root, "out-real");
    const run = await generateRomDependencyList({ bundleDir: REAL, outDir: out, allowIncomplete: true });
    expect(run.complete).toBe(false);
    const list = decodeRomDependencyList(new Uint8Array(await readFile(run.binPath)));
    const source = await loadSourceBundle(REAL, { allowIncomplete: true });
    expect(roundTripAgainstBundle(list, source).checked).toBe(87868);
    const entries = list.entries();
    const incompatibleOnly = entries.map((e) => ({ ...e, decisions: e.decisions.filter((d) => d.incompatible !== 0) })).filter((e) => e.decisions.length);
    const incompatibleSubtunes = incompatibleOnly.reduce((s, e) => s + e.decisions.length, 0);
    expect(incompatibleSubtunes).toBe(163);
    const incompatibleBytes = 192 + 17 * incompatibleOnly.length + 2 * incompatibleSubtunes;
    console.log(`[rom-dependency-list dry run] listed ${run.listedFiles} files / ${run.listedSubtunes} subtunes -> ${run.bytes} bytes (unknown pending subtunes dominate); incompatible-only: ${incompatibleOnly.length} files / ${incompatibleSubtunes} subtunes -> ${incompatibleBytes} bytes; extrapolated complete corpus (1,600 files / 2,700 subtunes): ${192 + 17 * 1600 + 2 * 2700} bytes; for 3% of 87,868 subtunes (~2,636) over ~1,560 files: ${192 + 17 * 1560 + 2 * 2636} bytes`);
    expect(run.bytes).toBe(192 + 17 * run.listedFiles + 2 * run.listedSubtunes);
    expect(Object.keys(ROM_DEP_LANE_BITS)).toHaveLength(4);
  }, 120_000);

  const SONGLENGTHS = "/mnt/data/dev/c64/sidflow/workspace/hvsc/C64Music/DOCUMENTS/Songlengths.md5";
  test.skipIf(!existsSync(path.join(REAL, "manifest.json")) || !existsSync(SONGLENGTHS))("the horizon rule reproduces all 87,868 real published horizons from HVSC #85 Songlengths.md5", async () => {
    const source = await loadSourceBundle(REAL, { allowIncomplete: true });
    const paths = verifyHorizonRule(source, await readFile(SONGLENGTHS, "utf8"));
    expect(paths.size).toBe(61157);
  }, 120_000);
});

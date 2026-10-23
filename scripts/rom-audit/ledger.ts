/**
 * Durable, corpus-scoped accounting of every distinct HVSC subtune that the ROM
 * audit machinery has rendered or is about to render. The 5% hardening ceiling is
 * enforced against this ledger, not against completed checkpoints:
 *
 *  - a reservation is appended and fsynced BEFORE a job is dispatched, so a crash
 *    between rendering and checkpointing cannot leave an identity uncounted;
 *  - identities are unique by (path relative to the corpus root, subtune), so
 *    re-rendering a counted subtune adds nothing, regardless of output directory;
 *  - prior pilots and the real-HVSC integration subset are imported conservatively;
 *  - a torn final record is preserved and ignored (its reservation never completed
 *    its fsync, so no job was dispatched on its strength); interior damage fails.
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, truncateSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { dlopen, FFIType } from "bun:ffi";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
export const WORKSPACE = path.join(root, "workspace");

/**
 * Exclusive kernel advisory lock (flock). The kernel releases it when the holder
 * dies, including on SIGKILL, so there is no stale-lock state to recover and no
 * unlink race. The file only carries diagnostics about the current holder.
 */
const libc = dlopen("libc.so.6", { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
const LOCK_EX = 2, LOCK_NB = 4, LOCK_UN = 8;
export class ProcessLock {
  private fd: number | undefined;
  constructor(readonly file: string, readonly label: string) {}
  acquire(timeoutMs = 0): void {
    if (this.fd !== undefined) throw new Error(`${this.label} lock is already held by this object`);
    mkdirSync(path.dirname(this.file), { recursive: true });
    const fd = openSync(this.file, "a+");
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (libc.symbols.flock(fd, LOCK_EX | LOCK_NB) === 0) break;
      if (Date.now() >= deadline) {
        const holder = readFileSync(this.file, "utf8").trim() || "unknown holder";
        closeSync(fd);
        throw new Error(`${this.label} is already held (${holder})`);
      }
      Bun.sleepSync(25);
    }
    this.fd = fd;
    ftruncateSync(fd, 0);
    writeSync(fd, `pid=${process.pid} started=${new Date().toISOString()} cmd=${process.argv.slice(1).join(" ").slice(0, 200)}\n`, 0);
  }
  release(): void {
    if (this.fd === undefined) return;
    const fd = this.fd;
    this.fd = undefined;
    libc.symbols.flock(fd, LOCK_UN);
    closeSync(fd);
  }
}

export interface Identity { sha256: string; song: number; path: string }
export interface LedgerRecord extends Identity { v: 2; source: string; pid: number; at: string; crc: string }
export const ceilings = (files: number, songs: number): { maxFiles: number; maxSongs: number } =>
  ({ maxFiles: Math.floor(files * 0.05), maxSongs: Math.floor(songs * 0.05) });

const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const recordCrc = (record: Omit<LedgerRecord, "crc">): string => sha256(JSON.stringify(record)).slice(0, 16);

/** Identity is (content SHA-256, subtune); a copy of an HVSC file elsewhere counts as the same file. */
export class RolloutLedger {
  private readonly songs = new Set<string>();
  private readonly files = new Set<string>();
  private readonly lock: ProcessLock;
  private constructor(readonly file: string) {
    this.lock = new ProcessLock(file + ".lock", "rollout ledger");
    this.load(false);
  }
  static open(corpusSha256: string, directory = WORKSPACE): RolloutLedger {
    if (!/^[a-f0-9]{64}$/.test(corpusSha256)) throw new Error("Invalid corpus identity");
    mkdirSync(directory, { recursive: true });
    return new RolloutLedger(path.join(directory, `rom-audit-ledger-${corpusSha256}.jsonl`));
  }
  private static key(identity: { sha256: string; song: number }): string { return `${identity.sha256}\t${identity.song}`; }
  private static validate(identity: Identity): void {
    if (!/^[a-f0-9]{64}$/.test(identity.sha256) || typeof identity.path !== "string" || /[\t\r\n]/.test(identity.path) ||
      !Number.isSafeInteger(identity.song) || identity.song < 1 || identity.song > 256)
      throw new Error(`Invalid ledger identity ${JSON.stringify(identity)}`);
  }
  private offset = 0;
  /**
   * Read the records appended since the last call. Only the lock holder may repair a torn tail
   * (`repair`); an unlocked reader ignores it without touching the file. Reading incrementally keeps
   * a dispatch O(1) however long the ledger has grown.
   */
  private load(repair: boolean): void {
    if (!existsSync(this.file)) return;
    const size = statSync(this.file).size;
    if (size < this.offset) { this.songs.clear(); this.files.clear(); this.offset = 0; }   // truncated by a repair elsewhere
    if (size === this.offset) return;
    const fd = openSync(this.file, "r");
    let bytes: Buffer;
    try { bytes = Buffer.alloc(size - this.offset); readSync(fd, bytes, 0, bytes.length, this.offset); } finally { closeSync(fd); }
    let end = bytes.length;
    if (bytes[end - 1] !== 10) {
      // Reservations are fsynced before any job is dispatched, so a torn final record belongs to a batch
      // that never ran. Keep its bytes; never lose them.
      end = bytes.lastIndexOf(10) + 1;
      if (repair) {
        const tail = bytes.subarray(end);
        appendFileSync(`${this.file}.torn.${sha256(tail).slice(0, 16)}`, tail);
        truncateSync(this.file, this.offset + end);
        console.warn("Preserved incomplete rollout ledger tail; it was never acknowledged, so no job depended on it");
      }
    }
    for (const line of bytes.subarray(0, end).toString("utf8").split("\n").filter(Boolean)) {
      const { crc, ...record } = JSON.parse(line) as LedgerRecord;
      if (record.v !== 2) throw new Error("Unsupported rollout ledger record");
      RolloutLedger.validate(record);
      if (recordCrc(record) !== crc) throw new Error(`Rollout ledger record fails its checksum: ${line.slice(0, 80)}`);
      this.songs.add(RolloutLedger.key(record)); this.files.add(record.sha256);
    }
    this.offset += end;
  }
  get subtunes(): number { return this.songs.size; }
  get distinctFiles(): number { return this.files.size; }
  has(identity: { sha256: string; song: number }): boolean { return this.songs.has(RolloutLedger.key(identity)); }
  /**
   * Durably reserve identities, all or none. Returns false (and records nothing)
   * if they would push the ledger past `limit`. Already-counted identities are free.
   */
  reserve(identities: Identity[], source: string, limit?: { maxFiles: number; maxSongs: number }): boolean {
    this.lock.acquire(10000);
    try {
      this.load(true);
      const fresh = identities.filter((identity, index, all) => {
        RolloutLedger.validate(identity);
        return !this.has(identity) && all.findIndex(other => RolloutLedger.key(other) === RolloutLedger.key(identity)) === index;
      });
      if (!fresh.length) return true;
      const newFiles = new Set(fresh.map(i => i.sha256).filter(h => !this.files.has(h)));
      if (limit && (this.songs.size + fresh.length > limit.maxSongs || this.files.size + newFiles.size > limit.maxFiles)) return false;
      const at = new Date().toISOString();
      const text = fresh.map(i => {
        const record = { v: 2 as const, sha256: i.sha256, song: i.song, path: i.path, source, pid: process.pid, at };
        return JSON.stringify({ ...record, crc: recordCrc(record) }) + "\n";
      }).join("");
      const created = !existsSync(this.file);
      const fd = openSync(this.file, "a");
      try { appendFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
      if (created) this.syncDirectory();
      for (const i of fresh) { this.songs.add(RolloutLedger.key(i)); this.files.add(i.sha256); }
      this.offset += Buffer.byteLength(text);
      return true;
    } finally { this.lock.release(); }
  }
  private syncDirectory(): void {
    const fd = openSync(path.dirname(this.file), "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  /**
   * Import every identity already measured by an audit run of the same corpus
   * (<workspace>/<run>/execution.jsonl) and every subtune of the integration subset,
   * which renders without selecting a song. Returns the number of new identities.
   */
  importHistory(hvscRoot: string, corpusSha256: string, workspace = WORKSPACE, subsetRoot = path.join(workspace, "hvsc-e2e-subset-cache/C64Music")): number {
    const hashes = new Map<string, string>();
    const contentOf = (relative: string): string => {
      let digest = hashes.get(relative);
      if (!digest) { digest = sha256(readFileSync(path.join(hvscRoot, relative))); hashes.set(relative, digest); }
      return digest;
    };
    const found: Identity[] = [];
    for (const entry of readdirSync(workspace, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const base = path.join(workspace, entry.name), manifestPath = path.join(base, "manifest.json"), checkpoint = path.join(base, "execution.jsonl");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { corpusSha256?: string; hvscRoot?: string };
      if (manifest.corpusSha256 !== corpusSha256 || typeof manifest.hvscRoot !== "string") continue;
      // Methodology 3 census checkpoints identify rows by content hash.
      const census = path.join(base, "census.jsonl");
      if (existsSync(census)) {
        for (const line of readFileSync(census, "utf8").split("\n").filter(Boolean)) {
          const lead = /^\{.*?"sha256":"([a-f0-9]{64})".*?"song":(\d+)/.exec(line) ?? /"sha256":"([a-f0-9]{64})"/.exec(line);
          const song = /"song":(\d+)/.exec(line);
          if (!lead || !song) { console.warn(`Unrecoverable census record in ${census}`); continue; }
          found.push({ sha256: lead[1]!, path: `census:${base}`, song: Number(song[1]) });
        }
      }
      if (!existsSync(checkpoint)) continue;
      const raw = readFileSync(checkpoint, "utf8");
      for (const line of raw.split("\n").filter(Boolean)) {
        let row: { path?: unknown; song?: unknown };
        try { row = JSON.parse(line) as typeof row; } catch (error) {
          // A torn record was being written because that render finished: count the
          // identity if its leading fields survived, otherwise it is unrecoverable.
          const lead = /^\{"path":"((?:[^"\\]|\\.)*)","song":(\d+)/.exec(line);
          if (!lead) { console.warn(`Unrecoverable torn record in ${checkpoint}: ${(error as Error).message}`); continue; }
          row = { path: JSON.parse(`"${lead[1]}"`) as string, song: Number(lead[2]) };
        }
        if (typeof row.path !== "string" || !Number.isSafeInteger(row.song)) throw new Error(`Invalid historical identity in ${checkpoint}`);
        const relative = path.relative(manifest.hvscRoot, row.path);
        if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Historical path escapes corpus: ${row.path}`);
        found.push({ sha256: contentOf(relative), path: relative, song: row.song as number });
      }
    }
    if (existsSync(subsetRoot)) {
      for (const file of readdirSync(subsetRoot, { recursive: true, withFileTypes: true })) {
        if (!file.isFile() || !file.name.toLowerCase().endsWith(".sid")) continue;
        const relative = path.relative(subsetRoot, path.join(file.parentPath, file.name));
        const songs = readFileSync(path.join(hvscRoot, relative)).readUInt16BE(0x0e);
        for (let song = 1; song <= songs; song++) found.push({ sha256: contentOf(relative), path: relative, song });
      }
    }
    const before = this.songs.size;
    this.reserve(found, "import-history");
    return this.songs.size - before;
  }
}

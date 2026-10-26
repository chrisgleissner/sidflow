export interface DelayedFixtureOptions {
  /** PAL frames of the dependent subtune before the ROM is first read. */
  frames?: number;
  /** Subtunes in the file. Only `dependentSong` reads the ROM; the others stay constant. */
  songs?: number;
  /** One-based subtune that carries the delayed dependency. */
  dependentSong?: number;
}
/** Original synthetic PSID stimuli; no copyrighted payload. Access a ROM only
 * after `frames` PAL frames (default 300, ~6 seconds), then use its byte as
 * voice frequency. PSID does not declare this dependency. Banking is restored
 * before returning. With several subtunes, only `dependentSong` has the dependency.
 */
export function delayedRomFixture(mask:number,options:DelayedFixtureOptions={}):Buffer {
  const {frames=300,songs=1,dependentSong=1}=options;
  if(!Number.isInteger(mask)||mask<1||mask>7)throw new Error("Invalid dependency mask");
  if(!Number.isInteger(frames)||frames<1||frames>65535)throw new Error("Invalid delay frames");
  if(!Number.isInteger(songs)||songs<1||songs>255||!Number.isInteger(dependentSong)||dependentSong<1||dependentSong>songs)
    throw new Error("Invalid subtune selection");
  const code:number[]=[];
  const emit=(...b:number[]):void=>{code.push(...b);};
  // init: remember the selected subtune (A is zero-based), RAM banking,
  // reset frame counter, audible sawtooth + envelope/volume.
  emit(0x8d,2,0x20,0xa9,0x35,0x85,1,0xa9,0,0x8d,0,0x20,0x8d,1,0x20);
  for (const [reg,value] of [[0,0x40],[1,0x10],[4,0x21],[5,0],[6,0xf0],[24,15]])
    emit(0xa9,value!,0x8d,reg!,0xd4);
  emit(0x60);
  const play=0x1000+code.length;
  const toNormal:number[]=[];
  if(songs>1){emit(0xad,2,0x20,0xc9,dependentSong-1);toNormal.push(code.length);emit(0xd0,0);} // other subtune -> normal
  emit(0xee,0,0x20,0xd0,3,0xee,1,0x20,0xad,1,0x20,0xc9,frames>>8);
  toNormal.push(code.length);emit(0x90,0); // high byte below the trigger -> normal
  emit(0xd0,7,0xad,0,0x20,0xc9,frames&255); // high byte above -> late; equal -> compare low byte
  toNormal.push(code.length);emit(0x90,0);
  // Multiple-ROM fixture XORs loaded bytes; changes may interact, retain masks.
  emit(0xa9,0,0x48);
  for(const [bit,bank,addr] of [[1,0x37,0xe000],[2,0x37,0xa000],[4,0x33,0xd000]]) if(mask&bit!) {
    emit(0xa9,bank!,0x85,1,0x68,0x4d,addr!&255,addr!>>8,0x48);
  }
  emit(0xa9,0x35,0x85,1,0x68,0x8d,0,0xd4,0x60);
  const normal=code.length;emit(0xa9,0x40,0x8d,0,0xd4,0x60);
  for(const offset of toNormal){
    const distance=normal-(offset+2);
    if(distance>127)throw new Error("Fixture branch out of range");
    code[offset+1]=distance;
  }
  const bytes=Buffer.alloc(0x7c+code.length);
  bytes.write("PSID");bytes.writeUInt16BE(2,4);bytes.writeUInt16BE(0x7c,6);
  bytes.writeUInt16BE(0x1000,8);bytes.writeUInt16BE(0x1000,10);bytes.writeUInt16BE(play,12);
  bytes.writeUInt16BE(songs,14);bytes.writeUInt16BE(1,16);bytes.writeUInt16BE(0x14,0x76);
  bytes.write(`Delayed ROM mask ${mask} +${frames}f`,0x16);bytes.write("SIDFlow synthetic regression",0x36);bytes.write("2026",0x56);
  Buffer.from(code).copy(bytes,0x7c);return bytes;
}

/** Minimal 6502 assembler for the original synthetic stimuli: labels and relative branches only. */
class Asm {
  readonly code: number[] = [];
  private readonly labels = new Map<string, number>();
  private readonly fixups: { at: number; label: string; relative: boolean }[] = [];
  constructor(readonly origin: number) {}
  get here(): number { return this.origin + this.code.length; }
  emit(...bytes: number[]): this { this.code.push(...bytes); return this; }
  label(name: string): this { if (this.labels.has(name)) throw new Error(`Duplicate label ${name}`); this.labels.set(name, this.here); return this; }
  abs(opcode: number, address: number): this { return this.emit(opcode, address & 255, address >> 8); }
  branch(opcode: number, label: string): this { this.emit(opcode, 0); this.fixups.push({ at: this.code.length - 1, label, relative: true }); return this; }
  jump(label: string): this { this.emit(0x4c, 0, 0); this.fixups.push({ at: this.code.length - 2, label, relative: false }); return this; }
  lda(value: number): this { return this.emit(0xa9, value); }
  ldaAbs(address: number): this { return this.abs(0xad, address); }
  sta(address: number): this { return this.abs(0x8d, address); }
  staZp(address: number): this { return this.emit(0x85, address); }
  cmp(value: number): this { return this.emit(0xc9, value); }
  rts(): this { return this.emit(0x60); }
  inc(address: number): this { return this.abs(0xee, address); }
  resolve(): Buffer {
    for (const fix of this.fixups) {
      const target = this.labels.get(fix.label);
      if (target === undefined) throw new Error(`Unknown label ${fix.label}`);
      if (fix.relative) {
        const distance = target - (this.origin + fix.at + 1);
        if (distance < -128 || distance > 127) throw new Error(`Branch to ${fix.label} out of range`);
        this.code[fix.at] = distance & 255;
      } else { this.code[fix.at] = target & 255; this.code[fix.at + 1] = target >> 8; }
    }
    return Buffer.from(this.code);
  }
  address(label: string): number { return this.labels.get(label)!; }
}
const BNE = 0xd0, BEQ = 0xf0, BCC = 0x90, BCS = 0xb0;
/** KERNAL/BASIC byte that differs between the authentic image and the audit's absent bank. */
const KERNAL_PRESENT_TEST = 0xea;   // absent KERNAL: the engine's shim starts with NOP at $E000
export type SyntheticKind =
  | "combined-only"      // output changes only when BOTH KERNAL and BASIC are absent
  | "exactly-one"        // output changes when exactly one of KERNAL/BASIC is present (non-monotonic)
  | "silent-tail"         // volume 0; with BASIC absent the final per-frame write is missing
  | "silent-divergence"  // volume 0: PCM equal, SID write trace differs when BASIC is absent
  | "sparse-sfx"         // one write at frame 2500 (50 s) and nothing else
  | "silence"            // no SID write at all
  | "silent-halt"        // volume 0; halts without BASIC after the initial transient has ended
  | "halt-without-basic" // jumps through a BASIC byte; the absent (zero) bank leads to an illegal opcode
  | "busy-writes"        // more than the trace cap of SID writes within 15 s
  | "osc3-reader"        // reads $D41B, then depends on KERNAL after frame 100
  | "second-sid-late"    // ROM dependency written only to a second chip, after `frames`
  | "third-sid-late";    // ... only to a third chip
export interface SyntheticOptions { frames?: number; mask?: number }
/** Original synthetic PSID programs for the decision-path regression (decision 8). */
export function syntheticFixture(kind: SyntheticKind, options: SyntheticOptions = {}): Buffer {
  const { frames = 100, mask = 1 } = options;
  const chip = kind === "second-sid-late" ? 1 : kind === "third-sid-late" ? 2 : 0;
  const base = 0xd400 + 0x20 * chip;
  const a = new Asm(0x1000);
  const volume = kind === "silent-divergence" || kind === "silent-tail" || kind === "silent-halt" ? 0 : 15;
  // init: bank RAM+IO, clear the frame counter, audible sawtooth on voice 1 of the chosen chip.
  if (kind === "busy-writes") a.emit(0x78);   // SEI: with the KERNAL banked out an IRQ would vector through RAM
  a.lda(0x35).staZp(1).lda(0).sta(0x3000).sta(0x3001);
  if (kind !== "silence" && kind !== "sparse-sfx") {
    for (const [register, value] of [[0, 0x40], [1, 0x10], [4, 0x21], [5, 0], [6, 0xf0]] as const) a.lda(value).sta(base + register);
    a.lda(volume).sta(base + 24);
  }
  if (kind === "halt-without-basic") {
    // $A000 is 0x94 in the authentic BASIC ROM and 0x00 in the absent bank. Jump to $2094 (RTS) or $2000 (illegal opcode).
    a.lda(0x37).staZp(1).ldaAbs(0xa000).staZp(0xfb).lda(0x20).staZp(0xfc).emit(0x6c, 0xfb, 0x00).rts();
  } else if (kind === "busy-writes") a.label("busy").inc(base).inc(base + 1).inc(base).inc(base + 1).jump("busy");
  else a.emit(0x60);
  const play = a.here;
  if (kind === "silence") a.emit(0x60);
  else if (kind === "busy-writes" || kind === "halt-without-basic") a.emit(0x60);
  else {
    a.inc(0x3000).branch(BNE, "counted").inc(0x3001).label("counted").ldaAbs(0x3001).cmp(frames >> 8).branch(BCC, "early").branch(BNE, "late")
      .ldaAbs(0x3000).cmp(frames & 255).branch(BCC, "early").label("late");
    if (kind === "sparse-sfx") {
      a.ldaAbs(0x3000).cmp(frames & 255).branch(BNE, "early").lda(15).sta(base + 24).lda(0x40).sta(base + 1).lda(0x21).sta(base + 4).emit(0x60);
    } else if (kind === "osc3-reader") {
      a.ldaAbs(0xd41b).staZp(0xfd).lda(0x37).staZp(1).ldaAbs(0xe000).staZp(0xfe).lda(0x35).staZp(1).ldaAbs(0xfd).emit(0x4d, 0xfe, 0x00)
        .sta(base).emit(0x60);
    } else if (kind === "silent-halt") {
      a.lda(0x37).staZp(1).ldaAbs(0xa000).branch(BNE, "present").emit(0x02)
        .label("present").lda(0x35).staZp(1).emit(0x60);
    } else if (kind === "silent-tail") {
      a.lda(0x40).sta(base + 1).lda(0x37).staZp(1).ldaAbs(0xa000).staZp(0xfe).lda(0x35).staZp(1).ldaAbs(0xfe).branch(BEQ, "skipped").lda(1).sta(base + 14)
        .label("skipped").emit(0x60);
    } else if (kind === "silent-divergence") {
      a.lda(0x37).staZp(1).ldaAbs(0xa000).staZp(0xfe).lda(0x35).staZp(1).ldaAbs(0xfe).sta(base + 14).emit(0x60);
    } else if (kind === "second-sid-late" || kind === "third-sid-late") {
      const masks: [number, number, number][] = [[1, 0x37, 0xe000], [2, 0x37, 0xa000], [4, 0x33, 0xd000]];
      a.lda(0);
      for (const [bit, bank, address] of masks) if (mask & bit) a.emit(0x48).lda(bank).staZp(1).ldaAbs(address).staZp(0xfe).emit(0x68).emit(0x45, 0xfe);
      a.staZp(0xfd).lda(0x35).staZp(1).ldaAbs(0xfd).sta(base).emit(0x60);
    } else {
      // combined-only / exactly-one: classify each ROM as present by its first byte, branch-free
      // (compare, then rotate the carry into A) so every ROM variant takes the same number of cycles
      // and only the written value can differ.
      a.lda(0x37).staZp(1).ldaAbs(0xe000).emit(0x49, KERNAL_PRESENT_TEST).cmp(1).lda(0).emit(0x2a).staZp(0xfb)
        .ldaAbs(0xa000).cmp(1).lda(0).emit(0x2a).staZp(0xfc).lda(0x35).staZp(1);
      a.ldaAbs(0xfb).emit(kind === "combined-only" ? 0x05 : 0x45, 0xfc).emit(0x09, 0x40).sta(base).emit(0x60);
    }
    if (kind === "sparse-sfx") a.label("early").emit(0x60);
    else a.label("early").lda(0x40).sta(base).emit(0x60);
  }
  const code = a.resolve();
  // The halt fixture: $A000 is 0x94 in the authentic BASIC ROM, 0x00 or 0xFF in an unsupplied bank.
  // The jump lands on RTS at $2094, or on an illegal opcode at $2000 (zero fill) or $20FF (0xFF fill).
  const image = Buffer.alloc(kind === "halt-without-basic" ? 0x1100 : code.length);
  code.copy(image);
  if (kind === "halt-without-basic") { image[0x1000] = 0x02; image[0x10ff] = 0x02; image[0x1094] = 0x60; }
  const header = Buffer.alloc(0x7c);
  header.write(kind === "busy-writes" ? "RSID" : "PSID"); header.writeUInt16BE(3, 4); header.writeUInt16BE(0x7c, 6); header.writeUInt16BE(kind === "busy-writes" ? 0 : 0x1000, 8);
  header.writeUInt16BE(0x1000, 10); header.writeUInt16BE(kind === "busy-writes" ? 0 : play, 12); header.writeUInt16BE(1, 14); header.writeUInt16BE(1, 16);
  header.writeUInt16BE(0x14, 0x76);
  if (kind === "second-sid-late") header[0x7a] = 0x42;
  if (kind === "third-sid-late") { header[0x7a] = 0x42; header[0x7b] = 0x44; }
  if (chip === 2) header[0x7a] = 0x42;
  header.write(`Synthetic ${kind}`, 0x16); header.write("SIDFlow synthetic regression", 0x36); header.write("2026", 0x56);
  // RSID carries its load address in the first two data bytes (header field is 0).
  return Buffer.concat([header, kind === "busy-writes" ? Buffer.from([0x00, 0x10]) : Buffer.alloc(0), image]);
}

/** Same intended full-ROM note on both chips; only the selected engine reaches
 * BASIC after reading its actual write-only-register bus value. */
export function busReadRomFixture(dependent:"sidlite"|"residfp"):Buffer {
  const a=new Asm(0x1000);
  a.lda(0x35).staZp(1);
  for(const [register,value]of [[0,0x40],[1,0x10],[4,0x21],[5,0],[6,0xf0],[24,15]]as const)a.lda(value).sta(0xd400+register);
  a.rts();const play=a.here;
  a.lda(15).sta(0xd415).ldaAbs(0xd400).branch(dependent==="residfp"?0xf0:0xd0,"present");
  a.lda(0x37).staZp(1).ldaAbs(0xa000).cmp(0x94).branch(0xf0,"present");
  a.lda(0).sta(0xd418).jump("end");
  a.label("present").lda(15).sta(0xd418);
  a.label("end").lda(0x35).staZp(1).rts();
  const header=Buffer.alloc(0x7c);header.write("PSID");header.writeUInt16BE(2,4);header.writeUInt16BE(0x7c,6);header.writeUInt16BE(0x1000,8);header.writeUInt16BE(0x1000,10);header.writeUInt16BE(play,12);header.writeUInt16BE(1,14);header.writeUInt16BE(1,16);header.writeUInt16BE(0x14,0x76);
  header.write(`Bus ROM dependency ${dependent}`,0x16);
  return Buffer.concat([header,a.resolve()]);
}

/** One stateful SID read, early or late, with a running third-voice oscillator
 * and envelope. The sampled byte changes voice 1's pitch, so fabricated read
 * values cannot pass the trace/native/WASM controls. */
export function seedReadRomFixture(register:0x1b|0x1c,frame=5):Buffer {
  if(!Number.isInteger(frame)||frame<1||frame>255)throw new Error("Invalid seed-read frame");
  const a=new Asm(0x1000);a.lda(0x35).staZp(1).lda(0).sta(0x3000).sta(0x3001);
  for(const base of [0xd400,0xd40e])for(const [reg,value]of [[0,0x40],[1,0x10],[4,0x21],[5,0],[6,0xf0]]as const)a.lda(value).sta(base+reg);
  a.lda(15).sta(0xd418).rts();const play=a.here;
  a.ldaAbs(0x3001).branch(0xd0,"return").inc(0x3000).ldaAbs(0x3000).cmp(frame).branch(0xd0,"return");
  a.ldaAbs(0xd400+register).sta(0xd400).lda(1).sta(0x3001).label("return").rts();
  const header=Buffer.alloc(0x7c);header.write("PSID");header.writeUInt16BE(2,4);header.writeUInt16BE(0x7c,6);header.writeUInt16BE(0x1000,8);header.writeUInt16BE(0x1000,10);header.writeUInt16BE(play,12);header.writeUInt16BE(1,14);header.writeUInt16BE(1,16);header.writeUInt16BE(0x14,0x76);header.write(`Seed ${register} at frame ${frame}`,0x16);
  return Buffer.concat([header,a.resolve()]);
}

# ROM dependency is engine-specific: SIDLite and reSIDfp

Measured 2026-10-24 against the actual `libsidplayfp-wasm-audit` npm alias,
version 1.1.1, on the development i7-6700K. This is a source investigation and
small counterexample experiment, not a full-HVSC classification or performance qualification.

## Finding

A SIDLite-only deny list cannot establish reSIDfp ROM requirements. The shared
C64 CPU/MMU does not make their executed programs identical: reads from the
SID feed engine-specific values back to the CPU, affecting branches, memory
accesses and future SID writes. Neither engine's ROM-dependent set necessarily
contains the other's. Whether the sets happen to coincide for the current
HVSC release remains unmeasured; the synthetic examples do not establish an
HVSC disagreement count.

The exact packaged source was inspected, alongside these tagged upstream sources:

- [libsidplayfp 3.1.1 SIDLite SID::read](https://github.com/libsidplayfp/libsidplayfp/blob/v3.1.1/src/builders/sidlite-builder/sidlite/SID.cpp):
  OSC3 and ENV3 have dedicated results; every other address returns zero.
- [libresidfp 1.2.3 SID::read and SID::write](https://github.com/libsidplayfp/libresidfp/blob/v1.2.3/src/SID.cpp):
  writes retain the bus value; reads of write-only registers return it, reducing
  its remaining lifetime. OSC3, ENV3 and paddle reads have their own behavior.
- [libsidplayfp 3.1.1 c64sid::peek](https://github.com/libsidplayfp/libsidplayfp/blob/v3.1.1/src/c64/c64sid.h):
  the C64 memory bank delegates reads to the selected SID implementation.

Consequently even a tune that usually only writes SID registers can make
engine-specific decisions if it performs SID readback. Separately, equal
register changes can have different audibility in different chip emulations;
shared CPU execution alone does not establish a listener-equivalence result.

## Playback counterexamples

Two original PSID v2 stimuli initialise a sustained sawtooth note, write `$0f`
to the unused filter-cutoff register `$d415`, then immediately read the write-only
register `$d400`. SIDLite returns zero; reSIDfp retains `$0f`.
One stimulus reads BASIC only for nonzero readback; the other reverses the branch.
The ROM-reading branch banks BASIC in, reads `$a000`, masks it to four bits, and
sets SID volume. Authentic BASIC starts with `$94`, producing volume 4;
a zeroed BASIC bank produces volume 0. Banking is restored before returning.
The filter is not routed, so writing its cutoff does not itself affect the note.

All controls use 48 kHz stereo, header MOS8580/PAL, default power-on delay 8191,
a fresh WASM module per reSIDfp lane, and six seconds of rendering.
Each full-ROM reference repeats exactly. The KERNAL+BASIC supplied lane is
PCM-identical to the full-ROM reference in all four engine/stimulus combinations.
The existing listener assessment gives concrete results, with no `unknown`:

| Stimulus | SIDLite without ROMs | reSIDfp without ROMs |
| --- | --- | --- |
| Branch to BASIC on nonzero SID readback | Compatible | Incompatible |
| Branch to BASIC on zero SID readback | Incompatible | Compatible |

A second direct-render check holds authentic KERNAL and CHARGEN fixed and
changes **only BASIC** between authentic and zeroed. It does not use listener
thresholds to establish the difference. In the unaffected engine the entire
six-second PCM is byte-for-byte identical. In the affected engine the final
four seconds become exact silence; normalized, DC-subtracted RMS falls from
0.0221022266 to 0 for SIDLite and from 0.0174876687 to 0 for reSIDfp.
This demonstrates a sustained audible effect rather than tiny timing changes.
The generated WAVs allow listening; no claim of a human listening trial is made.

These are deliberately constructed stimuli, not files found in HVSC. They prove
that transferring a deny list between engines requires additional evidence.
For the user-facing goal, qualification and runtime budgeting must cover both
engines, or establish a sound per-case transfer rule. Existing v4 SIDLite results
remain scoped to their recorded engine identity; they must not be relabelled as
reSIDfp results. A sample agreement rate cannot establish universal equality.

## Shared CPU does execute the ROM calls

SIDLite replaces SID chip emulation, not C64 CPU execution. The packaged
`player.cpp` owns the same C64, `mmu.h` routes KERNAL/BASIC/CHARGEN banks, and
`c64sid.h::peek` calls the selected SID backend. A KERNAL or BASIC instruction
that is actually reached is fetched/executed by that shared CPU. SIDLite does
not magically implement an absent BASIC interpreter. The absent KERNAL has a
small explicitly constructed IRQ/reset shim, not the authentic complete ROM.
The difference is that SID readback can determine whether a ROM access/call
is reached, or what its result does to the music.

Additional controls extended the experiment to both MOS6581 and MOS8580 and to
each of KERNAL, BASIC and CHARGEN: 24 engine/stimulus comparisons passed, each
with an identical full-ROM repeat. These stronger controls explicitly request
the same sustained note/volume 15 in **both full-ROM branches**; only removal
of the selected ROM in the selected engine mutes the note. Thus the difference
is not merely choosing different intended full-ROM volume levels per engine.
The original two controls above are retained as the first experiment; the
extended control results are in the local diagnostic
`workspace/rom-audit-engine-bank-controls.json`.

ROM sensitivity and fidelity must remain separate. Equality to an engine's own
full-ROM output does not prove that full-ROM output faithfully matches a real
C64. These experiments demonstrate engine-specific ROM effects; they do not
certify either emulator's universal musical accuracy or a 100% listener metric.
A future catalogue must say which reference and engine its decisions describe.

## Real HVSC cross-check in progress

All 111 app audit-only records were joined by complete-file MD5/subtune to the
SIDLite v4 research evidence. A matched six-second listener-v1 check produced:

| SIDLite result | reSIDfp result | Subtunes |
| --- | --- | ---: |
| Audible difference | Audible difference | 46 |
| Equivalent for six seconds | Equivalent for six seconds | 43 |
| Audible difference | Equivalent for six seconds | 20 |
| Equivalent for six seconds | Audible difference | 1 |
| Audible difference | Engine failure | 1 |

All successful references repeat identically. The single failure is
`MUSICIANS/A/Andy/Justincase_part_6.sid` #1: a reSIDfp memory trap with the recorded
100,000-event request. A diagnostic 256-event request completes six seconds;
that different configuration is not substituted into the published contract.

The full-duration SIDLite baseline marks all 111 incompatible; therefore the
six-second reverse row (`Well_Done.sid` #1) does not establish a reverse
full-duration difference. Full-duration reSIDfp checks are running. Completed
examples of SIDLite-incompatible/reSIDfp-equivalent through the same documented
horizon include `GAMES/S-Z/Snooker.sid` #2 (10 s) and
`MUSICIANS/0-9/20CC/van_Santen_Edwin/No_Mercy.sid` #3 (36 s). The reverse search
uses already-counted SIDLite-compatible pilot inputs with matching hashes.
No complete-HVSC superset relation is claimed from this partial evidence.

The app's six-second whole-render RMS test differs from listener-v1. For
`DEMOS/G-L/Gott_Och_Blandat.sid` #1, direct reSIDfp renders differ by only
0.6808 dB in RMS, satisfying the app's 3 dB same-level criterion, but frequency
writes actually differ: voice 1 low frequency 17 versus 0 and voice 2 low/high
frequency 11/1 versus 0/0. This is not just a constant timing offset. The app's
same-level count cannot establish musical equivalence or attribute its reported
disagreements solely to SIDLite.

## Engine and stimulus identities

Complete source archive SHA-256: `e8521da254a1d063aecf76448ba013d8ed1c74b6c1e233bf52ae63b60cec3f57`.

- sidlite WASM SHA-256: `dd33f26261f130c3260b4b2680cfd4afbfd4a05019e6b016145938e933a250f5`.
- residfp WASM SHA-256: `90f636c967597dbb790f65f2679f0e2c32da59c0824be087630f72e3515fa001`.
- sidlite-dependent stimulus complete-file SHA-256: `63085beed99ef8c9080e4f4d535a632c73067c64338a555abc12bde0a9eba3a7`.
- residfp-dependent stimulus complete-file SHA-256: `3ade555c3f2e2dc6581d500d6da2276babb460f23a36c608d1572c15ca6d4307`.

## Reproduction

From the SIDFlow repository root with installed dependencies and fetched reference
ROMs, save each following block to the indicated file under the ignored `workspace/`
directory. Run the first script before the second. No downloaded SID is required.
The first script asserts clean repeatable references and opposite dependency
outcomes; the second asserts the isolated BASIC PCM result and writes six-second
WAV files to `/tmp/rom-branch-*.wav`.

`workspace/check-engine-rom-dependency.ts`:

```ts
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadRoms} from '../scripts/rom-audit/census-worker.ts';
import {runListenerEngine,engineHashes} from '../scripts/rom-audit/wasm-lanes.ts';
import {assessMask,observationHorizon} from '../scripts/rom-audit/methodology.ts';
const roms=loadRoms('workspace/roms');
const results=[];
for(const dependent of ['residfp','sidlite'] as const){
 const code:number[]=[];const emit=(...v:number[])=>code.push(...v);
 emit(0xa9,0x35,0x85,1);
 for(const [reg,value] of [[0,0x40],[1,0x10],[4,0x21],[5,0],[6,0xf0],[24,15]])emit(0xa9,value!,0x8d,reg!,0xd4);
 emit(0x60);const play=0x1000+code.length;
 // SIDLite returns zero on a write-only register. reSIDfp retains the last bus write (15).
 emit(0xa9,15,0x8d,0x15,0xd4,0xad,0,0xd4,dependent==='residfp'?0xf0:0xd0,0);
 const branch=code.length-1;
 // Authentic BASIC starts with $94, so volume becomes 4; absent BASIC makes it 0.
 emit(0xa9,0x37,0x85,1,0xad,0,0xa0,0x29,15,0x8d,0x18,0xd4,0xa9,0x35,0x85,1);
 code[branch]=code.length-(branch+1);emit(0x60);
 const bytes=Buffer.alloc(0x7c+code.length);bytes.write('PSID');bytes.writeUInt16BE(2,4);bytes.writeUInt16BE(0x7c,6);bytes.writeUInt16BE(0x1000,8);bytes.writeUInt16BE(0x1000,10);bytes.writeUInt16BE(play,12);bytes.writeUInt16BE(1,14);bytes.writeUInt16BE(1,16);bytes.writeUInt16BE(0x24,0x76);bytes.write(`ROM branch ${dependent}`,0x16);Buffer.from(code).copy(bytes,0x7c);
 writeFileSync(`/tmp/rom-branch-${dependent}.sid`,bytes);
 for(const engine of ['sidlite','residfp'] as const){
 const run=await runListenerEngine(engine,bytes,1,6,roms,true);
 const decision=assessMask(run,observationHorizon('0:01',1),6,48000,0);
 const full=run.lanes.find(l=>l.set==='full')!,none=run.lanes.find(l=>l.set==='none')!;
 const result={dependent,engine,sha256:createHash('sha256').update(bytes).digest('hex'),hashes:engineHashes(engine),decision,reference:run.reference,full,none};results.push(result);
 console.log(JSON.stringify(result));
 if(run.reference.outcome!=='clean'||run.reference.repeat!=='identical'||full.outcome!=='equivalent'||none.outcome!==(engine===dependent?'audible-difference':'equivalent'))throw Error('Unexpected counterexample outcome');
 }
}
writeFileSync('/tmp/sidflow-engine-rom-dependency-results.json',JSON.stringify(results,null,2)+'\n');
```

`workspace/check-engine-rom-pcm.ts`:

```ts
import {readFileSync,writeFileSync} from 'node:fs';
import {loadRoms} from '../scripts/rom-audit/census-worker.ts';
import {loadModule} from '../scripts/rom-audit/wasm-lanes.ts';
import {createHash} from 'node:crypto';
const roms=loadRoms('workspace/roms'), results=[];
for(const dependent of ['sidlite','residfp'] as const)for(const engine of ['sidlite','residfp'] as const){
 const renders:Buffer[]=[];
 for(const missingBasic of [false,true]){
  const m=await loadModule(engine),c=new m.SidPlayerContext();let samples=0;const parts:Buffer[]=[];
  try{
   if(!c.configure(48000,true)||!c.setSystemROMs(roms.kernal,missingBasic?new Uint8Array(8192):roms.basic,roms.chargen)||!c.loadSidBuffer(readFileSync(`/tmp/rom-branch-${dependent}.sid`))||!c.reset())throw Error(c.getLastError());
   while(samples<576000){const v=c.render(100000);if(!v?.length)throw Error(c.getLastError());const take=Math.min(v.length,576000-samples);parts.push(Buffer.from(new Uint8Array(v.buffer,v.byteOffset,take*2)));samples+=take;}
  }finally{c.delete();}
  const pcm=Buffer.concat(parts);renders.push(pcm);
  // Listen to the last four seconds, after the attack/DC-filter transient.
  const start=192000;let sum=0,mean=0;const count=samples-start;
  for(let i=start;i<samples;i++)mean+=pcm.readInt16LE(i*2);mean/=count;
  for(let i=start;i<samples;i++)sum+=(pcm.readInt16LE(i*2)-mean)**2;
  results.push({dependent,engine,missingBasic,rms:Math.sqrt(sum/count)/32768,sha256:createHash('sha256').update(pcm).digest('hex')});
  const wav=Buffer.alloc(44);wav.write('RIFF');wav.writeUInt32LE(36+pcm.length,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(192000,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);writeFileSync(`/tmp/rom-branch-${dependent}-on-${engine}-${missingBasic?'basic-zero':'full'}.wav`,Buffer.concat([wav,pcm]));
 }
 if((renders[0]!.equals(renders[1]!))===(dependent===engine))throw Error('Wrong isolated BASIC dependency');
}
writeFileSync('/tmp/sidflow-engine-rom-pcm-results.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
```

```sh
bun workspace/check-engine-rom-dependency.ts
bun workspace/check-engine-rom-pcm.ts
```

Validation: all four listener/reference assertions and all four isolated-BASIC
PCM assertions passed. This document adds no production renderer change. The
native optimization already in progress remains unqualified and is not certified
by these experiments.

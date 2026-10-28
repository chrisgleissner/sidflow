#!/usr/bin/env bun
/** Synthetic native A/B controls; no HVSC files or eligibility publication.
 * verify-adaptive-screen.ts <roms> <sidlite binary> <residfp binary> <report>
 */
import { writeFileSync } from "node:fs";
import { seedReadRomFixture, delayedRomFixture } from "./fixtures.js";
import { adaptiveScreens, type ScreenAttempt } from "./adaptive-screen.js";
import { screenLane } from "./digital-screen.js";
import { screenJson } from "./screen-identity.js";
const [roms,sidlite,residfp,report] = process.argv.slice(2);
if (!roms || !sidlite || !residfp || !report) throw new Error("Expected roms, both binaries and report");
const rows: unknown[] = [];
for (const [engine,binary] of [["sidlite",sidlite],["residfp",residfp]] as const) {
  for (const [name,bytes] of [["early-osc3",seedReadRomFixture(0x1b)],["late-env3",seedReadRomFixture(0x1c,100)],["late-chargen",delayedRomFixture(4,{frames:100})]] as const) {
    const results: ScreenAttempt[][] = [];
    for (const adaptive of [false,true]) results.push(await adaptiveScreens((mask,mode) => screenLane(binary,roms,bytes,1,3,mask,mode === "bus",mode === "warmup"),adaptive));
    const final = (index: number) => [7,0,3].map(mask => {
      const result = results[index]!.filter(a => a.mask === mask).at(-1)?.result;
      return result && {error:result.error,traceComplete:result.traceComplete,chargenReads:result.chargenReads,writes:result.writes};
    });
    if (screenJson(final(0)) !== screenJson(final(1))) throw new Error(`Adaptive execution changed: ${engine} ${name}`);
    rows.push({engine,name,matched:true,measurements:results.map(attempts=>({cpuSeconds:attempts.reduce((sum,a)=>sum+(a.result.cpuSeconds??0),0),attempts:attempts.map(a=>({mask:a.mask,mode:a.mode,error:a.result.error}))}))});
    console.log(`${engine} ${name}: exact final evidence matched`);
  }
}
writeFileSync(report,screenJson({schema:"sidflow-adaptive-native-controls-1",rows})+"\n");

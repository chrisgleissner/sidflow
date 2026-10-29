/** Qualified count-only register screen; unresolved lanes retain native PCM. */
import { sampleClockScreen } from "./sample-screen.js";
import { audioSets, audioStates, type ScreenClassification } from "./screen-classifier.js";
import { runNativeEngine } from "./native-lanes.js";
import { screenJson, screenSha } from "./screen-identity.js";

export async function classifySampleScreen(sampleBinary:string,audioBinary:string,roms:string,bytes:Uint8Array,song:number,seconds:number,repeat=false):Promise<ScreenClassification> {
  const measured=sampleClockScreen(sampleBinary,roms,bytes,song,seconds);
  const screen={...measured.screen,referenceError:measured.reference.terminal.error,traceComplete:measured.reference.terminal.traceComplete,
    referenceTraceSha256:screenSha(screenJson(measured.reference.packets))};
  const sets=audioSets(screen,repeat);
  if(!sets.length)return {engine:"residfp",states:{none:"compatible",full:"compatible"},screen,cpuSeconds:measured.screenCpuSeconds};
  const audio=await runNativeEngine("residfp",bytes,song,seconds,roms,audioBinary,repeat,sets);
  const states=audioStates(screen,audio,seconds);
  for(const set of ["none","full"] as const)if(screen[set]&&states[set]==="incompatible")throw new Error(`Sample screen false compatibility: ${set}`);
  return {engine:"residfp",states,screen,audio,audioBackend:"native",cpuSeconds:measured.screenCpuSeconds+audio.cpuSeconds};
}

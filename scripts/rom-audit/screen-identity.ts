import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { engineHashes } from "./wasm-lanes.js";
import { REFERENCE_ROM_SHA256, romSetId } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
export const screenJson=(value:unknown):string=>stringifyDeterministic(value as JsonValue,0).trimEnd();
export const SCREEN_METHODOLOGY="rom-audit-digital-screen-1";
export const screenSha=(value:string|Uint8Array):string=>createHash("sha256").update(value).digest("hex");
/** Qualification binds controllers/publication/tests as well as rendering. */
export function screenQualificationIdentity(): string {
  const directory=import.meta.dir;
  const files=readdirSync(directory).filter(f=>/\.(ts|mjs|cpp|sh|py)$/.test(f)).sort().map(f=>[f,screenSha(readFileSync(path.join(directory,f)))]);
  const extra=["packages/sidflow-common/src/rom-eligibility.ts","packages/sidflow-common/src/json.ts","packages/sidflow-common/src/sid-header-conformance.ts","packages/sidflow-common/test/rom-screen.test.ts","packages/sidflow-common/test/rom-audit-adversarial.test.ts","packages/sidflow-classify/test/super-mario-stress.test.ts","package.json","scripts/run-unit-coverage-batches.mjs","scripts/run-bun.mjs","scripts/ensure-bun.mjs","bun.lock"].map(f=>[f,screenSha(readFileSync(path.resolve(directory,"../..",f)))]);
  return screenSha(screenJson({files,extra,engines:{sidlite:engineHashes("sidlite"),residfp:engineHashes("residfp")}}));
}
/** Renderer/decision identity deliberately excludes publication, qualification
 * and rollout controllers: changing those cannot invalidate measured PCM. */
export function screenIdentity():string {
  const names=["render.cpp","apply-basic-read-hook.py","apply-sid-write-hook.py","apply-digital-screen.py","apply-inline-filters.py","build-native.sh",
    "digital-screen.ts","native-lanes.ts","listener.ts","register-comparison.ts","wasm-lanes.ts","screen-classifier.ts","screen-worker.ts","screen-inventory.ts","methodology.ts","inputs.ts"];
  const sources=names.map(name=>[name,screenSha(readFileSync(path.join(import.meta.dir,name)))]);
  const common=["rom-eligibility.ts","json.ts","sid-header-conformance.ts"].map(name=>[name,screenSha(readFileSync(path.resolve(import.meta.dir,"../../packages/sidflow-common/src",name)))]);
  return screenSha(screenJson({sources,common,engineIds:{sidlite:screenEngineIdentity("sidlite"),residfp:screenEngineIdentity("residfp")}}));
}
export function screenEngineIdentity(engine:"sidlite"|"residfp"):string {
  return screenSha(screenJson({engine,...engineHashes(engine),methodology:SCREEN_METHODOLOGY,sampleRate:48000,stereo:true,powerOnDelay:8191,pullEvents:256,
    reference:"KERNAL+BASIC+CHARGEN",masks:[0,3],absent:"KERNAL shim; BASIC/CHARGEN zero",sidModel:"header with MOS8580 fallback",screen:"native bus-only; 1024000-cycle warmup then bus-only with later OSC3/ENV3 abort; detailed clockSilent; listener-v1 register fast path; native audio fallback; inline filter tables; native/WASM parity qualified"}));
}
export const screenRomSetId=romSetId;

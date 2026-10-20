#!/usr/bin/env bun
/** Exercise the actual application dispatcher/core with its installed package.
 * check-commander.ts <Commander repo> <HVSC root> <ROM dir>
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const [repo,hvsc,romDir]=process.argv.slice(2);
if (!repo||!hvsc||!romDir) throw new Error("Expected Commander repo, HVSC and ROM directory");
const load=async(p:string)=>import(pathToFileURL(path.resolve(repo,p)).href);
const library=await load("node_modules/libsidplayfp-wasm/dist/index.js");
const {WasmSidRendererCore}=await load("src/lib/playback/sidRenderer/wasmRendererCore.ts");
const {createRendererDispatcher}=await load("src/lib/playback/sidRenderer/sidRendererContract.ts");
const get=async(name:string):Promise<ArrayBuffer>=>Uint8Array.from(await readFile(path.join(romDir,name))).buffer;
for (const supplied of [true,false]) {
  let player: InstanceType<typeof library.SidAudioEngine>;
  class Observed extends library.SidAudioEngine {
    constructor(options:object) { super(options);player=this; }
    async loadSidBuffer(bytes:Uint8Array,song:number):Promise<void> {
      await super.loadSidBuffer(bytes,song);
      await this.setEmulationConfig({powerOnDelay:5000});
      this.setSidWriteTraceEnabled(true);
    }
  }
  const core=new WasmSidRendererCore(async()=>Observed);
  const messages: {type:string;romRequired?:boolean;code?:string}[]=[];
  const dispatch=createRendererDispatcher(core,(message:{type:string;romRequired?:boolean})=>messages.push(message));
  try {
    await dispatch({type:"open",id:1,engine:"sidlite",sampleRate:8000,songIndex:0,
      sidBytes:Uint8Array.from(await readFile(path.join(hvsc,"DEMOS/0-9/128_Byte_Blues_BASIC.sid"))).buffer,
      ...(supplied?{roms:{kernal:await get("kernal.901227-03.bin"),basic:await get("basic.901226-01.bin")}}:{})});
    const chunk=await core.render(10);
    console.log(JSON.stringify({supplied,packageVersion:library.PACKAGE_VERSION,libraryVersion:library.LIBSIDPLAYFP_VERSION,
      messages:messages.map(({type,romRequired,code})=>({type,romRequired,code})),samples:chunk?.samples,
      sidWrites:player!.getAndClearSidWriteTraces().length}));
  } finally {core.dispose();}
}

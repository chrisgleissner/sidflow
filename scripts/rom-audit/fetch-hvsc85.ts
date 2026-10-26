#!/usr/bin/env bun
/** Fetch the exact research release without updating or deleting an existing
 * collection. Download, checksum and validate in a private staging directory;
 * install only a complete byte-verified HVSC85. No ROMs/SIDs are committed.
 */
import { existsSync } from "node:fs";
import { mkdir,mkdtemp,rename,rm } from "node:fs/promises";
import path from "node:path";
import { loadConfig,parseArgs,formatHelp,handleParseResult,extractSevenZipArchive,retry } from "../../packages/sidflow-common/src/index.js";
import { __internal } from "../../packages/sidflow-fetch/src/sync.js";
import { screenInventory } from "./screen-inventory.js";
const ARCHIVE={version:85,filename:"HVSC_85-all-of-them.7z",url:"https://hvsc.brona.dk/HVSC/HVSC_85-all-of-them.7z"};
// Recorded upstream archive; its extracted full-content inventory is independently
// checked against HVSC85_CORPUS and every pinned release document before install.
const ARCHIVE_SHA256="f770339229446df1b8e037938fb70f3f4c953cb4a6eeef7ce357f05ca2c73225";
export async function fetchPinnedHvsc85(destination:string):Promise<void>{
  if(existsSync(destination)){await screenInventory(destination);console.log(`Verified existing HVSC85: ${destination}`);return;}
  await mkdir(path.dirname(destination),{recursive:true});
  const staging=await mkdtemp(path.join(path.dirname(destination),".hvsc85-stage-"));
  try{
    const archive=path.join(staging,ARCHIVE.filename),extracted=path.join(staging,"extracted");
    console.log(`Downloading pinned HVSC85: ${ARCHIVE.url}`);
    await retry(()=>__internal.defaultDownloadArchive(ARCHIVE,archive));
    if(await __internal.defaultChecksum(archive)!==ARCHIVE_SHA256)throw new Error("HVSC85 archive checksum mismatch");
    await extractSevenZipArchive(archive,extracted);
    const candidate=existsSync(path.join(extracted,"C64Music"))?path.join(extracted,"C64Music"):extracted;
    await screenInventory(candidate);
    if(existsSync(destination))throw new Error(`Destination appeared during fetch; left untouched: ${destination}`);
    await rename(candidate,destination);console.log(`Installed verified HVSC85: ${destination}`);
  }finally{await rm(staging,{recursive:true,force:true});}
}
if(import.meta.main){
  const definitions=[{name:"--config",type:"string",description:"SIDFlow config override"},{name:"--destination",type:"string",description:"Destination C64Music directory"}]as const;
  const parsed=parseArgs<{config?:string;destination?:string}>(process.argv.slice(2),[...definitions]);
  const code=handleParseResult(parsed,formatHelp("fetch-hvsc85","Fetch the pinned ROM-audit corpus safely",[...definitions]));
  if(code!==undefined)process.exit(code);
  const config=await loadConfig(parsed.options.config),base=path.resolve(config.sidPath);
  await fetchPinnedHvsc85(path.resolve(parsed.options.destination??(path.basename(base)==="C64Music"?base:path.join(base,"C64Music"))));
}

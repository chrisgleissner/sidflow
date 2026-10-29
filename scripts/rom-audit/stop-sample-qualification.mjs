#!/usr/bin/env node
/** Stop only a verified local sample qualification and its process descendants.
 * Usage: node scripts/rom-audit/stop-sample-qualification.mjs <pid> <output-dir>
 * Preserves all reports. Never signals an unverified/reused parent PID.
 */
import {readFile,readdir,realpath,readlink} from 'node:fs/promises';
import path from 'node:path';
const pid=Number(process.argv[2]),output=await realpath(process.argv[3]);
if(!Number.isSafeInteger(pid)||pid<=1)throw Error('Expected qualification PID and output directory');
const args=(await readFile(`/proc/${pid}/cmdline`,'utf8')).split('\0');
const index=args.findIndex(a=>a.endsWith('/qualify-sample-screen.ts')||a==='scripts/rom-audit/qualify-sample-screen.ts');
const production=args.findIndex(a=>a.endsWith('/qualify-screen.ts')||a==='scripts/rom-audit/qualify-screen.ts');
const cwd=await readlink(`/proc/${pid}/cwd`);
const matches=index>=0?await realpath(path.resolve(cwd,args[index+5]))===output:production>=0&&['rom-audit-sample-qualification','rom-audit-screen-qualification'].some(name=>path.join(cwd,'workspace',name)===output);
if(!matches)throw Error('PID/output does not match this qualification');
const parents=new Map();
for(const entry of await readdir('/proc'))if(/^\d+$/.test(entry)){
  try{const stat=await readFile(`/proc/${entry}/stat`,'utf8');parents.set(Number(entry),Number(stat.slice(stat.lastIndexOf(')')+2).split(' ')[1]));}
  catch(error){if(error.code!=='ENOENT'&&error.code!=='ESRCH')throw error;console.debug('Process exited during stop scan',entry);}
}
const selected=new Set([pid]);
for(let added=true;added;){added=false;for(const [child,parent]of parents)if(selected.has(parent)&&!selected.has(child)){selected.add(child);added=true;}}
for(const target of [...selected].reverse()){
  try{process.kill(target,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;console.debug('Process already exited',target);}
}
console.log(`Stopped qualification ${pid} and its descendants; reports preserved in ${output}`);

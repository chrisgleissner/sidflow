#!/usr/bin/env node
/** Safely interrupt one Linux dual-ROM census, preserving its checkpoint.
 * node scripts/stop-rom-audit.mjs workspace/rom-audit-dual-2
 * Verifies the lock PID's live command and output directory before signaling;
 * never removes evidence, sends SIGKILL or signals an unrelated/reused PID.
 */
import {readFile,readlink,realpath} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const directory=process.argv[2];
if(!directory)throw Error('Usage: node scripts/stop-rom-audit.mjs <census-directory>');
const target=await realpath(directory);
let lock;
try{lock=await readFile(path.join(target,'run.lock'),'utf8');}
catch(error){if(error.code==='ENOENT'){console.log('No census lock; nothing to stop.');process.exit(0);}throw error;}
const pid=Number(/^pid=(\d+)\b/.exec(lock)?.[1]);
if(!Number.isSafeInteger(pid)||pid<=1)throw Error('Invalid census lock PID; refusing to signal.');
let args,cwd;
try{
  args=(await readFile(`/proc/${pid}/cmdline`,'utf8')).split('\0').filter(Boolean);
  cwd=await readlink(`/proc/${pid}/cwd`);
}catch(error){if(error.code==='ENOENT'){console.log('Census already stopped; checkpoint preserved.');process.exit(0);}throw error;}
const index=args.findIndex(arg=>arg.endsWith('/scripts/rom-audit/screen-census.ts')||arg==='scripts/rom-audit/screen-census.ts');
if(index<0||!['bench','full'].includes(args[index+1])||!args[index+4]||await realpath(path.resolve(cwd,args[index+4]))!==target)
  throw Error('Lock PID does not match this census; refusing to signal.');
console.log(`Interrupting census PID ${pid}; preserving ${target}`);
try{process.kill(pid,'SIGINT');}catch(error){if(error.code==='ESRCH'){console.log('Census already stopped.');process.exit(0);}throw error;}
for(let attempt=0;attempt<120;attempt++){
  await delay(500);
  try{
    process.kill(pid,0);
    const stat=await readFile(`/proc/${pid}/stat`,'utf8');
    if(stat.slice(stat.lastIndexOf(')')+2).startsWith('Z ')){console.log('Census exited; checkpoint preserved.');process.exit(0);}
  }catch(error){if(error.code==='ESRCH'||error.code==='ENOENT'){console.log('Census stopped; checkpoint preserved.');process.exit(0);}throw error;}
}
throw Error('Census has not exited after 60 seconds; no forced termination performed.');

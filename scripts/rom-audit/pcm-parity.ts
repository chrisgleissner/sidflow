/** Native/WASM qualification, using the upstream engine project's fidelity
 * limits (scripts/native-parity.mjs at libsidplayfp-wasm 1.1.1). SIDLite is exact;
 * reSIDfp's glibc/musl filter-table rounding has a documented small error floor.
 */
export function pcmParity(engine:"sidlite"|"residfp",a:Int16Array,b:Int16Array){
  if(!a.length||a.length!==b.length)throw new Error("Native/WASM PCM length mismatch");
  let x=0,y=0,xx=0,yy=0,xy=0,delta=0,max=0;
  for(let i=0;i<a.length;i++){const u=a[i]!,v=b[i]!,d=u-v;x+=u;y+=v;xx+=u*u;yy+=v*v;xy+=u*v;delta+=d*d;max=Math.max(max,Math.abs(d));}
  const n=a.length,vx=Math.max(0,xx/n-(x/n)**2),vy=Math.max(0,yy/n-(y/n)**2),errorRms=Math.sqrt(delta/n)/32768;
  const quiet=Math.max(Math.sqrt(vx),Math.sqrt(vy))/32768<0.005;
  const correlation=vx&&vy?(xy/n-x*y/n/n)/Math.sqrt(vx*vy):delta===0?1:0;
  const levelDb=20*Math.log10((Math.sqrt(xx/n)+1e-20)/(Math.sqrt(yy/n)+1e-20)),dc=Math.abs(x-y)/n/32768;
  if(engine==="sidlite"?max!==0:errorRms>0.001||dc>0.001||(quiet?max>16:correlation<0.9999||Math.abs(levelDb)>0.2))throw new Error(`Native/WASM ${engine} PCM parity failed: ${max} LSB, RMS ${errorRms}, correlation ${correlation}`);
  return{maxAbsLsb:max,errorRms,correlation,levelDb,dc};
}

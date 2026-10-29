import { expect, test } from "bun:test";
import { screenIdentity, screenEngineIdentity, sampleClockEnabled } from "../../../scripts/rom-audit/screen-identity.js";
test("sample mode has separate measurement provenance while preserving the SIDLite profile",()=>{
  expect(screenIdentity(true)).not.toBe(screenIdentity(false));
  expect(screenEngineIdentity("residfp",true)).not.toBe(screenEngineIdentity("residfp",false));
  expect(screenEngineIdentity("sidlite",true)).toBe(screenEngineIdentity("sidlite",false));
});
test("invalid backend selection is rejected rather than silently using the old backend",()=>{
  const prior=process.env.ROM_AUDIT_SAMPLE_CLOCK;
  try{
    process.env.ROM_AUDIT_SAMPLE_CLOCK="1";expect(sampleClockEnabled()).toBe(true);
    process.env.ROM_AUDIT_SAMPLE_CLOCK="0";expect(sampleClockEnabled()).toBe(false);
    process.env.ROM_AUDIT_SAMPLE_CLOCK="2";expect(()=>sampleClockEnabled()).toThrow("0 or 1");
  }finally{if(prior===undefined)delete process.env.ROM_AUDIT_SAMPLE_CLOCK;else process.env.ROM_AUDIT_SAMPLE_CLOCK=prior;}
});

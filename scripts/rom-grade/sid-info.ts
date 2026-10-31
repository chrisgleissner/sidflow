/** Header-derived context dimensions of a SID file (file type, clock, SID model, chip count). */
import { checkSidHeader } from "../../packages/sidflow-common/src/sid-header-conformance.js";

export type SidKind = "PSID" | "RSID" | "BASIC" | "multiSID";
export type SidModel = "6581" | "8580" | "either" | "unknown";
export interface SidInfo {
  kind: SidKind;
  /** libsidplayfp plays NTSC only when the header declares NTSC; unknown/either/PAL play at the PAL clock */
  clock: "PAL" | "NTSC";
  clockDeclared: "unknown" | "PAL" | "NTSC" | "either";
  model: SidModel;
  chips: number;
  songs: number;
  version: number;
}

const MODELS: SidModel[] = ["unknown", "6581", "8580", "either"];

export function sidInfo(bytes: Uint8Array): SidInfo {
  const fields = checkSidHeader(bytes).fields;
  if (!fields) throw new Error("Not a SID file");
  const flags = fields.version >= 2 ? fields.flags ?? 0 : 0;
  const declared = (["unknown", "PAL", "NTSC", "either"] as const)[(flags >> 2) & 3]!;
  const chips = 1 + (fields.secondSidAddress ? 1 : 0) + (fields.thirdSidAddress ? 1 : 0);
  const kind: SidKind = fields.magic === "RSID" ? (flags & 2 ? "BASIC" : "RSID") : fields.secondSidAddress ? "multiSID" : "PSID";
  return { kind, clock: declared === "NTSC" ? "NTSC" : "PAL", clockDeclared: declared, model: MODELS[(flags >> 4) & 3]!, chips, songs: fields.songs, version: fields.version };
}

import { HvscManifest } from "./types.js";

const DEFAULT_BASE_URL = "https://hvsc.brona.dk/HVSC/";

export { DEFAULT_BASE_URL };

export async function fetchHvscManifest(baseUrl: string = DEFAULT_BASE_URL): Promise<HvscManifest> {
  const response = await fetch(baseUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch HVSC manifest from ${baseUrl}: ${response.status} ${response.statusText}`);
  }

  const listing = await response.text();
  const baseMatches = [...listing.matchAll(/HVSC_(\d+)-all-of-them\.7z/gi)];
  if (baseMatches.length === 0) {
    throw new Error("Unable to locate HVSC base archive in remote manifest");
  }

  const baseCandidate = baseMatches
    .map((match) => ({ version: Number(match[1]), filename: match[0] }))
    .sort((a, b) => b.version - a.version)[0];

  const deltaMatches = [...listing.matchAll(/HVSC_Update_(\d+)\.7z/gi)];
  const uniqueDeltas = new Map<number, string>();
  deltaMatches.forEach((match) => {
    const version = Number(match[1]);
    const filename = match[0];
    if (!uniqueDeltas.has(version)) {
      uniqueDeltas.set(version, filename);
    }
  });

  const deltas = [...uniqueDeltas.entries()]
    .map(([version, filename]) => ({ version, filename }))
    .sort((a, b) => a.version - b.version)
    .map(({ version, filename }) => ({
      version,
      filename,
      url: new URL(filename, baseUrl).toString()
    }));

  return {
    base: {
      version: baseCandidate.version,
      filename: baseCandidate.filename,
      url: new URL(baseCandidate.filename, baseUrl).toString()
    },
    deltas
  };
}

import { readFile, writeFile } from "node:fs/promises";
import { pathExists, stringifyDeterministic } from "@sidflow/common";

export const WAV_RENDER_SETTINGS_EXTENSION = ".render.json";

export type WavRenderSettingsSidecar = {
  v: 2;
  maxRenderSec: number;
  introSkipSec: number;
  maxClassifySec: number;
  sourceOffsetSec: number;
};

type LegacyWavRenderSettingsSidecar = {
  v: 1;
  maxRenderSec: number;
  introSkipSec: number;
  maxClassifySec: number;
};

export function getWavRenderSettingsSidecarPath(wavFile: string): string {
  return `${wavFile}${WAV_RENDER_SETTINGS_EXTENSION}`;
}

export async function writeWavRenderSettingsSidecar(
  wavFile: string,
  settings: Omit<WavRenderSettingsSidecar, "v"> & { v?: 2 }
): Promise<void> {
  const sidecarPath = getWavRenderSettingsSidecarPath(wavFile);
  const payload: WavRenderSettingsSidecar = {
    v: 2,
    maxRenderSec: settings.maxRenderSec,
    introSkipSec: settings.introSkipSec,
    maxClassifySec: settings.maxClassifySec,
    sourceOffsetSec:
      typeof settings.sourceOffsetSec === "number" && Number.isFinite(settings.sourceOffsetSec) && settings.sourceOffsetSec > 0
        ? settings.sourceOffsetSec
        : 0,
  };

  try {
    await writeFile(sidecarPath, `${stringifyDeterministic(payload)}\n`, "utf8");
  } catch {
    // Best-effort only.
  }
}

export async function readWavRenderSettingsSidecar(wavFile: string): Promise<WavRenderSettingsSidecar | null> {
  const sidecarPath = getWavRenderSettingsSidecarPath(wavFile);
  if (!(await pathExists(sidecarPath))) {
    return null;
  }

  try {
    const raw = await readFile(sidecarPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || (parsed.v !== 1 && parsed.v !== 2)) {
      return null;
    }
    if (
      typeof parsed.maxRenderSec !== "number" ||
      typeof parsed.introSkipSec !== "number" ||
      typeof parsed.maxClassifySec !== "number"
    ) {
      return null;
    }

    return {
      v: 2,
      maxRenderSec: parsed.maxRenderSec,
      introSkipSec: parsed.introSkipSec,
      maxClassifySec: parsed.maxClassifySec,
      sourceOffsetSec:
        typeof parsed.sourceOffsetSec === "number" && Number.isFinite(parsed.sourceOffsetSec) && parsed.sourceOffsetSec > 0
          ? parsed.sourceOffsetSec
          : 0,
    };
  } catch {
    return null;
  }
}
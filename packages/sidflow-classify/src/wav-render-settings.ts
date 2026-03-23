import { readFile, writeFile } from "node:fs/promises";
import { pathExists, stringifyDeterministic } from "@sidflow/common";

export const WAV_RENDER_SETTINGS_EXTENSION = ".render.json";

export type WavRenderSettingsSidecar = {
  v: 3;
  maxRenderSec: number;
  introSkipSec: number;
  maxClassifySec: number;
  sourceOffsetSec: number;
  renderEngine: string | null;
  traceCaptureEnabled: boolean;
  traceSidecarVersion: number | null;
};

export function getWavRenderSettingsSidecarPath(wavFile: string): string {
  return `${wavFile}${WAV_RENDER_SETTINGS_EXTENSION}`;
}

export async function writeWavRenderSettingsSidecar(
  wavFile: string,
  settings: Omit<WavRenderSettingsSidecar, "v"> & { v?: 3 }
): Promise<void> {
  const sidecarPath = getWavRenderSettingsSidecarPath(wavFile);
  const payload: WavRenderSettingsSidecar = {
    v: 3,
    maxRenderSec: settings.maxRenderSec,
    introSkipSec: settings.introSkipSec,
    maxClassifySec: settings.maxClassifySec,
    sourceOffsetSec:
      typeof settings.sourceOffsetSec === "number" && Number.isFinite(settings.sourceOffsetSec) && settings.sourceOffsetSec > 0
        ? settings.sourceOffsetSec
        : 0,
    renderEngine: typeof settings.renderEngine === "string" && settings.renderEngine.length > 0 ? settings.renderEngine : null,
    traceCaptureEnabled: settings.traceCaptureEnabled === true,
    traceSidecarVersion:
      typeof settings.traceSidecarVersion === "number" && Number.isFinite(settings.traceSidecarVersion)
        ? settings.traceSidecarVersion
        : null,
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
    if (!parsed || (parsed.v !== 1 && parsed.v !== 2 && parsed.v !== 3)) {
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
      v: 3,
      maxRenderSec: parsed.maxRenderSec,
      introSkipSec: parsed.introSkipSec,
      maxClassifySec: parsed.maxClassifySec,
      sourceOffsetSec:
        typeof parsed.sourceOffsetSec === "number" && Number.isFinite(parsed.sourceOffsetSec) && parsed.sourceOffsetSec > 0
          ? parsed.sourceOffsetSec
          : 0,
      renderEngine: parsed.v === 3 && typeof parsed.renderEngine === "string" && parsed.renderEngine.length > 0
        ? parsed.renderEngine
        : null,
      traceCaptureEnabled: parsed.v === 3 ? parsed.traceCaptureEnabled === true : false,
      traceSidecarVersion:
        parsed.v === 3 && typeof parsed.traceSidecarVersion === "number" && Number.isFinite(parsed.traceSidecarVersion)
          ? parsed.traceSidecarVersion
          : null,
    };
  } catch {
    return null;
  }
}
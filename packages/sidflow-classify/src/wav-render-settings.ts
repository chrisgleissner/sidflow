import { readFile, writeFile } from "node:fs/promises";
import { pathExists, stringifyDeterministic } from "@sidflow/common";

export const WAV_RENDER_SETTINGS_EXTENSION = ".render.json";

/**
 * Version 4 adds `sidEngine`, and versions 1 to 3 are rejected rather than upgraded.
 *
 * The sidecar decides whether a cached WAV can be reused. Until version 4 it recorded
 * `renderEngine: "wasm"` without saying which SID emulation produced the audio, so a WAV
 * rendered by SIDLite and one rendered by reSIDfp were indistinguishable and each was
 * accepted as a cache hit for the other. Nothing in an older sidecar can tell the two
 * apart after the fact, so an older file cannot be upgraded in place.
 *
 * The cost is real: the first run after this change re-renders the whole WAV cache. That
 * is the price of the cache never again mixing two emulations within one corpus, which is
 * what makes the 34 trace-derived similarity dimensions comparable across tracks.
 */
export type WavRenderSettingsSidecar = {
  v: 4;
  maxRenderSec: number;
  introSkipSec: number;
  maxClassifySec: number;
  sourceOffsetSec: number;
  renderEngine: string | null;
  /** SID emulation used by WASM renders; null for non-WASM engines. */
  sidEngine: string | null;
  traceCaptureEnabled: boolean;
  traceSidecarVersion: number | null;
  renderProfile?: string | null;
  renderSampleRate?: number | null;
  truncated?: boolean;
  fallbackReason?: string | null;
};

export function getWavRenderSettingsSidecarPath(wavFile: string): string {
  return `${wavFile}${WAV_RENDER_SETTINGS_EXTENSION}`;
}

export async function writeWavRenderSettingsSidecar(
  wavFile: string,
  settings: Omit<WavRenderSettingsSidecar, "v"> & { v?: 4 }
): Promise<void> {
  const sidecarPath = getWavRenderSettingsSidecarPath(wavFile);
  const payload: WavRenderSettingsSidecar = {
    v: 4,
    maxRenderSec: settings.maxRenderSec,
    introSkipSec: settings.introSkipSec,
    maxClassifySec: settings.maxClassifySec,
    sourceOffsetSec:
      typeof settings.sourceOffsetSec === "number" && Number.isFinite(settings.sourceOffsetSec) && settings.sourceOffsetSec > 0
        ? settings.sourceOffsetSec
        : 0,
    renderEngine: typeof settings.renderEngine === "string" && settings.renderEngine.length > 0 ? settings.renderEngine : null,
    sidEngine: typeof settings.sidEngine === "string" && settings.sidEngine.length > 0 ? settings.sidEngine : null,
    traceCaptureEnabled: settings.traceCaptureEnabled === true,
    traceSidecarVersion:
      typeof settings.traceSidecarVersion === "number" && Number.isFinite(settings.traceSidecarVersion)
        ? settings.traceSidecarVersion
        : null,
    renderProfile: typeof settings.renderProfile === "string" && settings.renderProfile.length > 0
      ? settings.renderProfile
      : null,
    renderSampleRate:
      typeof settings.renderSampleRate === "number" && Number.isFinite(settings.renderSampleRate) && settings.renderSampleRate > 0
        ? settings.renderSampleRate
        : null,
    truncated: settings.truncated === true,
    fallbackReason: typeof settings.fallbackReason === "string" && settings.fallbackReason.length > 0
      ? settings.fallbackReason
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
    if (!parsed || parsed.v !== 4) {
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
      v: 4,
      maxRenderSec: parsed.maxRenderSec,
      introSkipSec: parsed.introSkipSec,
      maxClassifySec: parsed.maxClassifySec,
      sourceOffsetSec:
        typeof parsed.sourceOffsetSec === "number" && Number.isFinite(parsed.sourceOffsetSec) && parsed.sourceOffsetSec > 0
          ? parsed.sourceOffsetSec
          : 0,
      renderEngine: typeof parsed.renderEngine === "string" && parsed.renderEngine.length > 0
        ? parsed.renderEngine
        : null,
      sidEngine: typeof parsed.sidEngine === "string" && parsed.sidEngine.length > 0
        ? parsed.sidEngine
        : null,
      traceCaptureEnabled: parsed.traceCaptureEnabled === true,
      traceSidecarVersion:
        typeof parsed.traceSidecarVersion === "number" && Number.isFinite(parsed.traceSidecarVersion)
          ? parsed.traceSidecarVersion
          : null,
      renderProfile:
        typeof parsed.renderProfile === "string" && parsed.renderProfile.length > 0
          ? parsed.renderProfile
          : null,
      renderSampleRate:
        typeof parsed.renderSampleRate === "number" && Number.isFinite(parsed.renderSampleRate) && parsed.renderSampleRate > 0
          ? parsed.renderSampleRate
          : null,
      truncated: parsed.truncated === true,
      fallbackReason:
        typeof parsed.fallbackReason === "string" && parsed.fallbackReason.length > 0
          ? parsed.fallbackReason
          : null,
    };
  } catch {
    return null;
  }
}
import { NextRequest, NextResponse } from "next/server";
import path from "node:path";

import { RenderOrchestrator } from "@sidflow/classify";
import type { RenderEngine, RenderFormat } from "@sidflow/common";
import {
  loadConfig,
  Ultimate64AudioCapture,
  Ultimate64Client,
} from "@sidflow/common";

const ENGINE_OPTIONS: RenderEngine[] = ["sidplayfp-cli", "ultimate64", "wasm"];
const FORMAT_OPTIONS: RenderFormat[] = ["wav", "m4a", "flac"];
const DEFAULT_TARGET_DURATION_MS = 120_000;
const DEFAULT_MAX_LOSS = 0.01;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sidPath = typeof body.sidPath === "string" ? body.sidPath : null;
    if (!sidPath) {
      return NextResponse.json(
        { error: "sidPath is required" },
        { status: 400 }
      );
    }

    const config = await loadConfig(body.configPath);
    const absoluteSidPath = resolveSidPath(config.hvscPath, sidPath);

    const formats = resolveFormats(body.formats, config.render?.defaultFormats);
    if (formats.length === 0) {
      return NextResponse.json(
        { error: "No valid formats provided" },
        { status: 400 }
      );
    }

    const targetDurationMs = normalizeDuration(body.targetDurationMs);
    const maxLossRate = normalizeMaxLoss(body.maxLossRate);
    const outputDir = path.resolve(
      typeof body.outputDir === "string"
        ? body.outputDir
        : config.render?.outputPath ?? path.join(config.wavCachePath, "rendered")
    );

    const chip = body.chip === "8580r5" ? "8580r5" : "6581";
    const preferredEngines = Array.isArray(body.preferredEngines)
      ? body.preferredEngines
          .map((entry: unknown) => coerceEngine(entry))
          .filter((engine: RenderEngine | null): engine is RenderEngine => engine !== null)
      : [];
    const resolvedEngine = coerceEngine(body.engine);
    const engineSelection: RenderEngine | "auto" | undefined =
      resolvedEngine ?? (body.engine === "auto" ? "auto" : undefined);

    const orchestrator = createOrchestrator(config, targetDurationMs, maxLossRate);
    const engineOrder = resolveEngineOrder(
      engineSelection,
      preferredEngines,
      config.render?.preferredEngines
    );

    const availability: RenderEngine[] = [];
    const unavailable: string[] = [];
    for (const engine of engineOrder) {
      const status = await orchestrator.checkEngineAvailability(engine);
      if (status.available) {
        availability.push(engine);
      } else {
        unavailable.push(`${engine}: ${status.reason ?? "unknown"}`);
      }
    }

    if (availability.length === 0) {
      return NextResponse.json(
        {
          error: "No render engines available",
          reasons: unavailable,
        },
        { status: 400 }
      );
    }

    const attempts: { engine: RenderEngine; error?: string }[] = [];
    for (const engine of availability) {
      try {
        const result = await orchestrator.render({
          sidPath: absoluteSidPath,
          outputDir,
          engine,
          formats,
          chip,
          songIndex: typeof body.songIndex === "number" ? body.songIndex : undefined,
          targetDurationMs,
          maxLossRate,
        });

        return NextResponse.json({
          success: true,
          engine,
          formats,
          outputDir,
          attempts,
          result,
        });
      } catch (error) {
        attempts.push({ engine, error: String(error) });
      }
    }

    return NextResponse.json(
      {
        error: "Failed to render with available engines",
        attempts,
        unavailable,
      },
      { status: 500 }
    );
  } catch (error) {
    console.error("Failed to execute render:", error);
    return NextResponse.json(
      { error: "Failed to execute render", details: String(error) },
      { status: 500 }
    );
  }
}

function coerceEngine(value: unknown): RenderEngine | null {
  if (typeof value !== "string") {
    return null;
  }
  const candidate = value as RenderEngine;
  return ENGINE_OPTIONS.includes(candidate) ? candidate : null;
}

function coerceFormat(value: unknown): RenderFormat | null {
  if (typeof value !== "string") {
    return null;
  }
  const candidate = value as RenderFormat;
  return FORMAT_OPTIONS.includes(candidate) ? candidate : null;
}

function resolveFormats(
  requestedFormats: unknown,
  defaultFormats?: RenderFormat[]
): RenderFormat[] {
  const rawList: unknown[] = Array.isArray(requestedFormats)
    ? requestedFormats
    : typeof requestedFormats === "string"
    ? requestedFormats.split(",")
    : defaultFormats ?? FORMAT_OPTIONS;

  const resolved: RenderFormat[] = [];
  for (const entry of rawList) {
    const format = coerceFormat(typeof entry === "string" ? entry.trim() : entry);
    if (!format) {
      continue;
    }
    if (!resolved.includes(format)) {
      resolved.push(format);
    }
  }
  return resolved;
}

function resolveEngineOrder(
  selection: RenderEngine | "auto" | undefined,
  preferred: RenderEngine[],
  configPreferred?: RenderEngine[]
): RenderEngine[] {
  const ordered: RenderEngine[] = [];
  const append = (engine: RenderEngine | null | undefined) => {
    if (engine && !ordered.includes(engine)) {
      ordered.push(engine);
    }
  };

  if (selection && selection !== "auto") {
    append(selection);
  }
  for (const engine of preferred) {
    append(engine);
  }
  if (configPreferred) {
    for (const engine of configPreferred) {
      append(engine);
    }
  }
  append("wasm");
  return ordered;
}

function normalizeDuration(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed * 1000);
    }
  }
  return DEFAULT_TARGET_DURATION_MS;
}

function normalizeMaxLoss(value: unknown): number {
  if (typeof value === "number" && value >= 0 && value < 1) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed < 1) {
      return parsed;
    }
  }
  return DEFAULT_MAX_LOSS;
}

function resolveSidPath(hvscPath: string, sidPath: string): string {
  return path.isAbsolute(sidPath)
    ? path.normalize(sidPath)
    : path.join(hvscPath, sidPath);
}

function createOrchestrator(
  config: Awaited<ReturnType<typeof loadConfig>>,
  targetDurationMs: number,
  maxLossRate: number
): RenderOrchestrator {
  const ultimateConfig = config.render?.ultimate64;
  let ultimate64Client: Ultimate64Client | undefined;
  let ultimate64Capture: Ultimate64AudioCapture | undefined;

  if (ultimateConfig) {
    ultimate64Client = new Ultimate64Client({
      host: ultimateConfig.host,
      https: ultimateConfig.https,
      password: ultimateConfig.password,
    });
    ultimate64Capture = new Ultimate64AudioCapture({
      port: ultimateConfig.audioPort ?? 11001,
      targetDurationMs,
      maxLossRate,
    });
  }

  const hvscRoot = path.resolve(config.hvscPath);
  const availabilityManifestPath = config.availability?.manifestPath
    ? path.resolve(config.availability.manifestPath)
    : undefined;
  const availabilityAssetRoot = config.availability?.assetRoot
    ? path.resolve(config.availability.assetRoot)
    : undefined;

  return new RenderOrchestrator({
    ultimate64Client,
    ultimate64Capture,
    sidplayfpCliPath: config.sidplayPath,
    ultimate64AudioPort: ultimateConfig?.audioPort,
    ultimate64StreamIp: ultimateConfig?.streamIp,
    hvscRoot,
    availabilityManifestPath,
    availabilityAssetRoot,
    availabilityPublicBaseUrl: config.availability?.publicBaseUrl,
  });
}

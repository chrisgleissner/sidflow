/**
 * Admin API: Render execution endpoint
 * POST: Execute a render job
 */

import { NextRequest, NextResponse } from "next/server";
import { RenderOrchestrator } from "@sidflow/classify/render/render-orchestrator";
import { loadConfig } from "@sidflow/common";
import path from "node:path";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sidPath, engine, formats, chip, songIndex, outputDir } = body;

    if (!sidPath || !engine || !formats) {
      return NextResponse.json(
        { error: "Missing required fields: sidPath, engine, formats" },
        { status: 400 }
      );
    }

    const config = await loadConfig();
    const resolvedOutputDir = outputDir || path.join(config.wavCachePath, "rendered");

    const orchestrator = new RenderOrchestrator({
      // Ultimate 64 config would go here if configured
    });

    // Check engine availability
    const availability = await orchestrator.checkEngineAvailability(engine);
    if (!availability.available) {
      return NextResponse.json(
        { error: `Engine ${engine} not available: ${availability.reason}` },
        { status: 400 }
      );
    }

    // Execute render
    const result = await orchestrator.render({
      sidPath,
      outputDir: resolvedOutputDir,
      engine,
      formats,
      chip,
      songIndex,
    });

    return NextResponse.json({
      success: !result.errors || result.errors.length === 0,
      result,
    });
  } catch (error) {
    console.error("Failed to execute render:", error);
    return NextResponse.json(
      { error: "Failed to execute render", details: String(error) },
      { status: 500 }
    );
  }
}

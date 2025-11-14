import { NextResponse } from "next/server";
import { loadConfig, loadAvailabilityManifest } from "@sidflow/common";
import { stat, access } from "node:fs/promises";
import { constants } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Health check endpoints for observability
 * Checks status of: WASM readiness, sidplayfp binary, streaming assets, Ultimate 64
 */

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  details?: Record<string, unknown>;
}

interface SystemHealth {
  overall: "healthy" | "degraded" | "unhealthy";
  timestamp: number;
  checks: {
    wasm: HealthStatus;
    sidplayfpCli: HealthStatus;
    streamingAssets: HealthStatus;
    ultimate64?: HealthStatus;
  };
}

export async function GET() {
  const checks: {
    wasm: HealthStatus;
    sidplayfpCli: HealthStatus;
    streamingAssets: HealthStatus;
    ultimate64?: HealthStatus;
  } = {
    wasm: await checkWasmReadiness(),
    sidplayfpCli: await checkSidplayfpCli(),
    streamingAssets: await checkStreamingAssets(),
  };

  // Check Ultimate 64 if configured
  try {
    const config = await loadConfig();
    if (config.render?.ultimate64?.host) {
      checks.ultimate64 = await checkUltimate64(config.render.ultimate64);
    }
  } catch {
    // Config loading failed or Ultimate 64 not configured
  }

  // Determine overall health
  const statuses = Object.values(checks).map((c) => c.status);
  let overall: "healthy" | "degraded" | "unhealthy" = "healthy";

  if (statuses.includes("unhealthy")) {
    overall = "unhealthy";
  } else if (statuses.includes("degraded")) {
    overall = "degraded";
  }

  const health: SystemHealth = {
    overall,
    timestamp: Date.now(),
    checks,
  };

  const httpStatus = overall === "healthy" ? 200 : overall === "degraded" ? 200 : 503;

  return NextResponse.json(health, {
    status: httpStatus,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

async function checkWasmReadiness(): Promise<HealthStatus> {
  try {
    // Check if WASM files are accessible
    const wasmPath = "public/wasm/sidplayfp.wasm";

    try {
      await access(wasmPath, constants.R_OK);
      const stats = await stat(wasmPath);

      if (stats.size === 0) {
        return {
          status: "unhealthy",
          message: "WASM file is empty",
        };
      }

      return {
        status: "healthy",
        details: { sizeBytes: stats.size },
      };
    } catch {
      return {
        status: "degraded",
        message: "WASM file not found (will be generated on first use)",
      };
    }
  } catch (error) {
    return {
      status: "unhealthy",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkSidplayfpCli(): Promise<HealthStatus> {
  try {
    const config = await loadConfig();
    const sidplayPath = config.sidplayPath;

    if (!sidplayPath) {
      return {
        status: "degraded",
        message: "sidplayfp CLI not configured (optional feature)",
      };
    }

    try {
      await access(sidplayPath, constants.X_OK);

      // Try to execute --version
      try {
        const { stdout } = await execAsync(`"${sidplayPath}" --version`);
        const version = stdout.trim().split("\n")[0];

        return {
          status: "healthy",
          details: { version, path: sidplayPath },
        };
      } catch {
        return {
          status: "degraded",
          message: "sidplayfp binary found but version check failed",
          details: { path: sidplayPath },
        };
      }
    } catch {
      return {
        status: "degraded",
        message: "sidplayfp binary not executable",
        details: { path: sidplayPath },
      };
    }
  } catch (error) {
    return {
      status: "degraded",
      message: "sidplayfp CLI not configured (optional)",
    };
  }
}

async function checkStreamingAssets(): Promise<HealthStatus> {
  try {
    const config = await loadConfig();
    const manifestPath = "data/sidflow.lance.manifest.json";

    try {
      const manifest = await loadAvailabilityManifest(manifestPath);

      if (!manifest || !manifest.assets || manifest.assets.length === 0) {
        return {
          status: "degraded",
          message: "No streaming assets available yet",
        };
      }

      return {
        status: "healthy",
        details: {
          assetCount: manifest.assets.length,
          version: manifest.version,
        },
      };
    } catch {
      return {
        status: "degraded",
        message: "Availability manifest not found (no assets rendered yet)",
      };
    }
  } catch (error) {
    return {
      status: "unhealthy",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkUltimate64(config: {
  host: string;
  port?: number;
}): Promise<HealthStatus> {
  try {
    const host = config.host;
    const port = config.port ?? 64;

    // Try to connect to Ultimate 64 REST API
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000); // 2s timeout

      const response = await fetch(`http://${host}:${port}/v1/status`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        return {
          status: "healthy",
          details: { host, port, connected: true, data },
        };
      } else {
        return {
          status: "degraded",
          message: `Ultimate 64 returned HTTP ${response.status}`,
          details: { host, port },
        };
      }
    } catch (error) {
      return {
        status: "degraded",
        message: `Cannot connect to Ultimate 64 at ${host}:${port}`,
        details: {
          host,
          port,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  } catch (error) {
    return {
      status: "unhealthy",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

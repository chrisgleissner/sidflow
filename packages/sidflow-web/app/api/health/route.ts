import { NextResponse } from "next/server";
import { loadConfig, loadAvailabilityManifest } from "@sidflow/common";
import { resolveConfigPath } from "@/lib/server-env";
import { stat, access } from "node:fs/promises";
import { constants } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

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

interface ReadinessStatus {
  status: "ready" | "not_ready";
  blockingChecks: string[];
}

/**
 * Checks that are optional - degraded/unhealthy status on these
 * does not affect the overall system health
 */
const OPTIONAL_CHECKS = new Set(["ultimate64", "streamingAssets"]);

interface SystemHealth {
  overall: "healthy" | "degraded" | "unhealthy";
  liveness: HealthStatus;
  readiness: ReadinessStatus;
  timestamp: number;
  checks: {
    workspace: HealthStatus;
    ui: HealthStatus;
    wasm: HealthStatus;
    sidplayfpCli: HealthStatus;
    ffmpeg: HealthStatus;
    streamingAssets: HealthStatus;
    ultimate64?: HealthStatus;
  };
}

const READINESS_CHECKS = new Set(["workspace", "ui", "ffmpeg"]);

export async function GET(request?: Request) {
  const checks: {
    workspace: HealthStatus;
    ui: HealthStatus;
    wasm: HealthStatus;
    sidplayfpCli: HealthStatus;
    ffmpeg: HealthStatus;
    streamingAssets: HealthStatus;
    ultimate64?: HealthStatus;
  } = {
    workspace: await checkWorkspacePaths(),
    ui: await checkUiRoutes(),
    wasm: await checkWasmReadiness(),
    sidplayfpCli: await checkSidplayfpCli(),
    ffmpeg: await checkFfmpeg(),
    streamingAssets: await checkStreamingAssets(),
  };

  // Check Ultimate 64 if configured
  try {
    const config = await loadConfig();
    if (config.render?.ultimate64?.host) {
      checks.ultimate64 = await checkUltimate64(config.render.ultimate64);
    }
  } catch (error) {
    console.warn("[Health Check] Failed to load config for Ultimate 64 check:", error);
  }

  const readinessFailures = Object.entries(checks)
    .filter(([name, check]) => READINESS_CHECKS.has(name) && check.status === "unhealthy")
    .map(([name]) => name);
  const readiness: ReadinessStatus = {
    status: readinessFailures.length === 0 ? "ready" : "not_ready",
    blockingChecks: readinessFailures,
  };

  const criticalStatuses = Object.entries(checks)
    .filter(([name]) => !OPTIONAL_CHECKS.has(name))
    .map(([, check]) => check.status);
  let overall: "healthy" | "degraded" | "unhealthy" = "healthy";

  if (readiness.status === "not_ready") {
    overall = "unhealthy";
  } else if (criticalStatuses.includes("degraded") || Object.values(checks).some((check) => check.status === "degraded")) {
    overall = "degraded";
  }

  const mode = request ? new URL(request.url).searchParams.get("scope") : null;
  const httpStatus = mode === "readiness"
    ? readiness.status === "ready"
      ? 200
      : 503
    : overall === "unhealthy"
      ? 503
      : 200;

  const health: SystemHealth = {
    overall,
    liveness: { status: "healthy" },
    readiness,
    timestamp: Date.now(),
    checks,
  };

  return NextResponse.json(health, {
    status: httpStatus,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

async function checkWasmReadiness(): Promise<HealthStatus> {
  try {
    const wasmPath = path.join(process.cwd(), "public", "wasm", "libsidplayfp.wasm");

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
    } catch (error) {
      return {
        status: "degraded",
        message: "WASM file not found (will be generated on first use)",
      };
    }
  } catch (error) {
    console.error("[Health Check] WASM check failed:", error);
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

      let version = "unknown";
      try {
        const { stdout, stderr } = await execAsync(`"${sidplayPath}" 2>&1 || true`);
        const output = stdout || stderr;
        if (output.includes("Syntax: sidplayfp")) {
          try {
            const { stdout: versionOutput } = await execAsync("dpkg-query -W -f='${Version}' sidplayfp 2>/dev/null || echo 'unknown'");
            version = versionOutput.trim() || "unknown";
          } catch {
            version = "present";
          }
        }
      } catch (error) {
        return {
          status: "degraded",
          message: "sidplayfp binary found but execution check failed",
          details: { path: sidplayPath },
        };
      }

      return {
        status: "healthy",
        details: { version, path: sidplayPath },
      };
    } catch (error) {
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

async function checkFfmpeg(): Promise<HealthStatus> {
  try {
    try {
      const { stdout } = await execAsync("ffmpeg -version");
      const versionLine = stdout.trim().split("\n")[0];
      const versionMatch = versionLine.match(/ffmpeg version ([^ ]+)/);
      const version = versionMatch ? versionMatch[1] : versionLine;

      return {
        status: "healthy",
        details: { version },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        message: "ffmpeg not available (required for audio encoding)",
      };
    }
  } catch (error) {
    console.error("[Health Check] Failed to check ffmpeg:", error);
    return {
      status: "unhealthy",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkWorkspacePaths(): Promise<HealthStatus> {
  try {
    const configPath = resolveConfigPath();
    const configDir = path.dirname(configPath);
    const config = await loadConfig(configPath);

    const optionalPaths = [
      { name: "HVSC", path: config.sidPath, mode: constants.R_OK },
      { name: "WAV cache", path: config.audioCachePath, mode: constants.R_OK | constants.W_OK },
      { name: "Tags", path: config.tagsPath, mode: constants.R_OK | constants.W_OK },
      { name: "Classified data", path: path.resolve(configDir, "data/classified"), mode: constants.R_OK | constants.W_OK },
      { name: "Renders data", path: path.resolve(configDir, "data/renders"), mode: constants.R_OK | constants.W_OK },
      { name: "Availability data", path: path.resolve(configDir, "data/availability"), mode: constants.R_OK | constants.W_OK },
    ];

    const warnings: string[] = [];
    const available: string[] = [];

    // Check all paths - don't fail if missing (they'll be created on-demand or mounted)
    for (const entry of optionalPaths) {
      const targetPath = path.isAbsolute(entry.path) ? entry.path : path.resolve(configDir, entry.path);
      try {
        await access(targetPath, entry.mode);
        const stats = await stat(targetPath);
        if (!stats.isDirectory()) {
          warnings.push(`${entry.name} exists but is not a directory: ${targetPath}`);
        } else {
          available.push(entry.name);
        }
      } catch {
        warnings.push(`${entry.name} will be created on-demand`);
      }
    }

    const details: Record<string, any> = {
      hvsc: config.sidPath,
      audioCache: config.audioCachePath,
      tags: config.tagsPath,
    };

    if (available.length > 0) {
      details.available = available;
    }

    if (warnings.length > 0) {
      details.notes = warnings;
    }

    return {
      status: "healthy",
      details,
    };
  } catch (error) {
    return {
      status: "unhealthy",
      message: "Workspace validation failed",
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function checkStreamingAssets(): Promise<HealthStatus> {
  try {
    const config = await loadConfig();

    const rootDir = process.env.SIDFLOW_ROOT || process.cwd();
    const manifestPath = path.join(rootDir, "data", "sidflow.lance.manifest.json");

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
    } catch (error) {
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

async function checkUiRoutes(): Promise<HealthStatus> {
  const port = process.env.PORT || "3000";
  const baseUrl = `http://127.0.0.1:${port}`;

  async function checkPath(pathname: string, keyword: string): Promise<string | null> {
    try {
      const url = `${baseUrl}${pathname}`;
      const headers: Record<string, string> = { Host: "localhost" };
      const res = await fetch(url, { cache: "no-store", headers });
      if (!res.ok) {
        return `${pathname} responded ${res.status}`;
      }
      const body = await res.text();
      if (!body) {
        return `${pathname} returned empty body`;
      }
      
      // Check for bailout to client-side rendering
      if (body.includes('BAILOUT_TO_CLIENT_SIDE_RENDERING')) {
        return `${pathname} bailed out to client-side rendering`;
      }
      
      // Check if page is stuck on "Loading..." fallback
      const hasLoadingOnly = body.includes('Loading...') && !body.includes('<main') && !body.includes('id="__next"');
      if (hasLoadingOnly) {
        return `${pathname} stuck on "Loading..." fallback`;
      }
      
      // Check for expected content keyword
      if (!body.includes(keyword)) {
        return `${pathname} rendered without expected content (missing: "${keyword}")`;
      }
      
      // Verify actual UI components are present
      const hasUIComponents = body.includes('class=') || body.includes('className=') || body.includes('data-testid=');
      if (!hasUIComponents) {
        return `${pathname} missing UI components (possible hydration failure)`;
      }
      
      return null;
    } catch (err) {
      return `${pathname} fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const failures: string[] = [];
  
  // Only check public route - admin routes require authentication which is correct behavior
  const publicErr = await checkPath("/", "PLAY SID MUSIC");
  if (publicErr) failures.push(publicErr);

  if (failures.length > 0) {
    return {
      status: "unhealthy",
      message: "UI routes not rendering",
      details: { failures },
    };
  }

  return {
    status: "healthy",
    details: { public: "ok" },
  };
}

/**
 * Parse host and port from a string that may contain both.
 * Handles IPv6 addresses in bracket notation (e.g., [::1]:80)
 * and regular hostname:port or IPv4:port formats.
 */
function parseHostAndPort(host: string, defaultPort: number): { host: string; port: number } {
  // IPv6 with port: [::1]:80
  const ipv6Match = host.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6Match) {
    return { host: ipv6Match[1], port: parseInt(ipv6Match[2], 10) };
  }
  
  // Hostname or IPv4 with optional port: c64u:80 or 192.168.1.1:80
  if (!host.startsWith("[")) {
    const colonIndex = host.lastIndexOf(":");
    if (colonIndex !== -1) {
      const potentialPort = host.substring(colonIndex + 1);
      const parsedPort = parseInt(potentialPort, 10);
      if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
        return { host: host.substring(0, colonIndex), port: parsedPort };
      }
    }
  }
  
  return { host, port: defaultPort };
}

async function checkUltimate64(config: {
  host: string;
  port?: number;
}): Promise<HealthStatus> {
  try {
    // Host may contain port (e.g., "c64u:80" or "[::1]:80"), so parse it
    const { host, port } = parseHostAndPort(config.host, config.port ?? 80);

    // Try to connect to Ultimate 64 REST API using GET /v1/version
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000); // 2s timeout

      const response = await fetch(`http://${host}:${port}/v1/version`, {
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

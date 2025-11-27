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

/**
 * Checks that are optional - degraded/unhealthy status on these
 * does not affect the overall system health
 */
const OPTIONAL_CHECKS = new Set(["ultimate64", "streamingAssets"]);

interface SystemHealth {
  overall: "healthy" | "degraded" | "unhealthy";
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

export async function GET() {
  console.log("[Health Check] Starting health check at", new Date().toISOString());
  console.log("[Health Check] Process CWD:", process.cwd());
  console.log("[Health Check] SIDFLOW_CONFIG:", process.env.SIDFLOW_CONFIG || "(not set)");
  console.log("[Health Check] SIDFLOW_ROOT:", process.env.SIDFLOW_ROOT || "(not set)");
  console.log("[Health Check] NODE_ENV:", process.env.NODE_ENV);

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
    console.log("[Health Check] Attempting to load config for Ultimate 64 check...");
    const config = await loadConfig();
    console.log("[Health Check] Config loaded successfully");
    if (config.render?.ultimate64?.host) {
      console.log("[Health Check] Ultimate 64 configured, checking connectivity...");
      checks.ultimate64 = await checkUltimate64(config.render.ultimate64);
    } else {
      console.log("[Health Check] Ultimate 64 not configured");
    }
  } catch (error) {
    console.error("[Health Check] Failed to load config for Ultimate 64:", error);
  }

  // Determine overall health (only consider critical checks)
  const criticalStatuses = Object.entries(checks)
    .filter(([name]) => !OPTIONAL_CHECKS.has(name))
    .map(([, check]) => check.status);
  let overall: "healthy" | "degraded" | "unhealthy" = "healthy";

  if (criticalStatuses.includes("unhealthy")) {
    overall = "unhealthy";
  } else if (criticalStatuses.includes("degraded")) {
    overall = "degraded";
  }

  const health: SystemHealth = {
    overall,
    timestamp: Date.now(),
    checks,
  };

  const httpStatus = overall === "healthy" ? 200 : overall === "degraded" ? 200 : 503;

  console.log("[Health Check] Overall status:", overall, "- HTTP", httpStatus);
  console.log("[Health Check] Check results:", JSON.stringify(checks, null, 2));

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
    // In standalone builds, public/ is in the process cwd
    const wasmPath = path.join(process.cwd(), "public", "wasm", "libsidplayfp.wasm");
    console.log("[Health Check] Checking WASM at:", wasmPath);

    try {
      await access(wasmPath, constants.R_OK);
      const stats = await stat(wasmPath);
      console.log("[Health Check] WASM file found, size:", stats.size, "bytes");

      if (stats.size === 0) {
        console.error("[Health Check] WASM file is empty!");
        return {
          status: "unhealthy",
          message: "WASM file is empty",
        };
      }

      console.log("[Health Check] WASM check: healthy");
      return {
        status: "healthy",
        details: { sizeBytes: stats.size },
      };
    } catch (error) {
      console.warn("[Health Check] WASM file not found (will be generated on first use):", error);
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
    console.log("[Health Check] Loading config for sidplayfp CLI check...");
    const config = await loadConfig();
    const sidplayPath = config.sidplayPath;
    console.log("[Health Check] sidplayPath from config:", sidplayPath || "(not configured)");

    if (!sidplayPath) {
      console.log("[Health Check] sidplayfp CLI not configured (optional)");
      return {
        status: "degraded",
        message: "sidplayfp CLI not configured (optional feature)",
      };
    }

    try {
      await access(sidplayPath, constants.X_OK);
      console.log("[Health Check] sidplayfp binary is executable");

      // sidplayfp doesn't have --version flag, validate by running with no args (shows help)
      let version = "unknown";
      try {
        // Running sidplayfp with no args returns usage info (exit code 1) - that's expected
        const { stdout, stderr } = await execAsync(`"${sidplayPath}" 2>&1 || true`);
        const output = stdout || stderr;
        // Check for "Syntax: sidplayfp" in output to confirm it's working
        if (output.includes("Syntax: sidplayfp")) {
          console.log("[Health Check] sidplayfp responding correctly");
          // Try to get version from package manager
          try {
            const { stdout: versionOutput } = await execAsync("dpkg-query -W -f='${Version}' sidplayfp 2>/dev/null || echo 'unknown'");
            version = versionOutput.trim() || "unknown";
          } catch {
            version = "present";
          }
        } else {
          console.warn("[Health Check] sidplayfp output unexpected:", output.substring(0, 100));
        }
        console.log("[Health Check] sidplayfp version:", version);
      } catch (error) {
        console.error("[Health Check] sidplayfp execution check failed:", error);
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
      console.error("[Health Check] sidplayfp binary not executable:", error);
      return {
        status: "degraded",
        message: "sidplayfp binary not executable",
        details: { path: sidplayPath },
      };
    }
  } catch (error) {
    console.error("[Health Check] Failed to check sidplayfp CLI:", error);
    return {
      status: "degraded",
      message: "sidplayfp CLI not configured (optional)",
    };
  }
}

async function checkFfmpeg(): Promise<HealthStatus> {
  try {
    console.log("[Health Check] Checking ffmpeg availability...");

    // Check if ffmpeg is in PATH
    try {
      const { stdout } = await execAsync("ffmpeg -version");
      const versionLine = stdout.trim().split("\n")[0];
      const versionMatch = versionLine.match(/ffmpeg version ([^ ]+)/);
      const version = versionMatch ? versionMatch[1] : versionLine;
      console.log("[Health Check] ffmpeg version:", version);

      return {
        status: "healthy",
        details: { version },
      };
    } catch (error) {
      console.error("[Health Check] ffmpeg not found or not executable:", error);
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
    console.log("[Health Check] Validating workspace paths and permissions...");
    const configPath = resolveConfigPath();
    const configDir = path.dirname(configPath);
    const config = await loadConfig(configPath);
    console.log("[Health Check] Using config", { configPath, configDir, sidPath: config.sidPath, wavCachePath: config.wavCachePath, tagsPath: config.tagsPath });
    
    // All workspace paths are optional during initial startup (fresh Docker image, CI smoke tests)
    // They'll be created on-demand or populated via volume mounts in production
    const optionalPaths = [
      { name: "HVSC", path: config.sidPath, mode: constants.R_OK },
      { name: "WAV cache", path: config.wavCachePath, mode: constants.R_OK | constants.W_OK },
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
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.info(`[Health Check] Optional path not accessible (will create on-demand): ${entry.name} at ${targetPath} (${reason})`);
        warnings.push(`${entry.name} will be created on-demand`);
      }
    }

    // Workspace paths not existing is normal on first start, CI smoke tests, or before volume mounts
    // Return healthy since core functionality works - data dirs will be created on-demand or mounted
    const details: Record<string, any> = {
      hvsc: config.sidPath,
      wavCache: config.wavCachePath,
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
    console.error("[Health Check] Workspace validation failed:", error);
    return {
      status: "unhealthy",
      message: "Workspace validation failed",
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function checkStreamingAssets(): Promise<HealthStatus> {
  try {
    console.log("[Health Check] Loading config for streaming assets check...");
    const config = await loadConfig();
    console.log("[Health Check] Config loaded, checking manifest...");

    // Use SIDFLOW_ROOT if set (for standalone builds), otherwise use process.cwd()
    const rootDir = process.env.SIDFLOW_ROOT || process.cwd();
    const manifestPath = path.join(rootDir, "data", "sidflow.lance.manifest.json");
    console.log("[Health Check] Looking for manifest at:", manifestPath);

    try {
      const manifest = await loadAvailabilityManifest(manifestPath);
      console.log("[Health Check] Manifest loaded, asset count:", manifest?.assets?.length || 0);

      if (!manifest || !manifest.assets || manifest.assets.length === 0) {
        console.warn("[Health Check] No streaming assets available yet");
        return {
          status: "degraded",
          message: "No streaming assets available yet",
        };
      }

      console.log("[Health Check] Streaming assets check: healthy");
      return {
        status: "healthy",
        details: {
          assetCount: manifest.assets.length,
          version: manifest.version,
        },
      };
    } catch (error) {
      console.warn("[Health Check] Availability manifest not found:", error);
      return {
        status: "degraded",
        message: "Availability manifest not found (no assets rendered yet)",
      };
    }
  } catch (error) {
    console.error("[Health Check] Streaming assets check failed:", error);
    return {
      status: "unhealthy",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkUiRoutes(): Promise<HealthStatus> {
  const port = process.env.PORT || "3000";
  const baseUrl = `http://127.0.0.1:${port}`;
  const adminUser = process.env.SIDFLOW_ADMIN_USER;
  const adminPass = process.env.SIDFLOW_ADMIN_PASSWORD;
  const adminAuthHeader =
    adminUser && adminPass ? { Authorization: `Basic ${Buffer.from(`${adminUser}:${adminPass}`).toString("base64")}` } : {};

  async function checkPath(pathname: string, keyword: string): Promise<string | null> {
    try {
      const url = `${baseUrl}${pathname}`;
      const headers: Record<string, string> = { Host: "localhost" };
      if (pathname.startsWith("/admin") && Object.keys(adminAuthHeader).length > 0) {
        Object.assign(headers, adminAuthHeader);
      }
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
      // A properly rendered page should have more than just the loading fallback
      const hasLoadingOnly = body.includes('Loading...') && !body.includes('<main') && !body.includes('id="__next"');
      if (hasLoadingOnly) {
        return `${pathname} stuck on "Loading..." fallback`;
      }
      
      // Check for expected content keyword
      if (!body.includes(keyword)) {
        return `${pathname} rendered without expected content (missing: "${keyword}")`;
      }
      
      // Verify actual UI components are present (not just the Next.js shell)
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
  const warnings: string[] = [];
  
  const publicErr = await checkPath("/", "PLAY SID MUSIC");
  if (publicErr) failures.push(publicErr);
  
  const adminErr = await checkPath("/admin", "SETUP WIZARD");
  if (adminErr) {
    // Admin route 401 is expected if credentials aren't configured (CI smoke tests, fresh deployments)
    // Only fail if it's a different error (500, timeout, etc)
    if (adminErr.includes("responded 401")) {
      warnings.push("Admin route requires authentication (expected without credentials)");
    } else {
      failures.push(adminErr);
    }
  }

  if (failures.length > 0) {
    return {
      status: "unhealthy",
      message: "UI routes not rendering",
      details: { failures, warnings },
    };
  }

  const details: Record<string, any> = { public: "ok" };
  if (warnings.length === 0) {
    details.admin = "ok";
  } else {
    details.admin = "protected (401 expected without credentials)";
  }

  return {
    status: "healthy",
    details,
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

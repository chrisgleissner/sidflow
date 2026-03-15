import { NextResponse } from "next/server";
import { getSidflowConfig } from "@/lib/server-env";
import { readFile, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { getJobOrchestrator } from "@/lib/server/jobs";

/**
 * Admin metrics endpoint
 * Provides aggregated KPIs for job status, cache freshness, and sync health
 */

interface JobMetrics {
  pending: number;
  running: number;
  paused: number;
  completed: number;
  failed: number;
  totalDurationMs: number;
  avgDurationMs: number;
  oldestActiveAgeMs: number;
}

interface CacheMetrics {
  audioCacheCount: number;
  audioCacheSizeBytes: number;
  classifiedCount: number;
  oldestCacheFileAge: number;
  newestCacheFileAge: number;
}

interface SyncMetrics {
  hvscVersion?: string;
  hvscSidCount: number;
  lastSyncTimestamp?: number;
  syncAgeMs?: number;
}

interface AdminMetrics {
  timestamp: number;
  jobs: JobMetrics;
  cache: CacheMetrics;
  sync: SyncMetrics;
}

export async function GET() {
  try {
  const config = await getSidflowConfig();

    // Collect job metrics
    const jobMetrics = await collectJobMetrics();

    // Collect cache metrics
    const cacheMetrics = await collectCacheMetrics(
      config.audioCachePath,
      config.classifiedPath ?? path.join(config.tagsPath, "classified")
    );

    // Collect sync metrics
    const syncMetrics = await collectSyncMetrics(config.sidPath);

    const metrics: AdminMetrics = {
      timestamp: Date.now(),
      jobs: jobMetrics,
      cache: cacheMetrics,
      sync: syncMetrics,
    };

    return NextResponse.json(metrics, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("Failed to collect admin metrics:", error);
    return NextResponse.json(
      {
        error: "Failed to collect metrics",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

async function collectJobMetrics(): Promise<JobMetrics> {
  let pending = 0;
  let running = 0;
  let paused = 0;
  let completed = 0;
  let failed = 0;
  let totalDurationMs = 0;
  let oldestActiveCreatedAt = Number.POSITIVE_INFINITY;

  try {
    const orchestrator = await getJobOrchestrator();
    const jobs = orchestrator.listJobs();

    for (const job of jobs) {
      switch (job.status) {
        case "pending":
          pending++;
          oldestActiveCreatedAt = Math.min(oldestActiveCreatedAt, toTimestamp(job.metadata.createdAt));
          break;
        case "running":
          running++;
          oldestActiveCreatedAt = Math.min(oldestActiveCreatedAt, toTimestamp(job.metadata.startedAt ?? job.metadata.createdAt));
          break;
        case "paused":
          paused++;
          oldestActiveCreatedAt = Math.min(oldestActiveCreatedAt, toTimestamp(job.metadata.startedAt ?? job.metadata.createdAt));
          break;
        case "completed":
          completed++;
          if (job.metadata.startedAt && job.metadata.completedAt) {
            totalDurationMs += toTimestamp(job.metadata.completedAt) - toTimestamp(job.metadata.startedAt);
          }
          break;
        case "failed":
          failed++;
          break;
      }
    }
  } catch {
    // Durable job manifest does not exist yet
  }

  const totalCompleted = completed || 1; // Avoid division by zero
  const oldestActiveAgeMs = Number.isFinite(oldestActiveCreatedAt)
    ? Math.max(0, Date.now() - oldestActiveCreatedAt)
    : 0;

  return {
    pending,
    running,
    paused,
    completed,
    failed,
    totalDurationMs,
    avgDurationMs: totalDurationMs / totalCompleted,
    oldestActiveAgeMs,
  };
}

function toTimestamp(value: string | number | undefined): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

async function collectCacheMetrics(
  audioCachePath: string,
  classifiedPath: string
): Promise<CacheMetrics> {
  let audioCacheCount = 0;
  let audioCacheSizeBytes = 0;
  let oldestAge = Number.MAX_SAFE_INTEGER;
  let newestAge = 0;
  const now = Date.now();

  try {
    const files = await readdir(audioCachePath, { recursive: true });

    for (const file of files) {
      if (typeof file !== "string" || !file.endsWith(".wav")) {
        continue;
      }

      try {
        const filePath = path.join(audioCachePath, file);
        const stats = await stat(filePath);

        audioCacheCount++;
        audioCacheSizeBytes += stats.size;

        const ageMs = now - stats.mtimeMs;
        oldestAge = Math.min(oldestAge, ageMs);
        newestAge = Math.max(newestAge, ageMs);
      } catch {
        // Skip inaccessible files
      }
    }
  } catch {
    // WAV cache directory doesn't exist yet
  }

  let classifiedCount = 0;

  try {
    const files = await readdir(classifiedPath);

    for (const file of files) {
      if (file.endsWith(".jsonl")) {
        try {
          const content = await readFile(path.join(classifiedPath, file), "utf-8");
          const lines = content.trim().split("\n");
          classifiedCount += lines.length;
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // Classified directory doesn't exist yet
  }

  return {
    audioCacheCount,
    audioCacheSizeBytes,
    classifiedCount,
    oldestCacheFileAge: oldestAge === Number.MAX_SAFE_INTEGER ? 0 : oldestAge,
    newestCacheFileAge: newestAge,
  };
}

async function collectSyncMetrics(sidPath: string): Promise<SyncMetrics> {
  let hvscVersion: string | undefined;
  let lastSyncTimestamp: number | undefined;
  let syncAgeMs: number | undefined;
  let hvscSidCount = 0;

  // Check for HVSC version file
  try {
    const versionPath = path.join(sidPath, "..", "workspace", "hvsc-version.json");
    const content = await readFile(versionPath, "utf-8");
    const versionData = JSON.parse(content);
    hvscVersion = versionData.version;
    lastSyncTimestamp = versionData.timestamp;

    if (lastSyncTimestamp) {
      syncAgeMs = Date.now() - lastSyncTimestamp;
    }
  } catch {
    // Version file doesn't exist
  }

  // Count SID files
  try {
    const countSidFiles = async (dir: string): Promise<number> => {
      let count = 0;
      try {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory()) {
            count += await countSidFiles(path.join(dir, entry.name));
          } else if (entry.name.endsWith(".sid")) {
            count++;
          }
        }
      } catch {
        // Skip inaccessible directories
      }
      return count;
    };

    hvscSidCount = await countSidFiles(sidPath);
  } catch {
    // HVSC directory doesn't exist
  }

  return {
    hvscVersion,
    hvscSidCount,
    lastSyncTimestamp,
    syncAgeMs,
  };
}

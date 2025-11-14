#!/usr/bin/env bun
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  JobOrchestrator,
  createDefaultJobCommandFactory,
  JobQueueWorker,
  getDefaultAuditTrail,
} from "../packages/sidflow-common/src/index.ts";

async function main(): Promise<void> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const manifestPath = path.join(repoRoot, "data", "jobs", "manifest.json");

  const orchestrator = new JobOrchestrator({ manifestPath });
  await orchestrator.load();

  const worker = new JobQueueWorker({
    orchestrator,
    commandFactory: createDefaultJobCommandFactory({ repoRoot }),
    auditTrail: getDefaultAuditTrail(),
    pollIntervalMs: 2000,
  });

  worker.start();
  process.stdout.write("Job queue worker started. Press Ctrl+C to stop.\n");

  const shutdown = async () => {
    process.stdout.write("\nStopping job queue worker...\n");
    await worker.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();

import { createLogger } from "./logger.js";
import { JobRunner, type JobCommandFactory } from "./job-runner.js";
import type { JobDescriptor } from "./job-types.js";
import { JobOrchestrator } from "./job-orchestrator.js";
import type { AuditTrail } from "./audit-trail.js";

const queueLogger = createLogger("job-queue");

export interface JobQueueWorkerConfig {
  readonly orchestrator: JobOrchestrator;
  readonly commandFactory: JobCommandFactory;
  readonly auditTrail?: AuditTrail;
  readonly pollIntervalMs?: number;
}

export class JobQueueWorker {
  private readonly runner: JobRunner;
  private readonly auditTrail?: AuditTrail;
  private readonly pollIntervalMs: number;
  private running = false;
  private stopRequested = false;
  private loopPromise: Promise<void> | null = null;

  constructor(config: JobQueueWorkerConfig) {
    this.runner = new JobRunner({
      orchestrator: config.orchestrator,
      commandFactory: config.commandFactory,
    });
    this.auditTrail = config.auditTrail;
    this.pollIntervalMs = config.pollIntervalMs ?? 1000;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.stopRequested = true;
    await this.loopPromise;
    this.running = false;
    this.stopRequested = false;
    this.loopPromise = null;
  }

  private async loop(): Promise<void> {
    while (!this.stopRequested) {
      try {
        const job = await this.runner.processNextJob();
        if (job) {
          await this.logJobResult(job);
          continue;
        }
      } catch (error) {
        queueLogger.error("Job queue tick failed", error);
      }

      await delay(this.pollIntervalMs);
    }
  }

  private async logJobResult(job: JobDescriptor): Promise<void> {
    if (!this.auditTrail) {
      return;
    }

    if (job.status === "completed") {
      await this.auditTrail.logSuccess("job:update", "queue-runner", job.id, {
        status: job.status,
      });
    } else if (job.status === "failed") {
      await this.auditTrail.logFailure("job:update", "queue-runner", job.metadata.error ?? "Unknown error", job.id, {
        status: job.status,
      });
    }
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Job orchestration service for managing background tasks
 * Supports fetch, classify, train, and render jobs with persistence and resumability
 */

import { createLogger } from "./logger.js";
import { ensureDir } from "./fs.js";
import { stringifyDeterministic } from "./json.js";
import { readFile, writeFile } from "node:fs/promises";
import { pathExists } from "./fs.js";
import path from "node:path";
import type {
  JobDescriptor,
  JobManifest,
  JobMetadata,
  JobParams,
  JobStatus,
  JobType,
} from "./job-types.js";

const logger = createLogger("job-orchestrator");

export interface JobOrchestratorConfig {
  readonly manifestPath: string;
}

export class JobOrchestrator {
  private manifest: JobManifest;
  private readonly manifestPath: string;
  private readonly manifestDir: string;

  constructor(config: JobOrchestratorConfig) {
    this.manifestPath = config.manifestPath;
    this.manifestDir = path.dirname(this.manifestPath);
    this.manifest = {
      version: "1.0.0",
      jobs: {},
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Load job manifest from disk
   */
  async load(): Promise<void> {
    if (await pathExists(this.manifestPath)) {
      logger.debug(`Loading job manifest from ${this.manifestPath}`);
      const content = await readFile(this.manifestPath, "utf-8");
      this.manifest = JSON.parse(content) as JobManifest;
      logger.debug(`Loaded ${Object.keys(this.manifest.jobs).length} jobs`);
    } else {
      logger.debug("No existing job manifest found");
    }
  }

  /**
   * Save job manifest to disk
   */
  async save(): Promise<void> {
    await ensureDir(this.manifestDir);
    const updatedManifest = {
      ...this.manifest,
      lastUpdated: new Date().toISOString(),
    };
    this.manifest = updatedManifest;
    const content = stringifyDeterministic(updatedManifest as any);
    await writeFile(this.manifestPath, content, "utf-8");
    logger.debug(`Saved job manifest to ${this.manifestPath}`);
  }

  /**
   * Create a new job
   */
  async createJob(type: JobType, params: JobParams): Promise<JobDescriptor> {
    const id = this.generateJobId(type);
    const now = new Date().toISOString();

    const metadata: JobMetadata = {
      id,
      type,
      status: "pending",
      createdAt: now,
    };

    const job: JobDescriptor = {
      id,
      type,
      params,
      status: "pending",
      metadata,
    };

    this.manifest.jobs[id] = job;
    await this.save();

    logger.debug(`Created job ${id} (${type})`);
    return job;
  }

  /**
   * Get job by ID
   */
  getJob(id: string): JobDescriptor | null {
    return this.manifest.jobs[id] ?? null;
  }

  /**
   * List all jobs
   */
  listJobs(filters?: { type?: JobType; status?: JobStatus }): JobDescriptor[] {
    const jobs = Object.values(this.manifest.jobs);

    if (!filters) {
      return jobs;
    }

    return jobs.filter((job) => {
      if (filters.type && job.type !== filters.type) {
        return false;
      }
      if (filters.status && job.status !== filters.status) {
        return false;
      }
      return true;
    });
  }

  /**
   * Update job status
   */
  async updateJobStatus(
    id: string,
    status: JobStatus,
    updates?: Partial<JobMetadata>
  ): Promise<void> {
    const job = this.manifest.jobs[id];
    if (!job) {
      throw new Error(`Job ${id} not found`);
    }

    const now = new Date().toISOString();

    let updatedMetadata: JobMetadata = {
      ...job.metadata,
      ...updates,
      status,
    };

    // Set status-specific timestamps
    if (status === "running" && !updatedMetadata.startedAt) {
      updatedMetadata = { ...updatedMetadata, startedAt: now };
    } else if (status === "completed" && !updatedMetadata.completedAt) {
      updatedMetadata = { ...updatedMetadata, completedAt: now };
    } else if (status === "failed" && !updatedMetadata.failedAt) {
      updatedMetadata = { ...updatedMetadata, failedAt: now };
    } else if (status === "paused" && !updatedMetadata.pausedAt) {
      updatedMetadata = { ...updatedMetadata, pausedAt: now };
    }

    this.manifest.jobs[id] = {
      ...job,
      status,
      metadata: updatedMetadata,
    };

    await this.save();
    logger.debug(`Updated job ${id} status: ${status}`);
  }

  /**
   * Update job progress
   */
  async updateJobProgress(
    id: string,
    current: number,
    total: number,
    message?: string
  ): Promise<void> {
    const job = this.manifest.jobs[id];
    if (!job) {
      throw new Error(`Job ${id} not found`);
    }

    this.manifest.jobs[id] = {
      ...job,
      metadata: {
        ...job.metadata,
        progress: { current, total, message },
      },
    };

    await this.save();
  }

  /**
   * Mark job as failed
   */
  async failJob(id: string, error: string): Promise<void> {
    await this.updateJobStatus(id, "failed", { error });
  }

  /**
   * Delete a job
   */
  async deleteJob(id: string): Promise<void> {
    delete this.manifest.jobs[id];
    await this.save();
    logger.debug(`Deleted job ${id}`);
  }

  /**
   * Generate unique job ID
   */
  private generateJobId(type: JobType): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${type}-${timestamp}-${random}`;
  }

  /**
   * Get manifest statistics
   */
  getStatistics(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    paused: number;
  } {
    const jobs = Object.values(this.manifest.jobs);
    return {
      total: jobs.length,
      pending: jobs.filter((j) => j.status === "pending").length,
      running: jobs.filter((j) => j.status === "running").length,
      completed: jobs.filter((j) => j.status === "completed").length,
      failed: jobs.filter((j) => j.status === "failed").length,
      paused: jobs.filter((j) => j.status === "paused").length,
    };
  }
}

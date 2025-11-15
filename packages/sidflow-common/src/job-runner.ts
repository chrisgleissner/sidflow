import { spawn } from "node:child_process";
import type {
  BaseJobType,
  JobDescriptor,
  JobParams,
  JobType,
  PipelineJobParams,
  PipelineStage,
  RenderJobParams,
} from "./job-types.js";
import { JobOrchestrator } from "./job-orchestrator.js";
import { createLogger } from "./logger.js";

const runnerLogger = createLogger("job-runner");

export interface JobCommand {
  readonly command: string;
  readonly args?: string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface JobExecutionStage {
  readonly key: string;
  readonly type: BaseJobType;
  readonly command: JobCommand;
}

export interface JobExecutionPlan {
  readonly stages: JobExecutionStage[];
}

export type JobCommandFactory = (job: JobDescriptor) => JobExecutionPlan | null;

export interface JobRunnerConfig {
  readonly orchestrator: JobOrchestrator;
  readonly commandFactory: JobCommandFactory;
}

export class JobRunner {
  private readonly orchestrator: JobOrchestrator;
  private readonly commandFactory: JobCommandFactory;

  constructor(config: JobRunnerConfig) {
    this.orchestrator = config.orchestrator;
    this.commandFactory = config.commandFactory;
  }

  /**
   * Process the next available job (pending or paused).
   * Returns the processed job or null if no work was available.
   */
  async processNextJob(): Promise<JobDescriptor | null> {
    const nextJob = this.findNextJob();
    if (!nextJob) {
      return null;
    }

    const plan = this.commandFactory(nextJob);
    if (!plan || plan.stages.length === 0) {
      await this.orchestrator.failJob(
        nextJob.id,
        `No execution plan available for job type ${nextJob.type}`
      );
      return nextJob;
    }

    const stageNames = plan.stages.map((stage) => stage.key);
    const startingStageIndex = this.resolveResumeStageIndex(nextJob, plan);

    await this.orchestrator.updateJobStatus(nextJob.id, "running", {
      resumeData: {
        stageIndex: startingStageIndex,
        stages: stageNames,
      },
    });

    try {
      for (let index = startingStageIndex; index < plan.stages.length; index += 1) {
        const stage = plan.stages[index];

        await this.orchestrator.updateJobProgress(
          nextJob.id,
          index,
          plan.stages.length,
          `Running ${stage.key}`
        );

        await this.runCommand(stage.command, stage.type);

        await this.orchestrator.updateJobStatus(nextJob.id, "running", {
          resumeData: {
            stageIndex: index + 1,
            stages: stageNames,
          },
        });
      }

      await this.orchestrator.updateJobStatus(nextJob.id, "completed", {
        resumeData: undefined,
        error: undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.orchestrator.failJob(nextJob.id, message);
    }

    return this.orchestrator.getJob(nextJob.id);
  }

  private findNextJob(): JobDescriptor | null {
    const jobs = this.orchestrator.listJobs();
    const candidate = jobs.find(
      (job) =>
        job.status === "pending" ||
        job.status === "paused" ||
        (job.status === "failed" && this.canAutoResume(job))
    );
    return candidate ?? null;
  }

  private canAutoResume(job: JobDescriptor): boolean {
    if (!job.metadata.resumeData) {
      return false;
    }
    if (job.type !== "pipeline") {
      return false;
    }
    const params = job.params as PipelineJobParams;
    return params.allowResume !== false;
  }

  private resolveResumeStageIndex(job: JobDescriptor, plan: JobExecutionPlan): number {
    const resumeData = job.metadata.resumeData as { stageIndex?: number } | undefined;
    if (!resumeData || typeof resumeData.stageIndex !== "number") {
      return 0;
    }
    if (resumeData.stageIndex < 0) {
      return 0;
    }
    if (resumeData.stageIndex >= plan.stages.length) {
      return 0;
    }
    return resumeData.stageIndex;
  }

  private async runCommand(command: JobCommand, jobType: JobType | BaseJobType): Promise<void> {
    runnerLogger.info(
      `Starting ${jobType} job: ${command.command} ${(command.args ?? []).join(" ")}`
    );

    await new Promise<void>((resolve, reject) => {
      const child = spawn(command.command, command.args ?? [], {
        cwd: command.cwd,
        env: command.env,
        stdio: "inherit",
      });

      child.on("error", (error) => {
        runnerLogger.error(`Failed to start ${jobType} job`, error);
        reject(error);
      });

      child.on("close", (code) => {
        if (code === 0) {
          runnerLogger.info(`${jobType} job completed successfully`);
          resolve();
        } else {
          const message = `${jobType} job exited with code ${code}`;
          runnerLogger.warn(message);
          reject(new Error(message));
        }
      });
    });
  }
}

export interface DefaultJobCommandFactoryOptions {
  readonly repoRoot: string;
  readonly bunExecutable?: string;
}

/**
 * Default command factory that maps job types to the existing sidflow CLI wrappers.
 */
export function createDefaultJobCommandFactory(
  options: DefaultJobCommandFactoryOptions
): JobCommandFactory {
  const scriptForType: Record<BaseJobType, string> = {
    fetch: `${options.repoRoot}/scripts/sidflow-fetch`,
    classify: `${options.repoRoot}/scripts/sidflow-classify`,
    train: `${options.repoRoot}/scripts/sidflow-train`,
    render: `${options.repoRoot}/scripts/sidflow-render`,
  };

  return (job) => {
    if (job.type === "pipeline") {
      return buildPipelinePlan(job, scriptForType);
    }

    if (!isBaseJobType(job.type)) {
      return null;
    }

    const stage = buildSingleStage(job.type, job.params, scriptForType[job.type]);
    if (!stage) {
      return null;
    }

    return {
      stages: [stage],
    };
  };

  function buildFetchCommand(script: string, job: JobDescriptor): JobCommand {
    const args: string[] = [];
    const params = job.params as any;
    if (params.configPath) {
      args.push("--config", params.configPath);
    }
    if (params.remoteBaseUrl) {
      args.push("--remote", params.remoteBaseUrl);
    }
    if (params.hvscVersionPath) {
      args.push("--version-file", params.hvscVersionPath);
    }
    return { command: script, args };
  }

  function buildClassifyCommand(script: string, job: JobDescriptor): JobCommand {
    const args: string[] = [];
    const params = job.params as any;
    if (params.configPath) {
      args.push("--config", params.configPath);
    }
    if (params.forceRebuild) {
      args.push("--force-rebuild");
    }
    return { command: script, args };
  }

  function buildTrainCommand(script: string, job: JobDescriptor): JobCommand {
    const args: string[] = [];
    const params = job.params as any;
    if (params.configPath) {
      args.push("--config", params.configPath);
    }
    if (typeof params.epochs === "number") {
      args.push("--epochs", String(params.epochs));
    }
    if (typeof params.batchSize === "number") {
      args.push("--batch-size", String(params.batchSize));
    }
    if (typeof params.learningRate === "number") {
      args.push("--learning-rate", String(params.learningRate));
    }
    if (params.evaluate === false) {
      args.push("--no-evaluate");
    }
    if (params.force) {
      args.push("--force");
    }
    return { command: script, args };
  }

  function buildRenderCommand(script: string, job: JobDescriptor): JobCommand {
    const args: string[] = [];
    const params = job.params as RenderJobParams;

    if (params.configPath) {
      args.push("--config", params.configPath);
    }
    if (params.engine) {
      args.push("--engine", params.engine);
    }
    if (params.preferredEngines?.length) {
      args.push("--prefer", params.preferredEngines.join(","));
    }
    if (params.formats?.length) {
      args.push("--formats", params.formats.join(","));
    }
    if (params.chip) {
      args.push("--chip", params.chip);
    }
    if (params.outputPath) {
      args.push("--output", params.outputPath);
    }
    if (typeof params.targetDurationMs === "number") {
      const seconds = Math.max(1, Math.round(params.targetDurationMs / 1000));
      args.push("--target-duration", String(seconds));
    }
    if (typeof params.maxLossRate === "number") {
      args.push("--max-loss", params.maxLossRate.toString());
    }
    if (params.sidPaths?.length) {
      for (const sidPath of params.sidPaths) {
        args.push("--sid", sidPath);
      }
    }
    if (params.sidListFile) {
      args.push("--sid-file", params.sidListFile);
    }

    return { command: script, args };
  }

  function buildPipelinePlan(
    job: JobDescriptor,
    scripts: Record<BaseJobType, string>
  ): JobExecutionPlan | null {
    const params = job.params as PipelineJobParams;
    if (!params.stages || params.stages.length === 0) {
      return null;
    }

    const stages: JobExecutionStage[] = [];
    for (let index = 0; index < params.stages.length; index += 1) {
      const stageDef = params.stages[index] as PipelineStage;
      if (!isBaseJobType(stageDef.type)) {
        continue;
      }
      const script = scripts[stageDef.type];
      if (!script) {
        continue;
      }

      const derivedParams = {
        ...(stageDef.params ?? {}),
      } as JobParams;

      const stage = buildSingleStage(stageDef.type, derivedParams, script, stageDef.label);
      if (stage) {
        stages.push(stage);
      }
    }

    if (stages.length === 0) {
      return null;
    }

    return { stages };
  }

  function buildSingleStage(
    type: BaseJobType,
    params: JobParams,
    script: string,
    label?: string
  ): JobExecutionStage | null {
    let command: JobCommand | null = null;
    const descriptor: JobDescriptor = {
      id: "pipeline",
      type,
      params,
      status: "pending",
      metadata: {
        id: "pipeline",
        type,
        status: "pending",
        createdAt: new Date().toISOString(),
      },
    };

    switch (type) {
      case "fetch":
        command = buildFetchCommand(script, descriptor);
        break;
      case "classify":
        command = buildClassifyCommand(script, descriptor);
        break;
      case "train":
        command = buildTrainCommand(script, descriptor);
        break;
      case "render":
        command = buildRenderCommand(script, descriptor);
        break;
      default:
        command = null;
    }

    if (!command) {
      return null;
    }

    return {
      key: label ?? `${type.toUpperCase()} stage`,
      type,
      command,
    };
  }
}

function isBaseJobType(type: JobType): type is BaseJobType {
  return type === "fetch" || type === "classify" || type === "train" || type === "render";
}

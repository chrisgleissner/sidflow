import fs from "node:fs/promises";
import path from "node:path";
import { stringifyDeterministic, type JsonValue } from "@sidflow/common";
import { DEFAULT_JOURNEY_DIR, DEFAULT_RESULTS_ROOT, DEFAULT_TMP_ROOT, K6_USER_VARIANTS, PLAYWRIGHT_USER_VARIANTS } from "./constants.js";
import { loadJourneysFromDir } from "./journey-loader.js";
import { buildK6ScriptPath, generateK6ScriptContent } from "./k6-executor.js";
import { buildPlaywrightScriptPath, generatePlaywrightScriptContent } from "./playwright-executor.js";
import {
  type ExecutorKind,
  type GeneratedScript,
  type JourneySpec,
  type RunnerArtifacts,
  type RunnerEnvironment,
  type UserVariants
} from "./types.js";

export interface RunnerOptions {
  journeyDir?: string;
  resultsRoot?: string;
  tmpRoot?: string;
  environment: RunnerEnvironment;
  executors?: ExecutorKind[];
  journeyFilter?: string[];
  userVariants?: Partial<UserVariants>;
  execute?: boolean;
  reporter?: (line: string) => void;
  commandRunner?: (script: GeneratedScript) => Promise<void>;
  maxErrorRate?: number;
  playwrightRetries?: number;
}

export async function runUnifiedPerformance(options: RunnerOptions): Promise<RunnerArtifacts> {
  const journeyDir = path.resolve(options.journeyDir ?? DEFAULT_JOURNEY_DIR);
  const resultsRoot = path.resolve(options.resultsRoot ?? DEFAULT_RESULTS_ROOT);
  const tmpRoot = path.resolve(options.tmpRoot ?? DEFAULT_TMP_ROOT);
  const executors = options.executors ?? ["playwright", "k6"];
  const reporter = options.reporter ?? (() => {});
  let userVariants: UserVariants = {
    playwright: options.userVariants?.playwright ?? PLAYWRIGHT_USER_VARIANTS,
    k6: options.userVariants?.k6 ?? K6_USER_VARIANTS
  };

  if (options.environment.kind === "local") {
    userVariants = {
      playwright: [1],
      k6: [1]
    };
  }

  validateEnvironment(options.environment);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "-").slice(0, 15);
  const runRoot = path.join(resultsRoot, timestamp);
  await mkdirp(runRoot);
  await mkdirp(path.join(tmpRoot, timestamp));

  const journeys = await loadJourneysFromDir(journeyDir, { pacingSeconds: options.environment.pacingSeconds });
  const filteredJourneys = options.journeyFilter?.length
    ? journeys.filter((j) => options.journeyFilter?.includes(j.id))
    : journeys;

  if (!filteredJourneys.length) {
    throw new Error("No journeys found to run");
  }

  const scripts: GeneratedScript[] = [];

  for (const journey of filteredJourneys) {
    await copyJourneySpec(journey, runRoot);

    if (executors.includes("playwright")) {
      scripts.push(
        ...(await generatePlaywrightArtifacts({
          journey,
          environment: options.environment,
          tmpRoot,
          runRoot,
          timestamp,
          users: userVariants.playwright
        }))
      );
    }

    if (executors.includes("k6")) {
      scripts.push(
        ...(await generateK6Artifacts({
          journey,
          environment: options.environment,
          tmpRoot,
          runRoot,
          timestamp,
          users: userVariants.k6
        }))
      );
    }
  }

  const maxErrorRate = options.maxErrorRate ?? (options.environment.kind === "local" ? 1 : 0.05);

  if (options.execute) {
    for (const script of scripts) {
      const retries = script.executor === "playwright" ? options.playwrightRetries ?? 0 : 0;
      await runCommandWithRetries(script, retries, options.commandRunner);
    }
    await evaluateK6Slo(scripts, maxErrorRate);
  }

  const k6Metrics = await collectK6Metrics(scripts);
  await writeSummary(runRoot, scripts, timestamp, k6Metrics);
  const reportPath = await writeReport(runRoot, scripts, timestamp, k6Metrics);

  reporter(`Generated ${scripts.length} scripts under ${runRoot}`);

  return {
    timestamp,
    resultRoot: runRoot,
    summaryPath: path.join(runRoot, "summary", "summary.json"),
    reportPath,
    scripts
  };
}

function validateEnvironment(env: RunnerEnvironment) {
  if (env.kind === "remote" && !env.enableRemote) {
    throw new Error("Remote environment requested but enableRemote flag not set");
  }
}

async function copyJourneySpec(journey: JourneySpec, runRoot: string) {
  const target = path.join(runRoot, "journeys");
  await mkdirp(target);
  const output = path.join(target, `${journey.id}.json`);
  await fs.writeFile(output, stringifyDeterministic(journey as unknown as JsonValue));
}

async function generatePlaywrightArtifacts(params: {
  journey: JourneySpec;
  environment: RunnerEnvironment;
  tmpRoot: string;
  runRoot: string;
  timestamp: string;
  users: number[];
}): Promise<GeneratedScript[]> {
  const { journey, environment, tmpRoot, runRoot, timestamp, users } = params;
  const baseUrl = environment.baseUrl ?? "http://localhost:3000";
  const resultBase = path.join(runRoot, "playwright", journey.id);
  await mkdirp(resultBase);

  const generated: GeneratedScript[] = [];
  for (const u of users) {
    const scriptPath = buildPlaywrightScriptPath(tmpRoot, timestamp, journey.id, u);
    await mkdirp(path.dirname(scriptPath));
    const content = generatePlaywrightScriptContent(journey, {
      baseUrl,
      users: u,
      pacingSeconds: environment.pacingSeconds
    });
    await fs.writeFile(scriptPath, content);
    const resultDir = path.join(resultBase, `u${String(u).padStart(3, "0")}`);
    await mkdirp(resultDir);

    generated.push({
      executor: "playwright",
      journeyId: journey.id,
      users: u,
      scriptPath,
      resultDir,
      command: ["bun", "run", scriptPath],
      env: {
        BASE_URL: baseUrl,
        NODE_PATH: path.join(process.cwd(), "packages", "sidflow-performance", "node_modules")
      }
    });
  }

  return generated;
}

async function generateK6Artifacts(params: {
  journey: JourneySpec;
  environment: RunnerEnvironment;
  tmpRoot: string;
  runRoot: string;
  timestamp: string;
  users: number[];
}): Promise<GeneratedScript[]> {
  const { journey, environment, tmpRoot, runRoot, timestamp, users } = params;
  const baseUrl = environment.baseUrl ?? "http://localhost:3000";
  const iterations =
    environment.kind === "local"
      ? Math.min(Math.max(...users, 1), 3)
      : undefined;
  const strictThresholds = environment.kind !== "local";
  const resultBase = path.join(runRoot, "k6", journey.id);
  await mkdirp(resultBase);

  const generated: GeneratedScript[] = [];
  for (const u of users) {
    const scriptPath = buildK6ScriptPath(tmpRoot, timestamp, journey.id, u);
    await mkdirp(path.dirname(scriptPath));
    const content = generateK6ScriptContent(journey, {
      baseUrl,
      users: u,
      pacingSeconds: environment.pacingSeconds,
      iterations,
      strictThresholds
    });
    await fs.writeFile(scriptPath, content);
    const resultDir = path.join(resultBase, `u${String(u).padStart(3, "0")}`);
    await mkdirp(resultDir);

    const reportName = "report.html";
    generated.push({
      executor: "k6",
      journeyId: journey.id,
      users: u,
      scriptPath,
      resultDir,
      command: ["k6", "run", scriptPath],
      env: {
        BASE_URL: baseUrl,
        K6_WEB_DASHBOARD: "true",
        K6_WEB_DASHBOARD_EXPORT: path.join(resultDir, reportName),
        K6_SUMMARY_EXPORT: path.join(resultDir, "summary.json")
      }
    });
  }

  return generated;
}

async function writeSummary(
  runRoot: string,
  scripts: GeneratedScript[],
  timestamp: string,
  k6Metrics: Record<string, K6JourneyMetrics>
) {
  const summaryDir = path.join(runRoot, "summary");
  await mkdirp(summaryDir);

  const summary = {
    timestamp,
    scripts,
    k6Metrics
  };

  await fs.writeFile(path.join(summaryDir, "summary.json"), stringifyDeterministic(summary as unknown as JsonValue));
}

async function writeReport(
  runRoot: string,
  scripts: GeneratedScript[],
  timestamp: string,
  k6Metrics: Record<string, K6JourneyMetrics>
) {
  const report = [
    `# Performance Run ${timestamp}`,
    ``,
    `## Commands`,
    ``,
    ...scripts.map(
      (s) =>
        `- ${s.journeyId} (${s.executor} u${s.users}): \`${formatEnv(s.env)} ${s.command.join(
          " "
        )}\` → results at ${path.relative(runRoot, s.resultDir)}${formatK6Metrics(k6Metrics[`${s.journeyId}-u${s.users}`])}`
    )
  ].join("\n");

  const reportPath = path.join(runRoot, "report.md");
  await fs.writeFile(reportPath, report);
  return reportPath;
}

function formatEnv(env: Record<string, string | undefined>): string {
  const entries = Object.entries(env).filter(([, v]) => v !== undefined);
  if (!entries.length) return "";
  return entries.map(([k, v]) => `${k}=${v}`).join(" ");
}

async function mkdirp(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function runCommandWithRetries(
  script: GeneratedScript,
  retries: number,
  runner: RunnerOptions["commandRunner"]
) {
  let attempt = 0;
  const exec = runner ?? defaultCommandRunner;
  const normalizedScript = {
    ...script,
    resultDir: path.resolve(script.resultDir),
    scriptPath: path.resolve(script.scriptPath)
  };

  while (true) {
    try {
      await exec(normalizedScript);
      return;
    } catch (error) {
      attempt++;
      if (attempt > retries) {
        throw error;
      }
    }
  }
}

async function defaultCommandRunner(
  script: GeneratedScript
) {
  const [cmd, ...args] = script.command;
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: script.resultDir,
      env: { ...process.env, ...script.env },
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} exited with code ${code}`));
      }
    });
  });
}

async function evaluateK6Slo(scripts: GeneratedScript[], maxErrorRate: number) {
  const k6Scripts = scripts.filter((s) => s.executor === "k6");
  for (const script of k6Scripts) {
    const summaryPath = path.join(script.resultDir, "summary.json");
    try {
      const json = await readK6Summary(summaryPath);
      const rate = json?.metrics?.http_req_failed?.rate ?? json?.metrics?.http_req_failed?.value;
      if (typeof rate === "number" && rate > maxErrorRate) {
        throw new Error(
          `K6 error rate ${rate} exceeded threshold ${maxErrorRate} for ${script.journeyId} (u${script.users})`
        );
      }
    } catch (error: any) {
      // If summary is missing, surface the error to enforce completeness
      throw new Error(`Failed to evaluate k6 summary for ${script.journeyId}: ${error?.message ?? error}`);
    }
  }
}

type K6JourneyMetrics = {
  errorRate?: number;
  p95?: number;
  p99?: number;
  throughput?: number;
};

async function collectK6Metrics(scripts: GeneratedScript[]): Promise<Record<string, K6JourneyMetrics>> {
  const metrics: Record<string, K6JourneyMetrics> = {};
  for (const script of scripts.filter((s) => s.executor === "k6")) {
    const summaryPath = path.join(script.resultDir, "summary.json");
    try {
      const json = await readK6Summary(summaryPath);
      const journeyKey = `${script.journeyId}-u${script.users}`;
      metrics[journeyKey] = {
        errorRate: json?.metrics?.http_req_failed?.rate ?? json?.metrics?.http_req_failed?.value,
        p95: json?.metrics?.http_req_duration?.["p(95)"],
        p99: json?.metrics?.http_req_duration?.["p(99)"],
        throughput: json?.metrics?.http_reqs?.rate ?? json?.metrics?.http_reqs?.count
      };
    } catch {
      // Skip missing or malformed metrics; report still generated
    }
  }
  return metrics;
}

async function readK6Summary(summaryPath: string) {
  const raw = await fs.readFile(summaryPath, "utf8");
  return JSON.parse(raw);
}

function formatK6Metrics(metrics?: K6JourneyMetrics) {
  if (!metrics) return "";
  const parts = [];
  if (metrics.errorRate !== undefined) parts.push(`err=${metrics.errorRate}`);
  if (metrics.p95 !== undefined) parts.push(`p95=${metrics.p95}`);
  if (metrics.p99 !== undefined) parts.push(`p99=${metrics.p99}`);
  if (metrics.throughput !== undefined) parts.push(`rps=${metrics.throughput}`);
  return parts.length ? ` (k6: ${parts.join(", ")})` : "";
}

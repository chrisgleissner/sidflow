#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { loadConfig, resetConfigCache } from "../packages/sidflow-common/src/index.js";
import {
  DEFAULT_JOURNEY_DIR,
  DEFAULT_RESULTS_ROOT,
  DEFAULT_TMP_ROOT,
  runUnifiedPerformance,
  type ExecutorKind,
  type RunnerProfile
} from "../packages/sidflow-performance/src/index.js";

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      env: { type: "string", default: "local" },
      profile: { type: "string" },
      "base-url": { type: "string" },
      "enable-remote": { type: "boolean", default: false },
      executor: { type: "string", multiple: true },
      journey: { type: "string", multiple: true },
      pacing: { type: "string" },
      "k6-users": { type: "string", multiple: true },
      "playwright-users": { type: "string", multiple: true },
      "k6-journeys-per-vu": { type: "string" },
      "k6-max-error-rate": { type: "string" },
      "k6-max-p95-ms": { type: "string" },
      "k6-max-p99-ms": { type: "string" },
      results: { type: "string" },
      tmp: { type: "string" },
      execute: { type: "boolean", default: false }
    },
    strict: true,
    allowPositionals: false
  });

  const envKind = values.env as "local" | "ci" | "remote";
  const config = await loadConfig(values.config);
  resetConfigCache();

  const baseUrl =
    values["base-url"] ??
    config?.web?.baseUrl ??
    (envKind === "ci" ? "http://localhost:3000" : "http://localhost:3000");

  const executorStrings = values.executor ?? ["playwright", "k6"];

  // Validate that all executor strings are valid ExecutorKind values
  const validExecutors = new Set<string>(["playwright", "k6"]);
  
  function isExecutorKind(value: string): value is ExecutorKind {
    return validExecutors.has(value);
  }

  const executors = executorStrings.filter(isExecutorKind);

  if (executors.length !== executorStrings.length) {
    const invalid = executorStrings.filter(e => !isExecutorKind(e));
    throw new Error(`Invalid executor(s): ${invalid.join(", ")}. Valid options: ${Array.from(validExecutors).join(", ")}`);
  }

  const pacingSeconds = values.pacing ? Number(values.pacing) : undefined;
  const validProfiles = new Set<RunnerProfile>(["smoke", "reduced", "standard", "scale"]);
  const profileValue = values.profile as string | undefined;
  const profile = profileValue && validProfiles.has(profileValue as RunnerProfile) ? (profileValue as RunnerProfile) : undefined;
  if (profileValue && !profile) {
    throw new Error(`Invalid --profile ${profileValue}. Valid: ${Array.from(validProfiles).join(", ")}`);
  }

  const parseNumberList = (raw?: string[] | string): number[] | undefined => {
    const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (arr.length === 0) return undefined;
    const nums = arr
      .flatMap((entry) => entry.split(","))
      .map((v) => Number(v.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .map((n) => Math.floor(n));
    return nums.length ? nums : undefined;
  };

  const k6Users = parseNumberList(values["k6-users"]);
  const playwrightUsers = parseNumberList(values["playwright-users"]);
  const k6JourneysPerVu = values["k6-journeys-per-vu"] ? Number(values["k6-journeys-per-vu"]) : undefined;
  const maxErrorRate = values["k6-max-error-rate"] ? Number(values["k6-max-error-rate"]) : undefined;
  const maxP95Ms = values["k6-max-p95-ms"] ? Number(values["k6-max-p95-ms"]) : undefined;
  const maxP99Ms = values["k6-max-p99-ms"] ? Number(values["k6-max-p99-ms"]) : undefined;

  const result = await runUnifiedPerformance({
    journeyDir: DEFAULT_JOURNEY_DIR,
    resultsRoot: values.results ?? DEFAULT_RESULTS_ROOT,
    tmpRoot: values.tmp ?? DEFAULT_TMP_ROOT,
    environment: {
      kind: envKind,
      baseUrl,
      enableRemote: values["enable-remote"],
      pacingSeconds,
      profile
    },
    executors,
    journeyFilter: values.journey as string[] | undefined,
    userVariants: {
      k6: k6Users,
      playwright: playwrightUsers
    },
    k6JourneysPerVu,
    maxErrorRate,
    maxP95Ms,
    maxP99Ms,
    execute: values.execute,
    reporter: (msg) => console.log(msg)
  });

  console.log(`Report written to ${result.reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

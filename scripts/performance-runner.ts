#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { loadConfig, resetConfigCache } from "../packages/sidflow-common/src/index.js";
import {
  DEFAULT_JOURNEY_DIR,
  DEFAULT_RESULTS_ROOT,
  DEFAULT_TMP_ROOT,
  runUnifiedPerformance,
  type ExecutorKind
} from "../packages/sidflow-performance/src/index.js";

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      env: { type: "string", default: "local" },
      "base-url": { type: "string" },
      "enable-remote": { type: "boolean", default: false },
      executor: { type: "string", multiple: true },
      journey: { type: "string", multiple: true },
      pacing: { type: "string" },
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

  const result = await runUnifiedPerformance({
    journeyDir: DEFAULT_JOURNEY_DIR,
    resultsRoot: values.results ?? DEFAULT_RESULTS_ROOT,
    tmpRoot: values.tmp ?? DEFAULT_TMP_ROOT,
    environment: {
      kind: envKind,
      baseUrl,
      enableRemote: values["enable-remote"],
      pacingSeconds
    },
    executors,
    journeyFilter: values.journey as string[] | undefined,
    pacingSeconds,
    execute: values.execute,
    reporter: (msg) => console.log(msg)
  });

  console.log(`Report written to ${result.reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

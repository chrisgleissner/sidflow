#!/usr/bin/env bun
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { loadFeedback, formatOfflineEvaluationReport, loadClassificationEmbeddings, evaluateHybridCorpora, reportToJson } from "../packages/sidflow-train/src/index.js";

interface CliOptions {
  baselinePath: string;
  hybridPath: string;
  feedbackPath: string;
  outputPath?: string;
  json: boolean;
  holdoutFraction?: number;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const [baselineEmbeddings, hybridEmbeddings, feedbackEvents] = await Promise.all([
    loadClassificationEmbeddings(options.baselinePath),
    loadClassificationEmbeddings(options.hybridPath),
    loadFeedback(options.feedbackPath),
  ]);

  const report = evaluateHybridCorpora({
    baselineEmbeddings,
    hybridEmbeddings,
    feedbackEvents,
    holdoutFraction: options.holdoutFraction,
  });

  const rendered = options.json ? reportToJson(report) : formatOfflineEvaluationReport(report);
  process.stdout.write(rendered);

  if (options.outputPath) {
    const resolved = path.resolve(options.outputPath);
    await writeFile(resolved, rendered, "utf8");
  }

  process.exitCode = report.promote ? 0 : 1;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    baselinePath: "",
    hybridPath: "",
    feedbackPath: "data/feedback",
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    switch (arg) {
      case "--baseline":
        options.baselinePath = requireValue(argv, ++index, "--baseline");
        break;
      case "--hybrid":
        options.hybridPath = requireValue(argv, ++index, "--hybrid");
        break;
      case "--feedback":
        options.feedbackPath = requireValue(argv, ++index, "--feedback");
        break;
      case "--output":
        options.outputPath = requireValue(argv, ++index, "--output");
        break;
      case "--holdout":
        options.holdoutFraction = Number(requireValue(argv, ++index, "--holdout"));
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.baselinePath || !options.hybridPath) {
    throw new Error("Both --baseline and --hybrid are required");
  }

  return options;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: bun run scripts/evaluate-hybrid-similarity.ts --baseline <baseline.jsonl> --hybrid <hybrid.jsonl> [options]",
      "",
      "Options:",
      "  --feedback <path>   Feedback directory (default: data/feedback)",
      "  --output <path>     Write report to file",
      "  --holdout <0..1>    Holdout fraction override",
      "  --json              Emit JSON report",
      "  --help              Show this help",
      "",
      "The command exits with code 0 when the hybrid corpus meets the promotion rule, else 1.",
    ].join("\n") + "\n",
  );
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
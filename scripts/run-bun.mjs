#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { ensureBun } from "./ensure-bun.mjs";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    process.stderr.write("Usage: node scripts/run-bun.mjs <bun arguments...>\n");
    process.exit(1);
  }

  const isBunTest = args[0] === "test";

  const bunPath = await ensureBun();
  const bunDir = path.dirname(bunPath);
  const repoRoot = path.resolve(new URL("../", import.meta.url).pathname);

  const child = spawn(bunPath, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      PATH: `${bunDir}${path.delimiter}${process.env.PATH ?? ""}`,
      BUN_INSTALL: path.join(repoRoot, ".bun"),
      ...(isBunTest ? { SIDFLOW_MAX_THREADS: process.env.SIDFLOW_MAX_THREADS ?? "1" } : {})
    }
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(`Failed to launch bun: ${error.message}`);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

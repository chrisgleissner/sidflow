#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

async function main() {
  const [modulePath, exportName, ...args] = process.argv.slice(2);
  if (!modulePath || !exportName) {
    process.stderr.write("Usage: node scripts/run-node-cli.mjs <module-path> <export-name> [args...]\n");
    process.exit(1);
  }

  const resolvedModulePath = path.isAbsolute(modulePath)
    ? modulePath
    : path.resolve(process.cwd(), modulePath);
  const moduleUrl = pathToFileURL(resolvedModulePath).href;
  const importedModule = await import(moduleUrl);
  const entrypoint = importedModule[exportName];

  if (typeof entrypoint !== "function") {
    process.stderr.write(`Export ${exportName} is not a function in ${resolvedModulePath}\n`);
    process.exit(1);
  }

  const exitCode = await entrypoint(args);
  process.exit(typeof exitCode === "number" ? exitCode : 0);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
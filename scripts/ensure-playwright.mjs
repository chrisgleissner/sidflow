#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

async function main() {
  const repoRoot = path.resolve(new URL("../", import.meta.url).pathname);
  const webPackageDir = path.join(repoRoot, "packages", "sidflow-web");

  const browsersPath = path.join(repoRoot, ".playwright-browsers");
  const env = {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browsersPath
  };

  const installArgs = process.env.CI
    ? ["playwright", "install", "--with-deps", "chromium"]
    : ["playwright", "install", "chromium"];

  await runCommand("npx", installArgs, { cwd: webPackageDir, env });
}

async function runCommand(command, args, options) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated with signal ${signal}`));
        return;
      }
      if (code && code !== 0) {
        reject(new Error(`${command} exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

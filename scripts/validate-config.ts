import process from "node:process";

import { loadConfig } from "../packages/sidflow-common/src/index.ts";

async function main(): Promise<void> {
  const [, , configPath] = process.argv;
  await loadConfig(configPath);
  console.log(`Validated SIDFlow config at ${configPath ?? ".sidflow.json"}`);
}

main().catch((error) => {
  console.error("SIDFlow config validation failed", error);
  process.exitCode = 1;
});

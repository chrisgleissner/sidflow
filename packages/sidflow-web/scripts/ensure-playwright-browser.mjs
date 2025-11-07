import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";

async function isExecutable(path) {
  if (!path) {
    return false;
  }
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const preferredPaths = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  "/usr/bin/google-chrome"
].filter(Boolean);

for (const chromePath of preferredPaths) {
  // Exit early if a usable Chrome already exists.
  if (await isExecutable(chromePath)) {
    process.exit(0);
  }
}

if (process.env.CI) {
  console.error(
    "Playwright expected Chrome via PLAYWRIGHT_CHROME_PATH, but none was found in the container."
  );
  process.exit(1);
}

console.warn(
  "System Chrome was not found; installing Playwright-managed Chromium for local testing..."
);

const child = spawn("playwright", ["install", "chromium"], { stdio: "inherit" });
child.on("exit", (code) => {
  process.exit(code ?? 1);
});
child.on("error", (error) => {
  console.error(`Failed to run Playwright installer: ${error.message}`);
  process.exit(1);
});

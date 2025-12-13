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

const installArgs = process.env.CI
  ? ["install", "--with-deps", "chromium"]
  : ["install", "chromium"];

// Avoid --with-deps when not running as root (it may attempt apt installs).
if (installArgs.includes("--with-deps") && typeof process.getuid === "function" && process.getuid() !== 0) {
  const index = installArgs.indexOf("--with-deps");
  if (index >= 0) {
    installArgs.splice(index, 1);
  }
}

console.warn(
  process.env.CI
    ? "System Chrome was not found; installing Playwright-managed Chromium (CI mode)."
    : "System Chrome was not found; installing Playwright-managed Chromium for local testing..."
);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (error) => reject(error));
  });
}

async function install() {
  const candidates = [
    { cmd: "playwright", args: installArgs },
    { cmd: "bunx", args: ["playwright", ...installArgs] },
    { cmd: "npx", args: ["playwright", ...installArgs] },
  ];

  for (const candidate of candidates) {
    try {
      const code = await run(candidate.cmd, candidate.args);
      process.exit(code);
    } catch (error) {
      // Try next candidate
      console.warn(
        `Failed to run Playwright installer via ${candidate.cmd}: ${error.message ?? String(error)}`
      );
    }
  }

  console.error("Failed to run Playwright installer via any supported launcher (playwright/bunx/npx).");
  process.exit(1);
}

void install();

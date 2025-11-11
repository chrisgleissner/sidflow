#!/usr/bin/env node

import { createWriteStream, readFileSync } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readdir,
  rename,
  rm
} from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const REPO_ROOT = path.resolve(new URL("../", import.meta.url).pathname);
const INSTALL_DIR = path.join(REPO_ROOT, ".bun");
const BIN_DIR = path.join(INSTALL_DIR, "bin");
const BUN_BINARY = path.join(BIN_DIR, "bun");

class DownloadError extends Error {
  constructor(url, status) {
    super(`Failed to download ${url}: received status ${status}`);
    this.name = "DownloadError";
    this.status = status;
    this.url = url;
  }
}

async function fileExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findExecutable(name) {
  const searchPaths = process.env.PATH?.split(path.delimiter) ?? [];
  for (const candidateDir of searchPaths) {
    if (!candidateDir) {
      continue;
    }
    const candidate = path.join(candidateDir, name);
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getConfiguredBunVersion() {
  try {
    const rootPath = path.join(REPO_ROOT, "package.json");
    const data = JSON.parse(readFileSync(rootPath, "utf8"));
    if (typeof data.packageManager === "string") {
      return extractVersion(data.packageManager);
    }
  } catch {
    // ignore
  }
  return "1.3.1";
}

function extractVersion(descriptor) {
  const match = descriptor.match(/bun@([\dv.]+)/i);
  if (match && match[1]) {
    return match[1].startsWith("v") ? match[1].slice(1) : match[1];
  }
  return "1.3.1";
}

async function downloadToFile(url, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await rm(destination, { force: true });

  await new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.destroy();
        downloadToFile(response.headers.location, destination).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new DownloadError(url, response.statusCode ?? 0));
        return;
      }

      const fileStream = createWriteStream(destination);
      response.pipe(fileStream);
      fileStream.on("finish", () => {
        fileStream.close(resolve);
      });
      fileStream.on("error", reject);
    });

    request.on("error", reject);
  });
}

async function extractTarArchive(archivePath, targetDir) {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  await new Promise((resolve, reject) => {
    const child = spawn(
      "tar",
      ["-xzf", archivePath, "--strip-components=1", "-C", targetDir],
      { stdio: "inherit" }
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code && code !== 0) {
        reject(new Error(`tar exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

async function extractZipArchive(archivePath, targetDir) {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  await new Promise((resolve, reject) => {
    const child = spawn(
      "unzip",
      ["-o", archivePath, "-d", targetDir],
      { stdio: "inherit" }
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code && code !== 0) {
        reject(new Error(`unzip exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

async function findBinary(rootDir, fileName) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findBinary(fullPath, fileName);
      if (nested) {
        return nested;
      }
    } else if (entry.isFile() && entry.name === fileName) {
      return fullPath;
    }
  }
  return null;
}

export async function ensureBun() {
  const existing = await findExecutable("bun");
  if (existing) {
    return existing;
  }

  if (await fileExists(BUN_BINARY)) {
    return BUN_BINARY;
  }

  const version = getConfiguredBunVersion();
  const releaseTag = version.startsWith("v") ? version : `v${version}`;
  const tempDir = path.join(os.tmpdir(), `bun-download-${Date.now()}`);
  const archivePath = path.join(tempDir, "bun-archive");
  const extractDir = path.join(tempDir, "extract");
  await mkdir(tempDir, { recursive: true });

  const downloadTargets = [
    {
      url: `https://github.com/oven-sh/bun/releases/download/bun-${releaseTag}/bun-linux-x64.tar.gz`,
      extract: async () => {
        await extractTarArchive(`${archivePath}.tar.gz`, extractDir);
      },
      extension: ".tar.gz"
    },
    {
      url: `https://github.com/oven-sh/bun/releases/download/bun-${releaseTag}/bun-linux-x64.zip`,
      extract: async () => {
        await extractZipArchive(`${archivePath}.zip`, extractDir);
      },
      extension: ".zip"
    }
  ];

  let extracted = false;
  let lastError = null;
  for (const candidate of downloadTargets) {
    try {
      process.stderr.write(`Attempting to download ${candidate.url}...\n`);
      const targetArchive = `${archivePath}${candidate.extension}`;
      await downloadToFile(candidate.url, targetArchive);
      process.stderr.write("Extracting Bun archive...\n");
      await candidate.extract();
      extracted = true;
      break;
    } catch (error) {
      lastError = error;
      process.stderr.write(`Failed to use ${candidate.url}: ${error.message}\n`);
    }
  }

  if (!extracted) {
    throw lastError ?? new Error("Failed to download Bun runtime");
  }

  await mkdir(BIN_DIR, { recursive: true });
  const bunSource = await findBinary(extractDir, "bun");
  if (!bunSource) {
    throw new Error("Failed to locate bun binary in downloaded archive");
  }
  await rename(bunSource, BUN_BINARY);
  await chmod(BUN_BINARY, 0o755);

  // Optionally install bunx if present.
  const bunxSource = await findBinary(extractDir, "bunx");
  if (bunxSource) {
    const bunxTarget = path.join(BIN_DIR, "bunx");
    await rename(bunxSource, bunxTarget);
    await chmod(bunxTarget, 0o755);
  }

  await rm(tempDir, { recursive: true, force: true });

  return BUN_BINARY;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureBun()
    .then((binary) => {
      process.stdout.write(`${binary}\n`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

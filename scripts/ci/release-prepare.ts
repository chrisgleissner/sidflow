import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";

const repoRoot = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const packagesDir = path.join(repoRoot, "packages");
const changesPath = path.join(repoRoot, "CHANGES.md");

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

function normalizeVersion(value: string | undefined): string {
  if (!value) {
    die("release-prepare requires a version argument, e.g. bun run release:prepare -- 0.2.0");
  }
  const cleaned = value.trim().replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+$/.test(cleaned)) {
    die(`Invalid semver version \"${value}\". Expected format: 1.2.3`);
  }
  return cleaned;
}

async function updatePackageJson(filePath: string, version: string): Promise<void> {
  const content = await readFile(filePath, "utf8");
  const json = JSON.parse(content) as { version?: string };
  json.version = version;
  await writeFile(filePath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
}

async function ensureChangesEntry(version: string): Promise<void> {
  try {
    const body = await readFile(changesPath, "utf8");
    const pattern = new RegExp(`^##\\s+(?:v)?${version.replaceAll(".", "\\.")}\\b`, "m");
    if (!pattern.test(body)) {
      die(`CHANGES.md is missing a \"## ${version}\" entry. Please add release notes before running release:prepare.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      die("CHANGES.md not found. Add release notes before running release:prepare.");
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2).filter((arg) => arg !== "--");
  const version = normalizeVersion(args[0]);
  await ensureChangesEntry(version);

  await updatePackageJson(path.join(repoRoot, "package.json"), version);

  const entries = await readdir(packagesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = path.join(packagesDir, entry.name, "package.json");
    await updatePackageJson(pkgJsonPath, version);
  }

  await $({ cwd: repoRoot })`bun install`;
  console.log(`Updated workspace versions to ${version} and refreshed bun.lock`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

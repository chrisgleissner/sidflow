import { execSync } from "node:child_process";
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

function getCommitMessages(previousTag?: string): string[] {
  try {
    const range = previousTag ? `${previousTag}..HEAD` : "";
    const output = execSync(
      `git log ${range} --no-merges --format=%s`,
      { cwd: repoRoot, encoding: "utf8" },
    );
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !line.toLowerCase().startsWith("chore: prepare release"));
  } catch (error) {
    console.warn("Unable to read commit messages for changelog:", error);
    return [];
  }
}

async function ensureChangesEntry(version: string, previousTag?: string): Promise<void> {
  try {
    const body = await readFile(changesPath, "utf8");
    const pattern = new RegExp(`^##\\s+(?:v)?${version.replaceAll(".", "\\.")}\\b`, "m");
    
    // If version entry already exists, we're done
    if (pattern.test(body)) {
      console.log(`CHANGES.md already has entry for ${version}`);
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const commits = getCommitMessages(previousTag);
    
    // Insert new version entry after "# Changelog" header
    const lines = body.split('\n');
    const changelogIndex = lines.findIndex(line => /^#\s+Changelog/i.test(line));
    
    if (changelogIndex >= 0) {
      // Find the next non-empty line after "# Changelog"
      let insertIndex = changelogIndex + 1;
      while (insertIndex < lines.length && lines[insertIndex].trim() === '') {
        insertIndex++;
      }
      
      const entryLines = [
        `## ${version} (${today})`,
        "",
        ...(commits.length > 0
          ? commits.map((commit) => `- ${commit}`)
          : ["- No notable changes; see git history."]),
        "",
      ];

      // Insert new version section
      lines.splice(insertIndex, 0, ...entryLines);
      await writeFile(changesPath, lines.join('\n'), "utf8");
      console.log(`Auto-generated CHANGES.md entry for ${version}`);
    } else {
      die(`CHANGES.md is missing a \"## ${version}\" entry and could not auto-generate one.`);
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
  const previousTag = process.env.PREVIOUS_TAG;
  await ensureChangesEntry(version, previousTag);

  await updatePackageJson(path.join(repoRoot, "package.json"), version);

  const entries = await readdir(packagesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = path.join(packagesDir, entry.name, "package.json");
    await updatePackageJson(pkgJsonPath, version);
  }

  await $`bun install`.cwd(repoRoot);
  console.log(`Updated workspace versions to ${version} and refreshed bun.lock`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

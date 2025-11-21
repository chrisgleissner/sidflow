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
    
    // If version entry already exists, we're done
    if (pattern.test(body)) {
      console.log(`CHANGES.md already has entry for ${version}`);
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    
    // Insert new version entry after "# Changelog" header
    const lines = body.split('\n');
    const changelogIndex = lines.findIndex(line => /^#\s+Changelog/i.test(line));
    
    if (changelogIndex >= 0) {
      // Find the next non-empty line after "# Changelog"
      let insertIndex = changelogIndex + 1;
      while (insertIndex < lines.length && lines[insertIndex].trim() === '') {
        insertIndex++;
      }
      
      // Insert new version section
      lines.splice(insertIndex, 0, `## ${version} (${today})`, '', '- Release created from tag', '');
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
  await ensureChangesEntry(version);

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

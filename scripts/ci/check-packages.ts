import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verifyPackage } from "./verify-package.ts";

type Source = "local" | "npm";

interface WorkspacePackage {
  name: string;
  dir: string;
}

function parseArgs(): { source: Source; version?: string } {
  const args = Bun.argv.slice(2).filter((arg) => arg !== "--");
  let source: Source = "local";
  let version: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === "--source" || arg === "-s") && typeof args[i + 1] === "string") {
      source = args[i + 1] as Source;
      i += 1;
    } else if ((arg === "--version" || arg === "-v") && typeof args[i + 1] === "string") {
      version = args[i + 1];
      i += 1;
    } else if (!arg.startsWith("-") && !version) {
      version = arg;
    }
  }

  if (source !== "local" && source !== "npm") {
    throw new Error(`Unknown package source "${source}". Expected "local" or "npm".`);
  }

  if (source === "npm" && (!version || !/^\d+\.\d+\.\d+$/.test(version.replace(/^v/i, "")))) {
    throw new Error("When --source npm is used you must provide a semantic version (e.g. 0.2.0).");
  }

  return { source, version: version?.trim().replace(/^v/i, "") };
}

const execFileAsync = promisify(execFile);

async function readPublishableDirs(rootDir: string): Promise<Set<string>> {
  const tsconfigPath = path.join(rootDir, "tsconfig.json");
  const publishable = new Set<string>();
  try {
    const content = JSON.parse(await readFile(tsconfigPath, "utf8")) as {
      references?: Array<{ path: string }>;
    };
    for (const ref of content.references ?? []) {
      publishable.add(path.resolve(rootDir, ref.path));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return publishable;
    }
    throw error;
  }
  return publishable;
}

async function collectWorkspacePackages(rootDir: string, allowedDirs: Set<string>): Promise<WorkspacePackage[]> {
  const packagesDir = path.join(rootDir, "packages");
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const packages: WorkspacePackage[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageDir = path.join(packagesDir, entry.name);
    if (allowedDirs.size > 0 && !allowedDirs.has(packageDir)) {
      continue;
    }
    const pkgJsonPath = path.join(packageDir, "package.json");
    try {
      const pkgJson = JSON.parse(await readFile(pkgJsonPath, "utf8")) as { name: string };
      packages.push({ name: pkgJson.name, dir: packageDir });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  return packages;
}

async function packLocalPackages(packages: WorkspacePackage[], artifactDir: string): Promise<string[]> {
  const tarballs: string[] = [];
  const env = { ...process.env, npm_config_cache: path.join(artifactDir, ".npm-cache") };
  for (const workspace of packages) {
    const before = new Set(await readdir(artifactDir));
    await execFileAsync("bun", ["run", "build"], {
      cwd: workspace.dir,
      env: process.env
    });
    await execFileAsync("npm", ["pack", "--silent", "--pack-destination", artifactDir], {
      cwd: workspace.dir,
      env
    });
    const after = await readdir(artifactDir);
    const diff = after.filter((file) => !before.has(file) && file !== ".npm-cache");
    if (diff.length !== 1) {
      throw new Error(`Unexpected pack result for ${workspace.name}, new files: ${diff.join(", ")}`);
    }
    tarballs.push(path.join(artifactDir, diff[0]));
  }
  return tarballs;
}

async function packPublishedPackages(packages: WorkspacePackage[], artifactDir: string, version: string): Promise<string[]> {
  const tarballs: string[] = [];
  const env = { ...process.env, npm_config_cache: path.join(artifactDir, ".npm-cache") };
  for (const workspace of packages) {
    const before = new Set(await readdir(artifactDir).catch(() => [] as string[]));
    await execFileAsync("npm", ["pack", `${workspace.name}@${version}`, "--silent"], {
      cwd: artifactDir,
      env
    });
    const after = await readdir(artifactDir);
    const diff = after.filter((file) => !before.has(file) && file !== ".npm-cache");
    if (diff.length !== 1) {
      throw new Error(`Unexpected pack result for ${workspace.name}@${version}, new files: ${diff.join(", ")}`);
    }
    tarballs.push(path.join(artifactDir, diff[0]));
  }
  return tarballs;
}

async function extractTarball(tarball: string, destination: string): Promise<string> {
  await execFileAsync("tar", ["-xzf", tarball, "-C", destination], {
    env: process.env
  });
  return path.join(destination, "package");
}

async function run(): Promise<void> {
  const repoRoot = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
  const { source, version } = parseArgs();
  const allowedDirs = await readPublishableDirs(repoRoot);
  const packages = await collectWorkspacePackages(repoRoot, allowedDirs);

  if (packages.length === 0) {
    throw new Error("No workspace packages found under packages/");
  }

  const artifactDir = await mkdtemp(path.join(tmpdir(), "sidflow-pack-"));
  const extractDir = await mkdtemp(path.join(tmpdir(), "sidflow-extract-"));

  const tarballs =
    source === "local"
      ? await packLocalPackages(packages, artifactDir)
      : await packPublishedPackages(packages, artifactDir, version!);

  const expectedVersion = source === "npm" ? version : undefined;

  for (const tarball of tarballs) {
    const baseName = path.basename(tarball, ".tgz");
    const destination = path.join(extractDir, baseName);
    await execFileAsync("mkdir", ["-p", destination]);
    const packageDir = await extractTarball(tarball, destination);
    await verifyPackage(packageDir, { expectedVersion });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

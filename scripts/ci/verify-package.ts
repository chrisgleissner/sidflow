import { access, readFile } from "node:fs/promises";
import path from "node:path";

interface VerifyOptions {
  expectedVersion?: string;
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function verifyPackage(packageDir: string, options: VerifyOptions = {}): Promise<void> {
  const packageJsonPath = path.join(packageDir, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { name: string; version: string };

  if (options.expectedVersion && packageJson.version !== options.expectedVersion) {
    throw new Error(
      `Package ${packageJson.name} expected version ${options.expectedVersion}, found ${packageJson.version}`
    );
  }

  const mainFile = path.join(packageDir, "dist", "index.js");
  if (!(await fileExists(mainFile))) {
    throw new Error(`Package ${packageJson.name} is missing dist/index.js`);
  }

  const typesFile = path.join(packageDir, "dist", "index.d.ts");
  if (!(await fileExists(typesFile))) {
    throw new Error(`Package ${packageJson.name} is missing dist/index.d.ts`);
  }

  console.log(`✔ Verified ${packageJson.name}@${packageJson.version}`);
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const target = args[0];
  if (!target) {
    console.error("Usage: bun run scripts/ci/verify-package.ts <extracted-package-dir> [expected-version]");
    process.exit(1);
  }

  const expectedVersion = args[1];
  await verifyPackage(target, { expectedVersion });
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

const repoRoot = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const changesPath = path.join(repoRoot, "CHANGES.md");

function normalizeVersion(value: string | undefined): string {
  if (!value) die("extract-changes-entry requires a version argument, e.g. bun run scripts/ci/extract-changes-entry.ts 0.2.0");
  return value.trim().replace(/^v/i, "");
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2).filter((arg) => arg !== "--");
  const version = normalizeVersion(args[0]);
  const body = await readFile(changesPath, "utf8");

  const headingPattern = new RegExp(`^##\\s+(?:v)?${version.replaceAll(".", "\\.")}\\b`, "m");
  const match = body.match(headingPattern);
  if (!match) {
    die(`Unable to find a "## ${version}" entry in CHANGES.md`);
  }

  const startIndex = match.index ?? 0;
  const sliceFromHeading = body.slice(startIndex + match[0].length);
  const nextHeadingIndex = sliceFromHeading.search(/\n##\s+/);
  const endIndex = nextHeadingIndex === -1
    ? body.length
    : startIndex + match[0].length + nextHeadingIndex + 1;
  const entry = body.slice(startIndex, endIndex).trimEnd();

  console.log(entry);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { appendFile } from "node:fs/promises";
import { execSync } from "node:child_process";

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

interface TagInfo {
  cleaned: string;
  parts: number[];
  raw: string;
}

function toSemver(raw: string): TagInfo | null {
  const stripped = raw.startsWith("v") ? raw.slice(1) : raw;
  const parts = stripped.split(".").map((value) => Number.parseInt(value, 10));
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    return null;
  }
  return { cleaned: stripped, parts, raw };
}

async function main(): Promise<void> {
  const [currentVersionArg, currentTag] = Bun.argv.slice(2);
  const currentVersion = currentVersionArg?.replace(/^v/i, "");

  if (!currentVersion || !currentTag) {
    die("find-previous-tag requires the current version and tag.");
  }

  const rawTags = execSync("git tag --sort=version:refname", { encoding: "utf8" })
    .split("\n")
    .map((tag) => tag.trim())
    .filter(Boolean);

  const dedupe = new Map<string, { parts: number[]; variants: string[] }>();
  for (const raw of rawTags) {
    const info = toSemver(raw);
    if (!info) continue;
    if (!dedupe.has(info.cleaned)) {
      dedupe.set(info.cleaned, { parts: info.parts, variants: [] });
    }
    dedupe.get(info.cleaned)?.variants.push(raw);
  }

  const ordered = Array.from(dedupe.entries())
    .map(([cleaned, data]) => ({ cleaned, parts: data.parts, variants: data.variants }))
    .sort((a, b) => {
      for (let i = 0; i < 3; i += 1) {
        if (a.parts[i] !== b.parts[i]) {
          return a.parts[i] - b.parts[i];
        }
      }
      return 0;
    });

  const currentIndex = ordered.findIndex((info) => info.cleaned === currentVersion);
  const previous = currentIndex > 0 ? ordered[currentIndex - 1] : undefined;

  const outputs = [
    `version=${previous?.cleaned ?? ""}`,
    `tag=${previous ? (previous.variants.find((tag) => tag.startsWith("v")) ?? previous.variants[0]) : ""}`
  ];

  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    die("GITHUB_OUTPUT is not set.");
  }

  await appendFile(outputPath, `${outputs.join("\n")}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

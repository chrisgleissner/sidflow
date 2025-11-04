import { appendFile } from "node:fs/promises";

function normalize(value: string | undefined): string {
  return (value ?? "").trim();
}

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const changelogEntry = normalize(process.env.CHANGELOG_ENTRY);
  const currentTag = normalize(process.env.CURRENT_TAG);
  const previousTag = normalize(process.env.PREVIOUS_TAG);

  if (!changelogEntry) {
    die("CHANGELOG_ENTRY environment variable is required.");
  }

  const lines = changelogEntry.split("\n");
  if (lines.length > 0 && /^##\s+/.test(lines[0])) {
    lines.shift();
  }

  while (lines.length > 0 && lines[0].trim() === "") {
    lines.shift();
  }

  const body: string[] = [];
  body.push("## What's Changed");
  body.push("");
  const content = lines.join("\n").trim();
  body.push(content.length > 0 ? content : "- No notable changes in this release.");

  if (previousTag) {
    body.push("");
    const compareUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/compare/${previousTag}...${currentTag}`;
    body.push(`**Full Changelog**: ${compareUrl}`);
  }

  const output = body.join("\n").replace(/\n{3,}/g, "\n\n");
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    die("GITHUB_OUTPUT is not set.");
  }

  await appendFile(outputPath, `body<<EOF\n${output}\nEOF\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

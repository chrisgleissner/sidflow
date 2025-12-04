import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { DEFAULT_PACING_SECONDS } from "./constants.js";
import { type JourneySpec } from "./types.js";

const SUPPORTED_EXTENSIONS = [".json", ".yaml", ".yml"];

export interface JourneyLoadOptions {
  pacingSeconds?: number;
}

/**
 * Allows JSON journey files to include `//` line comments while keeping parsing deterministic.
 * This avoids CI failures when specs include inline documentation comments.
 */
function parseJsonWithLineComments(raw: string): JourneySpec {
  const sanitized = raw
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//")) {
        return "";
      }

      let inString = false;
      let escaped = false;
      for (let i = 0; i < line.length - 1; i += 1) {
        const char = line[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = !inString;
        }
        if (!inString && char === "/" && line[i + 1] === "/") {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join("\n");

  return JSON.parse(sanitized) as JourneySpec;
}

export async function loadJourneyFile(
  filePath: string,
  options: JourneyLoadOptions = {}
): Promise<JourneySpec> {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported journey file extension: ${ext}`);
  }

  const raw = await fs.readFile(filePath, "utf8");
  const parsed: JourneySpec = ext === ".json" ? parseJsonWithLineComments(raw) : (parseYaml(raw) as JourneySpec);

  validateJourney(parsed, filePath);

  return {
    pacingSeconds: parsed.pacingSeconds ?? options.pacingSeconds ?? DEFAULT_PACING_SECONDS,
    ...parsed
  };
}

export async function loadJourneysFromDir(
  dir: string,
  opts: JourneyLoadOptions = {}
): Promise<JourneySpec[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const journeys: JourneySpec[] = [];

  for (const entry of entries) {
    if (entry.isFile() && SUPPORTED_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      const journey = await loadJourneyFile(path.join(dir, entry.name), opts);
      journeys.push(journey);
    }
  }

  return journeys;
}

function validateJourney(spec: JourneySpec, source: string) {
  if (!spec.id || typeof spec.id !== "string") {
    throw new Error(`Journey spec missing "id" in ${source}`);
  }
  if (!Array.isArray(spec.steps) || spec.steps.length === 0) {
    throw new Error(`Journey spec "${spec.id}" has no steps (${source})`);
  }
}

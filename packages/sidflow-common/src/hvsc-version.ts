/**
 * Which HVSC release a corpus was built from.
 *
 * Every published export identifies its tracks by `sid_path` (full, lite) or by an
 * MD5 prefix of the file's bytes (tiny), and every consumer resolves those against a
 * local collection. That makes the HVSC release part of the data's identity, yet no
 * export before 0.8.0 recorded it: `corpus_version` was the bare string "hvsc" in
 * every release, so a consumer whose paths stopped resolving had no way to tell
 * whether their collection was too old, too new, or simply incomplete.
 *
 * `@sidflow/fetch` owns writing `hvsc-version.json`; this module only reads it, and
 * deliberately does not import that package — `@sidflow/fetch` depends on
 * `@sidflow/common`, so the dependency has to point this way. The read is structural
 * and tolerant: an absent, unreadable or malformed file yields UNKNOWN rather than
 * throwing, because an export from a private corpus with no HVSC at all is a
 * legitimate case and must not be blocked by a missing provenance file.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * What to record when the release genuinely cannot be established.
 *
 * Publishing this is better than publishing a guess: a consumer can act on "I do not
 * know" (fall back to path matching, warn the user) but cannot act on a plausible
 * wrong answer, which is indistinguishable from a right one until their lookups fail.
 */
export const HVSC_VERSION_UNKNOWN = "unknown";

/** The subset of `hvsc-version.json` that identifies the release. */
export interface HvscVersionLike {
  baseVersion?: unknown;
  deltas?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Render a version record as the label published in the manifests.
 *
 * The shape is "HVSC <base>" plus one " + Update <n>" per applied delta, in the order
 * they were applied — the same information `hvsc-version.json` carries, flattened to a
 * single string so it can sit in a manifest field and be compared by eye.
 *
 * Deltas are listed rather than collapsed to the highest number because they are not
 * guaranteed to be contiguous: a collection at base 84 with only Update 86 applied is
 * a different corpus from one at base 84 with 85 and 86, and "HVSC 84 + Update 86"
 * says so where "HVSC 86" would not.
 */
export function formatHvscVersionLabel(record: HvscVersionLike | null | undefined): string {
  if (!isRecord(record)) {
    return HVSC_VERSION_UNKNOWN;
  }
  const baseVersion = record.baseVersion;
  if (typeof baseVersion !== "number" || !Number.isFinite(baseVersion)) {
    return HVSC_VERSION_UNKNOWN;
  }

  const parts = [`HVSC ${baseVersion}`];
  if (Array.isArray(record.deltas)) {
    for (const delta of record.deltas) {
      if (!isRecord(delta)) {
        continue;
      }
      const version = delta.version;
      if (typeof version === "number" && Number.isFinite(version)) {
        parts.push(`Update ${version}`);
      }
    }
  }
  return parts.join(" + ");
}

/**
 * Read `hvsc-version.json` and format it, or return UNKNOWN.
 *
 * Every failure mode collapses to UNKNOWN on purpose. The caller is an export that
 * has already done hours of work; a malformed provenance file is a reason to publish
 * "unknown" and carry on, not a reason to discard the run.
 */
export async function readHvscVersionLabel(versionFilePath: string): Promise<string> {
  try {
    const contents = await readFile(versionFilePath, "utf8");
    return formatHvscVersionLabel(JSON.parse(contents) as HvscVersionLike);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      // Not fatal, but not silent either: a corrupt version file is worth knowing
      // about, since the export will publish "unknown" because of it.
      console.debug(
        `Could not read HVSC version from ${versionFilePath}, publishing "${HVSC_VERSION_UNKNOWN}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return HVSC_VERSION_UNKNOWN;
  }
}

/**
 * Where `hvsc-version.json` sits relative to the collection itself.
 *
 * `@sidflow/fetch` writes it beside the HVSC root rather than inside it, so that a
 * re-sync that replaces the whole tree cannot take the provenance with it.
 */
export function hvscVersionPathForSidPath(sidPath: string): string {
  return path.join(path.dirname(path.resolve(sidPath)), "hvsc-version.json");
}

/** Convenience wrapper: resolve the label for a configured `sidPath`. */
export async function resolveHvscVersionLabel(sidPath: string): Promise<string> {
  return readHvscVersionLabel(hvscVersionPathForSidPath(sidPath));
}

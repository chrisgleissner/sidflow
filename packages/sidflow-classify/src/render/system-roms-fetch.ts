/**
 * Auto-source the C64 system ROMs.
 *
 * Without KERNAL, BASIC and CHARGEN, libsidplayfp initialises a tune but never
 * advances it: affected songs render as silence or a single held frame, and
 * still classify, producing plausible-looking features from wrong audio. That
 * failure is silent, which makes "the user forgot to supply ROMs" an expensive
 * mistake — so fetch them rather than merely warn.
 *
 * The ROMs are Commodore's, and are not vendored into this repository. They are
 * downloaded from VICE's data directory, which distributes them as part of the
 * emulator, and verified against pinned SHA-256 digests: an upstream that
 * changed these bytes must not be able to swap the machine underneath a
 * classification run without the pin failing first.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createLogger, pathExists } from "@sidflow/common";

const logger = createLogger("system-roms-fetch");

const VICE_C64_DATA =
  "https://raw.githubusercontent.com/libretro/vice-libretro/master/vice/data/C64";

interface RomSpec {
  /** Name SIDFlow looks for; see the "System ROMs" section of the README. */
  readonly localName: string;
  /** Name in VICE's data directory, which uses dashes where SIDFlow uses dots. */
  readonly remoteName: string;
  readonly bytes: number;
  readonly sha256: string;
}

/**
 * Verified byte-identical to a known-good dump of each ROM.
 * kernal 901227-03 is the final C64 KERNAL revision.
 */
export const SYSTEM_ROMS: readonly RomSpec[] = [
  {
    localName: "kernal.901227-03.bin",
    remoteName: "kernal-901227-03.bin",
    bytes: 8192,
    sha256: "83c60d47047d7beab8e5b7bf6f67f80daa088b7a6a27de0d7e016f6484042721",
  },
  {
    localName: "basic.901226-01.bin",
    remoteName: "basic-901226-01.bin",
    bytes: 8192,
    sha256: "89878cea0a268734696de11c4bae593eaaa506465d2029d619c0e0cbccdfa62d",
  },
  {
    localName: "characters.901225-01.bin",
    remoteName: "chargen-901225-01.bin",
    bytes: 4096,
    sha256: "fd0d53b8480e86163ac98998976c72cc58d5dd8eb824ed7b829774e74213b420",
  },
] as const;

export function isRomAutoFetchEnabled(): boolean {
  const raw = process.env.SIDFLOW_ROMS_AUTO_FETCH?.trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no";
}

async function fetchOne(spec: RomSpec, targetDir: string): Promise<void> {
  const url = `${VICE_C64_DATA}/${spec.remoteName}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());

  if (bytes.byteLength !== spec.bytes) {
    throw new Error(
      `${spec.remoteName}: expected ${spec.bytes} bytes, got ${bytes.byteLength}`
    );
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== spec.sha256) {
    // Refuse rather than fall back: a ROM that is not the one we pinned is a
    // different machine, and every feature downstream would be measuring it.
    throw new Error(
      `${spec.remoteName}: SHA-256 mismatch.\n  expected ${spec.sha256}\n  actual   ${digest}`
    );
  }

  await writeFile(path.join(targetDir, spec.localName), bytes);
}

export interface EnsureSystemRomsResult {
  readonly status: "present" | "downloaded" | "skipped" | "failed";
  readonly dir: string;
  readonly reason?: string;
}

/**
 * Make sure all three ROMs exist in `targetDir`, downloading any that do not.
 *
 * Never throws: a classification run without ROMs is degraded, not impossible,
 * and the caller decides how loudly to complain. Returns what happened so the
 * caller can say something useful.
 */
export async function ensureSystemRoms(targetDir: string): Promise<EnsureSystemRomsResult> {
  const missing: RomSpec[] = [];
  for (const spec of SYSTEM_ROMS) {
    if (!(await pathExists(path.join(targetDir, spec.localName)))) {
      missing.push(spec);
    }
  }

  if (missing.length === 0) {
    return { status: "present", dir: targetDir };
  }

  if (!isRomAutoFetchEnabled()) {
    return {
      status: "skipped",
      dir: targetDir,
      reason: "SIDFLOW_ROMS_AUTO_FETCH is disabled",
    };
  }

  logger.info("Downloading C64 system ROMs from the VICE data directory", {
    dir: targetDir,
    missing: missing.map((spec) => spec.localName),
    source: VICE_C64_DATA,
  });

  try {
    await mkdir(targetDir, { recursive: true });
    for (const spec of missing) {
      await fetchOne(spec, targetDir);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn("Could not download C64 system ROMs; rendering will be degraded", { reason });
    return { status: "failed", dir: targetDir, reason };
  }

  logger.info("C64 system ROMs ready", {
    dir: targetDir,
    downloaded: missing.map((spec) => spec.localName),
  });
  return { status: "downloaded", dir: targetDir };
}

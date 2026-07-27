#!/usr/bin/env bun
/**
 * Download the C64 system ROMs into workspace/roms/.
 *
 * Classification does this automatically when the ROMs are missing; run it
 * yourself when you would rather fetch them up front, or to check what is
 * already in place.
 *
 *   bun run roms:fetch
 *   bun run roms:fetch -- /some/other/dir
 */

import path from "node:path";
import process from "node:process";

import { ensureSystemRoms, SYSTEM_ROMS } from "../packages/sidflow-classify/src/render/system-roms-fetch.js";

const target = path.resolve(
  process.argv[2] ?? process.env.SIDFLOW_ROMS_DIR ?? path.join(process.cwd(), "workspace", "roms")
);

const result = await ensureSystemRoms(target);

switch (result.status) {
  case "present":
    process.stdout.write(`All ${SYSTEM_ROMS.length} system ROMs are already in ${target}\n`);
    break;
  case "downloaded":
    process.stdout.write(`Downloaded the C64 system ROMs into ${target}\n`);
    for (const spec of SYSTEM_ROMS) {
      process.stdout.write(`  ${spec.localName} (${spec.bytes} bytes)\n`);
    }
    break;
  case "skipped":
    process.stderr.write(`Skipped: ${result.reason}\n`);
    process.exit(1);
    break;
  case "failed":
    process.stderr.write(`Could not download the system ROMs: ${result.reason}\n`);
    process.stderr.write(
      "Supply them manually instead — see the \"System ROMs\" section of the README.\n"
    );
    process.exit(1);
    break;
}

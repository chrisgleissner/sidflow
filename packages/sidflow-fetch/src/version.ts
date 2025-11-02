import { readFile, writeFile } from "node:fs/promises";

import { stringifyDeterministic, type JsonValue } from "@sidflow/common";

import type { HvscVersionRecord } from "./types.js";

export async function loadHvscVersion(filePath: string): Promise<HvscVersionRecord | null> {
  try {
    const contents = await readFile(filePath, "utf8");
    const parsed = JSON.parse(contents) as HvscVersionRecord;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function saveHvscVersion(filePath: string, record: HvscVersionRecord): Promise<void> {
  const payload = stringifyDeterministic(record as unknown as JsonValue);
  await writeFile(filePath, payload, "utf8");
}

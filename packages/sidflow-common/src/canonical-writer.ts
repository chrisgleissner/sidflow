/**
 * Deterministic writers for canonical SIDFlow data assets.
 *
 * Provides helpers that ensure consistent formatting and emit
 * audit-trail entries for each write.
 */

import { writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "./fs.js";
import { stringifyDeterministic, type JsonValue } from "./json.js";
import {
  getDefaultAuditTrail,
  type AuditTrail,
  type AuditAction
} from "./audit-trail.js";

const DEFAULT_ACTOR = process.env.SIDFLOW_ACTOR ?? "system";

export interface CanonicalWriteOptions {
  readonly actor?: string;
  readonly action?: AuditAction;
  readonly resource?: string;
  readonly auditTrail?: AuditTrail;
  readonly details?: Record<string, unknown>;
}

export interface CanonicalJsonFileOptions extends CanonicalWriteOptions {
  readonly spacing?: number;
  readonly trailingNewline?: boolean;
}

export interface CanonicalJsonLinesOptions extends CanonicalWriteOptions {
  readonly newline?: string;
}

function relativeResource(filePath: string): string {
  const relative = path.relative(process.cwd(), filePath);
  return relative && !relative.startsWith("..") ? relative : filePath;
}

async function withAuditLogging(
  filePath: string,
  options: CanonicalWriteOptions | undefined,
  metadata: Record<string, unknown>,
  operation: () => Promise<void>
): Promise<void> {
  const auditTrail = options?.auditTrail ?? getDefaultAuditTrail();
  const actor = options?.actor ?? DEFAULT_ACTOR;
  const action: AuditAction = options?.action ?? "data:modify";
  const resource = options?.resource ?? relativeResource(filePath);
  const details = { ...metadata, ...(options?.details ?? {}) };

  try {
    await operation();
    await auditTrail.logSuccess(action, actor, resource, details);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await auditTrail.logFailure(action, actor, message, resource, details);
    throw error;
  }
}

function toCanonicalLine(record: JsonValue | string): string {
  if (typeof record === "string") {
    return record.trimEnd();
  }
  return stringifyDeterministic(record, 0).trimEnd();
}

export async function writeCanonicalJsonFile(
  filePath: string,
  value: JsonValue,
  options?: CanonicalJsonFileOptions
): Promise<void> {
  const spacing = options?.spacing ?? 2;
  const trailingNewline = options?.trailingNewline ?? true;
  const payload = stringifyDeterministic(value, spacing);
  const data = trailingNewline ? `${payload}\n` : payload;

  await withAuditLogging(
    filePath,
    options,
    { mode: "write", format: "json", bytes: Buffer.byteLength(data) },
    async () => {
      await ensureDir(path.dirname(filePath));
      await writeFile(filePath, data, "utf8");
    }
  );
}

async function writeLines(
  filePath: string,
  records: Array<JsonValue | string>,
  mode: "write" | "append",
  options?: CanonicalJsonLinesOptions
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const newline = options?.newline ?? "\n";
  const lines = records.map(toCanonicalLine).join(newline) + newline;

  await withAuditLogging(
    filePath,
    options,
    { mode, format: "jsonl", records: records.length, bytes: Buffer.byteLength(lines) },
    async () => {
      await ensureDir(path.dirname(filePath));
      const writer = mode === "write" ? writeFile : appendFile;
      try {
        await writer(filePath, lines, "utf8");
      } catch (error) {
        if (mode === "append" && (error as NodeJS.ErrnoException).code === "ENOENT") {
          await writeFile(filePath, lines, "utf8");
          return;
        }
        throw error;
      }
    }
  );
}

export async function writeCanonicalJsonLines(
  filePath: string,
  records: Array<JsonValue | string>,
  options?: CanonicalJsonLinesOptions
): Promise<void> {
  await writeLines(filePath, records, "write", options);
}

export async function appendCanonicalJsonLines(
  filePath: string,
  records: Array<JsonValue | string>,
  options?: CanonicalJsonLinesOptions
): Promise<void> {
  await writeLines(filePath, records, "append", options);
}

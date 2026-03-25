import process from "node:process";

import type { JsonValue } from "@sidflow/common";

import { flushWriterQueue, queueJsonlWrite } from "./jsonl-writer-queue.js";

export interface ClassificationRunContext {
  command: string;
  cwd: string;
  mode?: string;
  fullRerun?: boolean;
}

function parseBooleanString(value: string | undefined): boolean | undefined {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
}

export function resolveClassificationRunContext(): ClassificationRunContext {
  const fallbackCommand = process.argv.join(" ").trim() || "sidflow-classify";
  return {
    command: (process.env.SIDFLOW_CLASSIFY_RUN_COMMAND ?? fallbackCommand).trim(),
    cwd: (process.env.SIDFLOW_CLASSIFY_RUN_CWD ?? process.cwd()).trim(),
    mode: process.env.SIDFLOW_CLASSIFY_RUN_MODE?.trim() || undefined,
    fullRerun: parseBooleanString(process.env.SIDFLOW_CLASSIFY_RUN_FULL_RERUN),
  };
}

/**
 * Buffered telemetry writer for classification lifecycle events.
 *
 * Call `emit()` with small JSON-serializable records during classification, then
 * call `flush()` exactly once before returning so the queued JSONL writes are
 * persisted in order.
 */
export class ClassificationTelemetryLogger {
  private pending: Promise<void> = Promise.resolve();

  private firstError: Error | null = null;

  constructor(readonly filePath: string) {}

  emit(record: Record<string, JsonValue>): void {
    this.pending = this.pending
      .catch(() => undefined)
      .then(async () => {
        try {
          await queueJsonlWrite(this.filePath, [record]);
        } catch (error) {
          this.firstError ??= error instanceof Error ? error : new Error(String(error));
        }
      });
  }

  async flush(): Promise<void> {
    await this.pending;
    await flushWriterQueue(this.filePath);
    if (this.firstError) {
      throw this.firstError;
    }
  }
}

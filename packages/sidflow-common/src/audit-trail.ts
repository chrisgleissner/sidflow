/**
 * Audit trail for admin actions
 * Logs all administrative operations for compliance and debugging
 */

import { createLogger } from "./logger.js";
import { ensureDir } from "./fs.js";
import { appendFile } from "node:fs/promises";
import path from "node:path";

const logger = createLogger("audit-trail");

export type AuditAction =
  | "job:create"
  | "job:update"
  | "job:delete"
  | "model:publish"
  | "model:rollback"
  | "cache:invalidate"
  | "config:update"
  | "data:modify";

export interface AuditEntry {
  readonly timestamp: string;
  readonly action: AuditAction;
  readonly actor: string;
  readonly resource?: string;
  readonly details?: Record<string, unknown>;
  readonly success: boolean;
  readonly error?: string;
}

export interface AuditTrailConfig {
  readonly logPath: string;
  readonly enabled?: boolean;
}

export class AuditTrail {
  private readonly config: AuditTrailConfig;

  constructor(config: AuditTrailConfig) {
    this.config = {
      ...config,
      enabled: config.enabled ?? true,
    };
  }

  /**
   * Log an audit entry
   */
  async log(entry: Omit<AuditEntry, "timestamp">): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const fullEntry: AuditEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    try {
      await ensureDir(path.dirname(this.config.logPath));

      const line = JSON.stringify(fullEntry) + "\n";
      await appendFile(this.config.logPath, line, "utf-8");

      logger.debug(
        `Audit: ${entry.action} by ${entry.actor} ${entry.success ? "succeeded" : "failed"}`
      );
    } catch (err) {
      logger.error("Failed to write audit log:", err);
    }
  }

  /**
   * Log a successful action
   */
  async logSuccess(
    action: AuditAction,
    actor: string,
    resource?: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      action,
      actor,
      resource,
      details,
      success: true,
    });
  }

  /**
   * Log a failed action
   */
  async logFailure(
    action: AuditAction,
    actor: string,
    error: string,
    resource?: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      action,
      actor,
      resource,
      details,
      success: false,
      error,
    });
  }
}

/**
 * Create a singleton audit trail instance
 */
let defaultAuditTrail: AuditTrail | null = null;

export function getDefaultAuditTrail(logPath?: string): AuditTrail {
  if (!defaultAuditTrail) {
    const path = logPath || "data/audit/admin-actions.jsonl";
    defaultAuditTrail = new AuditTrail({ logPath: path });
  }
  return defaultAuditTrail;
}

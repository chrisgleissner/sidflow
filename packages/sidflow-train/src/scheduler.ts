/**
 * D4: Automated retraining scheduler.
 *
 * Monitors new feedback events and triggers retraining when:
 *   - At least MIN_EVENTS_DELTA new events have accumulated since the last run, OR
 *   - At least MIN_INTERVAL_MS have elapsed since the last run.
 *
 * On each run:
 *   1. Load all feedback events
 *   2. Build training pairs (D1)
 *   3. Load current embeddings from classified JSONL
 *   4. Train metric MLP (D2)
 *   5. Evaluate challenger vs champion (D3)
 *   6. If promoted: save new model as versioned current (model versioning in D5's saveVersioedModel)
 */

import { readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import {
  pathExists,
  ensureDir,
  stringifyDeterministic,
  type FeedbackRecord,
  type ClassificationRecord,
  type JsonValue,
} from "@sidflow/common";
import { loadFeedback } from "./index.js";
import { deriveTrainingPairs } from "./pair-builder.js";
import { trainMetricModel, type MetricModel, type TrainOptions } from "./metric-learning.js";
import { evaluateChallenger, type EvaluationResult } from "./evaluate.js";
import { readdir } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum new feedback events since last training to trigger a run. */
const MIN_EVENTS_DELTA = 50;

/** Minimum elapsed time between scheduler runs (default: 24 h). */
const DEFAULT_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Fraction of feedback kept as holdout for evaluation. */
const HOLDOUT_FRACTION = 0.2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchedulerOptions {
  feedbackPath?: string;
  classifiedPath?: string;
  modelPath?: string;
  trainOptions?: TrainOptions;
  minEventsDelta?: number;
  minIntervalMs?: number;
  force?: boolean;
}

export interface SchedulerState {
  lastRunAt?: string;
  eventCountAtLastRun?: number;
}

export interface SchedulerResult {
  triggered: boolean;
  reason?: "min_events" | "min_interval" | "force" | "no_trigger";
  evaluation?: EvaluationResult;
  promoted: boolean;
  newEventCount: number;
  stateFile: string;
}

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

const STATE_FILENAME = "scheduler-state.json";

async function loadState(modelPath: string): Promise<SchedulerState> {
  const filePath = path.join(modelPath, STATE_FILENAME);
  if (!(await pathExists(filePath))) return {};
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as SchedulerState;
  } catch {
    return {};
  }
}

async function saveState(modelPath: string, state: SchedulerState): Promise<void> {
  await ensureDir(modelPath);
  const filePath = path.join(modelPath, STATE_FILENAME);
  await writeFile(filePath, `${stringifyDeterministic(state as unknown as JsonValue)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Embedding loader (reads 24D perceptual vectors from classified JSONL)
// ---------------------------------------------------------------------------

async function loadEmbeddings(classifiedPath: string): Promise<Map<string, number[]>> {
  const embeddings = new Map<string, number[]>();
  if (!(await pathExists(classifiedPath))) return embeddings;

  let files: string[];
  try {
    files = await readdir(classifiedPath);
  } catch {
    return embeddings;
  }

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const filePath = path.join(classifiedPath, file);
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const record = JSON.parse(trimmed) as ClassificationRecord;
        const vec = record.vector;
        if (!vec || !Array.isArray(vec) || vec.length !== 24) continue;
        const songIndex = record.song_index ?? 1;
        const trackId = `${record.sid_path}#${songIndex}`;
        embeddings.set(trackId, vec as number[]);
      } catch {
        // skip corrupt lines
      }
    }
  }

  return embeddings;
}

// ---------------------------------------------------------------------------
// Model persistence
// ---------------------------------------------------------------------------

const METRIC_MODEL_FILENAME = "metric-model.json";

async function loadCurrentModel(modelPath: string): Promise<MetricModel | null> {
  const currentPath = path.join(modelPath, "current", METRIC_MODEL_FILENAME);
  if (!(await pathExists(currentPath))) return null;
  try {
    const raw = await readFile(currentPath, "utf8");
    return JSON.parse(raw) as MetricModel;
  } catch {
    return null;
  }
}

/** Save model as the new `current/`, shifting existing versions. */
export async function saveVersionedModel(model: MetricModel, modelPath: string): Promise<void> {
  await ensureDir(modelPath);

  const currentPath = path.join(modelPath, "current");
  const currentFile = path.join(currentPath, METRIC_MODEL_FILENAME);

  // === Rotate existing versions: v4→v5, v3→v4, v2→v3, v1→v2, current→v1 ===
  const MAX_VERSIONS = 5;
  for (let v = MAX_VERSIONS - 1; v >= 1; v--) {
    const src = path.join(modelPath, `v${v}`, METRIC_MODEL_FILENAME);
    const dst = path.join(modelPath, `v${v + 1}`, METRIC_MODEL_FILENAME);
    if (await pathExists(src)) {
      await ensureDir(path.join(modelPath, `v${v + 1}`));
      await copyFile(src, dst);
    }
  }

  // Rotate current → v1
  if (await pathExists(currentFile)) {
    await ensureDir(path.join(modelPath, "v1"));
    await copyFile(currentFile, path.join(modelPath, "v1", METRIC_MODEL_FILENAME));
  }

  // Promote new model to current
  await ensureDir(currentPath);
  await writeFile(currentFile, `${stringifyDeterministic(model as unknown as JsonValue)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Simple holdout split with deterministic ordering
// ---------------------------------------------------------------------------

function splitHoldout<T>(items: T[]): { train: T[]; holdout: T[] } {
  const sorted = [...items].sort((left, right) => {
    const leftTs = typeof (left as { ts?: unknown }).ts === "string" ? ((left as { ts: string }).ts) : "";
    const rightTs = typeof (right as { ts?: unknown }).ts === "string" ? ((right as { ts: string }).ts) : "";
    if (leftTs !== rightTs) {
      return leftTs.localeCompare(rightTs);
    }
    return stringifyDeterministic(left as unknown as JsonValue, 0)
      .localeCompare(stringifyDeterministic(right as unknown as JsonValue, 0));
  });
  const holdoutCount = Math.floor(sorted.length * HOLDOUT_FRACTION);
  return {
    train: sorted.slice(0, sorted.length - holdoutCount),
    holdout: sorted.slice(sorted.length - holdoutCount),
  };
}

// ---------------------------------------------------------------------------
// Main scheduler entry point
// ---------------------------------------------------------------------------

/**
 * Run one iteration of the retraining scheduler.
 * Returns immediately with `triggered=false` if no trigger condition is met.
 */
export async function runScheduler(options: SchedulerOptions = {}): Promise<SchedulerResult> {
  const feedbackPath = options.feedbackPath ?? "data/feedback";
  const classifiedPath = options.classifiedPath ?? "data/classified";
  const modelPath = options.modelPath ?? "data/model";
  const minEventsDelta = options.minEventsDelta ?? MIN_EVENTS_DELTA;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const stateFile = path.join(modelPath, STATE_FILENAME);

  const state = await loadState(modelPath);
  const allEvents = await loadFeedback(feedbackPath);
  const newEventCount = allEvents.length;
  const eventsSinceLast = newEventCount - (state.eventCountAtLastRun ?? 0);

  const now = Date.now();
  const lastRunAt = state.lastRunAt ? new Date(state.lastRunAt).getTime() : 0;
  const elapsedMs = now - lastRunAt;

  // Determine whether to trigger
  let trigger: SchedulerResult["reason"] = "no_trigger";
  if (options.force) {
    trigger = "force";
  } else if (eventsSinceLast >= minEventsDelta) {
    trigger = "min_events";
  } else if (elapsedMs >= minIntervalMs) {
    trigger = "min_interval";
  }

  if (trigger === "no_trigger") {
    return { triggered: false, reason: "no_trigger", promoted: false, newEventCount, stateFile };
  }

  // ── Full retraining pipeline ──────────────────────────────────────────────

  const embeddings = await loadEmbeddings(classifiedPath);

  if (embeddings.size === 0) {
    // Nothing to train on — update state and bail gracefully
    await saveState(modelPath, { lastRunAt: new Date().toISOString(), eventCountAtLastRun: newEventCount });
    return { triggered: true, reason: trigger, promoted: false, newEventCount, stateFile };
  }

  const { train: trainEvents, holdout: holdoutEvents } = splitHoldout(allEvents);

  const trainingPairs = deriveTrainingPairs(trainEvents as FeedbackRecord[]);
  const holdoutPairs = deriveTrainingPairs(holdoutEvents as FeedbackRecord[]);

  const trainResult = trainMetricModel(trainingPairs, embeddings, options.trainOptions ?? {});
  const challenger = trainResult.model;

  const champion = await loadCurrentModel(modelPath);
  const evaluation = evaluateChallenger(champion, challenger, holdoutPairs, embeddings);

  let promoted = false;
  if (evaluation.promote) {
    challenger.version = (champion?.version ?? 0) + 1;
    await saveVersionedModel(challenger, modelPath);
    promoted = true;
  }

  await saveState(modelPath, { lastRunAt: new Date().toISOString(), eventCountAtLastRun: newEventCount });

  return { triggered: true, reason: trigger, evaluation, promoted, newEventCount, stateFile };
}

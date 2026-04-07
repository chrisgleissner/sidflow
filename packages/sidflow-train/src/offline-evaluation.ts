import { readFile } from "node:fs/promises";
import { cosineSimilarity, pathExists, stringifyDeterministic, type ClassificationRecord, type FeedbackRecord, type JsonValue } from "@sidflow/common";
import { deriveTrainingPairs, type DerivedTrainingPairs } from "./pair-builder.js";

export interface OfflineMetricResult {
  key: "pairwise_ranking_accuracy" | "ndcg_at_10" | "station_coherence" | "rating_agreement" | "early_skip_auc";
  label: string;
  baseline: number;
  hybrid: number;
  delta: number;
  threshold: number;
  thresholdType: "absolute" | "relative";
  improved: boolean;
}

export interface OfflineEvaluationReport {
  metrics: OfflineMetricResult[];
  improvedCount: number;
  promote: boolean;
  coherenceRegression: boolean;
  holdoutEventCount: number;
  seedTrackCount: number;
  summary: string;
}

export interface EvaluateHybridCorporaOptions {
  baselineEmbeddings: Map<string, number[]>;
  hybridEmbeddings: Map<string, number[]>;
  feedbackEvents: FeedbackRecord[];
  holdoutFraction?: number;
}

const DEFAULT_HOLDOUT_FRACTION = 0.2;
const RATING_BUCKET_COUNT = 5;
const DEFAULT_STATION_SIZE = 10;

interface HoldoutSplit<T> {
  train: T[];
  holdout: T[];
}

interface TrackRatingStats {
  averageRating: number;
  positiveCount: number;
  skipEarlyCount: number;
}

export async function loadClassificationEmbeddings(jsonlPath: string): Promise<Map<string, number[]>> {
  const embeddings = new Map<string, number[]>();
  if (!(await pathExists(jsonlPath))) {
    return embeddings;
  }

  const content = await readFile(jsonlPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const record = JSON.parse(trimmed) as ClassificationRecord;
      if (!Array.isArray(record.vector) || record.vector.length !== 24) {
        continue;
      }
      const trackId = `${record.sid_path}#${record.song_index ?? 1}`;
      embeddings.set(trackId, [...record.vector]);
    } catch {
      // Skip corrupt lines in offline evaluation mode.
    }
  }

  return embeddings;
}

export function evaluateHybridCorpora(options: EvaluateHybridCorporaOptions): OfflineEvaluationReport {
  const holdoutFraction = clamp(options.holdoutFraction ?? DEFAULT_HOLDOUT_FRACTION, 0, 1);
  const { holdout } = splitHoldout(options.feedbackEvents, holdoutFraction);
  const holdoutPairs = deriveTrainingPairs(holdout);
  const seedTrackIds = deriveSeedTrackIds(holdout, options.hybridEmbeddings);
  const trackRatings = buildTrackRatingStats(holdout);

  const metrics: OfflineMetricResult[] = [
    buildMetricResult({
      key: "pairwise_ranking_accuracy",
      label: "Pairwise ranking accuracy",
      baseline: computePairwiseRankingAccuracy(options.baselineEmbeddings, holdoutPairs),
      hybrid: computePairwiseRankingAccuracy(options.hybridEmbeddings, holdoutPairs),
      threshold: 0.07,
      thresholdType: "absolute",
    }),
    buildMetricResult({
      key: "ndcg_at_10",
      label: "NDCG@10 on holdout favorites",
      baseline: computeNdcgAt10(options.baselineEmbeddings, seedTrackIds, trackRatings),
      hybrid: computeNdcgAt10(options.hybridEmbeddings, seedTrackIds, trackRatings),
      threshold: 0.1,
      thresholdType: "relative",
    }),
    buildMetricResult({
      key: "station_coherence",
      label: "Station coherence",
      baseline: computeStationCoherence(options.baselineEmbeddings, seedTrackIds),
      hybrid: computeStationCoherence(options.hybridEmbeddings, seedTrackIds),
      threshold: 0.05,
      thresholdType: "absolute",
    }),
    buildMetricResult({
      key: "rating_agreement",
      label: "Rating agreement",
      baseline: computeRatingAgreement(options.baselineEmbeddings, seedTrackIds, trackRatings),
      hybrid: computeRatingAgreement(options.hybridEmbeddings, seedTrackIds, trackRatings),
      threshold: 0.1,
      thresholdType: "absolute",
    }),
    buildMetricResult({
      key: "early_skip_auc",
      label: "Early-skip AUC",
      baseline: computeEarlySkipAuc(options.baselineEmbeddings, seedTrackIds, trackRatings),
      hybrid: computeEarlySkipAuc(options.hybridEmbeddings, seedTrackIds, trackRatings),
      threshold: 0.03,
      thresholdType: "absolute",
    }),
  ];

  const improvedCount = metrics.filter((metric) => metric.improved).length;
  const coherenceMetric = metrics.find((metric) => metric.key === "station_coherence")!;
  const coherenceRegression = coherenceMetric.hybrid + 1e-9 < coherenceMetric.baseline;
  const promote = improvedCount >= 3 && !coherenceRegression;
  const summary = metrics
    .map((metric) => `${metric.key}=${metric.hybrid.toFixed(3)} (${metric.improved ? "improved" : "no-improve"})`)
    .join(", ");

  return {
    metrics,
    improvedCount,
    promote,
    coherenceRegression,
    holdoutEventCount: holdout.length,
    seedTrackCount: seedTrackIds.length,
    summary,
  };
}

export function formatOfflineEvaluationReport(report: OfflineEvaluationReport): string {
  const lines = [
    `Holdout events: ${report.holdoutEventCount}`,
    `Seed tracks: ${report.seedTrackCount}`,
    `Improved metrics: ${report.improvedCount}/5`,
    `Coherence regression: ${report.coherenceRegression ? "yes" : "no"}`,
    `Promotion decision: ${report.promote ? "PROMOTE" : "REJECT"}`,
    "",
    "Metrics:",
  ];

  for (const metric of report.metrics) {
    const thresholdText = metric.thresholdType === "relative"
      ? `${Math.round(metric.threshold * 100)}% relative`
      : `${metric.threshold.toFixed(2)} absolute`;
    lines.push(
      `- ${metric.label}: baseline=${metric.baseline.toFixed(3)} hybrid=${metric.hybrid.toFixed(3)} delta=${metric.delta.toFixed(3)} threshold=${thresholdText} ${metric.improved ? "PASS" : "FAIL"}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export function reportToJson(report: OfflineEvaluationReport): string {
  return `${stringifyDeterministic(report as unknown as JsonValue)}\n`;
}

function splitHoldout<T>(items: T[], holdoutFraction: number): HoldoutSplit<T> {
  const sorted = [...items].sort((left, right) => stringifyDeterministic(left as unknown as JsonValue, 0)
    .localeCompare(stringifyDeterministic(right as unknown as JsonValue, 0)));
  const holdoutCount = Math.min(sorted.length, Math.max(0, Math.floor(sorted.length * holdoutFraction)));
  return {
    train: sorted.slice(0, sorted.length - holdoutCount),
    holdout: holdoutCount > 0 ? sorted.slice(sorted.length - holdoutCount) : sorted,
  };
}

function deriveSeedTrackIds(events: FeedbackRecord[], embeddings: Map<string, number[]>): string[] {
  const ratings = buildTrackRatingStats(events);
  return [...ratings.entries()]
    .filter(([trackId, stats]) => stats.averageRating >= 4 && embeddings.has(trackId))
    .map(([trackId]) => trackId)
    .filter((trackId) => embeddings.has(trackId))
    .sort((left, right) => {
      const leftStats = ratings.get(left)!;
      const rightStats = ratings.get(right)!;
      return rightStats.averageRating - leftStats.averageRating || left.localeCompare(right);
    });
}

function buildTrackRatingStats(events: FeedbackRecord[]): Map<string, TrackRatingStats> {
  const accumulators = new Map<string, { ratingSum: number; count: number; positiveCount: number; skipEarlyCount: number }>();

  for (const event of events) {
    const trackId = `${event.sid_path}#${event.song_index ?? 1}`;
    const accumulator = accumulators.get(trackId) ?? { ratingSum: 0, count: 0, positiveCount: 0, skipEarlyCount: 0 };
    accumulator.ratingSum += actionToExplicitRating(event.action);
    accumulator.count += 1;
    if (isPositiveAction(event.action)) {
      accumulator.positiveCount += 1;
    }
    if (event.action === "skip_early") {
      accumulator.skipEarlyCount += 1;
    }
    accumulators.set(trackId, accumulator);
  }

  const stats = new Map<string, TrackRatingStats>();
  for (const [trackId, accumulator] of accumulators) {
    stats.set(trackId, {
      averageRating: accumulator.count === 0 ? 3 : accumulator.ratingSum / accumulator.count,
      positiveCount: accumulator.positiveCount,
      skipEarlyCount: accumulator.skipEarlyCount,
    });
  }
  return stats;
}

function actionToExplicitRating(action: FeedbackRecord["action"]): number {
  switch (action) {
    case "replay":
      return 5;
    case "like":
    case "play_complete":
      return 4;
    case "play":
      return 3;
    case "skip_late":
      return 2;
    case "skip":
    case "skip_early":
    case "dislike":
      return 1;
    default:
      return 3;
  }
}

function isPositiveAction(action: FeedbackRecord["action"]): boolean {
  return action === "like" || action === "replay" || action === "play_complete";
}

function buildMetricResult(input: {
  key: OfflineMetricResult["key"];
  label: string;
  baseline: number;
  hybrid: number;
  threshold: number;
  thresholdType: OfflineMetricResult["thresholdType"];
}): OfflineMetricResult {
  const delta = input.hybrid - input.baseline;
  const relativeDelta = input.baseline === 0 ? (input.hybrid > 0 ? Number.POSITIVE_INFINITY : 0) : delta / Math.abs(input.baseline);
  const improved = input.thresholdType === "relative"
    ? relativeDelta >= input.threshold
    : delta >= input.threshold;

  return {
    ...input,
    delta,
    improved,
  };
}

function computePairwiseRankingAccuracy(
  embeddings: Map<string, number[]>,
  holdoutPairs: DerivedTrainingPairs,
): number {
  const positiveByAnchor = new Map<string, string[]>();
  const negativeByAnchor = new Map<string, string[]>();

  for (const pair of holdoutPairs.positive) {
    if (!embeddings.has(pair.anchor) || !embeddings.has(pair.other)) {
      continue;
    }
    const existing = positiveByAnchor.get(pair.anchor) ?? [];
    existing.push(pair.other);
    positiveByAnchor.set(pair.anchor, existing);
  }

  for (const pair of holdoutPairs.negative) {
    if (!embeddings.has(pair.anchor) || !embeddings.has(pair.other)) {
      continue;
    }
    const existing = negativeByAnchor.get(pair.anchor) ?? [];
    existing.push(pair.other);
    negativeByAnchor.set(pair.anchor, existing);
  }

  let correct = 0;
  let total = 0;
  for (const [anchor, positives] of positiveByAnchor) {
    const negatives = negativeByAnchor.get(anchor) ?? [];
    const anchorVector = embeddings.get(anchor);
    if (!anchorVector || negatives.length === 0) {
      continue;
    }
    for (const positive of positives) {
      const positiveVector = embeddings.get(positive);
      if (!positiveVector) {
        continue;
      }
      const positiveScore = cosineSimilarity(anchorVector, positiveVector);
      for (const negative of negatives) {
        const negativeVector = embeddings.get(negative);
        if (!negativeVector) {
          continue;
        }
        total += 1;
        if (positiveScore > cosineSimilarity(anchorVector, negativeVector)) {
          correct += 1;
        }
      }
    }
  }

  return total === 0 ? 0 : correct / total;
}

function computeNdcgAt10(
  embeddings: Map<string, number[]>,
  seedTrackIds: string[],
  trackRatings: Map<string, TrackRatingStats>,
): number {
  const relevantTrackIds = new Set(
    [...trackRatings.entries()]
      .filter(([, stats]) => stats.averageRating >= 4)
      .map(([trackId]) => trackId),
  );

  const values = seedTrackIds
    .map((seedTrackId) => {
      const ranking = rankTracksForSeed(seedTrackId, embeddings).slice(0, 10);
      if (ranking.length === 0) {
        return null;
      }

      let dcg = 0;
      for (let index = 0; index < ranking.length; index += 1) {
        const entry = ranking[index]!;
        const relevance = relevantTrackIds.has(entry.trackId) ? 1 : 0;
        dcg += relevance / Math.log2(index + 2);
      }

      const idealCount = Math.min(10, Math.max(0, relevantTrackIds.size - (relevantTrackIds.has(seedTrackId) ? 1 : 0)));
      let idcg = 0;
      for (let index = 0; index < idealCount; index += 1) {
        idcg += 1 / Math.log2(index + 2);
      }
      return idcg === 0 ? 0 : dcg / idcg;
    })
    .filter((value): value is number => value !== null);

  return average(values);
}

function computeStationCoherence(embeddings: Map<string, number[]>, seedTrackIds: string[]): number {
  const scores: number[] = [];

  for (const seedTrackId of seedTrackIds) {
    const seedVector = embeddings.get(seedTrackId);
    if (!seedVector) {
      continue;
    }

    const station = [seedVector, ...rankTracksForSeed(seedTrackId, embeddings)
      .filter((entry) => entry.score > 0)
      .slice(0, DEFAULT_STATION_SIZE)
      .map((entry) => embeddings.get(entry.trackId))
      .filter((vector): vector is number[] => Array.isArray(vector))];

    if (station.length < 2) {
      continue;
    }

    let total = 0;
    let count = 0;
    for (let left = 0; left < station.length; left += 1) {
      for (let right = left + 1; right < station.length; right += 1) {
        total += cosineSimilarity(station[left]!, station[right]!);
        count += 1;
      }
    }
    if (count > 0) {
      scores.push(total / count);
    }
  }

  return average(scores);
}

function computeRatingAgreement(
  embeddings: Map<string, number[]>,
  seedTrackIds: string[],
  trackRatings: Map<string, TrackRatingStats>,
): number {
  const scored = scoreTracksAgainstSeeds(embeddings, seedTrackIds, trackRatings);
  if (scored.length < RATING_BUCKET_COUNT) {
    return 0;
  }

  const buckets = bucketize(scored, RATING_BUCKET_COUNT);
  const x: number[] = [];
  const y: number[] = [];
  for (let index = 0; index < buckets.length; index += 1) {
    const bucket = buckets[index]!;
    if (bucket.length === 0) {
      continue;
    }
    x.push(index + 1);
    y.push(average(bucket.map((entry) => entry.averageRating)));
  }

  return computeSpearmanCorrelation(x, y);
}

function computeEarlySkipAuc(
  embeddings: Map<string, number[]>,
  seedTrackIds: string[],
  trackRatings: Map<string, TrackRatingStats>,
): number {
  const examples = scoreTracksAgainstSeeds(embeddings, seedTrackIds, trackRatings)
    .map((entry) => ({
      score: 1 - entry.score,
      label: (entry.skipEarlyCount > entry.positiveCount ? 1 : 0) as 0 | 1,
    }));

  return computeRocAuc(examples);
}

function scoreTracksAgainstSeeds(
  embeddings: Map<string, number[]>,
  seedTrackIds: string[],
  trackRatings: Map<string, TrackRatingStats>,
): Array<{ trackId: string; score: number; averageRating: number; positiveCount: number; skipEarlyCount: number }> {
  const seedVectors = seedTrackIds
    .map((trackId) => embeddings.get(trackId))
    .filter((vector): vector is number[] => Array.isArray(vector));
  if (seedVectors.length === 0) {
    return [];
  }

  const scored: Array<{ trackId: string; score: number; averageRating: number; positiveCount: number; skipEarlyCount: number }> = [];
  for (const [trackId, stats] of trackRatings) {
    const vector = embeddings.get(trackId);
    if (!vector || seedTrackIds.includes(trackId)) {
      continue;
    }
    let bestScore = -1;
    for (const seedVector of seedVectors) {
      bestScore = Math.max(bestScore, cosineSimilarity(seedVector, vector));
    }
    scored.push({
      trackId,
      score: bestScore,
      averageRating: stats.averageRating,
      positiveCount: stats.positiveCount,
      skipEarlyCount: stats.skipEarlyCount,
    });
  }

  scored.sort((left, right) => right.score - left.score || left.trackId.localeCompare(right.trackId));
  return scored;
}

function rankTracksForSeed(seedTrackId: string, embeddings: Map<string, number[]>): Array<{ trackId: string; score: number }> {
  const seedVector = embeddings.get(seedTrackId);
  if (!seedVector) {
    return [];
  }

  return [...embeddings.entries()]
    .filter(([trackId]) => trackId !== seedTrackId)
    .map(([trackId, vector]) => ({ trackId, score: cosineSimilarity(seedVector, vector) }))
    .sort((left, right) => right.score - left.score || left.trackId.localeCompare(right.trackId));
}

function bucketize<T>(items: T[], bucketCount: number): T[][] {
  const buckets: T[][] = Array.from({ length: bucketCount }, () => []);
  for (let index = 0; index < items.length; index += 1) {
    const bucketIndex = Math.min(bucketCount - 1, Math.floor((index * bucketCount) / items.length));
    buckets[bucketIndex]!.push(items[index]!);
  }
  return buckets;
}

function computeSpearmanCorrelation(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < 2) {
    return 0;
  }
  return computePearsonCorrelation(rankValues(left), rankValues(right));
}

function computePearsonCorrelation(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < 2) {
    return 0;
  }

  const leftMean = average(left);
  const rightMean = average(right);
  let numerator = 0;
  let leftDenominator = 0;
  let rightDenominator = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index]! - leftMean;
    const rightDelta = right[index]! - rightMean;
    numerator += leftDelta * rightDelta;
    leftDenominator += leftDelta * leftDelta;
    rightDenominator += rightDelta * rightDelta;
  }

  if (leftDenominator === 0 || rightDenominator === 0) {
    return 0;
  }

  return numerator / Math.sqrt(leftDenominator * rightDenominator);
}

function rankValues(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((left, right) => left.value - right.value || left.index - right.index);
  const ranks = new Array<number>(values.length);

  let index = 0;
  while (index < indexed.length) {
    let end = index + 1;
    while (end < indexed.length && indexed[end]!.value === indexed[index]!.value) {
      end += 1;
    }
    const averageRank = (index + end + 1) / 2;
    for (let cursor = index; cursor < end; cursor += 1) {
      ranks[indexed[cursor]!.index] = averageRank;
    }
    index = end;
  }

  return ranks;
}

function computeRocAuc(examples: Array<{ score: number; label: 0 | 1 }>): number {
  const positives = examples.filter((example) => example.label === 1);
  const negatives = examples.filter((example) => example.label === 0);
  if (positives.length === 0 || negatives.length === 0) {
    return 0.5;
  }

  let favorable = 0;
  let total = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      total += 1;
      if (positive.score > negative.score) {
        favorable += 1;
      } else if (positive.score === negative.score) {
        favorable += 0.5;
      }
    }
  }

  return total === 0 ? 0.5 : favorable / total;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
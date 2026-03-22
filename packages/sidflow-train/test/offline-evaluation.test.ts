import { describe, expect, it } from "bun:test";
import type { FeedbackRecord } from "@sidflow/common";
import { evaluateHybridCorpora } from "../src/offline-evaluation.js";

function makeVector(entries: Record<number, number>): number[] {
  const vector = new Array<number>(24).fill(0);
  for (const [index, value] of Object.entries(entries)) {
    vector[Number(index)] = value;
  }
  return vector;
}

describe("evaluateHybridCorpora", () => {
  it("reports promotion when hybrid embeddings improve the offline benchmark", () => {
    const baselineEmbeddings = new Map<string, number[]>([
      ["fav-a.sid#1", makeVector({ 0: 1, 1: 0.2 })],
      ["fav-b.sid#1", makeVector({ 0: 0.3, 1: 1 })],
      ["skip-a.sid#1", makeVector({ 0: 1, 1: 0.8 })],
      ["skip-b.sid#1", makeVector({ 0: 0.8, 1: 0.7 })],
      ["neutral.sid#1", makeVector({ 2: 1 })],
    ]);
    const hybridEmbeddings = new Map<string, number[]>([
      ["fav-a.sid#1", makeVector({ 0: 1 })],
      ["fav-b.sid#1", makeVector({ 0: 0.97, 1: 0.03 })],
      ["skip-a.sid#1", makeVector({ 12: 1 })],
      ["skip-b.sid#1", makeVector({ 12: 0.94, 13: 0.06 })],
      ["neutral.sid#1", makeVector({ 2: 1 })],
    ]);

    const feedbackEvents: FeedbackRecord[] = [
      { ts: "2026-03-01T00:00:00.000Z", sid_path: "fav-a.sid", action: "like" },
      { ts: "2026-03-01T00:01:00.000Z", sid_path: "fav-b.sid", action: "replay" },
      { ts: "2026-03-01T00:02:00.000Z", sid_path: "skip-a.sid", action: "skip_early" },
      { ts: "2026-03-02T00:00:00.000Z", sid_path: "fav-a.sid", action: "play_complete" },
      { ts: "2026-03-02T00:01:00.000Z", sid_path: "fav-b.sid", action: "like" },
      { ts: "2026-03-02T00:02:00.000Z", sid_path: "skip-b.sid", action: "skip_early" },
      { ts: "2026-03-02T00:03:00.000Z", sid_path: "neutral.sid", action: "play" },
    ];

    const report = evaluateHybridCorpora({
      baselineEmbeddings,
      hybridEmbeddings,
      feedbackEvents,
      holdoutFraction: 1,
    });

    expect(report.metrics).toHaveLength(5);
    expect(report.improvedCount).toBeGreaterThanOrEqual(3);
    expect(report.coherenceRegression).toBe(false);
    expect(report.promote).toBe(true);
  });
});
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AuditTrail } from "../src/audit-trail.js";
import {
  AVAILABILITY_MANIFEST_VERSION,
  createAvailabilityAssetId,
  findAvailabilityAsset,
  listAvailabilityAssets,
  loadAvailabilityManifest,
  registerAvailabilityAsset,
  type AvailabilityAsset,
} from "../src/availability-manifest.js";
import type { RenderMode } from "../src/render-matrix.js";

function createAuditSpy() {
  const success = mock(async () => {});
  const failure = mock(async () => {});
  const auditTrail = {
    logSuccess: success,
    logFailure: failure,
  } as unknown as AuditTrail;
  return { auditTrail, success, failure };
}

const BASE_MODE: RenderMode = {
  location: "server",
  time: "prepared",
  technology: "wasm",
  target: "wav-m4a-flac",
};

function buildAsset(overrides: Partial<AvailabilityAsset> = {}): AvailabilityAsset {
  const relativeSidPath = overrides.relativeSidPath ?? "C64Music/Artists/Track.sid";
  const songIndex = overrides.songIndex ?? 1;
  const format = overrides.format ?? "m4a";
  const renderMode = overrides.renderMode ?? BASE_MODE;
  const id =
    overrides.id ??
    createAvailabilityAssetId({
      relativeSidPath,
      songIndex,
      format,
      engine: overrides.engine ?? "wasm",
      renderMode,
    });

  return {
    id,
    relativeSidPath,
    songIndex,
    format,
    engine: overrides.engine ?? "wasm",
    renderMode,
    durationMs: overrides.durationMs ?? 120_000,
    sampleRate: overrides.sampleRate ?? 44_100,
    channels: overrides.channels ?? 2,
    sizeBytes: overrides.sizeBytes ?? 1_234_567,
    bitrateKbps: overrides.bitrateKbps ?? 256,
    codec: overrides.codec ?? "aac",
    storagePath: overrides.storagePath ?? "data/availability/assets/track.m4a",
    publicPath: overrides.publicPath ?? "/api/playback/assets/track.m4a",
    checksum: overrides.checksum,
    capture: overrides.capture,
    metadata: overrides.metadata,
    generatedAt: overrides.generatedAt ?? new Date().toISOString(),
  };
}

describe("availability manifest", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "sidflow-avail-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("registers a new asset and creates manifest", async () => {
    const manifestPath = path.join(tempDir, "manifest.json");
    const { auditTrail, success } = createAuditSpy();
    const asset = buildAsset();

    await registerAvailabilityAsset(manifestPath, asset, { auditTrail, actor: "test" });
    const manifest = await loadAvailabilityManifest(manifestPath);

    expect(manifest.version).toBe(AVAILABILITY_MANIFEST_VERSION);
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0]).toEqual({
      ...asset,
      relativeSidPath: "C64Music/Artists/Track.sid",
      storagePath: "data/availability/assets/track.m4a",
      publicPath: "/api/playback/assets/track.m4a",
    });
    expect(success).toHaveBeenCalled();
  });

  test("updates an existing asset when key matches", async () => {
    const manifestPath = path.join(tempDir, "manifest.json");
    const { auditTrail } = createAuditSpy();
    const asset = buildAsset({ sizeBytes: 10 });
    await registerAvailabilityAsset(manifestPath, asset, { auditTrail });

    const updated = { ...asset, sizeBytes: 20 };
    await registerAvailabilityAsset(manifestPath, updated, { auditTrail });

    const manifest = await loadAvailabilityManifest(manifestPath);
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0].sizeBytes).toBe(20);
  });

  test("finds and lists assets for a track", async () => {
    const manifestPath = path.join(tempDir, "manifest.json");
    const { auditTrail } = createAuditSpy();

    await registerAvailabilityAsset(manifestPath, buildAsset({ format: "wav" }), { auditTrail });
    await registerAvailabilityAsset(
      manifestPath,
      buildAsset({ format: "m4a", songIndex: 2 }),
      { auditTrail }
    );

    const manifest = await loadAvailabilityManifest(manifestPath);
    const found = findAvailabilityAsset(
      manifest,
      "C64Music/Artists/Track.sid",
      1,
      "wav"
    );
    expect(found).not.toBeNull();

    const listings = listAvailabilityAssets(manifest, "C64Music/Artists/Track.sid");
    expect(listings).toHaveLength(2);
    expect(listings.map((entry) => entry.format).sort()).toEqual(["m4a", "wav"]);
  });
});

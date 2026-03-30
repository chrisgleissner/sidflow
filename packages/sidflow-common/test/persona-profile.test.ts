import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createDefaultProfile,
  updateProfileFromFeedback,
  getEffectivePersona,
  loadProfile,
  saveProfile,
  getProfilePath,
  DEFAULT_PERSONA_PROFILE,
  type PersonaProfile,
} from "../src/persona-profile.js";
import { PERSONA_IDS, DEFAULT_PERSONA } from "../src/persona.js";

describe("createDefaultProfile", () => {
  test("produces valid profile with version 1", () => {
    const profile = createDefaultProfile();
    expect(profile.version).toBe(1);
  });

  test("has all 9 persona entries", () => {
    const profile = createDefaultProfile();
    for (const id of PERSONA_IDS) {
      expect(profile.perPersona[id]).toBeDefined();
      expect(profile.perPersona[id].skipRate).toBe(0);
      expect(profile.perPersona[id].trackCount).toBe(0);
      expect(profile.perPersona[id].lastUsed).toBeNull();
    }
  });

  test("defaults to melodic persona", () => {
    const profile = createDefaultProfile();
    expect(profile.lastPersonaId).toBe(DEFAULT_PERSONA);
  });

  test("has null global taste centroid", () => {
    const profile = createDefaultProfile();
    expect(profile.globalTasteCentroid).toBeNull();
  });

  test("has empty session history", () => {
    const profile = createDefaultProfile();
    expect(profile.sessionHistory).toEqual([]);
  });
});

describe("DEFAULT_PERSONA_PROFILE", () => {
  test("is equivalent to createDefaultProfile output", () => {
    const created = createDefaultProfile();
    expect(DEFAULT_PERSONA_PROFILE.version).toBe(created.version);
    expect(DEFAULT_PERSONA_PROFILE.lastPersonaId).toBe(created.lastPersonaId);
  });
});

describe("updateProfileFromFeedback", () => {
  test("skip action increases skip rate", () => {
    const profile = createDefaultProfile();
    const updated = updateProfileFromFeedback(profile, "skip", "melodic", "track:1");
    expect(updated.perPersona.melodic.skipRate).toBeGreaterThan(0);
    expect(updated.perPersona.melodic.trackCount).toBe(1);
    expect(updated.perPersona.melodic.lastUsed).not.toBeNull();
  });

  test("skip_early action increases skip rate", () => {
    const profile = createDefaultProfile();
    const updated = updateProfileFromFeedback(profile, "skip_early", "fast_paced", "track:2");
    expect(updated.perPersona.fast_paced.skipRate).toBeGreaterThan(0);
  });

  test("play_complete action decreases skip rate", () => {
    // Start with a non-zero skip rate
    const profile = createDefaultProfile();
    const afterSkip = updateProfileFromFeedback(profile, "skip", "melodic", "track:1");
    const afterComplete = updateProfileFromFeedback(afterSkip, "play_complete", "melodic", "track:2");
    expect(afterComplete.perPersona.melodic.skipRate).toBeLessThan(afterSkip.perPersona.melodic.skipRate);
  });

  test("replay action decreases skip rate", () => {
    const profile = createDefaultProfile();
    const afterSkip = updateProfileFromFeedback(profile, "skip", "experimental", "track:1");
    const afterReplay = updateProfileFromFeedback(afterSkip, "replay", "experimental", "track:2");
    expect(afterReplay.perPersona.experimental.skipRate).toBeLessThan(afterSkip.perPersona.experimental.skipRate);
  });

  test("adds track to session history", () => {
    const profile = createDefaultProfile();
    const updated = updateProfileFromFeedback(profile, "play_complete", "melodic", "track:1");
    expect(updated.sessionHistory).toContain("track:1");
  });

  test("does not duplicate tracks in session history", () => {
    const profile = createDefaultProfile();
    const first = updateProfileFromFeedback(profile, "play_complete", "melodic", "track:1");
    const second = updateProfileFromFeedback(first, "skip", "melodic", "track:1");
    expect(second.sessionHistory.filter((id) => id === "track:1")).toHaveLength(1);
  });

  test("updates lastPersonaId", () => {
    const profile = createDefaultProfile();
    const updated = updateProfileFromFeedback(profile, "play_complete", "experimental", "track:1");
    expect(updated.lastPersonaId).toBe("experimental");
  });

  test("is immutable — does not modify original profile", () => {
    const profile = createDefaultProfile();
    const original = JSON.stringify(profile);
    updateProfileFromFeedback(profile, "skip", "melodic", "track:1");
    expect(JSON.stringify(profile)).toBe(original);
  });
});

describe("getEffectivePersona", () => {
  test("returns default persona for null profile", () => {
    expect(getEffectivePersona(null)).toBe(DEFAULT_PERSONA);
  });

  test("returns lastPersonaId from profile", () => {
    const profile = createDefaultProfile();
    profile.lastPersonaId = "experimental";
    expect(getEffectivePersona(profile)).toBe("experimental");
  });
});

describe("profile persistence", () => {
  test("getProfilePath uses default dir", () => {
    const p = getProfilePath();
    expect(p).toContain("persona-profile.json");
    expect(p).toContain(".sidflow");
  });

  test("getProfilePath uses custom dir", () => {
    const p = getProfilePath("/tmp/custom");
    expect(p).toBe("/tmp/custom/persona-profile.json");
  });

  test("loadProfile returns default for missing file", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "sidflow-profile-test-"));
    try {
      const profile = await loadProfile(tmpDir);
      expect(profile.version).toBe(1);
      expect(profile.lastPersonaId).toBe(DEFAULT_PERSONA);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("saveProfile and loadProfile round-trip", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "sidflow-profile-test-"));
    try {
      const profile = createDefaultProfile();
      profile.lastPersonaId = "experimental";
      profile.perPersona.experimental.skipRate = 0.2;
      profile.perPersona.experimental.trackCount = 5;

      await saveProfile(profile, tmpDir);

      // Verify file exists and is valid JSON
      const raw = await readFile(path.join(tmpDir, "persona-profile.json"), "utf8");
      const parsed = JSON.parse(raw);
      expect(parsed.lastPersonaId).toBe("experimental");

      // Load it back
      const loaded = await loadProfile(tmpDir);
      expect(loaded.lastPersonaId).toBe("experimental");
      expect(loaded.perPersona.experimental.skipRate).toBe(0.2);
      expect(loaded.perPersona.experimental.trackCount).toBe(5);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

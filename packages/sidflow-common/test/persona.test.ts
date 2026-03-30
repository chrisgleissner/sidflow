import { describe, expect, test } from "bun:test";
import {
  PERSONA_IDS,
  PERSONAS,
  PERSONA_LIST,
  DEFAULT_PERSONA,
  PERSONA_METRIC_NAMES,
  parsePersonaId,
  type PersonaId,
  type PersonaDefinition,
} from "../src/persona.js";

describe("persona canonical definitions", () => {
  test("PERSONA_IDS has exactly 9 entries", () => {
    expect(PERSONA_IDS).toHaveLength(9);
  });

  test("PERSONA_IDS contains all expected IDs", () => {
    expect(PERSONA_IDS).toContain("fast_paced");
    expect(PERSONA_IDS).toContain("slow_ambient");
    expect(PERSONA_IDS).toContain("melodic");
    expect(PERSONA_IDS).toContain("experimental");
    expect(PERSONA_IDS).toContain("nostalgic");
    expect(PERSONA_IDS).toContain("composer_focus");
    expect(PERSONA_IDS).toContain("era_explorer");
    expect(PERSONA_IDS).toContain("deep_discovery");
    expect(PERSONA_IDS).toContain("theme_hunter");
  });

  test("PERSONAS record has one definition per ID", () => {
    for (const id of PERSONA_IDS) {
      expect(PERSONAS[id]).toBeDefined();
      expect(PERSONAS[id].id).toBe(id);
    }
  });

  test("PERSONA_LIST is ordered and matches PERSONA_IDS", () => {
    expect(PERSONA_LIST).toHaveLength(9);
    for (let i = 0; i < PERSONA_IDS.length; i++) {
      expect(PERSONA_LIST[i].id).toBe(PERSONA_IDS[i]);
    }
  });

  test("DEFAULT_PERSONA is melodic", () => {
    expect(DEFAULT_PERSONA).toBe("melodic");
  });

  test("first 5 personas are audio kind", () => {
    const audioPersonas = PERSONA_LIST.filter((p) => p.kind === "audio");
    expect(audioPersonas).toHaveLength(5);
    expect(audioPersonas.map((p) => p.id)).toEqual([
      "fast_paced",
      "slow_ambient",
      "melodic",
      "experimental",
      "nostalgic",
    ]);
  });

  test("last 4 personas are hybrid kind", () => {
    const hybridPersonas = PERSONA_LIST.filter((p) => p.kind === "hybrid");
    expect(hybridPersonas).toHaveLength(4);
    expect(hybridPersonas.map((p) => p.id)).toEqual([
      "composer_focus",
      "era_explorer",
      "deep_discovery",
      "theme_hunter",
    ]);
  });

  test("all persona metric weights sum to approximately 1", () => {
    for (const persona of PERSONA_LIST) {
      const sum = Object.values(persona.metricWeights).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 5);
    }
  });

  test("all personas have descriptions", () => {
    for (const persona of PERSONA_LIST) {
      expect(persona.description.length).toBeGreaterThan(0);
      expect(persona.label.length).toBeGreaterThan(0);
    }
  });

  test("hybrid personas have metadata policies", () => {
    for (const persona of PERSONA_LIST) {
      if (persona.kind === "hybrid") {
        expect(persona.metadataPolicy).not.toBeNull();
        expect(persona.metadataPolicy!.primaryMetadataFields.length).toBeGreaterThan(0);
      } else {
        expect(persona.metadataPolicy).toBeNull();
      }
    }
  });

  test("PERSONA_METRIC_NAMES has 5 entries", () => {
    expect(PERSONA_METRIC_NAMES).toHaveLength(5);
  });
});

describe("parsePersonaId", () => {
  test("accepts underscored IDs", () => {
    expect(parsePersonaId("fast_paced")).toBe("fast_paced");
    expect(parsePersonaId("slow_ambient")).toBe("slow_ambient");
    expect(parsePersonaId("composer_focus")).toBe("composer_focus");
  });

  test("accepts hyphenated IDs", () => {
    expect(parsePersonaId("fast-paced")).toBe("fast_paced");
    expect(parsePersonaId("slow-ambient")).toBe("slow_ambient");
    expect(parsePersonaId("composer-focus")).toBe("composer_focus");
    expect(parsePersonaId("era-explorer")).toBe("era_explorer");
    expect(parsePersonaId("deep-discovery")).toBe("deep_discovery");
    expect(parsePersonaId("theme-hunter")).toBe("theme_hunter");
  });

  test("is case-insensitive", () => {
    expect(parsePersonaId("MELODIC")).toBe("melodic");
    expect(parsePersonaId("Fast-Paced")).toBe("fast_paced");
  });

  test("returns undefined for invalid inputs", () => {
    expect(parsePersonaId("invalid")).toBeUndefined();
    expect(parsePersonaId("")).toBeUndefined();
    expect(parsePersonaId("fast paced")).toBeUndefined();
  });
});

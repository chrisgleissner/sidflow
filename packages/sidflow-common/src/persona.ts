// ---------------------------------------------------------------------------
// Canonical persona definitions — shared across CLI and web
// ---------------------------------------------------------------------------

/**
 * All 9 listening-mode persona IDs.
 * First 5 are audio-led; last 4 are metadata-aware (hybrid).
 */
export const PERSONA_IDS = [
  "fast_paced",
  "slow_ambient",
  "melodic",
  "experimental",
  "nostalgic",
  "composer_focus",
  "era_explorer",
  "deep_discovery",
  "theme_hunter",
] as const;

export type PersonaId = (typeof PERSONA_IDS)[number];

export type PersonaKind = "audio" | "hybrid";

export const DEFAULT_PERSONA: PersonaId = "melodic";

// ---------------------------------------------------------------------------
// Metric types
// ---------------------------------------------------------------------------

export type PersonaMetricName =
  | "melodicComplexity"
  | "rhythmicDensity"
  | "timbralRichness"
  | "nostalgiaBias"
  | "experimentalTolerance";

export const PERSONA_METRIC_NAMES: readonly PersonaMetricName[] = [
  "melodicComplexity",
  "rhythmicDensity",
  "timbralRichness",
  "nostalgiaBias",
  "experimentalTolerance",
] as const;

export interface PersonaMetrics {
  melodicComplexity: number;
  rhythmicDensity: number;
  timbralRichness: number;
  nostalgiaBias: number;
  experimentalTolerance: number;
}

// ---------------------------------------------------------------------------
// Metadata policy for hybrid personas
// ---------------------------------------------------------------------------

export interface PersonaMetadataPolicy {
  /** Metadata fields that provide bonus scoring. */
  primaryMetadataFields: string[];
  /** Diversity / anti-repetition rules description. */
  diversityRules: string;
  /** Soft vs hard constraint preference. */
  constraintMode: "soft" | "hard";
}

// ---------------------------------------------------------------------------
// Persona definition
// ---------------------------------------------------------------------------

export interface PersonaDefinition {
  id: PersonaId;
  label: string;
  kind: PersonaKind;
  description: string;
  /** Weights applied to each metric dimension when scoring. Sum should be 1. */
  metricWeights: Record<PersonaMetricName, number>;
  /** Direction per metric: +1 = higher is better, -1 = lower is better, 0 = ignore */
  metricDirections: Record<PersonaMetricName, 1 | -1 | 0>;
  /** Rating targets on the 1-5 scale (e, m, c) */
  ratingTargets: { e: number; m: number; c: number };
  /** Metadata policy for hybrid modes (null for audio-only). */
  metadataPolicy: PersonaMetadataPolicy | null;
  /** Explanation template for track inclusion. */
  explanationTemplate: string;
}

// ---------------------------------------------------------------------------
// The 9 persona definitions
// ---------------------------------------------------------------------------

export const PERSONAS: Record<PersonaId, PersonaDefinition> = {
  fast_paced: {
    id: "fast_paced",
    label: "Fast Paced",
    kind: "audio",
    description: "High energy, rhythmic drive",
    metricWeights: {
      rhythmicDensity: 0.60,
      experimentalTolerance: 0.15,
      melodicComplexity: 0.10,
      timbralRichness: 0.10,
      nostalgiaBias: 0.05,
    },
    metricDirections: {
      rhythmicDensity: 1,
      experimentalTolerance: -1,
      melodicComplexity: -1,
      timbralRichness: -1,
      nostalgiaBias: -1,
    },
    ratingTargets: { e: 5, m: 2, c: 3 },
    metadataPolicy: null,
    explanationTemplate: "Selected for Fast Paced: {reasons}",
  },
  slow_ambient: {
    id: "slow_ambient",
    label: "Slow / Ambient",
    kind: "audio",
    description: "Calm, low tempo",
    metricWeights: {
      rhythmicDensity: 0.60,
      melodicComplexity: 0.15,
      experimentalTolerance: 0.10,
      nostalgiaBias: 0.10,
      timbralRichness: 0.05,
    },
    metricDirections: {
      rhythmicDensity: -1,
      melodicComplexity: 1,
      experimentalTolerance: -1,
      nostalgiaBias: -1,
      timbralRichness: 0,
    },
    ratingTargets: { e: 2, m: 4, c: 4 },
    metadataPolicy: null,
    explanationTemplate: "Selected for Slow / Ambient: {reasons}",
  },
  melodic: {
    id: "melodic",
    label: "Melodic",
    kind: "audio",
    description: "Rich melodies, harmonic depth",
    metricWeights: {
      melodicComplexity: 0.60,
      timbralRichness: 0.15,
      rhythmicDensity: 0.10,
      nostalgiaBias: 0.10,
      experimentalTolerance: 0.05,
    },
    metricDirections: {
      melodicComplexity: 1,
      timbralRichness: 1,
      rhythmicDensity: 0,
      nostalgiaBias: -1,
      experimentalTolerance: -1,
    },
    ratingTargets: { e: 3, m: 5, c: 5 },
    metadataPolicy: null,
    explanationTemplate: "Selected for Melodic: {reasons}",
  },
  experimental: {
    id: "experimental",
    label: "Experimental",
    kind: "audio",
    description: "Unusual timbres, sonic exploration",
    metricWeights: {
      experimentalTolerance: 0.60,
      timbralRichness: 0.15,
      rhythmicDensity: 0.10,
      nostalgiaBias: 0.10,
      melodicComplexity: 0.05,
    },
    metricDirections: {
      experimentalTolerance: 1,
      timbralRichness: 1,
      rhythmicDensity: 0,
      nostalgiaBias: -1,
      melodicComplexity: -1,
    },
    ratingTargets: { e: 5, m: 2, c: 5 },
    metadataPolicy: null,
    explanationTemplate: "Selected for Experimental: {reasons}",
  },
  nostalgic: {
    id: "nostalgic",
    label: "Nostalgic",
    kind: "audio",
    description: "Classic SID, warm familiarity",
    metricWeights: {
      nostalgiaBias: 0.60,
      melodicComplexity: 0.15,
      rhythmicDensity: 0.10,
      experimentalTolerance: 0.10,
      timbralRichness: 0.05,
    },
    metricDirections: {
      nostalgiaBias: 1,
      melodicComplexity: 1,
      rhythmicDensity: 1,
      experimentalTolerance: -1,
      timbralRichness: -1,
    },
    ratingTargets: { e: 3, m: 5, c: 3 },
    metadataPolicy: null,
    explanationTemplate: "Selected for Nostalgic: {reasons}",
  },

  // --- metadata-aware (hybrid) personas ---

  composer_focus: {
    id: "composer_focus",
    label: "Composer Focus",
    kind: "hybrid",
    description: "One composer, without manual browsing",
    metricWeights: {
      melodicComplexity: 0.25,
      timbralRichness: 0.20,
      rhythmicDensity: 0.20,
      nostalgiaBias: 0.15,
      experimentalTolerance: 0.20,
    },
    metricDirections: {
      melodicComplexity: 1,
      timbralRichness: 1,
      rhythmicDensity: 0,
      nostalgiaBias: 0,
      experimentalTolerance: 0,
    },
    ratingTargets: { e: 3, m: 4, c: 4 },
    metadataPolicy: {
      primaryMetadataFields: ["composer"],
      diversityRules: "Anti-repetition: max 2 tracks per SID file, spread across era",
      constraintMode: "soft",
    },
    explanationTemplate: "Selected for Composer Focus: {reasons}",
  },
  era_explorer: {
    id: "era_explorer",
    label: "Era Explorer",
    kind: "hybrid",
    description: "Historically coherent era journeys",
    metricWeights: {
      melodicComplexity: 0.20,
      rhythmicDensity: 0.20,
      timbralRichness: 0.20,
      nostalgiaBias: 0.20,
      experimentalTolerance: 0.20,
    },
    metricDirections: {
      melodicComplexity: 0,
      rhythmicDensity: 0,
      timbralRichness: 0,
      nostalgiaBias: 0,
      experimentalTolerance: 0,
    },
    ratingTargets: { e: 3, m: 3, c: 3 },
    metadataPolicy: {
      primaryMetadataFields: ["year", "category"],
      diversityRules: "Prefer nearby years, max 3 tracks per composer within era",
      constraintMode: "soft",
    },
    explanationTemplate: "Selected for Era Explorer: {reasons}",
  },
  deep_discovery: {
    id: "deep_discovery",
    label: "Deep Discovery",
    kind: "hybrid",
    description: "Obscure deep cuts near your taste",
    metricWeights: {
      melodicComplexity: 0.25,
      timbralRichness: 0.20,
      rhythmicDensity: 0.20,
      nostalgiaBias: 0.15,
      experimentalTolerance: 0.20,
    },
    metricDirections: {
      melodicComplexity: 1,
      timbralRichness: 1,
      rhythmicDensity: 0,
      nostalgiaBias: -1,
      experimentalTolerance: 1,
    },
    ratingTargets: { e: 3, m: 3, c: 4 },
    metadataPolicy: {
      primaryMetadataFields: ["rarity"],
      diversityRules: "Boost rarity/obscurity, penalize canonical tracks",
      constraintMode: "soft",
    },
    explanationTemplate: "Selected for Deep Discovery: {reasons}",
  },
  theme_hunter: {
    id: "theme_hunter",
    label: "Theme Hunter",
    kind: "hybrid",
    description: "Theme-led stations from track titles",
    metricWeights: {
      melodicComplexity: 0.25,
      rhythmicDensity: 0.15,
      timbralRichness: 0.20,
      nostalgiaBias: 0.20,
      experimentalTolerance: 0.20,
    },
    metricDirections: {
      melodicComplexity: 1,
      rhythmicDensity: 0,
      timbralRichness: 0,
      nostalgiaBias: 0,
      experimentalTolerance: 0,
    },
    ratingTargets: { e: 3, m: 4, c: 3 },
    metadataPolicy: {
      primaryMetadataFields: ["titleThemeTags", "year", "category"],
      diversityRules: "Cluster by theme, spread across years and composers",
      constraintMode: "soft",
    },
    explanationTemplate: "Selected for Theme Hunter: {reasons}",
  },
};

/**
 * Ordered array of persona definitions (same order as PERSONA_IDS).
 */
export const PERSONA_LIST: PersonaDefinition[] = PERSONA_IDS.map((id) => PERSONAS[id]);

/**
 * Parse a user-supplied persona string (hyphenated or underscored) into a PersonaId.
 * Returns undefined if the string is not a valid persona.
 */
export function parsePersonaId(input: string): PersonaId | undefined {
  const normalized = input.toLowerCase().replace(/-/g, "_");
  return PERSONA_IDS.includes(normalized as PersonaId)
    ? (normalized as PersonaId)
    : undefined;
}

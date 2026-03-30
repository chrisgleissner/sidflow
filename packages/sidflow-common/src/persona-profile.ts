// ---------------------------------------------------------------------------
// Persona profile — user preferences persisted across sessions
// ---------------------------------------------------------------------------

import {
  PERSONA_IDS,
  DEFAULT_PERSONA,
  type PersonaId,
  type PersonaMetrics,
} from "./persona.js";

// ---------------------------------------------------------------------------
// Profile types
// ---------------------------------------------------------------------------

export interface PersonaTasteModifier {
  /** Implicit skip rate in this persona (0-1). Higher = more skips = lower affinity. */
  skipRate: number;
  /** Number of tracks played in this persona. */
  trackCount: number;
  /** Timestamp of last use (ISO 8601). */
  lastUsed: string | null;
}

export interface PersonaProfile {
  version: 1;
  /** Last-used persona ID, used as default when no --persona flag given. */
  lastPersonaId: PersonaId;
  /** Per-persona taste modifiers — accumulated from persona-specific sessions. */
  perPersona: Record<PersonaId, PersonaTasteModifier>;
  /** Global taste centroid — from all explicit ratings regardless of persona. */
  globalTasteCentroid: PersonaMetrics | null;
  /** Track IDs played in current session, for recency penalty. */
  sessionHistory: string[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function createDefaultTasteModifier(): PersonaTasteModifier {
  return {
    skipRate: 0,
    trackCount: 0,
    lastUsed: null,
  };
}

export function createDefaultProfile(): PersonaProfile {
  const perPersona = {} as Record<PersonaId, PersonaTasteModifier>;
  for (const id of PERSONA_IDS) {
    perPersona[id] = createDefaultTasteModifier();
  }
  return {
    version: 1,
    lastPersonaId: DEFAULT_PERSONA,
    perPersona,
    globalTasteCentroid: null,
    sessionHistory: [],
  };
}

export const DEFAULT_PERSONA_PROFILE: PersonaProfile = createDefaultProfile();

// ---------------------------------------------------------------------------
// Profile updates
// ---------------------------------------------------------------------------

export type ProfileFeedbackAction = "play_complete" | "skip" | "skip_early" | "replay" | "rate";

/**
 * Immutably update a profile based on user feedback.
 */
export function updateProfileFromFeedback(
  profile: PersonaProfile,
  action: ProfileFeedbackAction,
  personaId: PersonaId,
  trackId: string,
): PersonaProfile {
  const modifier = { ...profile.perPersona[personaId] };
  const now = new Date().toISOString();

  switch (action) {
    case "skip":
    case "skip_early": {
      // Increase skip rate using exponential moving average
      const alpha = 0.1;
      modifier.skipRate = modifier.skipRate * (1 - alpha) + alpha;
      modifier.trackCount += 1;
      modifier.lastUsed = now;
      break;
    }
    case "play_complete":
    case "replay": {
      // Decrease skip rate (track was enjoyed)
      const alpha = 0.1;
      modifier.skipRate = modifier.skipRate * (1 - alpha);
      modifier.trackCount += 1;
      modifier.lastUsed = now;
      break;
    }
    case "rate": {
      // Rating doesn't change skip rate but updates timestamp
      modifier.lastUsed = now;
      break;
    }
  }

  const perPersona = { ...profile.perPersona, [personaId]: modifier };

  // Add to session history (simple deduplication)
  const sessionHistory = profile.sessionHistory.includes(trackId)
    ? profile.sessionHistory
    : [...profile.sessionHistory, trackId];

  return {
    ...profile,
    perPersona,
    sessionHistory,
    lastPersonaId: personaId,
  };
}

/**
 * Get the effective persona ID from a profile.
 * Returns the last-used persona or the default.
 */
export function getEffectivePersona(profile: PersonaProfile | null): PersonaId {
  if (!profile) return DEFAULT_PERSONA;
  return profile.lastPersonaId;
}

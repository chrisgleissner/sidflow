---
description: Implement user-facing listener persona system with instant mode switching, sensible fallbacks, and progressive personalization across CLI and web.
---

# Listener Persona System Implementation

Implement the user-facing listener persona system described in `doc/research/listener-personas.md`.

Read the full research document before starting. This prompt is implementation-ready and references exact files, types, and APIs.

---

# Convergence Contract

This prompt uses strong convergence. Work iteratively until ALL of the following are true:

- `bun run build` passes locally with zero errors
- `bun run test` passes locally (unit tests)
- `bun test integration-tests/hvsc-persona-station.test.ts` passes (E2E persona test)
- Push the branch and confirm CI is green via `gh run list --branch <branch> --limit 1`
- If CI fails, read the logs with `gh run view <id> --log-failed`, fix locally, push again
- Repeat until CI is fully green

Do NOT mark any task as complete until both local and CI builds are green.

---

# Architecture Overview

The user-facing persona system has 9 listening modes (not personality types):

| ID | Label | Class | Primary signals |
|----|-------|-------|-----------------|
| `fast_paced` | Fast Paced | audio-led | rhythmic density, energy, forward drive |
| `slow_ambient` | Slow / Ambient | audio-led | low density, low tempo, calm |
| `melodic` | Melodic | audio-led | melodic complexity, harmonic depth |
| `experimental` | Experimental | audio-led | unusual timbres, sonic risk |
| `nostalgic` | Nostalgic | audio-led | nostalgia bias, classic SID familiarity |
| `composer_focus` | Composer Focus | metadata-led | composer identity, era spread, anti-repetition |
| `era_explorer` | Era Explorer | metadata-led | year / era coherence, category, audio continuity |
| `deep_discovery` | Deep Discovery | metadata-led | rarity / obscurity, nearby audio fit, provenance |
| `theme_hunter` | Theme Hunter | metadata-led | title-theme tags, year, category, audio support |

The first 5 modes are direct descendants of the current metric-based persona prototype. The remaining 4 are the smallest metadata-aware set that still covers the most common non-sonic intents.

Advanced needs such as hardware purity, subtune excavation, and editorial survey should remain filters or templates, not top-level modes.

The existing audio scoring engine already exists in `packages/sidflow-play/src/persona-station.ts` with `buildParallelPersonaStation()`. This prompt extends that work into a user-facing 9-mode system.

---

# Phase 1 — Shared Persona Types and Scoring API

## 1.1 Create `packages/sidflow-common/src/persona.ts`

Export the canonical persona definitions and types so both CLI and web can share them.

Move from `persona-station.ts` into this shared module:

- `PersonaId` — union type: `'fast_paced' | 'slow_ambient' | 'melodic' | 'experimental' | 'nostalgic' | 'composer_focus' | 'era_explorer' | 'deep_discovery' | 'theme_hunter'`
- `PERSONA_IDS` — readonly array of all 9 IDs
- `PersonaKind` — `'audio' | 'hybrid'`
- `PersonaDefinition` — the full definition, including metric weights for audio-led modes and metadata policy for hybrid modes
- `PERSONAS` — the 9 persona definitions
- `DEFAULT_PERSONA` — `'melodic'` (sensible fallback for unknown users)
- `PersonaMetrics` — the 5-dimensional metric type
- `PersonaMetricName` — the union of metric keys

Keep the current metric/direction definitions for the first 5 audio-led modes. Add 4 metadata-aware definitions for the new modes with:

- concise user-facing descriptions
- metadata filter preferences
- diversity / anti-repetition rules
- explanation templates

Add a barrel export from `packages/sidflow-common/src/index.ts`.

Update `packages/sidflow-play/src/persona-station.ts` to import from `@sidflow/common` instead of defining locally.

### Acceptance criteria

- No duplicate persona definitions exist in the codebase
- `persona-station.ts` imports from `@sidflow/common`
- Existing E2E test still passes with zero changes to test code

## 1.2 Create `packages/sidflow-common/src/persona-scorer.ts`

Extract a reusable scoring function that both CLI and web can call without the full station builder:

```typescript
export interface PersonaTrackContext {
  metrics: PersonaMetrics;
  ratings: { e?: number; m?: number; c?: number };
  metadata?: {
    category?: string;
    composer?: string;
    year?: number;
    sidType?: string;
    sidChipCount?: number;
    sidModel?: string;
    clock?: string;
    subtuneCount?: number;
    titleThemeTags?: string[];
  };
  rarity?: number;
}

export function scoreTrackForPersona(
  context: PersonaTrackContext,
  personaId: PersonaId,
): { score: number; breakdown: Record<string, number> }
```

This wraps the existing `scoreTrack()` logic for the first 5 audio-led modes and extends it with deterministic metadata bonuses/penalties for the 4 metadata-aware modes.

Also export:

```typescript
export function scoreAllPersonas(
  context: PersonaTrackContext,
): Record<PersonaId, number>
```

This returns all 9 persona scores for a single track, used for pre-computation and instant switching.

### Acceptance criteria

- Unit tests in `packages/sidflow-common/src/__tests__/persona-scorer.test.ts`
- Tests verify that scoring is deterministic
- Tests verify that the first 5 audio-led modes preserve the existing primary-metric behavior
- Tests verify that metadata-aware modes respond to the intended metadata fields

## 1.3 Create `packages/sidflow-common/src/persona-profile.ts`

Define the user profile schema for persona preferences:

```typescript
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

export interface PersonaTasteModifier {
  /** Implicit skip rate in this persona (0-1). Higher = more skips = lower affinity. */
  skipRate: number;
  /** Number of tracks played in this persona. */
  trackCount: number;
  /** Timestamp of last use (ISO 8601). */
  lastUsed: string | null;
}

export const DEFAULT_PERSONA_PROFILE: PersonaProfile = { ... };
```

Include:

- `createDefaultProfile(): PersonaProfile`
- `updateProfileFromFeedback(profile, action, personaId, trackId): PersonaProfile`
- `getEffectivePersona(profile): PersonaId` — returns `lastPersonaId` or `DEFAULT_PERSONA`
- `applyRecencyPenalty(score, trackId, sessionHistory, halfLifeMinutes): number`

### Acceptance criteria

- Unit tests for profile creation, feedback update, and recency penalty
- `createDefaultProfile()` produces a valid profile with all 9 persona entries
- `updateProfileFromFeedback` with action `'skip'` increases the persona's skip rate
- `applyRecencyPenalty` reduces score for recently played tracks

---

# Phase 2 — CLI Integration

## 2.1 Add `--persona` flag to `packages/sidflow-play/src/cli.ts`

Add a new CLI argument:

```typescript
{
  name: "--persona",
  type: "string",
  description: "Listening mode (fast-paced, ambient, melodic, experimental, nostalgic, composer-focus, era-explorer, deep-discovery, theme-hunter)"
}
```

Accept both hyphenated (`fast-paced`) and underscored (`fast_paced`) forms. Map to `PersonaId`.

When `--persona` is provided:

- Load the classified corpus (or SQLite similarity export)
- Score all tracks for the selected persona using `scoreTrackForPersona`
- For metadata-led modes, include normalized metadata and title-theme tags in the scoring context
- Build the playlist from the top-ranked tracks instead of the current mood-preset path
- Apply recency penalty from profile session history

When `--persona` is omitted:

- Use the existing behavior (backward compatible)
- The existing `--mood` presets continue to work unchanged

## 2.2 Add interactive persona switching during playback

During interactive CLI playback (when `--play-only` is not set), add keypress bindings:

```
[1] Fast  [2] Ambient  [3] Melodic  [4] Experimental  [5] Nostalgic
[6] Composer  [7] Era  [8] Discovery  [9] Theme
```

When a number key is pressed:

1. Update `profile.lastPersonaId`
2. Keep the currently playing track
3. Rebuild the queue from the new persona's rankings, excluding already-played tracks
4. Print a one-line status: `Switched to Melodic mode (queue rebuilt, 47 tracks)`

### Acceptance criteria

- `sidflow-play --persona melodic --limit 20` produces a playlist
- `sidflow-play --persona fast-paced --export-only --export /tmp/test.json` exports persona-scored tracks
- Omitting `--persona` produces identical output to before (regression test)
- Interactive switching rebuilds queue without interrupting playback

---

# Phase 3 — Web API Integration

## 3.1 Add `persona` parameter to play API routes

Update the following API routes to accept an optional `persona` field in the request body:

- `packages/sidflow-web/app/api/play/route.ts` (manual play)
- `packages/sidflow-web/app/api/play/random/route.ts`
- `packages/sidflow-web/app/api/play/station-from-song/route.ts`
- `packages/sidflow-web/app/api/play/adaptive-station/route.ts`

Schema addition (Zod):

```typescript
persona: z.enum([
  'fast_paced',
  'slow_ambient',
  'melodic',
  'experimental',
  'nostalgic',
  'composer_focus',
  'era_explorer',
  'deep_discovery',
  'theme_hunter',
]).optional()
```

When `persona` is present:

- Apply persona scoring as a reranking step on the candidate tracks
- For metadata-led modes, the reranking must use normalized metadata context, not just audio metrics
- Return the persona ID in the response so the client knows which mode was used

When `persona` is absent:

- Existing behavior unchanged (backward compatible)

### Acceptance criteria

- `POST /api/play/random` with `{ "persona": "experimental" }` returns tracks biased toward experimental tolerance
- `POST /api/play/random` without `persona` field returns identical behavior to before
- Invalid persona values return 400 with a clear error message

## 3.2 Add `POST /api/play/persona-station` endpoint

New route: `packages/sidflow-web/app/api/play/persona-station/route.ts`

Request:

```typescript
{
  persona: PersonaId;          // required
  limit?: number;              // default 50
  excludeTrackIds?: string[];  // for recency/anti-repeat
}
```

Response:

```typescript
{
  persona: PersonaId;
  tracks: Array<{
    sidPath: string;
    songIndex: number;
    score: number;
    explanation: string;
    metrics: PersonaMetrics;
  }>;
}
```

This endpoint builds a full persona station from the classified corpus. It uses the shared scoring API, not the E2E subset manifest.

### Acceptance criteria

- Returns 50 tracks by default
- Tracks are sorted by score descending
- Each track has an explanation string
- Returns 400 for invalid persona ID

## 3.3 Add `POST /api/play/persona-scores` endpoint

New route: `packages/sidflow-web/app/api/play/persona-scores/route.ts`

Request:

```typescript
{
  trackIds: string[];  // up to 500
}
```

Response:

```typescript
{
  scores: Record<string, Record<PersonaId, number>>;
}
```

This endpoint returns all 9 persona scores for a batch of tracks. The web client uses this to pre-compute scores and enable instant switching without server round-trips.

### Acceptance criteria

- Batch of 100 track IDs returns scores in under 500ms
- Returns empty record for unknown track IDs (not an error)
- Capped at 500 track IDs per request (400 error if exceeded)

---

# Phase 4 — Web UI Persona Bar

## 4.1 Create `packages/sidflow-web/components/PersonaBar.tsx`

A compact two-row bar of 9 buttons, one per listening mode. Always visible in the player area, with the first row for audio-led modes and the second row for metadata-led modes.

Props:

```typescript
interface PersonaBarProps {
  activePersona: PersonaId | null;  // null = no persona active (default mode)
  onPersonaChange: (persona: PersonaId | null) => void;
  disabled?: boolean;
}
```

Behavior:

- Clicking the active persona deactivates it (returns to default mode, `onPersonaChange(null)`)
- Clicking an inactive persona activates it
- Active button is visually highlighted (use existing theme tokens)
- Each button shows the persona label and a single-line description:
  - Fast Paced: "High energy, rhythmic drive"
  - Slow / Ambient: "Calm, low tempo"
  - Melodic: "Rich melodies, harmonic depth"
  - Experimental: "Unusual timbres, sonic exploration"
  - Nostalgic: "Classic SID, warm familiarity"
  - Composer Focus: "One composer, without manual browsing"
  - Era Explorer: "Historically coherent era journeys"
  - Deep Discovery: "Obscure deep cuts near your taste"
  - Theme Hunter: "Theme-led stations from track titles"

### Acceptance criteria

- Component renders 9 buttons
- Clicking triggers `onPersonaChange` with the correct ID
- Active state is visually distinct
- Null state (no persona) is supported

## 4.2 Integrate PersonaBar into PlayTab

In `packages/sidflow-web/components/PlayTab.tsx`:

1. Add `PersonaBar` above or below the existing playback controls
2. Store active persona in component state
3. When persona changes, call the persona-station or persona-scores endpoint
4. Rebuild the upcoming queue client-side using pre-fetched scores
5. Do NOT interrupt the currently playing track

### First-visit experience

When no persona has been selected:

- All 9 buttons are available in their default (inactive) visual state
- The player uses the existing recommendation logic (no persona scoring)
- A small help text below the bar: "Choose a listening mode to shape your station"

### Acceptance criteria

- PersonaBar appears in the PlayTab
- Switching persona does not interrupt current playback
- First visit shows all 9 options without requiring any setup
- The existing play flow works unchanged when no persona is active

---

# Phase 5 — Fallback Hierarchy

## 5.1 Implement the fallback chain in scoring

In `packages/sidflow-common/src/persona-scorer.ts`, add:

```typescript
export function scoreWithFallback(
  context: PersonaTrackContext,
  personaId: PersonaId,
  profile: PersonaProfile | null,
): number
```

Fallback levels:

1. **Full personalization** (profile has global centroid + persona modifier): apply taste centroid bias + persona modifier + base persona score
2. **Partial personalization** (profile exists but no persona-specific data): apply global centroid bias + base persona score
3. **No personalization** (profile is null): use base persona score only

The base persona score (level 3) must always produce a valid ranking. Levels 1 and 2 are additive adjustments that nudge the ranking, not replacements.

### Acceptance criteria

- `scoreWithFallback` with `null` profile returns the same score as `scoreTrackForPersona`
- With a profile that has a global centroid, scores are nudged but not dramatically different
- Unit test: audio-led ranking order is preserved (the primary metric leader doesn't change)
- Unit test: metadata-led fallback never discards the persona's defining metadata preference

## 5.2 Implement session recency penalty

In the station builder (both CLI and web), apply recency penalty to all tracks in the session history:

```typescript
const RECENCY_HALF_LIFE_MINUTES = 30;

function applyRecencyPenalty(
  baseScore: number,
  trackId: string,
  sessionHistory: Array<{ trackId: string; timestamp: number }>,
  nowMs: number,
): number {
  const entry = sessionHistory.find(h => h.trackId === trackId);
  if (!entry) return baseScore;
  const ageMinutes = (nowMs - entry.timestamp) / 60_000;
  const decay = Math.pow(0.5, ageMinutes / RECENCY_HALF_LIFE_MINUTES);
  return baseScore * (1 - 0.4 * decay);  // max 40% penalty, decaying over time
}
```

This prevents repeated tracks when switching between personas.

### Acceptance criteria

- A track played 0 minutes ago gets 40% score penalty
- A track played 30 minutes ago gets 20% penalty (half-life)
- A track played 2 hours ago gets < 3% penalty (effectively no penalty)
- Unit test with exact penalty values

---

# Phase 6 — Profile Persistence

## 6.1 CLI profile storage

Store the persona profile at `~/.sidflow/persona-profile.json`.

- Load on startup, create with defaults if missing
- Update `lastPersonaId` on persona switch
- Update session history on track play
- Save on exit

Use the existing `ensureDir` utility for directory creation.

## 6.2 Web profile storage

Extend `packages/sidflow-web/lib/preferences/schema.ts`:

Add to `BrowserPreferences` (bump to v3 with migration):

```typescript
persona: {
  activePersonaId: PersonaId | null;
  perPersona: Record<PersonaId, { skipRate: number; trackCount: number; lastUsed: string | null }>;
}
```

Store in localStorage alongside existing preferences. Migrate v2 -> v3 by adding default persona state.

### Acceptance criteria

- v2 preferences auto-migrate to v3 with default persona state
- Active persona persists across page reloads
- Per-persona stats accumulate correctly

---

# Phase 7 — Test Hardening

## 7.1 Unit tests

Add or extend unit tests in:

- `packages/sidflow-common/src/__tests__/persona.test.ts` — canonical definitions
- `packages/sidflow-common/src/__tests__/persona-scorer.test.ts` — scoring determinism, fallback chain
- `packages/sidflow-common/src/__tests__/persona-profile.test.ts` — profile CRUD, recency penalty

## 7.2 E2E persona test update

Update `integration-tests/hvsc-persona-station.test.ts`:

- Verify that `buildParallelPersonaStation` uses the shared types from `@sidflow/common`
- Add a test that `scoreAllPersonas` produces the same scores as the station builder for the 5 audio-led modes
- Add deterministic assertions for the 5 metadata-led modes using a fixed metadata fixture set
- Verify deterministic output is maintained

## 7.3 Web API tests

If Playwright E2E tests exist for the play API routes, extend them to cover:

- `POST /api/play/persona-station` with each persona ID
- `POST /api/play/random` with and without persona field
- `POST /api/play/persona-scores` batch endpoint

---

# Phase 8 — Documentation

Do NOT create new markdown files. Update existing files only:

- Update `PLANS.md` with the implementation phase and evidence
- Update `WORKLOG.md` with timestamped completion
- Update `STATE.json` with validation results

---

# Convergence Checklist

Before declaring completion, verify each item:

- [ ] `bun run build` — zero errors
- [ ] `bun run test` — all unit tests pass
- [ ] `bun test integration-tests/hvsc-persona-station.test.ts` — E2E passes
- [ ] CLI: `sidflow-play --persona melodic --limit 10 --export-only --export /tmp/test.json` works
- [ ] CLI: omitting `--persona` produces unchanged behavior
- [ ] Web: `POST /api/play/persona-station` returns valid response for each persona
- [ ] Web: `POST /api/play/random` without persona returns unchanged behavior
- [ ] Web: PersonaBar renders and switches without interrupting playback
- [ ] Fallback: null profile produces valid stations
- [ ] Recency penalty: switching back surfaces fresh tracks
- [ ] Determinism: two runs produce identical output
- [ ] Profile: persists across CLI restarts and web page reloads
- [ ] Push branch and confirm CI green via `gh run list --branch <branch> --limit 1`
- [ ] If CI fails: `gh run view <id> --log-failed`, fix, push, repeat until green

---

# Execution Rules

- Implement phases in order. Each phase builds on the previous.
- Run `bun run build` after each phase to catch type errors early.
- Run relevant tests after each phase, not just at the end.
- Do NOT skip phases. Do NOT reorder phases.
- If a phase requires changes to existing tests, make those changes and verify the test still passes.
- If a type error or test failure occurs, fix it before proceeding to the next phase.
- Backward compatibility is mandatory: existing behavior without persona parameters must not change.

# SIDFlow Rollout

**Required reading:** `sidflow-project-spec.md`

## Execution Rules

- Work through phases strictly in order; do not begin a new phase until the prior phase's checklist is complete.
- Before checking any box, ensure automated tests cover the change, all tests pass, and coverage remains above 90% in CI.

## Phase 1 — Monorepo & Shared Foundation

### Phase 1 Checklist

- [x] Scaffold Bun workspace with packages: `sidflow-fetch`, `sidflow-tag`, `sidflow-classify`, `sidflow-common`.
- [x] Implement `.sidflow.json` ingestion and shared logging/config utilities in `sidflow-common`.
- [x] Add GitHub Actions CI with Bun setup, build, test with coverage, and Codecov upload.
- [x] Publish `.github/copilot-instructions.md` to guide contributions and enforce strict TypeScript practices.
- [x] Bun workspace builds cleanly; `bun test --coverage` reports ≥90% coverage for foundation modules.
- [x] CI pipeline green on default branch with Codecov gate configured.
- [x] README updated with repository structure and first-run guidance referencing the spec.

## Phase 2 — HVSC Synchronization (`sidflow-fetch`)

### Phase 2 Checklist

- [x] Implement smart HVSC base/delta downloader with retry logic and checksum validation.
- [x] Persist `hvsc-version.json` with last applied versions, timestamps, and checksums.
- [x] Ensure idempotent behavior: re-running across empty or current trees leaves data consistent.
- [x] Abstract archive handling and `sidplayfp` discovery via `sidflow-common` utilities.
- [x] CLI command `sidflow fetch` syncs a sample HVSC subtree end-to-end in CI.
- [x] Unit/integration tests cover success, delta updates, and failure scenarios (network, checksum mismatch).
- [x] Documentation includes troubleshooting for network outages and checksum mismatches.

## Phase 3 — Manual Tagging (`sidflow-tag`)

### Phase 3 Checklist

- [x] Build interactive CLI that cycles through untagged `.sid` files with sequential/random modes.
- [x] Wire keyboard controls for energy (`e1-5`), mood (`m1-5`), complexity (`c1-5`), save (`Enter`), quit (`Q`).
- [x] Serialize deterministic `*.sid.tags.json` files adjacent to source SIDs with timestamps and source markers.
- [x] Integrate `sidplayfp` playback management with graceful error handling and overrides.
- [x] CLI demo covers default flow, override flags, and tag persistence with deterministic ordering.
- [x] Automated tests validate key bindings, file output, and configuration fallbacks (mocked players/filesystem).
- [x] README and in-tool help explain tagging semantics (`e/m/c`) and workflow expectations.

## Phase 4 — Automated Classification (`sidflow-classify`)

### Phase 4 Checklist

- [x] Implement WAV caching pipeline using `sidplayfp -w`, respecting `threads` and cache freshness.
- [ ] Integrate Essentia.js for feature extraction and a lightweight TF.js regressor producing `(e,m,c)`.
- [x] Merge manual and auto tags without overwriting manual values; fill gaps only.
- [x] Generate `auto-tags.json` per folder level defined by `classificationDepth`, with deterministic ordering.
- [x] Capture metadata via `sidplayfp -t1 --none` for use in tagging and future features.
- [x] CLI processes a curated HVSC sample, producing WAV cache, metadata, and aggregated auto-tag files.
- [x] Regression tests ensure manual tags take precedence and feature extraction/model steps are repeatable.
- [x] Performance metrics recorded (runtime, cache reuse) and documented for future scaling.

Current status: the classify CLI, metadata capture, WAV cache, auto-tag generation, and performance metrics are live and covered by tests. Essentia.js + TF.js integration remains outstanding, so the pipeline defaults to heuristic feature and prediction helpers.

## Phase 4.5 — Rename Speed to Energy

### Phase 4.5 Checklist

- [ ] Rename `s` field to `e` (energy) in all data structures and interfaces (TagRatings, etc.).
- [ ] Update documentation to use "energy" instead of "speed" throughout.
- [ ] Update CLI help text and keyboard shortcuts from `s1-5` to `e1-5`.
- [ ] Update all source code comments referencing speed/tempo to use energy.
- [ ] Update README and specification documents to reflect energy terminology.
- [ ] Ensure backwards compatibility or migration path for existing tagged files.

**Rationale:**  
"Energy" is more technically accurate than "speed" for describing the intensity and drive of a musical piece. While "speed" might suggest tempo (BPM), "energy" better captures the combined effect of dynamics, rhythmic intensity, and overall drive that the rating system measures.

**Migration:**
- Existing `*.sid.tags.json` files with `"s":` field should be readable as `"e":` via compatibility layer
- New files written with `"e":` field
- Documentation updated to explain the terminology change

## Phase 5 — JSONL Classification Output & Data Formats

### Phase 5 Checklist

- [ ] Define and implement extensible JSONL schema for classification output with `sid_path`, nested `tags` object (`e`, `m`, `c`), and `features` object, storing one record per line.
- [ ] Update classification pipeline to output `classified/*.jsonl` files preserving all extracted features (energy, rms, spectralCentroid, bpm, etc.) with deterministic ordering and VS Code "JSON Lines" extension support.
- [ ] Provide optional converter `bun run format:json` for pretty-printing JSONL to readable JSON for human review.

**JSONL Schema (Nested Tags + Extended Features):**
```jsonl
{"sid_path":"Rob_Hubbard/Delta.sid","tags":{"e":3,"m":4,"c":5},"features":{"energy":0.42,"rms":0.15,"spectralCentroid":2150,"spectralRolloff":4200,"zeroCrossingRate":0.08,"bpm":128,"confidence":0.85,"duration":180}}
{"sid_path":"Martin_Galway/Parallax.sid","tags":{"e":2,"m":5,"c":4},"features":{"energy":0.18,"rms":0.09,"spectralCentroid":1850,"spectralRolloff":3800,"zeroCrossingRate":0.05,"bpm":96,"confidence":0.72,"duration":210}}
```

**Core Fields:**
- `sid_path` — Full relative path within HVSC or local folders (ensures uniqueness)
- `tags` — Rating dimensions (may originate from manual tagging or classifier prediction)
  - `e` — Energy/Drive rating (1-5)
  - `m` — Mood/Tone rating (1-5)
  - `c` — Complexity/Texture rating (1-5)

**Extended Fields (Classifier Output):**
- `features` — Object containing all extracted audio features from classifier
  - `energy` — Signal energy (float)
  - `rms` — Root mean square amplitude (float)
  - `spectralCentroid` — Spectral center of mass in Hz (float)
  - `spectralRolloff` — Frequency below which 85% of spectrum energy is contained (float)
  - `zeroCrossingRate` — Rate of sign changes in signal (float)
  - `bpm` — Estimated tempo in beats per minute (float)
  - `confidence` — Confidence score for tempo estimation (0-1)
  - `duration` — Audio duration in seconds (float)
  - Additional features as extracted by classifier (extensible)

**Rationale:**
Grouping `e`, `m`, `c` ratings in a `tags` object keeps the schema extensible and logically separates rating dimensions (which may come from manual tagging or classifier prediction) from raw audio features. Preserving all classifier features enables future music stream selections based on diverse criteria (tempo matching, spectral similarity, etc.) without requiring re-classification.

**Benefits:**
- **Small diffs:** Line-based format produces minimal Git diffs
- **Easy merges:** Append-only structure reduces merge conflicts
- **Stream ingestion:** Can be read line-by-line for processing large datasets
- **LanceDB compatible:** Direct import into vector database

**Tooling:**
- VS Code extension: "JSON Lines" for syntax highlighting and validation
- Pretty-printer: `bun run format:json` converts JSONL to indented JSON for human review

## Phase 6 — JSONL User Feedback Log

### Phase 6 Checklist

- [ ] Implement append-only JSONL feedback logging with schema (timestamp, sid_path, action) and date-based partitioning (`data/feedback/YYYY/MM/DD/events.jsonl`).
- [ ] Support feedback actions with defined weighting: `like` (+1.0), `skip` (-0.3), `dislike` (-1.0), `play` (0.0), and document merge-friendly properties.
- [ ] Add optional UUID deduplication strategy for multi-device scenarios and create tooling for feedback log validation.

**JSONL Feedback Schema:**
```jsonl
{"ts":"2025-11-03T12:10:05Z","sid_path":"Rob_Hubbard/Delta.sid","action":"play"}
{"ts":"2025-11-03T12:11:10Z","sid_path":"Martin_Galway/Parallax.sid","action":"skip"}
{"ts":"2025-11-03T12:12:22Z","sid_path":"Rob_Hubbard/Delta.sid","action":"like"}
{"ts":"2025-11-03T12:13:30Z","sid_path":"Martin_Galway/Parallax.sid","action":"dislike"}
```

**Fields:**
- `ts` — ISO 8601 timestamp with timezone
- `sid_path` — Full relative path matching classification records
- `action` — User interaction type (`play`, `like`, `dislike`, `skip`)
- `uuid` — (Optional) Unique event ID for deduplication

**Actions & Weighting:**
- `like` — Strong positive signal (weight: +1.0)
- `skip` — Mild negative signal (weight: -0.3)
- `dislike` — Strong negative signal (weight: -1.0)
- `play` — Neutral observation (weight: 0.0)

**Partitioning Strategy:**
- Files organized by date: `data/feedback/YYYY/MM/DD/events.jsonl`
- Append-only for merge safety
- Daily granularity balances file size and query performance

**Merge Policy:**
- Append-only structure minimizes conflicts
- UUID-based deduplication optional for multi-device sync
- Chronological ordering preserved within files

## Phase 7 — Rebuildable LanceDB (Derived)

### Phase 7 Checklist

- [ ] Design LanceDB schema combining classification vectors `[e,m,c]`, extended features, and feedback aggregates, then implement deterministic rebuild command (`bun run build:db`).
- [ ] Combine `classified/*.jsonl` (with all extracted features) + `feedback/**/*.jsonl` into unified `data/sidflow.lance/` preserving classifier output for flexible querying.
- [ ] Add `.lance/` directory to `.gitignore` and generate manifest file `sidflow.lance.manifest.json` with checksums, schema version, and record counts for Git.

**LanceDB Structure:**
```
data/
  ├── classified/*.jsonl          (Canonical, in Git)
  ├── feedback/YYYY/MM/DD/*.jsonl (Canonical, in Git)
  ├── sidflow.lance/              (Derived, NOT in Git)
  │   ├── data/                   (Binary vector storage)
  │   └── schema.json             (Internal schema)
  └── sidflow.lance.manifest.json (Manifest, in Git)
```

**Database Schema:**
- `sid_path` — Primary identifier (string)
- `vector` — `[e, m, c]` as float array for similarity search
- `composer` — Artist/composer name (string)
- `title` — Song title (string)
- `features` — All extracted classifier features (JSON object)
  - Includes: `energy`, `rms`, `spectralCentroid`, `spectralRolloff`, `zeroCrossingRate`, `bpm`, `confidence`, `duration`
  - Enables future queries based on any audio characteristic
- `likes` — Aggregated like count (integer)
- `dislikes` — Aggregated dislike count (integer)
- `skips` — Aggregated skip count (integer)
- `plays` — Total play count (integer)
- `last_played` — Most recent play timestamp (ISO 8601)

**Rebuild Command:**
```bash
bun run build:db
```

**Process:**
1. Read all `classified/*.jsonl` files
2. Aggregate all `feedback/**/*.jsonl` events by `sid_path`
3. Compute feedback statistics (likes, dislikes, skips, plays)
4. Extract `[e, m, c]` values from nested `tags` object and generate vector embeddings
5. Write to `data/sidflow.lance/`
6. Generate manifest with checksums and metadata

**Manifest Schema (`sidflow.lance.manifest.json`):**
```json
{
  "version": "1.0",
  "schema_version": "1.0",
  "created_at": "2025-11-03T12:00:00Z",
  "record_count": 15234,
  "source_checksums": {
    "classified": "sha256:abc123...",
    "feedback": "sha256:def456..."
  },
  "stats": {
    "total_classifications": 15234,
    "total_feedback_events": 4521,
    "unique_songs": 15234
  }
}
```

**Policy:**
- `.lance/` directory excluded from Git (binary format, large size)
- Rebuild is deterministic: same inputs → same database
- Manifest tracks source data versions and database state
- Local rebuilds required after cloning or pulling changes

## Phase 8 — Music Stream Recommendation Engine

### Phase 8 Checklist

- [ ] Define scoring formula (`score = α·similarity + β·song_feedback + γ·user_affinity`) with default weights (0.6/0.3/0.1) and implement mood-based seed search using LanceDB vector similarity.
- [ ] Create mood presets (quiet, energetic, dark, bright, complex) and apply feedback weighting to re-rank recommendations with diversity filters.
- [ ] Implement feedback loop where new JSONL events adjust future recommendations on rebuild, and support extended feature-based queries (BPM matching, spectral similarity).

**Scoring Formula:**
```
score = α·similarity + β·song_feedback + γ·user_affinity
```

**Components:**
- `similarity` — Cosine similarity between query vector and song vector `[e, m, c]`
- `song_feedback` — Aggregated feedback score: `(likes - dislikes - 0.3·skips) / plays`
- `user_affinity` — Personalized boost based on user's historical preferences

**Default Weights:**
- `α = 0.6` — Similarity weight (primary factor)
- `β = 0.3` — Song feedback weight (community signal)
- `γ = 0.1` — User affinity weight (personalization)

**Mood Presets:**
```json
{
  "quiet": {"e": 1, "m": 2, "c": 1},
  "ambient": {"e": 2, "m": 3, "c": 2},
  "energetic": {"e": 5, "m": 5, "c": 4},
  "dark": {"e": 3, "m": 1, "c": 3},
  "bright": {"e": 4, "m": 5, "c": 3},
  "complex": {"e": 3, "m": 3, "c": 5}
}
```

**Recommendation Flow:**
1. User selects mood seed (e.g., "quiet") or custom `[e, m, c]` vector
2. Query LanceDB for nearest neighbors using vector similarity
3. Re-rank results using feedback weighting and user affinity
4. Apply diversity filters to avoid repetition
5. Return scored playlist with metadata

**Extended Feature-Based Queries:**
Beyond basic `[e, m, c]` similarity, the preserved classifier features enable:
- **BPM matching**: Find songs within ±10 BPM for seamless transitions
- **Spectral similarity**: Match spectral characteristics for timbral coherence
- **Energy profiling**: Build dynamic playlists that gradually increase/decrease energy
- **Complexity progression**: Create learning paths from simple to complex arrangements

**Feedback Loop:**
- New `like`/`dislike`/`skip` events append to feedback logs
- `bun run build:db` rebuilds LanceDB with updated aggregates
- Future recommendations reflect accumulated feedback
- Continuous improvement through user interaction

**Tuning Parameters:**
- `k` — Number of nearest neighbors to retrieve (default: 100)
- `diversity_threshold` — Minimum vector distance between consecutive songs (default: 0.2)
- `recency_boost` — Weight for recently released songs (default: 0.0)
- `exploration_rate` — Probability of including lower-ranked songs (default: 0.1)

## Phase 9 — Artifact Governance

### Phase 9 Checklist

- [ ] Document artifact classification (canonical vs. derived) and define Git policies for each type, creating `.gitignore` rules for derived artifacts.
- [ ] Establish manifest file standards for reproducibility and document rebuild procedures for derived artifacts.
- [ ] Provide troubleshooting guide for artifact inconsistencies (checksum mismatches, corrupt databases, feedback conflicts).

**Artifact Classification:**

| Artifact | Type | In Git | Notes |
|----------|------|--------|-------|
| `classified/*.jsonl` | Canonical | ✅ | Classification outputs, text-based, small diffs |
| `feedback/**/*.jsonl` | Canonical | ✅ | Append-only user feedback, merge-friendly |
| `sidflow.lance/` | Derived | ❌ | Binary vector database, rebuilt locally |
| `sidflow.lance.manifest.json` | Manifest | ✅ | Metadata, checksums, schema version |
| `*.sid.tags.json` | Canonical | ✅ | Manual tags, colocated with SID files |
| `auto-tags.json` | Canonical | ✅ | Aggregated auto-tags, text-based |
| `wav-cache/` | Derived | ❌ | WAV files, rebuilt from SID sources |
| `hvsc-version.json` | Manifest | ✅ | HVSC sync state and checksums |

**Git Policy:**
- **Canonical data:** Text-based, committed to Git, versioned
- **Derived data:** Binary or large, excluded from Git, rebuilt locally
- **Manifests:** Metadata and checksums, committed to Git for reproducibility

**Reproducibility:**
1. Clone repository (contains canonical data + manifests)
2. Run `bun run build:db` to rebuild LanceDB from JSONL sources
3. Run `sidflow-classify` to rebuild WAV cache if needed
4. Verify checksums match manifest values

**Benefits:**
- Git remains text-based and lightweight
- Binary artifacts excluded to minimize repository size
- Deterministic rebuilds ensure consistency
- Manifests provide audit trail and validation

**.gitignore Rules:**
```gitignore
# Derived artifacts (not committed)
data/sidflow.lance/
workspace/wav-cache/

# Manifests and canonical data ARE committed
!data/sidflow.lance.manifest.json
!data/classified/*.jsonl
!data/feedback/**/*.jsonl
```

**Troubleshooting:**
- **Checksum mismatch:** Delete derived artifacts and rebuild
- **Missing manifest:** Regenerate with `bun run build:db --update-manifest`
- **Corrupt LanceDB:** Delete `.lance/` directory and rebuild
- **Feedback log conflicts:** Append-only structure should auto-merge; manually dedupe by UUID if needed

## Phase 10 — Personal Radio (`sidflow-play`)

### Phase 10 Checklist

- [ ] Expose playlist builder that consumes manual and auto tags to score tracks against user mood profiles.
- [ ] Support filter syntax (tempo, mood, complexity ranges) and weighted blends for on-the-fly sessions.
- [ ] Stream selected tracks through `sidplayfp` with queue controls (skip, pause, resume) and graceful fallbacks.
- [ ] Persist session history and allow exporting deterministic playlist manifests (JSON + M3U).
- [ ] Provide CLI help, examples, and integration tests covering playlist generation and playback orchestration.
- [ ] Document radio workflows in README, emphasising how classification feeds personalised queues.

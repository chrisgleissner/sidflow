# Metadata-Aware Classification and Persona-Driven Station Design

## Executive Summary

SIDFlow already has the right foundation for better stations:

- a deterministic 24-dimensional audio/perceptual vector from classification
- an offline similarity export that can drive both CLI and web playback
- a station builder with feedback weighting, minimum-similarity floors, clustering, diversification, and flow ordering
- a prototype persona pipeline that proves the repo can already express more than raw like/dislike

The main gap is not absence of recommendation logic. It is that the current system models almost everything as audio similarity plus scalar user ratings, while a large part of real SID listening intent is actually about context:

- "game loader themes from 1986-1989"
- "Martin Galway, but not just the famous tracks"
- "multi-SID demo monsters"
- "real-hardware-friendly RSID only"
- "melodic late-night station with low surprise"
- "show me overlooked subtunes from prolific composers"

That intent is only weakly recoverable from the current vector. The next step should therefore be **hybrid rather than replacement**:

1. Keep the audio vector as the primary representation of sonic similarity.
2. Make metadata available as a first-class station signal, but keep it separate from the audio vector.
3. Treat personas as explicit station policies, not as another rating dimension.
4. Let station generation combine:
   - audio affinity
   - explicit metadata constraints
   - user feedback history
   - persona policy
   - diversity and sequencing rules

The strongest recommendation is to add a thin, explainable policy layer around the current recommendation pipeline instead of retraining a new opaque model immediately.

## Baseline: What Exists Today

The current implementation is already richer than a typical "similar songs" prototype.

### Current audio and vector pipeline

`packages/sidflow-classify/src/deterministic-ratings.ts` defines the current deterministic 24D perceptual feature surface. It captures spectral, temporal, and derived perceptual axes such as:

- brightness / noisiness / percussiveness proxies
- onset density and rhythmic regularity
- dynamic range and timbral modulation
- harmonic clarity, inharmonicity, low-frequency energy

`packages/sidflow-common/src/jsonl-schema.ts` shows that the canonical `ClassificationRecord` currently persists:

- `sid_path`
- `song_index`
- `ratings`
- `features`
- `vector`
- classification/runtime provenance

This means the classifier already emits a useful sonic representation, but the canonical classified record does **not** currently store richer musical metadata beyond path and song index.

### Current metadata surfaces

The repo already knows more metadata than the recommendation system uses:

- `packages/sidflow-common/src/sid-parser.ts` parses `title`, `author`, `released`, `songs`, `clock`, `type`, `sidModel1..3`, and extra SID addresses.
- `packages/sidflow-web/lib/rate-playback.ts` turns those fields into `RateTrackInfo`.
- `packages/sidflow-web/lib/feedback/features.ts` already extracts a small deterministic metadata feature vector for feedback-related logic.

So the system is not missing metadata extraction. It is missing **metadata propagation into the recommendation/export/station layer**.

### Current station generation behavior

The main station path in `packages/sidflow-play/src/station/queue.ts` already does several sophisticated things:

- derives weighted favorites from ratings
- uses vector-based `recommendFromFavorites(...)`
- enforces a hard minimum similarity threshold
- rejects candidates too far from the favorite centroid on `e/m/c`
- detects multi-cluster taste via `buildIntentModel(...)`
- diversifies by bucket key derived from path segments
- orders results for smoother flow

This is a solid base. The problem is that it is still almost entirely driven by:

- audio vector proximity
- coarse ratings
- path-bucket diversification

It cannot express listener intent that depends on provenance, hardware, era, authorship, or station purpose.

### Current persona prototype

`packages/sidflow-play/src/persona-station.ts` demonstrates a second path: five deterministic personas operating sequentially over derived audio metrics. This is useful because it proves:

- persona policies can be deterministic
- multi-stage filtering can be explainable
- acceptance evidence can be emitted per track

However, these personas are still **audio-only personas**. They do not model metadata-aware or context-aware listening.

## Current Limitations

### 1. User intent is under-specified

The system mostly learns "what sounds similar to what I rated highly". It does not capture:

- whether the user wants continuity or contrast
- whether the station should be historically narrow or historically broad
- whether the user is exploring a composer, an era, a platform style, or a hardware setup
- whether the user is targeting a semantic theme implied by the title, such as love, night, space, battle, or dream imagery
- whether the user wants canonical tracks, obscurities, or both
- whether the goal is discovery, comfort, study, hardware testing, or live-session flow

This causes a structural mismatch between what users mean and what the system can optimize.

### 2. Metadata is present but operationally invisible

Today, metadata is mostly UI garnish or auxiliary parsing, not a ranking signal. That means:

- a 1984 Hubbard game track and a 2008 demo track may rank together if audio features align
- multi-SID tracks cannot be intentionally sought or avoided
- RSID/PSID, chip model, clock, and subtune count do not meaningfully affect recommendation
- composer-driven listening requires manual browsing rather than station generation

### 3. The vector cannot and should not encode every kind of intent

Audio vectors are good at sonic proximity. They are bad at representing:

- authorship
- historical role
- release context
- hardware compatibility
- rarity
- listener goals for a specific session

Trying to force all of that into the audio vector would reduce interpretability and contaminate a good sonic signal with fragile metadata.

### 4. Like/dislike is too weak for station control

A user can currently express preference strength, but not preference *mode*. Examples:

- "give me more like this, but only one-chip tracks"
- "keep the mood, but rotate composers"
- "explore adjacent years, not adjacent timbres"
- "stay in game music, never jump to demos"
- "find weird tracks from composers I already love"

These are not stronger likes. They are different objectives.

### 5. Diversity is still coarse

The current diversification key is largely path-based. That helps prevent obvious overconcentration, but it is not enough to manage:

- composer dominance
- over-repetition of subtunes from one file
- year clumping
- overuse of one SID topology
- collapse into a single historical pocket

## Metadata as a First-Class Signal

Metadata should become a peer of audio similarity, not a replacement for it.

### Recommended metadata dimensions

| Dimension | Why it matters | Likely source | Best use |
|---|---|---|---|
| HVSC category (`GAMES`, `DEMOS`, `MUSICIANS`) | Strongly shapes listener context and expectations | path-derived | hard filter or quota |
| Composer / author | Core listening axis for SID audiences | SID header + HVSC path | hard filter, anti-overconcentration, exploration |
| Year / era | Separates stylistic and technical epochs | parsed `released` + path heuristics | hard filter, soft preference, sequencing |
| SID type (`PSID`/`RSID`) | Hardware / player compatibility and style proxy | header | hard filter for hardware personas |
| SID chip count (1/2/3 SID) | Major timbral/arrangement difference | extra SID addresses / models | hard filter or strong rerank |
| SID model (`6581`, `8580`, mixed, unknown) | Real hardware behavior and color | header | filter, soft preference |
| Clock (`PAL`, `NTSC`, mixed) | Compatibility and composition style | header | filter, explanation |
| Subtune count | Signals packs, suites, loaders, anthologies | header `songs` | exploration and anti-spam logic |
| Duration / songlength | Useful for session shaping | Songlengths + playback metadata | sequencing and mix policy |
| Title semantics / theme tags | Enables intent like "love songs from the 80s" or "space-themed demo music" | title parsing + heuristic tagging | soft preference, optional hard filter |
| File size / version | Weak signal, but useful for QA and edge-case personas | file stats + header | niche persona / diagnostics |
| Source path bucket | Helps with diversity and provenance | path-derived | quotas and anti-clumping |
| Historical salience | Important for canonical vs deep-cut personas | derived from feedback/popularity | rerank only |
| Rarity / obscurity | Important for discovery personas | derived from global/local play counts | rerank only |
| Metadata quality/confidence | Prevents over-trusting bad parses | derived | guardrail, weighting |

### Additional dimensions worth adding even though they were not requested

These are especially valuable because they capture behavior the audio vector alone will miss.

#### Provenance role

Not just category, but inferred role:

- title theme
- in-game loop
- loader
- intro/demo part
- end theme
- menu music
- tool/music-disk track

This could start as a lightweight title/path heuristic rather than a full classifier.

#### Title semantics

The title is often the only direct clue to narrative or emotional intent that is not audible from the waveform alone. It can support requests like:

- "Play all love songs from the 80s"
- "Give me night-themed tracks"
- "Find space or galaxy tunes"
- "Build a war/battle station"

The right implementation is a deterministic title-tagging layer, not a vague semantic embedding. A practical first version would use:

- normalized tokenization
- phrase dictionaries
- curated theme lexicons
- alias handling for common variants
- confidence scores per inferred theme

Useful initial theme families include:

- romance: `love`, `heart`, `kiss`, `lover`
- night / dream: `night`, `moon`, `dream`, `blue`
- sci-fi / space: `space`, `star`, `galaxy`, `cosmos`
- conflict / action: `battle`, `war`, `attack`, `chase`
- nature / environment: `rain`, `ocean`, `snow`, `summer`

This should be treated as **semantic metadata**, not as a truth claim. SID titles are often metaphorical, jokey, stylized, or opaque.

#### Station-relative novelty

Novelty is not a permanent track attribute. It is a **session feature**:

- new composer relative to current queue
- new year bucket
- new category
- new chip topology
- new similarity cluster

This is critical for personas like "comfortable but not repetitive" or "teach me the space without whiplash".

#### Canonicality vs obscurity

SID listeners often want one of two opposite things:

- the canonical classics
- the overlooked material around the classics

This deserves its own control. It should be derived from play counts, favorite counts, known playlist inclusion, or even export-neighbor centrality.

### How metadata should interact with audio similarity

Audio and metadata should not be fused blindly.

#### Best default model: late fusion

Use separate terms:

`final_score = audio_affinity + feedback_affinity + metadata_affinity + persona_objective + novelty/diversity adjustments`

Advantages:

- preserves the purity of the audio vector
- makes explanations easy
- allows strict vs soft metadata handling
- supports partial metadata availability

#### When metadata should be hard constraints

Metadata should act as a hard gate when violating it would break the user’s intent:

- `RSID only`
- `1 SID only`
- `year 1986-1989`
- `GAMES only`
- `exclude composer X`

#### When metadata should be soft ranking

Metadata should rerank rather than filter when it expresses a preference, not a rule:

- prefer 8580 over 6581
- lean toward demos, but allow game tracks
- mostly Galway, but include adjacent composers
- favor 1990-1993, but allow near neighbors
- favor title themes like love, night, or space, but allow semantically neutral tracks when title confidence is weak

#### When metadata should be explanation-only

Some metadata should not affect ranking initially, but should improve trust:

- "included because it keeps the 1988-1990 window"
- "diversity slot from a new composer"
- "closest 2SID match"
- "outlier pick to broaden era coverage"

Explanations will matter as much as the algorithm once stations become more configurable.

### Metadata risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Incorrect `released` strings | year parsing can be wrong or ambiguous | store parsed year plus confidence |
| Alias fragmentation for composers | same composer may appear under multiple names | introduce canonical composer IDs |
| Missing chip-model metadata | some files are incomplete or unknown | use tri-state handling, not false certainty |
| Title-theme false positives | titles can be metaphorical, jokey, or unrelated to subject matter | keep title semantics soft by default and attach confidence scores |
| Category bias | `GAMES` can dominate corpus counts and user history | quotas and normalized priors |
| Popularity bias | famous composers will swamp results | persona-aware composer caps |
| Sparse metadata | some useful fields are absent for many tracks | late fusion with confidence weighting |
| Leakage into "quality" judgments | metadata can crowd out sonic affinity | keep audio as default anchor except for explicitly metadata-led personas |

## Persona-Driven Listening

### The key distinction: taste vs intent

SIDFlow should explicitly separate:

- **taste memory**: what the user tends to like sonically
- **session intent**: what the user wants right now

Current ratings mostly capture taste memory. Personas should encode session intent.

That distinction matters because the same listener may want all of the following on different days:

- comforting Hubbard classics
- harsh modern demo experiments
- historically coherent 1987 game soundtracks
- 2SID/3SID hardware showcases
- obscure subtunes by familiar composers

Those are not contradictory tastes. They are different listening modes.

### Types of listener intent

Useful intent axes include:

| Intent axis | Low end | High end |
|---|---|---|
| Similarity strictness | seed-faithful | concept-faithful |
| Historical scope | narrow era | cross-era |
| Provenance scope | one category | blended categories |
| Composer focus | rotate widely | deep-dive one author |
| Hardware focus | ignore hardware | hardware-specific |
| Novelty appetite | familiar | adventurous |
| Flow smoothness | contrast allowed | smooth progression |
| Canonicality | classics | deep cuts |
| Educational framing | passive listening | curated comparison |
| Constraint strictness | soft hints | hard rules |

### When personas should complement similarity

Most personas should still anchor to audio similarity. Examples:

- "Late-night melodic" should still care about sonic coherence.
- "Composer deep dive" should still avoid jarring outliers within that composer.
- "Hardware showcase" should still order tracks for listenability.

In these cases, persona policy should rerank and constrain audio-based candidates.

### When personas should override similarity

Some intents are fundamentally not similarity-first:

- archive/historical study
- strict hardware compatibility
- composer-only retrospectives
- year-window curation
- "show me contrasts within this concept"

In those modes, metadata or curation policy should define the candidate set first, with audio similarity used only inside that slice.

## Station Generation Strategies

No single strategy will serve all intents. SIDFlow should support several strategies behind one shared interface.

### Strategy A: Audio-first retrieval, metadata reranking

Process:

1. retrieve nearest neighbors by audio vector
2. apply negative filters
3. rerank by metadata affinity and persona policy
4. diversify and sequence

Best for:

- default stations
- mood-like listening
- low-friction web use

Trade-off:

- simple and stable
- weaker when the user’s main goal is metadata-driven

### Strategy B: Metadata slice, audio ranking inside slice

Process:

1. restrict corpus to a metadata slice
2. rank within the slice by audio affinity and feedback
3. diversify and sequence

Best for:

- composer stations
- era stations
- `RSID only`, `2SID only`, `GAMES only`

Trade-off:

- very explainable
- can become brittle if the slice is too small

### Strategy C: Persona policy as multi-objective scoring

Process:

1. retrieve a wider candidate set
2. compute a score from weighted objectives
3. satisfy diversity/coverage constraints
4. order for flow

Example score:

`score = 0.45*audio + 0.20*feedback + 0.15*metadata_match + 0.10*persona_objective + 0.10*novelty`

Best for:

- general-purpose persona system
- adjustable CLI/web presets

Trade-off:

- flexible
- requires careful weighting and good explanations

### Strategy D: Sequential persona gating

This is the model already prototyped in `persona-station.ts`.

Process:

1. one policy filters a broad set
2. another policy narrows for groove / era / hardware / novelty
3. final policy chooses the station

Best for:

- "must satisfy several editorial tests"
- deterministic auditability

Trade-off:

- highly explainable
- can over-prune and create narrow outputs if thresholds are poorly calibrated

### Strategy E: Constraint-plus-quota builder

Process:

1. define required coverage rules
2. fill slots while meeting quotas
3. optimize audio and persona score within each quota

Examples:

- at least 30% games, 30% demos, 30% musicians
- no composer above 3 tracks in 25
- at least 4 year buckets
- at least 20% exploratory tracks

Best for:

- editorial personas
- anti-degeneracy safeguards
- long stations

Trade-off:

- powerful
- more implementation complexity than pure ranking

## Strict Filtering vs Soft Ranking

This should be a first-class design choice, not an implementation detail.

### Use strict filtering when

- violating the rule would feel wrong, not merely suboptimal
- the user explicitly asked for a constraint
- the station is for hardware testing or historical study
- the corpus slice remains comfortably large

### Use soft ranking when

- the user is expressing taste, not a hard requirement
- metadata is noisy or incomplete
- the system needs room to avoid degenerate outputs
- the station should retain serendipity

### Recommended default

Expose every metadata control with a strictness mode:

- `exclude`
- `prefer`
- `neutral`
- `require`

That maps naturally to both CLI flags and web UI toggles.

## Exploration vs Exploitation

The current station builder already has an "adventure" concept. Persona-aware stations should extend that idea across more than vector distance.

### Exploitation dimensions

- high audio similarity
- same favored composers
- same era
- same category
- same chip topology

### Exploration dimensions

- nearby but not identical audio neighborhoods
- adjacent years
- adjacent composers
- same persona but different provenance
- same metadata slice but less popular tracks

### Better exploration model

Treat exploration as a vector of independent budgets, not a single scalar:

- `audio_radius`
- `era_radius`
- `composer_novelty`
- `category_drift`
- `hardware_drift`
- `obscurity_budget`

This produces more legible behavior. A user may want:

- low audio drift, high obscurity
- high composer novelty, fixed era
- fixed hardware, broad provenance

## Expanded Use Cases

The combined audio + metadata + persona system unlocks far more than "better similar songs".

### Obvious use cases

- composer stations
- era stations
- category-only stations
- 1SID/2SID/3SID stations
- RSID-only or PSID-only stations
- "more like this, but calmer / stranger / more melodic"

### Less obvious but highly valuable use cases

#### 1. Canon plus deep cuts

Start from famous tracks, then deliberately branch into underplayed neighbors by the same composer, year range, or hardware profile.

#### 2. Hardware-safe curation

Build stations meant for actual playback environments:

- real C64 compatibility
- 6581-friendly texture
- avoid multi-SID or unsupported clock modes

#### 3. Educational stations

Examples:

- "How demo music diverged from game music"
- "The rise of 2SID and 3SID aesthetics"
- "Early Hubbard vs late Hubbard"
- "1986 to 1992 evolution"

These are not pure recommendation tasks. They are guided comparative listening tasks.

#### 4. Subtune excavation

Many SID files hide overlooked subtunes. A persona can intentionally surface:

- non-default subtunes
- short hidden loops
- alternate arrangements
- same-file companions without station spam

#### 5. Session architecture

Instead of just selecting tracks, the station can shape a journey:

- warm-up
- core zone
- stretch zone
- cooldown

Each phase can use different persona weights.

#### 6. Collection QA and metadata repair

A metadata-aware station system can reveal anomalies:

- impossible year parses
- composers with fragmented aliases
- weird chip-count metadata
- outlier tracks whose metadata and audio disagree strongly

This is useful operationally, not just musically.

#### 7. Curated surprise

"Stay inside my taste, but surprise me only along one axis." Examples:

- same feel, different composer
- same era, stranger timbres
- same composer, more obscure tracks
- same hardware profile, more adventurous rhythm

This is one of the most valuable improvements because it gives users controlled discovery.

## Persona System Design

The persona system should be implemented as configuration over one station engine, not as separate hand-coded pipelines per persona.

### Suggested persona schema

Each persona should specify:

- `retrievalMode`: audio-first, metadata-slice, quota, sequential
- `hardFilters`
- `softTargets`
- `objectiveWeights`
- `diversityRules`
- `sequencingRules`
- `explorationBudget`
- `overridePolicy`: when metadata outranks audio
- `explanationStyle`

### Core exposed modes

For a user-facing product, the persona list should be smaller than the full idea space. Industry-standard practice is to expose only the highest-coverage, easiest-to-understand modes, and express narrower needs as filters or advanced templates.

The best first shipping set is **9 listening modes**:

| ID | Label | Core intent | Primary signals | Why it deserves top-level exposure |
|---|---|---|---|---|
| `fast_paced` | Fast Paced | high-energy forward motion | rhythmic density, energy, momentum | universal and instantly legible |
| `slow_ambient` | Slow / Ambient | calm, low-whiplash listening | low density, low tempo, smoothness | universal and instantly legible |
| `melodic` | Melodic | strong tunes and harmonic shape | melodic complexity, harmonic clarity | one of the most common SID listening intents |
| `experimental` | Experimental | unusual timbres and sonic risk | experimental tolerance, timbral richness | captures a major SID/demo audience |
| `nostalgic` | Nostalgic | familiar classic SID feel | nostalgia bias, classic-era affinity | broad mainstream appeal |
| `composer_focus` | Composer Focus | one-composer immersion | composer identity, anti-repetition, era spread | common and obvious collection-browsing intent |
| `era_explorer` | Era Explorer | historically coherent year/era listening | year, category, audio continuity | common and obvious discovery intent |
| `deep_discovery` | Deep Discovery | less-obvious tracks near known taste | rarity, obscurity, nearby audio fit | high-value recommendation mode |
| `theme_hunter` | Theme Hunter | title/theme-led stations | title-theme tags, year, category, audio support | supports requests like "80s love songs" directly |

This set works because it spans three distinct user needs without overloading the UI:

- **sonic mood modes**: `fast_paced`, `slow_ambient`, `melodic`, `experimental`, `nostalgic`
- **contextual exploration modes**: `composer_focus`, `era_explorer`, `deep_discovery`
- **semantic theme mode**: `theme_hunter`

### Advanced patterns that should not be top-level modes initially

The following ideas are still valuable, but they are better expressed as:

- hard filters
- advanced options
- editorial templates
- internal sequencing strategies

Examples:

- `hardware_purist`: better as explicit hardware constraints like `RSID only`, `6581 only`, `1SID only`
- `subtune_excavator`: better as a "surface non-default subtunes" option inside discovery modes
- `museum_curator`: better as an editorial or demo template than a default consumer mode
- `contrast_tutor`: better as a guided comparison feature than a station preset
- `session_narrator`: better as queue-shaping logic than a separate top-level mode
- `festival_dj`: useful, but substantially overlaps with `fast_paced`
- `late_night_curator`: useful, but substantially overlaps with `slow_ambient`

This is the key refinement: **not every meaningful policy deserves to be a first-class persona**.

### How each persona should influence station building

#### Fast Paced

- complements audio similarity
- prioritizes drive, groove, and immediacy
- should still apply anti-repeat and anti-clump penalties so it does not collapse into one narrow sub-style

#### Slow / Ambient

- complements audio similarity
- prioritizes low density, calm pacing, and gentle transitions
- should impose stronger transition smoothness than other modes

#### Melodic

- complements audio similarity
- boosts tune-forward tracks with strong melodic and harmonic identity
- should not be forced to stay only in canonical material

#### Experimental

- allows more novelty and timbral drift than the other sonic modes
- should remain sonically coherent enough to avoid random "weirdness for its own sake"

#### Nostalgic

- complements audio similarity
- boosts familiar classic SID signatures and conservative transitions
- should favor warmth and recognizability over maximal novelty

#### Composer Focus

- metadata defines the candidate slice first
- audio similarity shapes the station inside that composer slice
- must cap same-file and same-subtune repetition to avoid fatigue

#### Era Explorer

- year is first-class
- should support both fixed-era listening and gentle chronological walks
- should prefer nearby years rather than wild historical jumps

#### Deep Discovery

- should stay near the listener's known taste while downweighting canonical or overplayed tracks
- should widen obscurity before widening audio distance
- is the right replacement for more niche "archaeologist" framing

#### Theme Hunter

- title semantics define a meaningful part of the candidate slice
- year, category, and audio fit keep the station coherent around the theme
- should usually treat title semantics as a soft preference unless the user explicitly asks for strict matching
- is the right mode for requests like "80s love songs", "space tunes", or "night tracks"

### Recommended exposed-mode families

The 9 exposed modes fall into a simpler family structure than the previous broader catalog:

- **sonic**: `fast_paced`, `slow_ambient`, `melodic`, `experimental`, `nostalgic`
- **exploration**: `composer_focus`, `era_explorer`, `deep_discovery`
- **semantic**: `theme_hunter`

This smaller family structure is easier to explain, test, and expose in CLI/web than the previous broader set.

## Recommended Hybrid Scoring Model

The most practical incremental design is a shared station objective with pluggable terms.

### Candidate context

Build a `TrackContext` per track with:

- audio vector
- ratings / feedback aggregates
- normalized metadata fields
- title-derived theme tags with confidence
- metadata confidence
- popularity / rarity features
- session-relative novelty fields

### Candidate score

Recommended shape:

`score = w_audio*A + w_feedback*F + w_metadata*M + w_persona*P + w_novelty*N - penalties`

Where:

- `A`: audio affinity to seed, favorites, or intent centroid
- `F`: learned preference from likes, skips, recency, and replay behavior
- `M`: metadata alignment with explicit user controls
- `P`: persona objective, including quotas and editorial priorities
- `N`: controlled novelty or anti-repetition benefit

Penalties should explicitly cover:

- repeated composer over limit
- repeated file or subtune over limit
- year clumping
- category whiplash
- hardware incompatibility

### Why not merge metadata into the main vector immediately?

Because metadata and audio have different failure modes:

- audio features are dense and continuous
- metadata is sparse, categorical, and often uncertain

Mixing them too early would make it harder to reason about wrong recommendations. A late-fusion design keeps the failure surface inspectable.

## Integration Approach

The guiding principle should be: **layer onto the existing system, do not replace it**.

### Minimal viable integration

#### Phase 1: propagate metadata into the export and station surfaces

Add normalized metadata fields to the offline/export layer:

- `category`
- `composer_id`
- `composer_name`
- `year`
- `year_confidence`
- `title_theme_tags`
- `title_theme_confidence`
- `sid_type`
- `sid_chip_count`
- `sid_model_primary`
- `sid_model_secondary`
- `clock`
- `subtune_count`
- `metadata_confidence`

This is the single highest-leverage structural change.

#### Phase 2: add a metadata preference model

Introduce a separate station-preferences object:

- include / exclude / prefer / require rules
- strictness per field
- persona ID
- novelty controls

This should flow into both CLI and web APIs.

#### Phase 3: extend scoring and diversification

Update the station queue builder so it can:

- filter by hard metadata constraints
- rerank by metadata affinity
- cap composer/file dominance
- satisfy year/category/hardware quotas
- explain why a track was included

#### Phase 4: expose persona presets

Start with curated presets in web and CLI, not arbitrary free-form policy editing.

Examples:

- `--persona melodic-archivist`
- `--persona scene-archaeologist`
- `--persona hardware-purist --sid-model 6581 --require-rsid`

### File-level incremental path

The repo structure suggests a clean layering path:

| Area | Likely change |
|---|---|
| `packages/sidflow-common/src/jsonl-schema.ts` | optional metadata block or companion normalized metadata record |
| `packages/sidflow-common/src/similarity-export.ts` | persist normalized metadata columns in SQLite export |
| `packages/sidflow-common/src/sid-parser.ts` | add normalized year/chip-count helpers, not just raw parse |
| `packages/sidflow-play/src/station/queue.ts` | hybrid scoring, metadata filters, composer/file caps, quota logic |
| `packages/sidflow-play/src/station/intent.ts` | support metadata-conditioned intent slices in addition to vector clusters |
| `packages/sidflow-play/src/persona-station.ts` | evolve from audio-only personas to policy-driven personas |
| `packages/sidflow-web/app/api/play/*` | accept persona and metadata preference payloads |
| `packages/sidflow-web/lib/types/rate-track.ts` | expose normalized metadata needed for explanation/UI |

### Complexity boundaries

To avoid uncontrolled complexity:

1. Keep audio similarity in the existing vector pipeline.
2. Keep metadata scoring outside the vector.
3. Keep persona definitions declarative.
4. Prefer a single station engine with multiple policies over multiple engines.
5. Make explanations part of the API contract early.

## Risks and Failure Modes

### Overfitting to metadata

If metadata is weighted too strongly, the system will produce stations that are semantically correct but sonically poor.

Example:

- all tracks are 1988 game tunes by one composer
- but the station loses flow, variety, or mood consistency

Mitigation:

- audio affinity remains the default anchor
- metadata-led modes must be explicit
- expose strictness controls

### Poor or missing metadata

The `released` field is especially messy. Composer names can also fragment badly.

Mitigation:

- normalize and confidence-score parsed metadata
- treat unknown values as unknown, not as negatives
- degrade from hard to soft logic when confidence is low

### User confusion

A powerful system can become opaque if users do not understand why a station changed.

Mitigation:

- keep the web UI persona list small
- provide concise inclusion explanations
- use "prefer" / "require" language instead of hidden weighting jargon

### Degenerate station outputs

Metadata-led stations can collapse into:

- one composer
- one SID file with many subtunes
- one year
- one category
- one hardware topology

Mitigation:

- explicit anti-collapse caps
- quota constraints
- minimum coverage rules
- station diagnostics before finalizing output

### Feedback contamination

If persona sessions and normal preference sessions are mixed naively, the model may infer that the user permanently loves whatever they temporarily explored.

Mitigation:

- store feedback with session context
- separate "liked in this persona" from global preference when appropriate
- treat temporary persona-driven exploration differently from durable likes

### Explainability debt

A hybrid system becomes difficult to maintain if recommendation reasons are not emitted at the same time as the scoring logic.

Mitigation:

- every score contribution should be capturable
- every hard rejection should have a reason
- persona-specific inclusion rules should be serializable

## Recommendations

### Strong recommendations

1. **Do not replace the 24D vector.** It solves the sonic side of the problem well enough to be the anchor.
2. **Do not stuff metadata into the audio vector immediately.** Keep a separate metadata lane.
3. **Treat personas as policy templates, not personality labels.** The value is behavioral difference, not branding.
4. **Start with a small set of high-value metadata fields.** Category, composer, year, SID type, chip count, chip model, clock, subtune count.
5. **Add explanations at the same time as persona logic.** Otherwise the system will become hard to trust.
6. **Support both strict and soft controls per metadata field.** That is the difference between "tool" and "black box".
7. **Treat title semantics as useful but noisy metadata.** It should unlock theme-driven stations without silently overpowering stronger signals like audio fit, explicit filters, year, and composer.

### Best near-term implementation order

1. propagate normalized metadata into the export
2. add metadata filters and soft preferences to the station queue builder
3. add composer/file/year anti-collapse rules
4. expose 6-8 curated personas across CLI and web
5. add station explanations and diagnostics
6. only then consider learning metadata weights from behavior

## Final View

The most important conceptual shift is this:

SID station generation should no longer be treated as only a nearest-neighbor problem. It is a **policy-guided retrieval and sequencing problem**.

The existing SIDFlow architecture already supports that shift. The classifier provides a solid sonic basis. The station builder already knows how to rank, diversify, and sequence. The missing layer is a shared representation of metadata-aware intent.

Once that layer exists, SIDFlow can support not just "songs like this", but genuinely useful listening modes:

- archivist
- historian
- hardware purist
- explorer
- deep diver
- DJ
- educator
- collector

That is the right direction because it increases expressiveness and usefulness without discarding the current system’s strengths.

---

## User-Facing Persona Selection and Instant Mode Switching

### Design principles

The persona system must be user-facing, not just an internal optimization detail. Three hard requirements drive the design:

1. **Instant mode switching**: a listener must be able to change persona mid-session with zero delay, no re-computation of the full corpus, and no loss of playback state.
2. **Sensible fallbacks**: an anonymous or new user with no feedback history must still receive a coherent station. The system must never produce empty or degraded output because it lacks user data.
3. **Progressive personalization**: as the system learns more about a user, per-persona stations should improve, but the user must always retain full manual control to override learned preferences.

These three principles are in tension. Progressive personalization tends to narrow the output. Instant switching demands that multiple divergent station views are always available. Sensible fallbacks require that the system works well with zero user-specific data. The design must satisfy all three simultaneously.

### Persona as listening mode, not personality type

Users do not identify as "an experimental listener" or "a nostalgic listener". They have moods, contexts, and goals that change throughout a day:

| Context | Likely persona | Switch trigger |
|---------|---------------|----------------|
| Coding session, need focus | Slow / Ambient | Start of work block |
| Workout or high-energy task | Fast Paced | Activity change |
| Evening wind-down | Melodic or Nostalgic | Time of day |
| Exploring new SID music | Experimental | Curiosity impulse |
| Showing C64 music to a friend | Nostalgic | Social context |

The system should present personas as **listening modes**, not as user categories. The language matters:

- Good: "Switch to Ambient mode"
- Bad: "You are an Ambient listener"

### Fallback strategy for unknown users

When a user has no ratings, no feedback history, and no profile, the system must still produce 5 distinct stations. The fallback hierarchy is:

| Data available | Strategy |
|---------------|----------|
| No data at all | Use corpus-wide metric distributions. Each persona selects from the full classified corpus using its directional scoring function. No personalization applied. |
| Implicit signals only (play counts, skips, session duration) | Weight the scoring function by implicit preference signals. A track played to completion gets a small affinity boost for the active persona. |
| Explicit ratings (1-5 on e/m/c) | Full personalized scoring. User ratings create a taste profile that modulates the persona’s base scoring function. |
| Explicit ratings + persona-specific feedback | Per-persona taste profiles. A user who skips tracks in Experimental mode but loves them in Fast Paced creates separate affinity models per persona. |

The critical rule: **every fallback level must produce a valid, non-empty, diverse station**. If a level produces fewer than STATION_SIZE tracks, the system falls back to the previous level to fill the remaining slots.

### Instant switching: architecture requirements

Instant switching means the user can tap/click a persona button and the station rebuilds in under 200ms wall-clock time. This constrains the architecture:

1. **Pre-computed persona scores**: When the classified corpus is loaded, all tracks are scored for all 5 personas upfront. This is a one-time O(N * 5) computation where N is the corpus size. For 60,000 tracks and 5 personas, this is ~300,000 score evaluations — trivially fast.

2. **Sorted candidate lists per persona**: Each persona maintains a pre-sorted list of tracks by score. Selecting the top 50 is an O(1) slice operation after the initial sort.

3. **Session state is persona-independent**: The current playback position, play history, skip history, and session clock are shared across personas. Switching persona changes the upcoming queue, not the current track.

4. **Queue rebuild, not restart**: When the user switches persona, the system:
   - Keeps the currently playing track.
   - Discards the remaining queue.
   - Builds a new queue from the new persona’s top candidates, excluding already-played tracks.
   - Resumes playback without interruption.

5. **No server round-trip for web**: Pre-computed persona scores should be sent to the client once. Switching persona is a client-side operation that re-slices the local score arrays.

### User preference learning model

User preferences should be stored as a per-user profile with two layers:

#### Global taste profile

Accumulated from all listening behavior across all personas. Contains:

- Rating history: `{ trackId, e, m, c, timestamp }`
- Implicit actions: `{ trackId, action, personaId, timestamp }`
- Derived taste centroid: weighted average of rated tracks’ feature vectors

This profile influences the base scoring function. A user who consistently rates high-energy tracks highly will see a small energy boost across all personas.

#### Per-persona taste modifiers

Accumulated from persona-specific sessions. Contains:

- Persona-specific skip patterns
- Persona-specific rating deviations from the global profile
- Persona-specific exploration tolerance

These modifiers adjust the persona’s scoring function. A user who skips melodic tracks in Experimental mode but likes them everywhere else should not see those tracks penalized globally — only in Experimental.

#### Feedback isolation rule

Feedback collected during a persona session is tagged with the active persona ID. The system applies two rules:

1. **Global update**: All explicit ratings (1-5) update the global taste profile regardless of active persona.
2. **Persona-specific update**: Implicit actions (skip, skip_early, replay, play_complete) update the per-persona modifier only.

This prevents the problem of a user exploring unfamiliar music in Experimental mode and having that exploration contaminate their Nostalgic station.

### Preference persistence across CLI and web

Both CLI and web must share the same user profile format:

| Surface | Storage | Sync |
|---------|---------|------|
| CLI | `~/.sidflow/profile.json` | Local file, manually exportable |
| Web (server-side) | `/data/.sidflow-profile.json` | File on server |
| Web (client-side) | IndexedDB `feedback` stores | Syncs to server via existing feedback sync |

The profile schema must be versioned (starting at v1) with forward-compatible migration, following the same pattern as `BrowserPreferences` v2.

### CLI persona workflow

The CLI must support persona selection as a first-class flag:

```
sidflow-play --persona ambient
sidflow-play --persona fast-paced
sidflow-play --persona melodic
sidflow-play --persona experimental
sidflow-play --persona nostalgic
```

When `--persona` is omitted, the system uses the user’s last-used persona (stored in profile) or falls back to `melodic` as the default.

During interactive playback, the user can switch persona with a single keypress:

```
[1] Fast Paced  [2] Ambient  [3] Melodic  [4] Experimental  [5] Nostalgic
```

The switch rebuilds the queue instantly using pre-computed scores.

### Web persona workflow

The web UI must expose persona selection as a prominent control, not buried in settings:

1. **Persona bar**: A horizontal row of 5 labeled buttons, always visible in the player area. The active persona is highlighted. Tapping another persona switches instantly.

2. **First-visit experience**: On first visit, all 5 personas are available with no configuration required. The system uses corpus-wide fallback scoring. A brief tooltip explains what each mode optimizes.

3. **Persona preview**: Before switching, a hover/long-press shows a 3-track preview of what the new persona’s station will contain. This helps the user decide without committing.

4. **Session continuity**: Switching persona does not interrupt the current track. The queue visually updates to show the new upcoming tracks.

5. **API contract**: The existing `POST /api/play/random` and station endpoints accept an optional `persona` field. When present, the response uses persona-specific scoring. When absent, the existing behavior is preserved (backward compatible).

### Custom persona blending (future extension)

Power users may want to blend personas. The system should eventually support:

```
sidflow-play --persona "70% melodic + 30% nostalgic"
```

Implementation: linearly interpolate the scoring weights of two or more personas. This is trivially computed from the existing weight vectors and requires no new infrastructure beyond a parser for the blend expression.

This is not required for the initial implementation but the architecture should not preclude it.

### Anti-stagnation across mode switches

A common failure mode: a user switches between two personas repeatedly and hears the same tracks because both personas’ top-50 lists are stable. The system should apply a recency penalty:

- Tracks played in the current session (regardless of persona) are pushed down in all persona rankings.
- The penalty decays over time (half-life of 30 minutes by default).
- This ensures that switching back to a previously used persona surfaces fresh tracks, not the same ones heard 20 minutes ago.

### Measurement and observability

The persona system should emit telemetry (when the user opts in) to answer:

- Which personas are most/least used?
- How often do users switch mid-session?
- What is the average session length per persona?
- Do users who switch frequently rate tracks differently than single-persona users?
- Which persona pairs have the most switching traffic?

This data informs future persona design and weight tuning without requiring A/B testing infrastructure.

### Summary of user-facing requirements

| Requirement | Mechanism |
|-------------|-----------|
| Persona selection | 5 labeled mode buttons (web) / `--persona` flag + keypress (CLI) |
| Instant switching | Pre-computed per-persona scores; client-side queue rebuild |
| Sensible fallbacks | Corpus-wide scoring when no user data; graceful degradation hierarchy |
| Progressive personalization | Global taste + per-persona modifiers; feedback isolation |
| Anti-stagnation | Session-wide recency penalty with time decay |
| No data loss on switch | Playback continues; only queue changes |
| Backward compatibility | Existing API endpoints work without `persona` parameter |
| Profile portability | Shared profile format across CLI and web |

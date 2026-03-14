# Portable Similarity Export

SIDFlow can export a portable offline similarity bundle for downstream consumers such as c64commander.

The primary artifact is a single SQLite file. A deterministic JSON sidecar manifest is written next to it so consumers and operators can inspect compatibility, counts, and checksums without opening SQLite.

## One-command workflow

Use the unattended helper script:

- Local checkout: `scripts/run-similarity-export.sh --mode local`
- GHCR Docker image: `scripts/run-similarity-export.sh --mode docker --hvsc /absolute/path/to/hvsc --state-dir /absolute/path/to/sidflow-state`

The script is the authoritative workflow. It starts the required runtime, triggers classification, waits for completion, runs the SQLite export, and prints the final file locations.

By default the script resumes from prior classified output. Use `--full-rerun true` only when you want to ignore existing classified data and rebuild everything from scratch.

If a previous classify run was interrupted after feature extraction but before `classification_*.jsonl` was fully written, the export step now recovers those rows from the orphaned `features_*.jsonl` files instead of silently under-exporting the corpus.

Show script options:

```bash
bash scripts/run-similarity-export.sh --help
```

Local prerequisites:

- `bun` 1.3.1
- `ffmpeg`
- `sidplayfp`
- `curl`
- `python3`

Ubuntu/Debian example:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg sidplayfp curl python3 p7zip-full
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

Docker mode prerequisites:

- `docker`
- a local checkout of this repository so you can run the helper script
- access to `ghcr.io/chrisgleissner/sidflow:latest`
- an HVSC directory on the host
- a writable host state directory for `audio-cache`, `tags`, `data`, and the final export

## Default output

When you run the export with the repo's default `.sidflow.json`, SIDFlow reads the classified corpus from `data/classified`, feedback from `data/feedback`, and writes the bundle to:

- `data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite`
- `data/exports/sidcorr-hvsc-full-sidcorr-1.manifest.json`

If you pass `--profile mobile`, the default SQLite filename becomes `data/exports/sidcorr-hvsc-mobile-sidcorr-1.sqlite`.

## Minimal commands

Local checkout, using the repo's `.sidflow.json` and `workspace/hvsc`:

```bash
cd /home/chris/dev/c64/sidflow
bash scripts/run-similarity-export.sh --mode local
```

Force a complete rerun:

```bash
cd /home/chris/dev/c64/sidflow
bash scripts/run-similarity-export.sh --mode local --full-rerun true
```

GHCR Docker image, using the published runtime image and host-mounted state:

```bash
cd /home/chris/dev/c64/sidflow
bash scripts/run-similarity-export.sh --mode docker --hvsc /absolute/path/to/hvsc --state-dir /absolute/path/to/sidflow-state
```

What the helper script does:

1. Starts the web runtime and durable worker.
2. Triggers classification through `POST /api/classify`.
3. Polls `/api/classify/progress` until the corpus finishes.
4. Runs `bun run export:similarity`.
5. Prints the final SQLite and manifest paths.

By default the helper uses these classify settings:

- `async=true`
- `skipAlreadyClassified=true`
- `deleteWavAfterClassification=true`
- `forceRebuild=false`

Override them directly on the script when needed:

```bash
bash scripts/run-similarity-export.sh --mode local --skip-already-classified false --delete-wav-after-classification false --threads 8
```

Test with only the next 200 songs:

```bash
bash scripts/run-similarity-export.sh --mode local --max-songs 200
```

Explicit full rerun in Docker mode:

```bash
cd /home/chris/dev/c64/sidflow
bash scripts/run-similarity-export.sh --mode docker --hvsc /absolute/path/to/hvsc --state-dir /absolute/path/to/sidflow-state --full-rerun true
```

Useful flags:

- `--config <path>` loads an alternate `.sidflow.json`
- `--output <file>` overrides the SQLite output path
- `--corpus-version <label>` stores an explicit corpus label in the manifest
- `--dims 3|4` exports either `e/m/c` or `e/m/c/p` vectors
- `--include-vectors` keeps vectors in SQLite for centroid queries
- `--neighbors <k>` optionally precomputes the top `k` neighbors per track

`--neighbors` is optional. For a full HVSC export, the portable workflow is usually best with vectors enabled and `--neighbors 0`, because downstream consumers can compute recommendations from the vector table directly.

## Android-oriented notes

The relational model stays explicit on purpose: `tracks` keeps `track_id`, `sid_path`, and `song_index` visible instead of hiding identity behind a surrogate integer. That keeps offline debugging, import/export checks, and consumer SQL straightforward.

Low-hanging optimizations worth taking early without weakening that model:

- The keyed SQLite tables are created `WITHOUT ROWID`, which avoids a second hidden B-tree for text/composite primary keys and reduces both file size and cache pressure on weaker devices.
- The export does not create a separate `neighbors` index because the `(profile, seed_track_id, rank)` primary key already covers the hot lookup path.
- `mobile` profile keeps the same relational shape but omits heavyweight payloads such as `features_json`; keep using that profile when the client does not need full feature inspection.

Tradeoffs to keep explicit rather than hiding behind premature abstraction:

- Keep `track_id = sid_path#song_index` materialized. Deriving it on every join would save a column but complicate consumers and make bug triage harder.
- Keep `sid_path` and `song_index` alongside `track_id`. That small amount of duplication buys clearer SQL and simpler downstream integrations.
- Only precompute `neighbors` when the target experience is mostly seed-track lookup. If the client needs arbitrary centroid playlists from many favorites, vectors plus `--neighbors 0` remain the more expressive default.

## SQLite schema

The SQLite bundle uses schema version `sidcorr-1` and stores three tables:

1. `meta`
   Stores small key/value metadata, including the full manifest JSON under `manifest_json`.
2. `tracks`
  One row per playable SID track, keyed by `track_id = sid_path#song_index`, with ratings, feedback aggregates, and optional vector/features payloads.
3. `neighbors`
  Optional precomputed nearest-neighbor rows keyed by `(profile, seed_track_id, rank)`.

Classification has always run per subsong when a SID file exposes multiple tracks. `sidcorr-1` now preserves that identity in the export instead of collapsing everything back to one row per SID file.

`tracks` columns:

- `track_id TEXT PRIMARY KEY`
- `sid_path TEXT NOT NULL`
- `song_index INTEGER NOT NULL`
- `vector_json TEXT NULL`
- `e REAL NOT NULL`
- `m REAL NOT NULL`
- `c REAL NOT NULL`
- `p REAL NULL`
- `likes INTEGER NOT NULL`
- `dislikes INTEGER NOT NULL`
- `skips INTEGER NOT NULL`
- `plays INTEGER NOT NULL`
- `last_played TEXT NULL`
- `classified_at TEXT NULL`
- `source TEXT NULL`
- `render_engine TEXT NULL`
- `feature_schema_version TEXT`
- `features_json TEXT NULL`

`neighbors` columns:

- `profile TEXT NOT NULL`
- `seed_track_id TEXT NOT NULL`
- `neighbor_track_id TEXT NOT NULL`
- `rank INTEGER NOT NULL`
- `similarity REAL NOT NULL`

## Manifest structure

The sidecar manifest records:

- `schema_version`: currently `sidcorr-1`
- `export_profile`: `full` or `mobile`
- `generated_at`
- `corpus_version`
- `feature_schema_version`
- `vector_dimensions`
- `include_vectors`
- `neighbor_count_per_track`
- `track_count`
- `neighbor_row_count`
- `paths.sqlite`
- `paths.manifest`
- `source_checksums.classified`
- `source_checksums.feedback`
- `file_checksums.sqlite_sha256`
- `tables`

## Consumer workflow

The expected consumer workflow for c64commander-style playback is:

1. Start with a few random songs from the full collection.
2. Let the user like, skip, or dislike songs.
3. Collect the liked track IDs as favorites.
4. Read the exported SQLite bundle offline.
5. Compute a centroid over the favorite vectors.
6. Rank the remaining tracks by cosine similarity to that centroid.
7. Build a custom playlist from the highest-ranked unseen tracks.

SIDFlow exposes helper functions in `@sidflow/common` for the two core cases:

- `buildSimilarityTrackId(sidPath, songIndex)`
- `recommendFromSeedTrack(dbPath, { seedTrackId, limit })`
- `recommendFromFavorites(dbPath, { favoriteTrackIds, limit, weightsByTrackId })`

Example:

```ts
import { recommendFromFavorites } from "@sidflow/common";

const playlistSeeds = [
  buildSimilarityTrackId("MUSICIANS/H/Hubbard_Rob/Commando.sid", 1),
  buildSimilarityTrackId("MUSICIANS/G/Galway_Martin/Parallax.sid", 2),
];

const recommendations = recommendFromFavorites(
  "data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite",
  {
    favoriteTrackIds: playlistSeeds,
    limit: 25,
    weightsByTrackId: {
      [buildSimilarityTrackId("MUSICIANS/H/Hubbard_Rob/Commando.sid", 1)]: 1.0,
      [buildSimilarityTrackId("MUSICIANS/G/Galway_Martin/Parallax.sid", 2)]: 1.2,
    },
  },
);
```

## Result files

Local mode writes to:

- `data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite`
- `data/exports/sidcorr-hvsc-full-sidcorr-1.manifest.json`

Docker mode writes to the host state directory you pass in:

- `/absolute/path/to/sidflow-state/data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite`
- `/absolute/path/to/sidflow-state/data/exports/sidcorr-hvsc-full-sidcorr-1.manifest.json`

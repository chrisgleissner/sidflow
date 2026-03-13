# Portable Similarity Export

SIDFlow can export a portable offline similarity bundle for downstream consumers such as c64commander.

The primary artifact is a single SQLite file. A deterministic JSON sidecar manifest is written next to it so consumers and operators can inspect compatibility, counts, and checksums without opening SQLite.

## Default output

When you run the export with the repo's default `.sidflow.json`, SIDFlow reads the classified corpus from `data/classified`, feedback from `data/feedback`, and writes the bundle to:

- `data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite`
- `data/exports/sidcorr-hvsc-full-sidcorr-1.manifest.json`

If you pass `--profile mobile`, the default SQLite filename becomes `data/exports/sidcorr-hvsc-mobile-sidcorr-1.sqlite`.

## Generate the export

Build the portable bundle after classification has produced JSONL output:

```bash
bun run export:similarity -- --profile full
```

Useful flags:

- `--config <path>` loads an alternate `.sidflow.json`
- `--output <file>` overrides the SQLite output path
- `--corpus-version <label>` stores an explicit corpus label in the manifest
- `--dims 3|4` exports either `e/m/c` or `e/m/c/p` vectors
- `--include-vectors` keeps vectors in SQLite for centroid queries
- `--neighbors <k>` optionally precomputes the top `k` neighbors per track

`--neighbors` is optional. For a full HVSC export, the portable workflow is usually best with vectors enabled and `--neighbors 0`, because downstream consumers can compute recommendations from the vector table directly.

## SQLite schema

The SQLite bundle uses schema version `sidcorr-1` and stores three tables:

1. `meta`
   Stores small key/value metadata, including the full manifest JSON under `manifest_json`.
2. `tracks`
   One row per SID path, with ratings, feedback aggregates, and optional vector/features payloads.
3. `neighbors`
   Optional precomputed nearest-neighbor rows keyed by `(profile, seed_sid_path, rank)`.

`tracks` columns:

- `sid_path TEXT PRIMARY KEY`
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
- `seed_sid_path TEXT NOT NULL`
- `neighbor_sid_path TEXT NOT NULL`
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
3. Collect the liked SID paths as favorites.
4. Read the exported SQLite bundle offline.
5. Compute a centroid over the favorite vectors.
6. Rank the remaining tracks by cosine similarity to that centroid.
7. Build a custom playlist from the highest-ranked unseen tracks.

SIDFlow exposes helper functions in `@sidflow/common` for the two core cases:

- `recommendFromSeedTrack(dbPath, { seedSidPath, limit })`
- `recommendFromFavorites(dbPath, { favoriteSidPaths, limit, weightsBySidPath })`

Example:

```ts
import { recommendFromFavorites } from "@sidflow/common";

const playlistSeeds = [
  "MUSICIANS/H/Hubbard_Rob/Commando.sid",
  "MUSICIANS/G/Galway_Martin/Parallax.sid",
];

const recommendations = recommendFromFavorites(
  "data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite",
  {
    favoriteSidPaths: playlistSeeds,
    limit: 25,
    weightsBySidPath: {
      "MUSICIANS/H/Hubbard_Rob/Commando.sid": 1.0,
      "MUSICIANS/G/Galway_Martin/Parallax.sid": 1.2,
    },
  },
);
```

## End-to-end local workflow

With the repo defaults, the local SID collection root is `workspace/hvsc`.

1. Start the web server:

```bash
cd packages/sidflow-web
SIDFLOW_CONFIG=/home/chris/dev/c64/sidflow/.sidflow.json \
SIDFLOW_ADMIN_USER=admin \
SIDFLOW_ADMIN_PASSWORD=password \
SIDFLOW_ADMIN_SECRET=local-dev-admin-secret-32-chars-min \
JWT_SECRET=local-dev-jwt-secret-32-chars-min \
bun run dev
```

2. In a second terminal, start the durable job worker:

```bash
cd /home/chris/dev/c64/sidflow
SIDFLOW_CONFIG=/home/chris/dev/c64/sidflow/.sidflow.json bun run jobs:run
```

3. Queue classification for the entire configured collection:

```bash
curl -u admin:password \
  -H 'content-type: application/json' \
  -X POST http://localhost:3000/api/classify \
  -d '{"async":true,"skipAlreadyClassified":true,"deleteWavAfterClassification":true}'
```

4. Poll progress until `phase` becomes `completed` and `isActive` is `false`:

```bash
watch -n 5 'curl -s http://localhost:3000/api/classify/progress | jq .data'
```

5. Export the offline bundle:

```bash
cd /home/chris/dev/c64/sidflow
bun run export:similarity -- --profile full --corpus-version hvsc
```

Resulting files:

- `data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite`
- `data/exports/sidcorr-hvsc-full-sidcorr-1.manifest.json`

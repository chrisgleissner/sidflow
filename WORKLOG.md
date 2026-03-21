# WORKLOG — Release Tag CI Fix (0.5.0-RC3)

Append-only execution trace. Each entry records commands, CI results, observations, and outcomes.

---

## 2026-03-21 — Phase 1: Discovery

### Observation: All release tags failing in CI

```
gh run list --workflow=release.yaml --limit=10
```

Result: Every tag from `0.3.43` through `0.5.0-rc2` has `conclusion: failure`.

### Finding the failure step

```
gh run view 23367403686 --log-failed
```

Grep for actual error:
```
mktemp: failed to create directory via template
'/home/runner/work/sidflow/sidflow/tmp/docker-smoke.XXXXXX':
No such file or directory
##[error]Process completed with exit code 1.
```

The Docker image build **succeeded** — the failure happens in the `Smoke test Docker image` step,
specifically on the very first line of `scripts/docker-smoke.sh` that calls `mktemp`.

### Root Cause

`scripts/docker-smoke.sh` line:
```bash
TMP_ROOT="$(mktemp -d "${ROOT_DIR}/tmp/docker-smoke.XXXXXX")"
```

The `tmp/` directory is in `.gitignore` and therefore absent in fresh CI checkouts.
`mktemp` cannot create a subdirectory when the parent does not exist.

---

## 2026-03-21 — Phase 2–3: Fix

**File changed:** `scripts/docker-smoke.sh`

**Change:** Added `mkdir -p "${ROOT_DIR}/tmp"` immediately before the `mktemp` call.

```diff
 CLASSIFY_LIMIT="${CLASSIFY_LIMIT:-10}"
 HEALTH_URL="http://127.0.0.1:${HOST_PORT}/api/health"
 READINESS_URL="${HEALTH_URL}?scope=readiness"
+# Ensure the tmp directory exists (it is gitignored and therefore absent in CI checkouts)
+mkdir -p "${ROOT_DIR}/tmp"
 TMP_ROOT="$(mktemp -d "${ROOT_DIR}/tmp/docker-smoke.XXXXXX")"
```

---

## 2026-03-21 — Phase 4: Local Docker Build

Command:
```
docker build -f Dockerfile.production -t sidflow:rc3-local .
```

Result: **SUCCESS** — cached layers used, build completed in ~90s.

---

## 2026-03-21 — Phase 5: Local Smoke Test

Command:
```
IMAGE_TAG=sidflow:rc3-local DOCKER_SMOKE_MODE=build \
  CONTAINER_NAME=sidflow-smoke-rc3-local \
  bash scripts/docker-smoke.sh
```

Result: **SUCCESS**

Smoke test evidence:
- `mktemp` directory created successfully (fix validated)
- Container started and became healthy
- Health endpoint: `liveness=healthy`, `readiness=ready`
- Admin metrics API: responded with correct job queue data
- Playback API: returned `10_Orbyte.sid` track data
- Favorites add/list/delete: all succeeded
- Classification (limit=10): 10/10 files processed, 10 JSONL records written
- Final: `[docker-smoke] Success! Image 'sidflow:rc3-local' passed smoke test.`

---

## 2026-03-21 — Phase 6: Commit and Tag

```
git add scripts/docker-smoke.sh PLANS.md WORKLOG.md
git commit -m "fix(ci): create tmp/ before mktemp in docker-smoke.sh"
git push origin main
git tag 0.5.0-rc3
git push origin 0.5.0-rc3
```

---

## 2026-03-21 — Phase 7: CI Validation

CI run 23376286432 for tag `0.5.0-rc3`:
- Polled every 30s for ~7 minutes
- Result: **`completed/success`** ✅
- Image published to `ghcr.io/chrisgleissner/sidflow:0.5.0-rc3`

---

## 2026-03-21 — Phase 8: GHCR Pull

```
docker pull ghcr.io/chrisgleissner/sidflow:0.5.0-rc3
```

Result: **SUCCESS** — image pulled, digest `sha256:397c0dff6a0dc00269348ebdc45d67f34d370e71a6897275ef11f21cdee39a52`

---

## 2026-03-21 — Phase 9: Functional Smoke Test (GHCR image)

Command:
```
IMAGE_TAG=ghcr.io/chrisgleissner/sidflow:0.5.0-rc3 \
  DOCKER_SMOKE_MODE=pull \
  CONTAINER_NAME=sidflow-smoke-rc3-ghcr \
  bash scripts/docker-smoke.sh
```

Result: **SUCCESS** ✅

- Container became healthy
- Health endpoint: `liveness=healthy`, `readiness=ready`
- Admin metrics API: responded correctly
- Playback API: returned track data for `C64Music/DEMOS/0-9/10_Orbyte.sid`
- Favorites add/list/delete: all passed
- Classification (limit=10): 10/10 files processed, 20 JSONL records across 2 files
- Final: `[docker-smoke] Success! Image 'ghcr.io/chrisgleissner/sidflow:0.5.0-rc3' passed smoke test.`

---

## OUTCOME: ALL TERMINATION CRITERIA MET ✅

1. ✅ Tag `0.5.0-rc3` exists and CI (release.yaml) is GREEN
2. ✅ Docker image published to `ghcr.io/chrisgleissner/sidflow:0.5.0-rc3`
3. ✅ Image pulled from GHCR successfully
4. ✅ Container runs and health endpoint responds
5. ✅ Functional smoke: UI accessible, classify (10 songs) works, playback works
6. ✅ PLANS.md updated with final state
7. ✅ WORKLOG.md contains full trace

---

## 2026-03-21 — SID CLI Station rating-column integration

### Source of rating data

- The playlist window now sources per-track ratings from the existing station selection ratings map that is already persisted and reused by the station CLI.
- Rendering reads `state.ratings.get(track.track_id)` for each playlist row.
- Missing ratings are normalized to `0` and render as `[☆☆☆☆☆]`.

### Invalid rating handling

- Before the change, malformed persisted ratings outside `0..5` were discarded during selection-state hydration.
- That meant bad historical values such as `11` implicitly fell back to “missing”, which rendered as zero stars instead of a clamped maximum.
- The normalization layer now clamps every numeric persisted rating through a pure `normalizeRating(...)` helper:
  - `null`/missing/NaN -> `0`
  - negative -> `0`
  - greater than `5` -> `5`
  - fractional -> truncated integer, then clamped
- Regression coverage now verifies that malformed persisted values such as `11` render as `[★★★★★]` instead of disappearing.

### Layout comparison

Before:
```text
▶ 001/100 Title — Author — 1:00
```

After:
```text
001/100  ► [★★★★★] Title...  Author...  1:00 1989
```

- The playlist row layout is now a fixed column contract:
  - `index(7, right-aligned)`
  - `marker(2)`
  - `rating(7)`
  - `title(fixed width)`
  - `artist(fixed width)`
  - `duration(6, right-aligned)`
  - `extra/meta(6)`
- Column widths are resolved once per render width and reused for every row, so mixed ratings and long titles no longer shift downstream columns.

### Performance considerations

- Star rendering uses a precomputed string table for ratings `0..5` rather than rebuilding star strings for every row.
- Rating normalization is a small pure clamp/truncation helper with no I/O and no per-row dynamic width discovery.
- Playlist row widths are computed once per render call, not per row, which keeps redraw cost stable even with a long visible playlist window.

### Validation status

- Fast build: `bun run build:quick` — PASS
- Focused station tests: `packages/sidflow-play/test/cli.test.ts` — PASS after adding unit, regression, and exact-layout assertions for the new rating column
- Full build + full-suite validation: in progress

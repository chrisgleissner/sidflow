# Artifact Governance

This document defines the classification, policies, and procedures for managing artifacts in the SIDFlow project.

## Overview

SIDFlow distinguishes between three types of artifacts:

1. **Canonical Data** — Source of truth, versioned in Git
2. **Derived Artifacts** — Generated from canonical data, excluded from Git
3. **Manifests** — Metadata and checksums for reproducibility, versioned in Git

This separation keeps the repository lightweight while enabling deterministic rebuilds and ensuring data consistency.

## Artifact Classification

| Artifact | Type | In Git | Notes |
|----------|------|--------|-------|
| `data/classified/*.jsonl` | Canonical | ✅ | Classification outputs, text-based, produces small diffs |
| `data/feedback/**/*.jsonl` | Canonical | ✅ | Append-only user feedback logs, merge-friendly |
| `data/sidflow.lance/` | Derived | ❌ | Binary vector database, rebuilt locally via `bun run build:db` |
| `data/sidflow.lance.manifest.json` | Manifest | ✅ | Database metadata, checksums, and schema version |
| `*.sid.tags.json` | Canonical | ✅ | Manual rating files, colocated with SID files |
| `auto-tags.json` | Canonical | ✅ | Aggregated auto-tags at classification depth |
| `workspace/wav-cache/` | Derived | ❌ | WAV files rendered from SIDs, rebuilt via `sidflow-classify` |
| `workspace/hvsc-version.json` | Manifest | ✅ | HVSC sync state tracking and checksums |
| `data/model/model.json` | Derived | ❌ | TensorFlow.js model topology, rebuilt via `sidflow-train` |
| `data/model/*.bin` | Derived | ❌ | TensorFlow.js model weights, rebuilt via `sidflow-train` |
| `data/model/feature-stats.json` | Manifest | ✅ | Normalization statistics for features |
| `data/model/model-metadata.json` | Manifest | ✅ | Model version, architecture, and training metadata |
| `data/training/training-log.jsonl` | Canonical | ✅ | Training history with timestamps and metrics |
| `data/training/training-samples.jsonl` | Canonical | ✅ | Aggregated training samples from feedback |

## Git Policies

### Canonical Data
- **Format:** Text-based (JSON, JSONL)
- **Storage:** Committed to Git and versioned
- **Purpose:** Source of truth for all derived artifacts
- **Characteristics:**
  - Human-readable and diff-friendly
  - Deterministic ordering (via `stringifyDeterministic`)
  - Small file sizes to minimize repository growth
  - Line-based format (JSONL) for merge-friendly updates

### Derived Artifacts
- **Format:** Binary or large files
- **Storage:** Excluded from Git via `.gitignore`
- **Purpose:** Optimized for runtime performance
- **Characteristics:**
  - Generated deterministically from canonical data
  - Can be rebuilt at any time
  - May be large (WAV files, databases, model weights)
  - Excluded to keep repository lightweight

### Manifests
- **Format:** Text-based JSON
- **Storage:** Committed to Git
- **Purpose:** Track state and enable reproducibility
- **Characteristics:**
  - Contains checksums of source data
  - Records schema versions
  - Documents rebuild procedures
  - Small file sizes

## Reproducibility

After cloning the repository, derived artifacts must be rebuilt:

### 1. Rebuild LanceDB Vector Database

```bash
bun run build:db
```

This command:
- Reads all `classified/*.jsonl` files
- Aggregates `feedback/**/*.jsonl` events
- Creates vector database in `data/sidflow.lance/`
- Generates `data/sidflow.lance.manifest.json`

**Time:** Typically 1-5 seconds for small datasets, scales linearly

**Validation:**
```bash
# Check manifest matches expectations
cat data/sidflow.lance.manifest.json | grep record_count
```

### 2. Rebuild WAV Cache (Optional)

```bash
bun run classify:sample
# or
sidflow-classify --hvsc-path ./workspace/hvsc
```

This command:
- Renders SID files to WAV using `sidplayfp -w`
- Stores in `workspace/wav-cache/` mirroring HVSC structure
- Only generates missing or stale WAV files (idempotent)

**Time:** Depends on number of SID files and CPU cores (uses parallel processing)

**Validation:**
```bash
# Check WAV cache contains expected files
find workspace/wav-cache -name "*.wav" | wc -l
```

### 3. Rebuild ML Model (Optional)

```bash
bun run sidflow-train --evaluate
```

This command:
- Loads training samples from `data/training/training-samples.jsonl`
- Trains TensorFlow.js model using explicit ratings and feedback
- Saves model to `data/model/model.json` and `data/model/*.bin`
- Updates `data/model/model-metadata.json`
- Appends entry to `data/training/training-log.jsonl`

**Time:** Depends on sample count and epochs (typically 30-120 seconds)

**Validation:**
```bash
# Check model files exist
ls -lh data/model/model.json data/model/*.bin

# Review training log
tail -1 data/training/training-log.jsonl | jq .
```

## Benefits

### 1. Lightweight Repository
- Binary artifacts excluded → smaller clone size
- Text-based canonical data → efficient Git operations
- Linear repository growth with dataset size

### 2. Merge-Friendly Workflow
- JSONL format → line-based diffs
- Append-only logs → minimal conflicts
- Deterministic ordering → consistent diffs

### 3. Reproducible Builds
- Manifests track checksums → verify integrity
- Rebuild commands documented → easy onboarding
- Deterministic processes → same inputs = same outputs

### 4. Audit Trail
- Manifest checksums → detect source data changes
- Training logs → track model evolution
- Feedback logs → analyze user behavior

## Troubleshooting

### Checksum Mismatch

**Symptom:** Manifest checksum doesn't match actual data

**Cause:** Canonical data modified after manifest generation

**Solution:**
```bash
# Delete derived artifacts
rm -rf data/sidflow.lance/

# Rebuild database (regenerates manifest)
bun run build:db

# Verify checksums
git diff data/sidflow.lance.manifest.json
```

### Missing Manifest

**Symptom:** `sidflow.lance.manifest.json` not found

**Cause:** Database rebuilt without manifest generation

**Solution:**
```bash
# Rebuild with manifest update
bun run build:db --update-manifest
```

### Corrupt LanceDB

**Symptom:** Errors when querying database, unexpected results

**Cause:** Interrupted build, disk corruption, or version mismatch

**Solution:**
```bash
# Delete database directory
rm -rf data/sidflow.lance/

# Rebuild from scratch
bun run build:db

# Validate record count
cat data/sidflow.lance.manifest.json | jq .record_count
```

### Feedback Log Conflicts

**Symptom:** Git merge conflicts in feedback JSONL files

**Cause:** Multiple users logging feedback concurrently

**Solution:**
```bash
# Append-only structure should auto-merge, but if conflicts occur:

# 1. Keep both versions (default Git behavior)
# 2. Validate for duplicate UUIDs
bun run validate:feedback

# 3. If duplicates found, manually dedupe by UUID
# The validation script will report duplicates to remove
```

### Stale WAV Cache

**Symptom:** Classification produces unexpected results

**Cause:** SID files updated but WAV cache not refreshed

**Solution:**
```bash
# Force rebuild of WAV cache
rm -rf workspace/wav-cache/

# Rebuild (automatically detects missing files)
bun run classify:sample
```

### Model Performance Degradation

**Symptom:** Predictions less accurate than expected

**Cause:** Insufficient training data, outdated model, or distribution shift

**Solution:**
```bash
# Check training sample count
wc -l data/training/training-samples.jsonl

# Retrain with evaluation
bun run sidflow-train --evaluate

# Review metrics
tail -1 data/training/training-log.jsonl | jq .metrics

# If MAE > 0.5 or R² < 0.7, need more training data
```

### Git Repository Size Growth

**Symptom:** Repository clone takes too long

**Cause:** Large canonical files committed accidentally

**Solution:**
```bash
# Identify large files
git rev-list --objects --all | 
  git cat-file --batch-check='%(objectsize) %(objectname) %(rest)' | 
  sort -nr | 
  head -20

# Remove large files from history (if needed)
# WARNING: Rewrites history, coordinate with team
git filter-branch --tree-filter 'rm -rf data/sidflow.lance/' HEAD

# Update .gitignore to prevent future commits
echo "data/sidflow.lance/" >> .gitignore
```

## Validation Commands

### Validate Configuration
```bash
bun run validate:config
```
Checks `.sidflow.json` for required fields and valid paths.

### Validate Feedback Logs
```bash
bun run validate:feedback
```
Checks for:
- Valid JSON in all feedback files
- Duplicate UUIDs (if used)
- Correct date-based partitioning
- Valid action types

### Verify Database Integrity
```bash
# Check manifest exists
test -f data/sidflow.lance.manifest.json && echo "✓ Manifest found" || echo "✗ Manifest missing"

# Check database exists
test -d data/sidflow.lance/ && echo "✓ Database found" || echo "✗ Database missing"

# Check record count matches
MANIFEST_COUNT=$(cat data/sidflow.lance.manifest.json | jq .record_count)
echo "Records in manifest: $MANIFEST_COUNT"
```

### Verify Checksums
```bash
# Script to verify manifest checksums match current data
# (This would be a future enhancement to the validate scripts)
bun run verify:checksums
```

## Best Practices

### 1. Regular Rebuilds
- Rebuild database after pulling changes: `bun run build:db`
- Rebuild WAV cache when HVSC updates: `sidflow-classify`
- Retrain model periodically: `bun run sidflow-train`

### 2. Commit Discipline
- Never commit derived artifacts (enforced by `.gitignore`)
- Always regenerate manifests after canonical data changes
- Use deterministic serialization (`stringifyDeterministic`)

### 3. Testing
- Test with derived artifacts deleted (simulate fresh clone)
- Verify rebuild commands complete successfully
- Check manifests contain expected checksums

### 4. Documentation
- Document rebuild time expectations in README
- Update troubleshooting guide with common issues
- Maintain changelog for schema version changes

### 5. Continuous Integration
- CI should rebuild all derived artifacts
- Validate checksums match manifests
- Ensure coverage remains ≥90%
- Test on fresh clone (no cached artifacts)

## Schema Versioning

Manifests track schema versions to handle breaking changes:

### LanceDB Schema Version
Current: `1.0`

Changes:
- `1.0` — Initial schema with `[e, m, c, p]` vectors

### Model Feature Set Version
Current: `2025-10-30`

Tracks feature extraction changes that require retraining.

### JSONL Record Version
Implicit in record structure, backward compatible via optional fields.

## Migration Procedures

When schema changes are required:

1. **Update schema version** in relevant manifest
2. **Provide migration script** to convert old data to new format
3. **Document breaking changes** in CHANGELOG
4. **Test migration** on sample data before applying to full dataset
5. **Update rebuild procedures** in this document

Example migration:
```bash
# Migrate from schema v1.0 to v2.0
bun run migrate:schema --from 1.0 --to 2.0
```

## Summary

SIDFlow's artifact governance ensures:
- ✅ Lightweight Git repository
- ✅ Reproducible builds
- ✅ Merge-friendly workflows
- ✅ Audit trails via manifests
- ✅ Clear troubleshooting procedures

By following these policies, contributors can work efficiently while maintaining data integrity and consistency across the project.

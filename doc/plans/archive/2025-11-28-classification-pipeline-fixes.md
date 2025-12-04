# Classification Pipeline Fixes (2025-11-27 to 2025-11-28)

**Status**: ✅ COMPLETED

This archive consolidates multiple related classification pipeline tasks completed between 2025-11-27 and 2025-11-28.

## Tasks Completed

### 1. Fix Classification Pipeline - Enable Full Audio Encoding and Feature Extraction
- **Problem**: Classification only created WAV files, missing Essentia.js feature extraction
- **Solution**: Changed `defaultFeatureExtractor` to use `essentiaFeatureExtractor` with automatic fallback; integrated `RenderOrchestrator` for multi-format support
- **Verification**: All 1400+ tests pass; Essentia.js confirmed as default

### 2. Inline Render + Classify Per Song
- **Problem**: Two-phase flow rendered all WAVs first, losing work if interrupted
- **Solution**: On-demand rendering inside `generateAutoTags`; removed separate `buildWavCache` pass
- **Verification**: CLI now renders each song immediately before feature extraction

### 3. Prevent Runaway sidplayfp Renders Ignoring Songlengths
- **Problem**: Some SIDs rendered indefinitely producing multi-GB WAVs
- **Solution**: Added Songlength-derived + fallback time limit with watchdog kill
- **Verification**: Tests confirm `-t` flag uses Songlength-derived caps

### 4. Fix Classification UI Progress - Show All Phases
- **Problem**: UI showed only "tagging" phase, rendering not visible
- **Solution**: Updated `CLASSIFICATION_STEPS` to 4 phases; added `getPhaseLabel()` mapping
- **Files**: ClassifyTab.tsx, doc/technical-reference.md

### 5. Classification Pipeline - Fix Progress Messages and Output Format
- **Problem**: Tag JSON files missing Essentia features; no force rebuild deletion
- **Solution**: CLI now calls both `generateAutoTags` AND `generateJsonlOutput`; added `cleanAudioCache` for force rebuild
- **Verification**: 745 pass / 0 fail / 1 skip × 3 runs

## Key Files Modified
- `packages/sidflow-classify/src/index.ts` - On-demand rendering, Essentia default
- `packages/sidflow-classify/src/cli.ts` - Progress labels, JSONL output
- `packages/sidflow-web/components/ClassifyTab.tsx` - 4-phase UI
- `doc/technical-reference.md` - Pipeline documentation

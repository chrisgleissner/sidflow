# Audio Format Preferences and UI Fixes (2025-11-28)

**Status**: ✅ COMPLETED

## Issues Fixed

### 1. Audio Format Save Error
- **Problem**: "Unable to save audio formats: No preferences provided"
- **Root Cause**: `defaultFormats` not in validation list
- **Fix**: Added normalization and validation for `defaultFormats` array

### 2. Classification UI Stuck
- **Problem**: Shows "Classifying" but threads say "Waiting for work"
- **Root Cause**: Progress labels not matching regex patterns
- **Fix**: Updated regex patterns in `classify-progress-store.ts`

### 3. Background Training Toggle Missing
- **Problem**: Toggle in PublicPrefsTab but not AdminPrefsTab
- **Fix**: Added training toggle card to AdminPrefsTab

### 4. Play/Pause Not Resuming
- **Problem**: Player resume logic broken
- **Fix**: Skip worker ready wait when resuming from pause

### 5. Era Station "No Tracks Found"
- **Problem**: Quality filter too strict
- **Fix**: Relaxed from e/m/c >= 2 to >= 1, increased limit to 1000

### 6. Rating Rate Limit Exceeded
- **Problem**: Docker bridge IP shared across sessions
- **Fix**: Increased limit to 300 req/min; added `SIDFLOW_DISABLE_RATE_LIMIT=1`

## Key Files Modified
- `app/api/prefs/route.ts` - defaultFormats handling
- `packages/sidflow-web/lib/classify-progress-store.ts` - Regex patterns
- `packages/sidflow-web/components/AdminPrefsTab.tsx` - Training toggle

## Verification
- All tests passing 3× consecutively (1148 unit tests)
- Test suite optimized: 2m+ → 1m46s (15% speedup)
- Docker deployed and verified healthy

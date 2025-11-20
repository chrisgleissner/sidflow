# Render Engine Naming Clarification (2025-11-19)

**Archived from PLANS.md on 2025-11-20**

## Task Summary

Clarified that "wasm" render engine is "libsidplayfp-wasm" in all user-facing documentation and UI, maintaining internal config compatibility.

## Context

**Issue**: Documentation and UI inconsistently referred to the WASM render engine as just "wasm", which didn't make clear the distinction between:
- sidplayfp: CLI tool
- libsidplayfp: C++ library
- libsidplayfp-wasm: WASM-compiled version of libsidplayfp library

## Completed Tasks

### User-Facing UI Updates ✅

**JobsTab Component**
- Changed: "wasm (WASM, cross-platform)" 
- To: "libsidplayfp-wasm (WASM, cross-platform)" vs "sidplayfp CLI (native binary)"
- Clarifies the technology stack for users

**AdminPrefsTab Component**
- Already had: "libsidplayfp-wasm (default)" label
- No changes needed

### Documentation Updates ✅

**README.md**
- Added clarification: "(compiled to WASM for cross-platform playback)" to libsidplayfp credit
- Makes it clear WASM version is derived from the C++ library

**user-guide.md**
- Added new "Playback Technology" section
- Explains both libsidplayfp-wasm (default, cross-platform) and sidplayfp CLI (optional, native) options
- Provides context for when users might choose one over the other

**technical-reference.md**
- Enhanced Render Engines section with detailed descriptions:
  - libsidplayfp-wasm: WASM-compiled C++ library, cross-platform, no dependencies
  - sidplayfp CLI: Native binary, platform-specific, optional performance boost
  - ultimate64: Hardware-based rendering (future)
- Clarified architecture and use cases for each engine

### Backward Compatibility ✅

**Internal Config Values**
- Maintained "wasm" as internal config value in `.sidflow.json`
- No breaking changes for existing users
- Transparent migration - documentation changes only

## Impact

✅ **User clarity**: Clear distinction between library and WASM compilation
✅ **Technical accuracy**: Proper attribution to libsidplayfp project
✅ **Backward compatible**: No config file changes required
✅ **Documentation complete**: All user-facing docs updated

## Files Modified

1. `packages/sidflow-web/components/JobsTab.tsx` - UI label update
2. `README.md` - Acknowledgements clarification
3. `doc/user-guide.md` - New Playback Technology section
4. `doc/technical-reference.md` - Enhanced Render Engines section

## No Changes Required

- `packages/sidflow-web/components/AdminPrefsTab.tsx` - Already correct
- `.sidflow.json` config files - Internal "wasm" value maintained
- Test files - No test changes needed
- API contracts - No breaking changes

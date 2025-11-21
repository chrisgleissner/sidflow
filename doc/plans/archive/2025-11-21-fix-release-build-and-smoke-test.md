## Task: Fix Release Build and Smoke Test (2025-11-21)

**User request (summary)**
- Investigate the entire release build and smoke test workflow
- Identify and fix issues that would prevent successful release packaging
- Ensure smoke test validates release artifact correctly

**Context and constraints**
- Release builds use Next.js standalone mode with output in .next/standalone
- Smoke test extracts zip and runs packaged server in GitHub Actions
- Health check must work with standalone paths (not dev-mode relative paths)

**Plan (checklist)**
- [x] 1 — Examine release workflow structure and all scripts
- [x] 2 — Check release scripts for Git dependencies and path issues
- [x] 3 — Verify smoke test implementation and validation
- [x] 4 — Test release build locally to identify path resolution issues
- [x] 5 — Fix health check path issues for standalone builds
- [x] 6 — Fix data manifest availability in standalone mode
- [x] 7 — Improve release server script with better logging
- [x] 8 — Enhance smoke test validation and error reporting

**Progress log**
- 2025-11-21 — Analyzed release.yaml workflow: builds workspace, creates standalone Next.js build, packages as zip, extracts and smoke tests
- 2025-11-21 — Reviewed all CI scripts: release-prepare.ts, extract-changes-entry.ts, format-release-notes.ts, update-release-notes.ts, package-release.py
- 2025-11-21 — Identified issues: health check uses relative paths that don't work in standalone; SIDFLOW_ROOT needs proper setup
- 2025-11-21 — Fixed health check: use path.join(process.cwd(), 'public', ...) for WASM, use SIDFLOW_ROOT for data manifest
- 2025-11-21 — Improved start-release-server.sh: correct working directory to standalone server dir, add logging
- 2025-11-21 — Enhanced smoke test: verify JSON response fields, show server logs on failure, report health check timing
- 2025-11-21 — Build passed: TypeScript compilation successful with all fixes applied
- 2025-11-21 — COMPLETE: All release build issues fixed, smoke test enhanced with better validation and debugging
- 2025-11-21 — User requested: eliminate manual release-prepare step, auto-generate CHANGES.md on tag push (like reference workflow)
- 2025-11-21 — Inlined find-previous-tag, format-release-notes, and update-release-notes logic directly in workflow using node heredocs
- 2025-11-21 — Modified release-prepare.ts to auto-generate CHANGES.md entries without requiring manual prep
- 2025-11-21 — Tested script: correctly inserts "## {version} ({date})" entry after "# Changelog" header
- 2025-11-21 — COMPLETE: Release workflow now fully automated - just push a tag via GitHub UI and workflow handles everything

**Assumptions and open questions**
- Assumption: CI has sidplayfp installed (test skips gracefully if not)
- Assumption: C4 tone test thresholds (6Hz freq error, 30% amplitude variation) are sufficient for CI stability
- Assumption: bunfig.toml exclusion patterns prevent E2E tests from running during unit test phase

**Follow-ups / future work**
- Monitor C4 tone test stability in CI over next few runs
- Consider adding explicit check for sidplayfp availability in CI setup
- Ensure test:all script properly sequences unit + E2E tests with correct exit codes


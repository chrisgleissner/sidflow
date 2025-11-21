# Release Artifact Distribution (2025-11-20)

**Archived from PLANS.md on 2025-11-21**

**User request (summary)**
- Replace npm publication with a GitHub release zip that boots the full SIDFlow website.
- Extend README with production startup instructions for the packaged build (distinct from dev mode).
- Add a post-release smoke test that validates the packaged artifact.

**Context and constraints**
- Current release workflow (`.github/workflows/release.yaml`) bumps versions and publishes every workspace package to npm.
- The web experience lives in `packages/sidflow-web` (Next.js 16) and assumes `next build` at deployment time.
- Admin APIs invoke CLI scripts under `scripts/`, so the release artifact must keep those assets plus Bun tooling available.
- Smoke test should unpack the new artifact, start the packaged server, and hit a representative endpoint (`/api/health`).

**Plan (checklist)**
- [x] 1 — Audit the release pipeline and capture all assets the artifact must contain.
- [x] 2 — Enable a production-ready Next.js build (e.g., standalone output) and add a helper start script + README instructions.
- [x] 3 — Implement packaging logic + workflow changes to create and upload the release zip.
- [x] 4 — Update README/CHANGES to describe the new artifact and startup process.
- [x] 5 — Add a post-release smoke test job that downloads the zip, extracts it, boots the server, and validates `/api/health`.
- [x] 6 — Run targeted validation (build/tests as feasible) and log results.

**Progress log**
- 2025-11-20 — Task opened, plan drafted.
- 2025-11-20 — Audited existing release workflow + asset requirements; decided to package the whole workspace with the built Next.js standalone output.
- 2025-11-20 — Enabled Next.js `output: "standalone"`, added `scripts/start-release-server.sh` + `start:release` script, and documented the new release artifact flow in `README.md` + `doc/release-readiness.md`.
- 2025-11-20 — Reworked `.github/workflows/release.yaml` to build the web bundle, copy the full workspace into `sidflow-<version>.zip`, upload it to the GitHub release, and added a `smoke_test_release` job that boots the packaged server and hits `/api/health`.
- 2025-11-20 — Ran `npm run build` + `npm run test` (Bun-installed toolchain); both passed, with the expected `wasm:check-upstream` reminder to rebuild libsidplayfp artifacts.

**Assumptions and open questions**
- Assumption: Bundling workspace dependencies and CLI scripts inside the zip is acceptable for now.
- Assumption: Smoke test may curl `http://localhost:3000/api/health` as proof of life.
- Open questions: None; proceed with these assumptions.

**Follow-ups / future work**
- Consider lighter-weight distribution (Docker image) once the zip workflow is validated.
- Add pre-release artifact verification to PR CI.

## Task: Repair Release Workflow Changelog Extraction (2025-11-22)

**User request (summary)**
- Fix tag-triggered release build failing while extracting changelog entry for release notes
- Review entire release pipeline to avoid further piecemeal fixes

**Context and constraints**
- Release workflow runs on tag push, generates changelog entry via `changes:entry`, and writes outputs to `$GITHUB_OUTPUT`
- Must keep automated release (tag → release) fully hands-off; avoid manual prep
- Prefer additive, low-risk changes that harden CI without altering release artifacts

**Plan (checklist)**
- [x] 1 — Inspect failing changelog extraction step and reproduce output handling locally
- [x] 2 — Update workflow/script to write changelog output safely (robust delimiter/escaping) and align with Actions conventions
- [x] 3 — Audit downstream release steps (release notes formatting, GH release update, packaging/smoke test) for similar risks and patch if needed
- [x] 4 — Run targeted validation of updated steps (local script invocations and output-file simulation) and record results

**Progress log**
- 2025-11-22 — Started task, captured user-reported failure in changelog extraction step of release workflow
- 2025-11-22 — Diagnosed quoted heredoc delimiter in changelog extraction as root cause; rewrote step to stream output with a unique delimiter and hardened release notes exporter with delimiter guard + missing env check
- 2025-11-22 — Reviewed downstream release steps (release notes update, packaging, smoke test) for similar output handling issues; locally validated changelog extraction and release notes formatting steps against temporary GITHUB_OUTPUT files

**Assumptions and open questions**
- Assumption: Full GitHub Actions release run cannot be executed locally; rely on targeted script checks
- Open question: None (proceed with best-effort hardening)

**Follow-ups / future work**
- Consider adding a lightweight local release dry-run script if further issues surface


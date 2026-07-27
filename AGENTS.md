# Agent Instructions for SIDFlow

This repository is optimized for long‑running, mostly autonomous LLM work across tools (Codex CLI, GitHub Copilot, Cursor, and others).

If you are an LLM agent working in this repo:

- Treat this file as **required reading** before you write or edit code.
- Obey these instructions together with any system/developer prompts from your host tool. If they conflict, system‑level instructions win.
- Prefer acting directly (editing files, running tests, updating plans) over merely suggesting code.

## ⚠️ ABSOLUTE TEST REQUIREMENTS — READ THIS FIRST ⚠️

**BEFORE YOU DO ANYTHING ELSE, READ AND INTERNALIZE THESE RULES:**

### 🔴 NON-NEGOTIABLE TEST QUALITY RULES 🔴

1. **100% PASS RATE REQUIRED**: ALL tests must pass 3 times consecutively before ANY work is considered complete.
   - ❌ NEVER say "855 pass, 50 fail" is acceptable or "stable"
   - ❌ NEVER claim "perfect stability" with ANY failing tests
   - ❌ "Mostly working" or "95% passing" is COMPLETE FAILURE
   - ✅ ONLY "100% pass" across 3 consecutive runs is acceptable

2. **ALWAYS LEAVE TESTS BETTER THAN YOU FOUND THEM**:
   - If baseline is 844 pass / 40 fail, you must reach 844+ pass / 0 fail
   - Fix ALL pre-existing test failures - NEVER skip them
   - NEVER introduce new failing tests
   - NEVER stop working while ANY tests are failing or flaky

3. **FAILING TESTS MUST BE FIXED, NOT SKIPPED**:
   - Failing tests indicate real problems that must be resolved
   - If a test fails due to missing test dependencies (test fixtures, mock data): CREATE the missing dependencies
   - If a test fails due to missing external tools (ffmpeg/ffprobe) that are expected to be installed: FIX the installation or make the code handle their absence gracefully
   - ONLY skip tests with explicit `test.skip()` when they test features not yet implemented
   - Document WHY each test is skipped at the top of the test file
   - A skipped test is a TODO item, not a permanent solution

4. **TEST BEFORE YOU COMMIT**:
   - Run full test suite 3x: `for i in 1 2 3; do bun test packages/...; done`
   - Verify 100% pass rate on ALL three runs
   - If ANY test fails on ANY run: STOP and fix it
   - Only commit when you have 3 consecutive clean runs
   - **Documentation-only exception:** for changes limited to Markdown/text documentation (including `README.md`, `PLANS.md`, and changelogs) that do not alter code, scripts, configuration, workflows, generated artefacts, or test fixtures, run `git diff --check` and verify the edited links/content instead. Do not run the full test suite solely for those changes.

5. **WHEN IN DOUBT, RUN THE TESTS**:
   - After every code change: run tests
   - Before every commit: run tests 3x
   - If you see failures: STOP EVERYTHING and fix them
   - Never rationalize away test failures

6. **COMPLETION ATTESTATION REQUIRED**:
   - Before declaring ANY task complete, you MUST paste the literal output of 3 consecutive test runs
   - The pasted output must show `0 fail` on all 3 runs
   - If you cannot paste this output, YOU ARE NOT DONE
   - Do not summarize or paraphrase - paste the actual terminal output
   - This attestation does not apply to the documentation-only exception above; report the documentation validation performed instead.

### 🚨 COMMON RATIONALIZATION TRAPS — DO NOT FALL FOR THESE 🚨

The most common failure mode is **rationalizing away test failures**. Here are the exact thoughts that lead to violations:

- ❌ "This failure is pre-existing, not caused by my changes" → **WRONG. Fix it anyway.**
- ❌ "This is a flaky test, it passes sometimes" → **WRONG. Flaky tests must be fixed or you are not done.**
- ❌ "This test is unrelated to the feature I'm implementing" → **WRONG. All tests must pass.**
- ❌ "I'll just note this failure and move on" → **WRONG. You must fix it before declaring completion.**
- ❌ "The test is probably broken, not my code" → **WRONG. Investigate and fix whichever is broken.**

If you catch yourself thinking any of these thoughts: STOP. You are about to violate the rules. Go fix the test.

**YOU HAVE JUST LEARNED THIS LESSON THE HARD WAY. NEVER FORGET IT.**

## Required reading and orientation

Before making non‑trivial changes, you must read or skim, in this order:

1. `PLANS.md` — central ExecPlan for multi‑hour work and validation workflow.
2. `README.md` — high‑level overview, user goals, and entry points.
3. `doc/developer.md` — local setup, workspace commands, and coding standards.
4. `doc/technical-reference.md` — architecture, CLIs, data flow, and key components.
5. Any additional rollout/design plans if the repo contains a `doc/plans/**` folder.

Re‑open `PLANS.md` whenever you start a new user request or resume work after a pause.

## Multi‑hour planning (`PLANS.md` / ExecPlans)

This repo follows the PLANS pattern from the OpenAI Cookbook article “Using PLANS.md for multi‑hour problem solving”.

In this repository, an **ExecPlan** is any concrete, checklist‑style plan you maintain in `PLANS.md` for a substantial task.

As an agent:

- Always open `PLANS.md` when you start working and treat it as the **contract** for plan‑then‑act behavior.
- For each substantial user request or feature, create or update a **Task/ExecPlan entry** in `PLANS.md` rather than keeping the plan only in transient memory or tool‑specific state.
- Maintain a concrete, checklist‑style plan there (phases/steps, not just prose), and keep it in sync with your actual work.
- Append short progress updates to the relevant task as you complete steps; do not silently diverge from the written plan.
- When you finish a task, clearly mark it as completed in `PLANS.md` and record any follow‑ups, risks, or known gaps.

`PLANS.md` is the shared memory for multi‑hour problem solving. Prefer editing it incrementally over rewriting large sections.

## Persistence and autonomy

When responding to a user request in this repo:

- Default to **persistent, end‑to‑end execution**: keep going until the request is fully implemented, validated (Build, Lint/Typecheck, Tests), and reflected in documentation or `PLANS.md`.
- Do **not** stop early just because you hit an uncertainty; instead, make the most reasonable assumption you can based on the docs and code, and record that assumption in `PLANS.md` (or in your plan tool) for later adjustment.
- Avoid asking the user to clarify edge cases unless the environment explicitly requires it. Prefer to decide, act, and document.
- Use your host tool’s planning mechanisms (e.g., explicit plan/execute phases, task lists, or planning tools like `update_plan`) alongside `PLANS.md`.
- Prioritize high‑leverage actions (tests, small refactors, doc updates) that move the codebase closer to the documented architecture and rollout plans.

Always stay within the safety and capability constraints of your host environment (sandboxing, approvals, network restrictions).

## Coding conventions and architecture

Follow the existing conventions rather than inventing new ones:

- Language and tooling:
  - TypeScript monorepo driven by Bun (`bun run build`, `bun run test`, `bun run test:e2e`).
  - Strict TypeScript settings from `tsconfig.base.json`; avoid `any` and keep types explicit.
- Error handling:
  - **Every `catch` block must either log the caught error or rethrow it.** Silent swallows — `catch { }` or `catch (e) { }` with no log and no rethrow — are forbidden. If the error is genuinely expected and non-actionable, log it at `debug` level with a brief explanation.
- Shared utilities and config:
  - Keep cross‑cutting helpers in `@sidflow/common` and **reuse** them instead of re‑implementing (config loader, deterministic JSON, logger, retry, LanceDB builder, filesystem helpers).
  - Always load configuration through `loadConfig` and honor `--config` overrides; use `resetConfigCache` in long‑running tools.
  - Serialize JSON deterministically with `stringifyDeterministic` to avoid diff churn and normalize structures before writing.
- CLIs and flows:
  - SIDFlow is a CLI‑first pipeline: fetch HVSC (`@sidflow/fetch`), classify (`@sidflow/classify`), train (`@sidflow/train`), and play/recommend (`@sidflow/play`); each stage reads/writes JSON/JSONL under `data/` and respects `.sidflow.json`.
  - Follow the existing CLI pattern: parse args in `cli.ts`, plan/validate inputs, then call pure helpers that accept explicit dependencies.
  - Treat scripts under `scripts/` as the contract for end‑to‑end flows; keep their UX and flags stable.
- Web/API:
 - For web UI and API work, align with the contracts and expectations in `doc/technical-reference.md`, `packages/sidflow-web/openapi.yaml`, and `packages/sidflow-web/README.md`.
  - Preserve health/metrics endpoints (`/api/health`, `/api/admin/metrics`) and their responsibilities.

Do not introduce new top‑level frameworks or major dependencies without a strong justification that is consistent with the existing design documents and rollout plans.

## Maintenance scripts and operational discipline

**CRITICAL: Never interact directly with Docker, system services, or application infrastructure using ad-hoc commands.**

All operational tasks must be performed through dedicated maintenance scripts in the `scripts/` directory:

- **Docker builds**: Use `scripts/build-docker.sh`, NOT `docker build` directly
- **Docker deployment**: Use `scripts/deploy/install.sh`, NOT `docker run` or `docker-compose` directly
- **Container management**: Extend scripts in `scripts/deploy/` for stop/start/restart/logs operations
- **Database operations**: Use `scripts/build-db.ts` and related validation scripts
- **CI/test operations**: Use package.json scripts (`bun run test`, `bun run build`, etc.)

**Rationale**: 
- Maintenance scripts encode institutional knowledge (correct flags, environment variables, paths)
- Scripts are version-controlled, reviewed, and tested
- Ad-hoc commands lead to configuration drift and undocumented changes
- Scripts serve as living documentation of operational procedures

**If a needed script doesn't exist**:
1. Create it in the appropriate `scripts/` subdirectory
2. Make it idempotent and safe (check preconditions, provide clear error messages)
3. Document its purpose and usage in a comment header
4. Update `doc/developer.md` or `doc/deployment.md` as appropriate
5. Then use the new script for the task at hand

**Exception**: Exploratory commands during development (e.g., `grep`, `find`, `cat`, one-off TypeScript checks) are fine, but anything that modifies system state or interacts with running services must go through a script.

## Testing, validation, and safety

**⚠️ CRITICAL: See "ABSOLUTE TEST REQUIREMENTS" section above before proceeding ⚠️**

- **MANDATORY**: Run tests 3x consecutively and achieve 100% pass rate before considering any work complete
- Prefer writing or updating tests alongside non‑trivial changes.
- Use the existing commands from `doc/developer.md`:
  - Build/typecheck: `bun run build`.
  - Unit tests: `bun run test` (coverage is enforced).
  - End‑to‑end: `bun run test:e2e` when pipeline changes are involved.
  - Config and data validations: `bun run validate:config`, `bun run build:db`, and other scripts as documented.
- **Before changing or adding e2e tests**, follow the existing patterns in `packages/sidflow-web/tests/e2e/` (avoid fixed sleeps where possible; prefer explicit, deterministic waits).
- **If you cannot run tests** due to environment limits: STOP and document this in `PLANS.md` as a blocker. Do NOT proceed with untested changes.
- **Missing dependencies**: If tests require unavailable tools (ffmpeg, sidplayfp), skip them explicitly with clear comments, NOT let them fail
- Prefer additive, idempotent changes. Avoid destructive operations (e.g., deleting data or large refactors) unless explicitly requested or clearly necessary; when you must perform them, describe rollback steps in the plan.

## The SID engine: comparative analysis (WASM vs native libsidplayfp)

**Read this before touching `packages/libsidplayfp-wasm/`.** The published WASM artifact was
silently wrong for months, and every test in the repo passed the whole time.

### What went wrong, so you know what to distrust

| # | defect | how it presented |
| --- | --- | --- |
| 1 | Built **SIDLite when it believed it was building reSIDfp**. Since libsidplayfp v3.x reSIDfp is the external `libresidfp`, and `configure` defines `HAVE_RESIDFP` only when pkg‑config finds it. The build never provided it, so `bindings.cpp` fell through to `SIDLiteBuilder` — while passing `-I.../residfp-builder` as if it had not. | Plausible audio, wrong engine. The defect was the mislabelling, not SIDLite: see below. |
| 2 | A `sidemu` **wrapper corrupted the mixer's buffer contract** — `bufferpos()` is non‑virtual, so `player.cpp`'s reset never reached the inner emulation. | Plausible audio. Decorrelated from the real machine. |
| 3 | **Heap‑use‑after‑free**: `initMixer()` caches each chip's raw `short*`; `player.load()` re‑runs `config()` which reallocates it; `selectSong()` called `load()` without re‑running `initMixer()`. | Plausible audio. ~10 dB too bright above 3 kHz. |
| 4 | reSIDfp's filter‑table threads aborted under emscripten, and the guard script silently matched nothing **and reported success**. | No audio at all. |

Every one of these loaded, rendered, returned sensible sample counts and never threw. **Do not treat
"it produces audio" as evidence that the engine is correct.**

### SIDLite was not the problem — and is now the default

Defects 2 and 3 lived in `bindings.cpp`, shared by both engines, so they damaged whichever emulation
was compiled in. That was easy to misread as "SIDLite sounds bad", because for months the only
SIDLite artifact anyone had was also the broken one. Rebuilt from fixed bindings, on the same tunes:

| artifact | peak | DC | 3‑SID |
| --- | --- | --- | --- |
| SIDLite, old bindings | 0.976–0.996 (clipping) | 0.12–0.15 | out‑of‑bounds in `selectSong` |
| SIDLite, current bindings | 0.17–0.41 | −0.005–0.10 | renders |
| reSIDfp, current bindings | 0.13–0.48 | 0.0005–0.004 | renders |

SIDLite is therefore the **default** engine, including for classification: it is roughly an order of
magnitude faster and the remaining difference is small enough that it mostly matters to audiophiles
and to comparison work. reSIDfp stays the cycle‑accurate reference, one flag away
(`--sid-engine residfp`, `SIDFLOW_SID_ENGINE=residfp`). Build either with
`SIDFLOW_SID_ENGINE=sidlite bun run build:wasm`; both artifacts ship, from identical bindings.

The lesson worth keeping is narrower than "SIDLite is bad": **an artifact that is not the engine it
claims to be is the bug**, whichever engine that is. The build now asserts the requested builder in
both directions, and `getSidEngineName()` reports it at runtime.

Both engines were then swept across the 998 HVSC tunes most likely to break a player — every 3‑SID
(25) and 2‑SID (313), every RSID+BASIC (587), every tune with ≥32 subsongs (76), plus 400 RSID and
400 with `playAddress=0`:

```
crashes: 0    render failures: 0
residfp: ok=998  silent=0  clipping=0  |dc|>0.12=0
sidlite: ok=998  silent=0  clipping=0  |dc|>0.12=34
```

The only asymmetry is DC, which is why `removeDcOffset()` now runs before every WAV is encoded —
without it the same tune would classify differently depending only on which engine rendered it.

### The three gates

- **Engine‑agnostic health, every CI run** — `packages/libsidplayfp-wasm/test/engine-health.test.ts`
  asserts, for **every** shipped engine, the properties the broken artifact violated: audible and
  unclipped, DC within bounds, multi‑SID renders, several tunes from one module instance, repeatable
  output. Because the defects lived in shared bindings, this is the gate that generalises; it was
  verified to produce 9 failures against the artifact that shipped for months. It skips an engine
  whose artifact is absent, so a checkout that only built the default does not report a false defect.
- **Fidelity, every CI run** — `packages/libsidplayfp-wasm/test/engine-parity.test.ts`, part of the normal
  unit suite. Renders committed SID fixtures (single‑, 2‑ and 3‑SID; the multi‑SID ones matter,
  because every buffer defect above lived in per‑chip buffer bookkeeping) and checks engine identity,
  signal sanity, run‑to‑run stability and a **golden comparison** of level, DC, peak, seven spectral
  bands and the loudness envelope. No hardware, no C64 ROMs, no native toolchain.
- **Formal, also every CI run** — `.github/workflows/engine-parity.yaml` runs
  `scripts/native-parity.mjs`, which builds **libsidplayfp + libresidfp natively at the same pinned
  refs** plus a renderer configured identically to `bindings.cpp`, renders the same fixtures through
  both engines, and requires them to agree. The native build is cached and keyed on the pins, so it
  is rebuilt only when a pin actually moves.

Run the formal analysis locally with:

```bash
cd packages/libsidplayfp-wasm
bun run scripts/native-parity.mjs                  # verify
bun run scripts/native-parity.mjs --update-goldens # verify, then re‑record goldens
```

### Rules that are easy to get wrong

- **Never compare against the distro `sidplayfp`.** Distros ship libsidplayfp **2.x**; the WASM build
  tracks 3.x. Comparing across that gap conflates "our build is wrong" with "upstream changed", and
  it cost real time before it was spotted. `scripts/build-native-reference.sh` reads the pins straight
  out of `docker/entrypoint.sh` so there is exactly one source of truth.
- **The two builds are NOT bit‑identical, and must not be asserted to be.** Emscripten's musl‑derived
  libm differs from glibc's in the last ulp, and that reaches reSIDfp's filter and resampler table
  generation. Measured: correlation > 0.99999, error floor **−75 to −87 dBFS**. For scale, defect 3
  measured correlation 0.75 and roughly −20 dBFS — about 60 dB worse. Thresholds sit at correlation
  ≥ 0.9999 and error ≤ −60 dBFS, which is ~15 dB of headroom over the noise and ~40 dB of margin to a
  real defect.
- **Do not assert chunk‑size invariance.** It is tempting — defect 3 violated it badly — but a
  *correct* native libsidplayfp also varies with chunk size on several fixtures, by a few LSBs. It is
  a useful diagnostic *signal*, not an invariant.
- **Do not assert byte‑equality between two renders of the same tune.** Successive renders in one
  module instance differ at the same ~−80 dBFS noise floor. Assert stability within tolerance instead.
- **Never hand‑edit `test/fixtures/engine-goldens.json`** to turn a red test green. Regenerate it only
  via `--update-goldens`, which refuses to write unless native parity passes first. The goldens record
  the upstream refs they were taken from, and the suite fails if those drift from `docker/entrypoint.sh`.

### When the gate fails

1. **Reproduce under AddressSanitizer.** This is how defect 3 was found, in a single run:
   ```bash
   cd packages/libsidplayfp-wasm
   SIDFLOW_EXTRA_FLAGS=-fsanitize=address bun run build:wasm
   ```
   The build's own smoke render will trip the sanitizer and name the offending access.
2. **Bisect the variable.** Useful controls, all of which held while defect 3 was live and therefore
   ruled out whole classes of cause: gcc‑native vs clang‑native, threaded vs inline filter‑table
   generation, and `SIDFLOW_RESIDFP_MATH_FLAGS="-fno-fast-math -ffp-contract=off"` (libresidfp's
   `configure` appends `-ffast-math` *after* any value you pass, so rewriting the generated Makefile
   is the only way to vary it).
3. **Check what was actually linked**: `strings dist/libsidplayfp.wasm | grep -E 'WasmReSIDfp|WasmSIDLite'`,
   or ask the module at runtime with `getSidEngineName()`. Each artifact must contain its own builder
   and not the other one — `dist/` is reSIDfp, `dist/sidlite/` is SIDLite.

### Hardware ground truth

The measurement that started all of this — the engine against a real C64 Ultimate, captured off its
multicast audio mirror — lives in the C64 Commander repo at
`docs/plans/sid-station/AUDIO-FIDELITY-TEST.md`. Consult it before changing engine defaults; it also
records the finding that **C64 ROMs are a prerequisite for correct playback, not an RSID‑only
unlock** (without them a tune initialises and then never advances).

## Tool‑specific guidance

These notes help different tools discover and obey the same instructions:

- **GitHub Copilot (including Workspace/Agents)**:
  - Always read `.github/copilot-instructions.md` (which points back to this file, `PLANS.md`, and the key docs) before large changes.
  - For multi‑step work, keep `PLANS.md` in sync with any internal Copilot plan or workspace state.
  - Prefer concrete edits plus validation over long speculative code dumps.
- **Cursor**:
  - Always obey `.cursorrules` in the repo root, which require reading this file and `PLANS.md` before editing.
  - Keep Cursor’s inline “Plan” or “Agent” view consistent with the ExecPlans you maintain in `PLANS.md`.
- **Codex / Codex CLI / other terminal agents**:
  - Treat `AGENTS.md` and `PLANS.md` as required reading before starting a task.
  - Use explicit plan/execute cycles and reflect each major step in `PLANS.md` as a checklist item with progress notes.

## When in doubt

When you are unsure how to proceed, prefer this sequence:

1. Read or re‑read relevant docs (`README.md`, `doc/developer.md`, `doc/technical-reference.md`, and any additional design docs present in the repo).
2. Update `PLANS.md` with your intended approach and any assumptions.
3. Implement the smallest coherent slice that moves the task forward.
4. Run targeted validation (build/tests/scripts) and record results in `PLANS.md`.
5. Summarize changes, decisions, and remaining work in `PLANS.md` and in your final user‑facing summary.

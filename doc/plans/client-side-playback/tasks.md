# SIDFlow Migration Tasks

## Most Important

* Required reading: `plan.md`
* Execute each phase **sequentially**. Do not move to the next phase until all checkboxes in the current one are completed and fully tested.  
* Each task must be ticked (`[x]`) when complete. Ensure full test coverage and browser validation before proceeding.

---

## Phase 1 – Backend Cleanup and API Update

* [x] Identify and isolate all code paths invoking `sidflow-play`, `ffplay`, or `aplay`.
* [x] Remove or disable subprocess spawning for playback in `/api/play`.
* [x] Verify that no CLI-based playback occurs anywhere in the codebase.
* [x] Add `PlaybackSessionResponse` schema to the OpenAPI spec under `components/schemas`.
* [x] Modify `/api/play` to return a session descriptor (session_id, sid_url, metadata, fallback_hls).
* [x] Update the OpenAPI `200` response reference to use the new schema.
* [x] Validate OpenAPI generation (lint + spec compliance).
* [x] Test with mock request to ensure correct JSON output and schema conformance.
* [x] Confirm that unrelated routes (`/api/rate`, `/api/classify`, `/api/fetch`, `/api/train`) remain functional.
* [x] Ensure build/test pipeline remains operational after removal of CLI dependencies.

---

## Phase 2 – Server Integration and Asset Handling

* [ ] Implement in-memory session registry for playback sessions.
* [ ] Expose static SID file route `/assets/sids/{path}.sid` with Range and immutable caching.
* [ ] Serve WASM and JS assets from `/assets/` with `Cache-Control: public, max-age=31536000, immutable`.
* [ ] Apply COOP/COEP headers on HTML and module/WASM responses.
* [ ] Add optional `/hls` static route for fallback playlists.
* [ ] Run integration test confirming asset serving and headers are correct.
* [ ] Verify caching and response headers through automated HTTP tests.

---

## Phase 3 – Client-Side Playback and Fallback

* [ ] Implement client modules: `sidflow-player.js`, `sid-engine.worker.js`, `sid-player.worklet.js`.
* [ ] Integrate `libsidplayfp-wasm` for SID decoding and playback.
* [ ] Connect WASM engine to AudioWorklet using SharedArrayBuffer.
* [ ] Add runtime feature detection for AudioWorklet and SAB, fallback to HLS if unavailable.
* [ ] Implement or configure ffmpeg-based HLS playlist generation.
* [ ] Serve `/hls/.../index.m3u8` and segment files with immutable caching.
* [ ] Update `/api/play` to include `fallback_hls` in session response when available.
* [ ] Verify end-to-end playback via WASM path on Chrome, Firefox, and Edge.
* [ ] Validate fallback HLS playback on Safari (iOS/macOS) and Android.
* [ ] Ensure zero server-side CPU usage during playback.

---

## Phase 4 – Testing, Validation, and Documentation

* [ ] Run automated tests for all updated endpoints and modules.
* [ ] Validate `/api/play` behavior matches OpenAPI schema exactly.
* [ ] Perform browser tests for both playback paths (WASM and HLS) with real SIDs.
* [ ] Check COOP/COEP and CORS headers on all responses.
* [ ] Confirm no regressions in `/api/rate`, `/api/classify`, `/api/fetch`, `/api/train`.
* [ ] Add telemetry for playback path (`wasm` vs `hls`) to confirm runtime behavior.
* [ ] Verify caching and static asset serving reliability.
* [ ] Confirm playback stability (no underruns, desync, or latency spikes).
* [ ] Update README and developer docs with revised architecture and usage.
* [ ] Sign off only once full browser, API, and integration test coverage is achieved.

---

## Execution Rules for the LLM

1. Process phases strictly in numerical order.
2. Complete and tick each checkbox only after full implementation and testing.
3. Perform unit, integration, and browser tests before advancing.
4. If a task cannot be completed, record the reason and halt execution.
5. After the final phase, output a summary confirming all checkboxes are ticked and all validations passed.

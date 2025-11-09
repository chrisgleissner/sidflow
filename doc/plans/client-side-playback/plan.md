# Migration Plan (Minimal-Invasive): Replace Server Playback via `sidflow-play` CLI with Client-Side WASM (AudioWorklet + SAB) and HLS Fallback

> Audience: LLM executor  
> Objective: Modify the existing SIDFlow Web API to remove dependency on server-side CLI playback (`sidflow-play`) and instead delegate playback to the client browser using libsidplayfp-wasm and AudioWorklet.  
> This is to support a large number of concurrent users of the website, delegating actual rendering and playback to client-side hardware.
> Keep all other API operations (`rate`, `classify`, `fetch`, `train`) unchanged.  
> Maintain minimal surface changes to ensure backward compatibility and reuse of existing API schema and responses.

---

## Constraints and Goals

- Retain the same REST API contract where possible.
- Remove all spawning of `sidflow-play` CLI or similar subprocesses.
- Introduce a client-side playback path that uses WASM and SharedArrayBuffer for rendering and playback.
- Provide an HLS AAC fallback for browsers without Worklet/SAB.
- Avoid unnecessary refactoring of unrelated server logic (rating, classification, sync, training).
- Preserve the existing OpenAPI specification structure, adding only minimal fields/endpoints required for the migration.

---

## Affected Area

Only `/api/play` changes in behavior:

- It must not spawn any local playback processes.
- It should instead:
  1. Return a playback session descriptor that clients use to initialize WASM playback.
  2. Optionally prepare an HLS playlist as a fallback.

All other routes (`/api/rate`, `/api/classify`, `/api/fetch`, `/api/train`) remain unchanged.

---

## Server-Side Modifications

### Remove

- Delete or disable any logic that executes `sidflow-play` as a CLI command or spawns external audio processes.
- Remove any PCM piping to host audio devices (e.g., ffplay, aplay).

### Add

- Implement an in-memory playback session registry to assign unique session IDs.
- Update `POST /api/play` to return:
  - A session ID.
  - The absolute or relative URL to the `.sid` file.
  - Optional metadata for the SID (title, author, subtunes).
  - An HLS fallback URL (if available).

### Serve SIDs Directly

- Expose static SID files or provide a secure download proxy endpoint at `/assets/sids/{hash}.sid`.
- Enable immutable caching and Range support.
- Apply these response headers on HTML and module/WASM responses:

  ```text
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  ```

- Serve WASM and JS player assets via the same origin with long-term immutable caching.

---

## API Contract Adjustments

### Modify `/api/play` Response

Current response returns CLI output; replace this with a session descriptor.

**Old:**

```json
{
  "success": true,
  "data": { "output": "Playlist generated successfully\nPlaying: Commando.sid\n" }
}
```

**New:**

```json
{
  "success": true,
  "data": {
    "session_id": "sidflow-173eae97",
    "sid_url": "https://localhost:3000/assets/sids/H/Hubbard_Rob/Commando.sid",
    "metadata": {
      "name": "Commando",
      "author": "Rob Hubbard",
      "subtunes": 3,
      "default_subtune": 1
    },
    "fallback_hls": "https://localhost:3000/hls/H/Hubbard_Rob/Commando/index.m3u8"
  }
}
```

### OpenAPI Amendments

Under `/api/play > responses > 200`, replace the success schema with:

```yaml
PlaybackSessionResponse:
  type: object
  required: [success, data]
  properties:
    success:
      type: boolean
      enum: [true]
    data:
      type: object
      required: [session_id, sid_url]
      properties:
        session_id:
          type: string
          description: Unique ID for this playback session
          example: sidflow-173eae97
        sid_url:
          type: string
          description: Direct URL to the SID file
          example: https://localhost:3000/assets/sids/H/Hubbard_Rob/Commando.sid
        metadata:
          type: object
          description: Extracted SID metadata (optional)
        fallback_hls:
          type: string
          description: URL to HLS fallback playlist
          example: https://localhost:3000/hls/H/Hubbard_Rob/Commando/index.m3u8
```

Then update the `200` response reference:

```yaml
'200':
  description: Playback session created successfully
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/PlaybackSessionResponse'
```

---

## Client-Side Integration

### Flow

1. `POST /api/play` → receive `sid_url`, `metadata`, and optional `fallback_hls`.
2. If browser supports AudioWorklet and SharedArrayBuffer:
   - Fetch the SID file from `sid_url`.
   - Load it into the libsidplayfp-wasm engine.
   - Stream decoded PCM into an AudioWorklet via SharedArrayBuffer.
3. If unsupported:
   - Use the provided `fallback_hls` URL and play via `<audio>` (Safari) or `hls.js`.

### Required Client Assets

- `libsidplayfp-wasm` module.
- `sid-player.worklet.js` (AudioWorkletProcessor).
- `sid-engine.worker.js` (WASM host).
- `sidflow-player.js` (controller/orchestration layer).

These are fetched from the same origin under `/assets/`.

---

## Fallback HLS Pipeline

### Optional Background Job

- For frequently used tracks, pre-render PCM to AAC/fMP4 segments via a headless worker.
- Use ffmpeg to produce `/hls/.../index.m3u8` playlists.
- Serve via CDN or local static hosting.

### On-Demand Mode

- For rare requests, dynamically generate the HLS playlist asynchronously.
- Return the fallback URL immediately in `/api/play` response; the stream can be prepared lazily.

---

## Testing and Validation

- Verify `/api/play` still conforms to the OpenAPI schema.
- Confirm no server-side audio subprocess runs.
- Test client playback on:
  - Chrome/Firefox/Edge (Worklet path)
  - Safari iOS/macOS (HLS fallback)
- Validate CORS and COOP/COEP headers are correctly applied.

---

## Migration Steps (Sequential)

1. Remove subprocess playback logic from `/api/play` handler.
2. Add schema `PlaybackSessionResponse` to OpenAPI under `components/schemas`.
3. Update `/api/play` response to return the session descriptor.
4. Serve SID assets and WASM files with COOP/COEP headers and immutable caching.
5. Add static `/assets/sids` and optional `/hls` routes.
6. Keep `/api/rate`, `/api/classify`, `/api/fetch`, `/api/train` fully unchanged.
7. Implement telemetry for chosen playback path (`wasm` or `hls`).
8. Test across browsers and verify caching, isolation, and correct responses.

---

## Acceptance Checklist

- [ ] `/api/play` no longer spawns CLI commands.
- [ ] Client plays SIDs via WASM path.
- [ ] HLS fallback functional in Safari/iOS.
- [ ] OpenAPI updated with `PlaybackSessionResponse`.
- [ ] Other APIs remain intact.
- [ ] All assets served with immutable caching and correct isolation headers.

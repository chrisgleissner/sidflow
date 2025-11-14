# SIDFlow Web UI

This guide documents the actual, implemented web experience in `packages/sidflow-web` including public vs admin personas, authentication, and how to get music playing on port 3000.

## Overview

SIDFlow’s web app has two personas:

- Public player (no login) at `/` with a minimal feature set
- Admin console (authenticated) at `/admin` with the full pipeline and operations

Both share the same C64‑inspired UI, themes, and tabbed layout.

## Screenshots

## Access and roles

- Public (default at `http://localhost:3000/`)
  - Tabs: Play, Prefs
  - Great for quick listening without exposing admin operations

- Admin (`http://localhost:3000/admin`)
  - Tabs: Wizard, Prefs, Fetch, Rate, Classify, Train, Play, Jobs
  - Used to fetch HVSC, set collection paths/ROMs, run jobs, and inspect history

### Authentication (admin)

Admin uses HTTP Basic auth and an HMAC‑signed session cookie.

- Default username: `admin` (configurable via `SIDFLOW_ADMIN_USER`)
- Password: `SIDFLOW_ADMIN_PASSWORD` (defaults to `password` if not set)
- Optional hardening:
  - `SIDFLOW_ADMIN_SECRET` (>=16 chars) for cookie signing; defaults to `sidflow-${SIDFLOW_ADMIN_PASSWORD}`
  - `SIDFLOW_ADMIN_SESSION_TTL_MS` (default 3600000 = 1h; minimum 5m)
- Session cookie: `sidflow_admin_session` on path `/admin`, auto‑renewed when <25% TTL remains

Security note: The default password `password` is for development convenience only. Always set a strong `SIDFLOW_ADMIN_PASSWORD` in production.

If `SIDFLOW_ADMIN_PASSWORD` isn’t set, the app falls back to the insecure default `password` and logs a warning. Configure a real password to disable the warning.

Rate limits: Admin API endpoints are stricter (20/min) than public (100/min).

## Screenshots and tabs

### 1. Wizard (admin)

The Wizard tab guides you through the complete SIDFlow setup process with a step-by-step workflow.

![Wizard Tab](web-screenshots/01-wizard.png)

**Features:**
- Progress indicator showing current step (1 of 5)
- Detailed explanation of each step
- "What Happens" information boxes
- Direct navigation to relevant tabs
- Overview of all steps at bottom

**Workflow Steps:**
1. **Fetch** - Download HVSC collection
2. **Rate** - Manually rate tracks
3. **Classify** - Analyze collection
4. **Train** - Train ML model
5. **Play** - Enjoy music

### 2. Preferences

Public and Admin see a Preferences tab tailored to their role.

![Prefs Tab](web-screenshots/02-prefs.png)

Public Prefs (local to the browser):
- Theme and font (applied instantly)
- Playback engine preference (auto‑fallback if unavailable):
  - In‑browser WASM (default)
  - sidplayfp CLI (local bridge)
  - Streaming WAV / Streaming M4A (server cache)
  - Ultimate 64 hardware (optional host/HTTPS/secret header)
- ROM bundle validation workflow (supply your own KERNAL/BASIC/CHARGEN; no redistribution)
- Offline cache settings (entry/byte limits, prefer offline)
- Local training controls (enable, iteration budget, sync cadence, allow upload; “Train Now” / “Sync Now”)

Admin Prefs (server‑side, affects backend):
- Active collection root (HVSC or a custom subset)
  - Browse HVSC folders server‑side and “Use This Folder”
  - Set/clear custom absolute path
- sidplayfp CLI flags: Balanced (default), Fast (`-rif --resid`), or Custom
- Server ROM paths: KERNAL/BASIC/CHARGEN file paths (with file picker)
- Theme and font for admin UI (saved locally in your browser)

### 3. Fetch (admin)

Download and synchronize the HVSC (High Voltage SID Collection).

![Fetch Tab](web-screenshots/03-fetch.png)

**Features:**
- One-click HVSC download/update
- Clear explanation of operation
- Time estimates provided
- Optional configuration paths

What happens:
- Downloads the latest HVSC archive
- Extracts SID files to the local workspace
- First run can take several minutes; subsequent updates are incremental

### 4. Rate (admin)

Submit manual ratings for SID tracks to train the recommendation system.

![Rate Tab](web-screenshots/04-rate.png)

**Features:**
- SID file path input
- Four rating dimensions with sliders:
  - **Energy** (1-5): Intensity level
  - **Mood** (1-5): Dark to Bright
  - **Complexity** (1-5): Simple to Complex
  - **Preference** (1-5): Personal taste
- Visual rating guide
- Real-time slider values
- Descriptive help text for each dimension

### 5. Play

Play music with optional mood presets and keyboard controls. Public users see this tab by default at `/`.

![Play Tab](web-screenshots/05-play.png)

Features:
- Mood presets: Quiet, Ambient, Energetic, Dark, Bright, Complex
- Keyboard shortcuts:
  - **SPACE** - Play/Pause
  - **S** - Stop
  - **N** - Next
  - **P** - Previous
  - **L** - Like
  - **D** - Dislike
- Position slider, like/dislike, ratings display
- Admin additionally sees a “Recently Played” panel on the page when tracks are played

How random play works under the hood:
- Calls `POST /api/play/random` with an optional `preset`
- Picks a SID using HVSC songlengths; falls back to filesystem scan of the active collection
- If no SIDs are found, the API returns 404 with `{ error: 'No SID files available', details: 'Unable to locate a SID to play.' }`

Why you might see an “empty playlist” at `/` and how to populate it:
- The public UI starts empty. It fills only after you play something.
- Ensure the collection contains SIDs:
  1) Visit `/admin` and sign in (see Authentication above)
  2) Open Fetch and download HVSC, or point Admin Prefs → “SID COLLECTION” to a folder that already contains `.sid` files
  3) Back on `/` (public), choose a mood preset and click Play
- If you still get a 404 (“No SID files available”), double‑check:
  - HVSC is present on disk and readable
  - Admin Prefs “Active collection” path points inside HVSC (or another folder with SIDs)
  - File extensions are `.sid`

## Design system

### Authentic C64 Colors

The interface uses the authentic Commodore 64 color palette:

- **Light Blue**: #6C5EB5 (C64's iconic light blue)
- **Dark Blue**: #352879 (C64's dark blue)
- **Light Green**: #50E89D (C64's light green for accents)
- **Black**: #000000 (dark mode background)

### Typography

- **Primary Font**: Courier New (monospace)
- **C64 Font**: Press Start 2P (optional, authentic C64 style)
- **Sans Serif**: Arial/Helvetica (optional)

### Visual Elements

- **Borders**: 3px solid with inner shadow (C64 style)
- **Text Shadow**: 2px PETSCII-inspired depth
- **Glow Effects**: Retro neon glow on interactive elements
- **Progress Bars**: C64-themed progress indicators

## Tab navigation

Tabs are ordered to follow the typical workflow:

1. **WIZARD** - Getting started guide
2. **PREFS** - Configure appearance
3. **FETCH** - Download music collection
4. **RATE** - Provide manual ratings
5. **CLASSIFY** - Auto-classify tracks
6. **TRAIN** - Train ML model
7. **PLAY** - Play music

## Keyboard shortcuts

The interface supports full keyboard navigation:

- **SPACE** - Play/Pause current track
- **S** - Stop playback
- **N** - Next track
- **P** - Previous track
- **L** - Like current track (rate 5/5)
- **D** - Dislike current track (rate 1/1)

## Storage & persistence

- User preferences stored in browser localStorage
- Settings persist across server restarts
- Per-browser and per-device configuration
- No server-side user accounts required
- Privacy-first: all data stays local

## Responsive design

- Adapts to desktop and mobile screens
- Tab grid: 4 columns on mobile, 7 columns on desktop
- Touch-friendly controls
- Scalable UI elements

## Browser compatibility

- Modern browsers with ES6+ support
- localStorage API required
- Tested on Chrome, Firefox, Safari, Edge
- Requires JavaScript enabled

## Accessibility

- Semantic HTML structure
- ARIA labels and roles
- Keyboard navigation support
- High contrast color schemes
- Focus indicators on interactive elements

## Technical stack

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS + shadcn/ui
- Bun (runtime and package manager)

## Future enhancements

- Additional color schemes (VIC-20, C128)
- Custom color picker
- Import/export preferences
- Cloud sync for preferences (optional)
- Additional keyboard shortcuts
- Gamepad support
- Accessibility improvements

## Getting started

1) Export admin credentials (required for `/admin`):
  - `SIDFLOW_ADMIN_PASSWORD=your-strong-password`
  - Optional: `SIDFLOW_ADMIN_USER=admin`, `SIDFLOW_ADMIN_SECRET=…`, `SIDFLOW_ADMIN_SESSION_TTL_MS=3600000`
2) Start the dev server: from repo root, `bun run dev` (or `cd packages/sidflow-web && bun run dev`)
3) Open `http://localhost:3000/admin`, sign in, and run the Wizard → Fetch HVSC
4) In Admin Prefs, confirm the “Active collection” path, ROM paths (if needed), and any CLI flag tweaks
5) Open `http://localhost:3000/` for the public player, pick a preset, and press Play
6) Optional: Rate → Classify → Train for smarter recommendations

## Support

For issues or questions:
- Check the [main README](../README.md)
- Read the [technical reference](technical-reference.md)
- Open an issue on GitHub

---

**Note:** All screenshots show the default C64 Light Blue theme. The interface appearance can be customized via the Preferences tab.

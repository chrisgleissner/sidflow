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
  - Browse HVSC folders server‑side and "Use This Folder"
  - Set/clear custom absolute path
- Render Engine (for server-side classification and admin render operations)
  - Default engine: libsidplayfp-wasm (portable, no dependencies)
  - Alternative engines: sidplayfp CLI, Ultimate 64 hardware
  - Preferred engine order: define fallback sequence when using auto mode
    - Add/remove engines from preferred order
    - Reorder with Up/Down buttons
    - WASM is always appended as final fallback
    - Empty list uses config defaults from `.sidflow.json`
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

Why you might see an "empty playlist" at `/` and how to populate it:
- The public UI starts empty. It fills only after you play something.
- Ensure the collection contains SIDs:
  1) Visit `/admin` and sign in (see Authentication above)
  2) Open Fetch and download HVSC, or point Admin Prefs → "SID COLLECTION" to a folder that already contains `.sid` files
  3) Back on `/` (public), choose a mood preset and click Play
- If you still get a 404 ("No SID files available"), double‑check:
  - HVSC is present on disk and readable
  - Admin Prefs "Active collection" path points inside HVSC (or another folder with SIDs)
  - File extensions are `.sid`

### Enhanced Play Tab Features

#### Search Bar

- Real-time search with 300ms debounce
- Case-insensitive title and artist matching
- Results dropdown with instant playback
- Clear button to reset search
- Keyboard shortcut: Press **S** to focus search bar

#### Favorites System

- Heart icon on track cards to add/remove favorites
- Dedicated Favorites tab showing all favorited tracks
- "Play All Favorites" and "Shuffle Favorites" buttons
- Syncs across browser sessions via localStorage
- Quick access to your most-loved tracks

#### Recently Played History

- Automatic tracking of last 100 tracks played
- Display of most recent 20 tracks in Play tab sidebar
- "Play Again" button per history entry
- "Clear History" to reset
- Circular buffer prevents unbounded growth

#### Top Charts

- Dedicated Top Charts tab showing most-played tracks
- Time range filters: This Week, This Month, All Time
- Displays rank, play count, and track metadata
- Quick play button per chart entry
- Data cached for 24 hours for performance

#### Keyboard Shortcuts

- **SPACE** - Play/Pause toggle
- **Arrow Right** - Next track
- **Arrow Left** - Previous track
- **Arrow Up** - Volume up (+10%)
- **Arrow Down** - Volume down (-10%)
- **M** - Mute toggle
- **F** - Focus favorites button
- **S** - Focus search bar
- **?** - Show keyboard shortcuts help
- Shortcuts disabled when typing in input fields

#### Theme System

- Three themes: C64 Light, C64 Dark, Classic
- Instant theme switching from Prefs tab
- Theme persists in localStorage
- Dark mode optimized for extended listening sessions

#### ML-Powered Station from Song

- "Start Station" button on currently playing track
- Creates personalized radio station based on:
  - Vector similarity search via LanceDB
  - Your historical likes/dislikes
  - 20 similar tracks weighted by preferences
- Adjustable parameters:
  - Personalization (0-100%): Boost liked tracks, penalize disliked
  - Discovery (0-100%): More similar vs more exploration
- Station name displays as "Station: [song title]"

#### Enhanced Rating Display

- Personal rating badge: "You rated: ★★★★☆"
- Community rating with stars: "★★★★☆ 4.2/5 (1.2K ratings)"
- Hover tooltip showing E/M/C dimension breakdown
- "Trending" badge for recently popular tracks
- Likes, plays, and recent play counts visible

#### Song Browser

- Navigate HVSC folder structure
- Breadcrumb navigation (e.g., Collection → MUSICIANS → Hubbard_Rob)
- Play individual songs or entire folders
- Folder actions:
  - "Play All in Folder" - Queue all songs (non-recursive)
  - "Play Folder Tree" - Queue folder + subfolders
  - "Shuffle Folder Tree" - Randomize folder tree playback
- File metadata display (title, author, subsongs)

#### Volume Control

- Volume slider with icon (speaker/mute)
- Range: 0-100% with 1% precision
- Visual feedback for volume level
- Mute toggle preserves volume level
- Syncs across player instances

#### Playback Modes

- Mood Station (default): ML-recommended tracks
- Folder Playback: Songs from browsed folder
- Station from Song: Personalized radio
- Current mode displayed in UI (e.g., "Energetic Station" or "MUSICIANS/Hubbard_Rob")

### 6. Social Features

SIDFlow includes social features to connect with other users and see community activity.

#### User Authentication

![Login Dialog](web-screenshots/06-social-login.png)

**Registration:**
- Username (3-20 alphanumeric characters)
- Password (minimum 8 characters)
- Automatic login after successful registration
- Client-side validation before submission

**Login:**
- Username and password authentication
- JWT token authentication (7-day expiration)
- Secure HTTP-only cookies
- Password hashed with bcrypt (10 salt rounds)

**User Menu:**
- Displays logged-in username
- Logout button
- Always visible when authenticated

#### Activity Stream

![Activity Tab](web-screenshots/07-activity.png)

The Activity tab shows real-time community activity:

**Features:**
- Live feed of user actions (likes, plays, ratings, playlist creation)
- Pagination support (default: 20 events, max: 100)
- Refresh button for latest activity
- Event types:
  - ❤️ **Like** - User liked a track
  - ▶️ **Play** - Track playback started
  - ⭐ **Rating** - Track rated with dimensions
  - 📁 **Playlist** - Playlist created or modified
- Time-ordered display (newest first)
- User attribution for each event
- Track metadata (title, artist) displayed

**Event Details:**
- Username who performed the action
- Action type with icon
- Track or playlist name
- Timestamp (relative time format)
- Additional metadata (e.g., rating values, dimensions)

#### User Profiles

![Profiles Tab](web-screenshots/08-profiles.png)

Browse and search user profiles:

**Profile Information:**
- Username and join date
- Total tracks rated
- Total likes given
- Total plays counted
- Favorite tracks list
- Activity statistics

**Search Features:**
- Username search with case-insensitive matching
- Instant results display
- Profile cards with key stats
- "View Profile" button for detailed view

**Profile Stats:**
- Total ratings submitted
- Average rating given
- Most-liked genres (when available)
- Recently played tracks
- Top-rated tracks by user

#### Charts & Leaderboards

![Charts Tab](web-screenshots/09-charts.png)

Discover trending tracks and top performers:

**Time Range Filters:**
- This Week - Last 7 days of activity
- This Month - Last 30 days
- All Time - Complete history

**Chart Data:**
- Rank (1-20, customizable up to 100)
- Track name and artist
- Play count
- Like count
- Average rating with star display
- "Trending" badge for rapidly rising tracks

**Sorting:**
- Primary sort: Play count descending
- Secondary sort: Like count (tiebreaker)
- Tertiary sort: Average rating

**Chart Entry Actions:**
- Quick play button
- View track details
- Add to playlist (when logged in)
- Share track link

### 7. Playlists

Create, manage, and share custom playlists.

#### Playlist Management

**Create Playlist:**
- Name (required, max 100 characters)
- Description (optional)
- Add tracks via drag-and-drop or "Add to Playlist" button
- Maximum 1000 tracks per playlist

**Edit Playlist:**
- Rename playlist
- Update description
- Reorder tracks with drag-and-drop
- Remove tracks
- Add more tracks

**Playlist Actions:**
- **Play All** - Queue all tracks in order
- **Shuffle** - Randomize playback order
- **Export M3U** - Download standard M3U playlist file
- **Share** - Generate shareable URL
- **Delete** - Remove playlist (confirmation required)

#### Playlist Features

**Track Management:**
- Display track number, title, artist
- Subtune selector for multi-subtune SID files
- Duration display (when available)
- Drag handles for reordering

**M3U Export:**
- Standard M3U format
- Absolute paths for local playback
- Compatible with VLC, foobar2000, other players
- Preserves subtune selections (#SUBSONG directive)

**Playlist Sharing:**
- Generate unique URL for playlist
- Public access (no login required to view)
- Read-only for non-owners
- Owner can edit via shared link
- Share via copy-paste or QR code (future)

**Storage:**
- Stored server-side in `data/playlists/`
- JSON format for easy backup/restore
- Auto-save on every change
- Versioned for conflict resolution

### 8. Advanced Search

![Advanced Search](web-screenshots/10-search.png)

Powerful search with multiple filters and options.

#### Search Bar

**Text Search:**
- Real-time search with 300ms debounce
- Case-insensitive matching
- Searches: Title, Artist, Author fields
- Minimum 2 characters required
- Maximum 50 results returned (adjustable)

**Search Modifiers:**
- Quoted phrases: `"test drive"` for exact match
- Wildcards: `hub*` matches "Hubbard", "Hub", etc.
- Field-specific: `artist:Hubbard` or `title:Commando`

#### Filter Panel

**Year Filters:**
- Minimum year (1980-2024)
- Maximum year (1980-2024)
- Range slider for easy selection
- Shows number of matching tracks

**Chip Model Filters:**
- MOS 6581 (R3/R4) - Original C64 SID chip
- MOS 8580 - C64C/C128 SID chip
- Any - Include all chip types
- Multiple selection supported

**Duration Filters:**
- Minimum duration (seconds)
- Maximum duration (seconds)
- Range slider (0-600 seconds typical)
- Filter out too-short intros or too-long tracks

**Rating Filters:**
- Minimum rating (1-5 stars)
- Filter by community rating
- Personal rating filter (when logged in)
- Unrated tracks option

#### Search Results

**Result Display:**
- Track title and artist
- Year and chip model badges
- Duration display
- Star rating with count
- Play button for instant playback
- Add to playlist button

**Result Actions:**
- **Play** - Start playback immediately
- **Add to Favorites** - Heart icon toggle
- **Add to Playlist** - Select from playlists
- **View Details** - Full track metadata
- **Start Station** - Create radio station from track

**Result Sorting:**
- Relevance (default) - Best match first
- Rating - Highest rated first
- Year - Newest or oldest first
- Duration - Shortest or longest first
- Title - Alphabetical A-Z or Z-A

#### Special Features

**Surprise Me:**
- Random track button
- Respects active filters
- Discovers hidden gems
- Different result each time
- Weighted by rating (optional)

**Search History:**
- Last 10 searches saved
- Quick re-run of previous searches
- Clear history option
- Stored in localStorage

**Saved Searches:**
- Name and save filter combinations
- Quick access to common queries
- Edit/delete saved searches
- Share saved search URL

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

## Troubleshooting

### Render engine issues

**Problem: Classification stalls with threads stuck in BUILDING phase**
- Check server logs for `[engine-stall]` or `[engine-chosen]` messages
- WASM worker may exit with code 0 but produce no audio
- Try switching to sidplayfp-cli engine in Admin Prefs → Render Engine
- Check `--prefer` flag order if using auto mode with multiple engines

**Problem: "No audio" errors during classification**
- WASM engine may have compatibility issues with certain SID files
- Look for `[engine-stall]` messages indicating consecutive failures
- Set preferred engine order to try sidplayfp-cli before WASM fallback
- Ensure sidplayfp CLI is installed and accessible: `which sidplayfp`

**Problem: Engine availability check fails**
- sidplayfp-cli: verify `sidplayfp` is in PATH or set `sidplayPath` in `.sidflow.json`
- Ultimate 64: check network connectivity, host/port, and password in render config
- WASM: should always be available; check browser console for worker errors

**Problem: Preferred engines not respected**
- Admin Prefs override config-level `render.preferredEngines` in `.sidflow.json`
- Empty preferred list in Admin Prefs falls back to config defaults
- Check server logs for `[engine-order]` messages showing resolved order
- Forced engine (`renderEngine` preference) takes priority over preferred list

### Server logs for debugging
Monitor console output for structured engine tags:
- `[engine-order]` — resolved engine priority order
- `[engine-availability]` — per-engine availability check results
- `[engine-chosen]` — which engine was selected for each render attempt
- `[engine-stall]` — thread inactivity or no-audio streak detection
- `[engine-escalate]` — automatic fallback triggered after repeated failures

## Future enhancements

- Additional color schemes (VIC-20, C128)
- Custom color picker
- Import/export preferences
- Cloud sync for preferences (optional)
- Additional keyboard shortcuts
- Gamepad support
- Accessibility improvements
- Real-time engine health monitoring in admin UI

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

# SIDFlow User Guide

A beginner-friendly guide to using SIDFlow's web interface for exploring, playing, and discovering C64 music.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Finding Music](#finding-music)
3. [Playing Music](#playing-music)
4. [Managing Favorites](#managing-favorites)
5. [Exploring Top Charts](#exploring-top-charts)
6. [Browsing Your Collection](#browsing-your-collection)
7. [Creating and Managing Playlists](#creating-and-managing-playlists)
8. [ML-Powered Stations](#ml-powered-stations)
9. [Social Features](#social-features)
10. [Advanced Search](#advanced-search)
11. [Personalizing Your Experience](#personalizing-your-experience)
12. [Understanding Ratings](#understanding-ratings)
13. [Keyboard Shortcuts](#keyboard-shortcuts)
14. [Tips and Tricks](#tips-and-tricks)

## Getting Started

### What is SIDFlow?

SIDFlow is a music player for C64 SID files that combines machine learning with a modern web interface. It helps you discover great C64 music based on your preferences and listening history.

### First Steps

1. **Open the Player**
   - Navigate to `http://localhost:3000` (or your hosted URL)
   - You'll see the main Play tab with mood presets

2. **Choose a Mood**
   - Click one of the mood buttons: Quiet, Ambient, Energetic, Dark, Bright, or Complex
   - SIDFlow's ML model will start playing tracks that match that mood

3. **Start Listening**
   - Press the Play button (or hit **SPACE**)
   - Watch the player load and start playing your first track!

## Finding Music

### Search Bar

The fastest way to find a specific track:

1. **Focus the search bar**
   - Click the search input at the top of the Play tab
   - Or press **S** from anywhere (shortcut)

2. **Type to search**
   - Enter artist name (e.g., "Hubbard")
   - Or song title (e.g., "Monty")
   - Results appear instantly as you type

3. **Play from results**
   - Click any result to play it immediately
   - Results show title, artist, and play count

4. **Clear search**
   - Click the X button or clear the input manually
   - Search history is preserved for your session

### Top Charts

See what everyone is listening to:

1. **Open Top Charts tab**
   - Click "Top Charts" in the main navigation
   - See the most-played tracks ranked by popularity

2. **Filter by time range**
   - Click "This Week" for recent hits
   - Click "This Month" for monthly favorites
   - Click "All Time" for classic favorites

3. **Play from charts**
   - Click the play button next to any track
   - Rank and play count help you discover popular music

## Playing Music

### Playback Controls

- **Play/Pause**: Click the play button or press **SPACE**
- **Next Track**: Click next button or press **Arrow Right**
- **Previous Track**: Click previous button or press **Arrow Left**
- **Position Slider**: Drag to jump to a specific time in the track

### Volume Control

- **Volume Slider**: Click and drag the volume slider
- **Volume Up**: Press **Arrow Up** (increases by 10%)
- **Volume Down**: Press **Arrow Down** (decreases by 10%)
- **Mute**: Click the speaker icon or press **M**
- Volume level is shown as a percentage (0-100%)

### Playback Modes

SIDFlow offers several ways to play music:

1. **Mood Station** (default)
   - ML-recommended tracks based on selected mood
   - Continuously adapts to your likes/dislikes

2. **Folder Playback**
   - Plays songs from a browsed folder
   - See [Browsing Your Collection](#browsing-your-collection)

3. **Station from Song**
   - Personalized radio based on a song you love
   - See [Personalizing Your Experience](#personalizing-your-experience)

### Rating Tracks

Help improve recommendations by rating tracks:

- **Like**: Click the thumbs-up button (or press **L**)
- **Dislike**: Click the thumbs-down button (or press **D**)
- Your ratings train the ML model to better match your taste
- Ratings are saved and used for future recommendations

## Managing Favorites

### Adding Favorites

1. **From currently playing track**
   - Click the heart icon on the track card
   - Heart fills to show it's favorited

2. **From search results**
   - Click the heart on any search result card
   - Quick way to favorite while browsing

3. **From browser**
   - Heart icons appear on tracks in the folder browser
   - Favorite entire folders worth of tracks

### Viewing Favorites

1. **Open Favorites tab**
   - Click "Favorites" in the main navigation
   - See all your favorited tracks in one place

2. **Track metadata shown**
   - Title, artist, and play count for each favorite
   - Sorted by when you added them (newest first)

3. **Play favorites**
   - Click play button on individual tracks
   - Or use "Play All Favorites" to queue all
   - Or use "Shuffle Favorites" for random order

### Removing Favorites

- Click the filled heart icon again to unfavorite
- Removes from Favorites tab immediately
- Can be re-added anytime

## Exploring Top Charts

### Understanding Chart Data

- **Rank**: Position in the chart (1 = most played)
- **Play Count**: Total times the track has been played
- **Time Ranges**:
  - This Week: Last 7 days
  - This Month: Last 30 days
  - All Time: Since tracking began

### Using Charts for Discovery

1. **Find popular artists**
   - Look for artists with multiple chart entries
   - Indicates consistent quality

2. **Discover underrated tracks**
   - Check lower ranks for hidden gems
   - Community favorites that aren't mainstream

3. **Track trends**
   - Switch between time ranges
   - See which tracks are rising in popularity

## Browsing Your Collection

### Song Browser Basics

1. **Open the browser**
   - Expand the folder browser panel in the Play tab
   - Shows your HVSC collection structure

2. **Navigate folders**
   - Click any folder to view its contents
   - Breadcrumb navigation shows your path
   - Example: Collection → MUSICIANS → Hubbard_Rob

3. **View files**
   - See all `.sid` files in the current folder
   - Metadata shown: title, author, number of subsongs

### Playing from Browser

#### Individual Songs

- Click the play button on any song
- Starts playing immediately
- Switches playback mode to "Folder Playback"

#### Folder Actions

1. **Play All in Folder**
   - Plays all songs in current folder (non-recursive)
   - Songs play in alphabetical order
   - Excludes subfolders

2. **Play Folder Tree**
   - Plays current folder + all subfolders
   - Great for playing an entire composer's catalog
   - Maintains folder hierarchy order

3. **Shuffle Folder Tree**
   - Randomizes playback across folder tree
   - Discovers tracks you might have missed
   - Fun way to explore large collections

### Breadcrumb Navigation

- Shows your current path (e.g., Collection → MUSICIANS → Hubbard_Rob)
- Click any breadcrumb to jump to that level
- Quick way to move up the folder tree

## Creating and Managing Playlists

Create custom playlists to organize your favorite tracks and share them with others.

### Creating a Playlist

1. **Open playlist dialog**
   - Click "New Playlist" button in the Play tab
   - Or use the Playlists menu

2. **Name your playlist**
   - Enter a descriptive name (max 100 characters)
   - Examples: "Energetic Favorites", "Hubbard Classics", "Game Music"

3. **Add description** (optional)
   - Describe the theme or mood
   - Helps you remember the playlist's purpose

4. **Add tracks**
   - Use "Add to Playlist" button on any playing track
   - Drag and drop from search results
   - Browse folders and add multiple tracks

### Managing Playlists

#### Viewing Playlists

- All your playlists appear in the Playlists menu
- Click any playlist to view its contents
- See track count, total duration, and creation date

#### Editing Playlists

1. **Rename playlist**
   - Click the edit icon next to playlist name
   - Update name or description
   - Changes save automatically

2. **Reorder tracks**
   - Drag and drop tracks to new positions
   - Use up/down arrows for precise control
   - Order is preserved for playback

3. **Remove tracks**
   - Click the X button next to any track
   - Confirms before removing
   - Can always re-add later

4. **Add more tracks**
   - Use "Add to Playlist" from anywhere
   - Select which playlist to add to
   - No limit on playlist size (up to 1000 tracks)

#### Playlist Actions

- **Play All** - Queue all tracks in order
- **Shuffle** - Randomize playback order
- **Export M3U** - Download standard playlist file
- **Share** - Get shareable URL for others
- **Delete** - Remove playlist (confirmation required)

### Exporting Playlists

#### M3U Format

1. **Download M3U file**
   - Click "Export M3U" button
   - Saves as standard .m3u playlist file
   - Compatible with most music players

2. **Use in other players**
   - VLC, foobar2000, Winamp, iTunes
   - Absolute paths for local playback
   - Preserves subtune selections

3. **Backup and restore**
   - Save playlists as files
   - Import in other SIDFlow instances
   - Share via email or cloud storage

### Sharing Playlists

#### Generate Share Link

1. **Create shareable URL**
   - Click "Share" button in playlist
   - Copy the generated URL
   - Share via email, chat, or social media

2. **Public access**
   - Anyone with the link can view the playlist
   - No login required to see tracks
   - Read-only for non-owners

3. **Edit shared playlists**
   - Original owner can edit via the shared link
   - Changes reflect immediately for all viewers
   - Delete removes the shared link

#### Share via QR Code (future)

- Generate QR code for mobile sharing
- Scan with phone to open playlist
- Great for sharing in person

## ML-Powered Stations

SIDFlow uses machine learning to create personalized radio stations based on songs you love.

### Creating a Station

#### From Currently Playing Track

1. **Find a track you love**
   - Play any track that matches your mood
   - Let it play for a few seconds

2. **Start the station**
   - Click "Start Station" button
   - Appears on the now-playing card

3. **Station generation**
   - ML analyzes the track's audio features
   - Searches for 20 similar tracks via LanceDB
   - Weights results by your listening history

#### Station Parameters

**Personalization Slider** (0-100%)

- **High (75-100%)**: Strong preference weighting
  - Boosts tracks you've liked before
  - Penalizes tracks you've disliked
  - Great for familiar, comfortable listening

- **Medium (25-75%)**: Balanced approach
  - Moderate preference influence
  - Good mix of known and new

- **Low (0-25%)**: Pure similarity
  - Ignores your listening history
  - Discovers new artists and styles
  - Explores beyond your usual preferences

**Discovery Slider** (0-100%)

- **High (75-100%)**: Exploration mode
  - Looser similarity matching
  - More musical diversity
  - Discovers unexpected gems

- **Medium (25-75%)**: Balanced discovery
  - Moderate similarity threshold
  - Mix of close and distant matches

- **Low (0-25%)**: Tight similarity
  - Very close matches only
  - Tracks sound similar to seed song
  - Consistent listening experience

### Using Stations

#### Playback Behavior

- Station name displays as "Station: [song title]"
- Plays through 20 tracks automatically
- Can skip forward/backward through station
- Like/dislike still affects future stations

#### Creating Multiple Stations

- Start new stations from any playing track
- Each station has unique track selection
- Experiment with different seed songs
- Discover different facets of the collection

#### Station Tips

1. **Seed song selection matters**
   - Choose a track that captures the mood you want
   - High-quality tracks often produce better stations

2. **Adjust parameters for mood**
   - Relaxing: Low discovery, high personalization
   - Adventurous: High discovery, low personalization
   - Familiar: High personalization, low discovery

3. **Like/dislike to refine**
   - Rate station tracks to improve future recommendations
   - ML learns from every interaction
   - Stations get better over time

### How It Works (Technical)

#### Vector Similarity Search

- Each track represented as feature vector
- Extracted from audio analysis (tempo, energy, timbre)
- LanceDB indexes for fast similarity queries
- Euclidean distance measures closeness

#### Personalization Scoring

- Positive feedback (likes): +0.2 boost per like
- Negative feedback (dislikes): -0.3 penalty per dislike
- Skip penalty: -0.05 per skip
- Combined with base similarity score

#### Discovery Factor

- Adjusts minimum similarity threshold
- High discovery: Accept scores as low as 0.4
- Low discovery: Require scores above 0.7
- Adds randomness to prevent repetition

## Social Features

Connect with other SIDFlow users and see what the community is listening to.

### Creating an Account

#### Registration

1. **Click "Sign Up" button**
   - Located in top-right corner
   - Opens registration dialog

2. **Choose username**
   - 3-20 alphanumeric characters
   - Case-insensitive (stored as lowercase)
   - Must be unique across all users

3. **Set password**
   - Minimum 8 characters
   - Mix of letters, numbers, symbols recommended
   - Securely hashed with bcrypt

4. **Automatic login**
   - Successfully registered users are logged in automatically
   - Session lasts 7 days
   - Secure JWT authentication

### Logging In

- Enter username and password
- Click "Log In" button
- Session saved in secure HTTP-only cookie
- Stay logged in across browser sessions

### Viewing Community Activity

#### Activity Stream

1. **Open Activity tab**
   - Click "Activity" in main navigation
   - See real-time feed of user actions

2. **Event types shown**
   - ❤️ **Like** - User liked a track
   - ▶️ **Play** - Track playback started
   - ⭐ **Rating** - Track rated with dimensions
   - 📁 **Playlist** - Playlist created or modified

3. **Event information**
   - Username who performed action
   - Track or playlist name
   - Timestamp (relative, e.g., "2 hours ago")
   - Additional details (rating values, etc.)

4. **Refresh feed**
   - Click "Refresh" button for latest activity
   - Pagination: Default 20 events, max 100
   - Automatically updates on navigation

### Exploring User Profiles

#### Finding Users

1. **Open Profiles tab**
   - Click "Profiles" in main navigation
   - See search bar and user list

2. **Search for users**
   - Type username in search box
   - Case-insensitive matching
   - Instant results as you type

3. **Browse popular users**
   - Sorted by activity level
   - See top contributors
   - Discover active community members

#### Viewing Profiles

**Profile Information Displayed:**

- Username and join date
- Total tracks rated
- Total likes given
- Total plays counted
- Favorite tracks (when public)
- Activity statistics

**Profile Stats:**

- Total ratings submitted
- Average rating given
- Most-liked genres (when available)
- Recently played tracks
- Top-rated tracks by that user

#### Following Users (future)

- Follow users to see their activity
- Get notified of their ratings and playlists
- Discover music through trusted sources

### Viewing Charts and Leaderboards

#### Top Charts

1. **Open Charts tab**
   - Click "Charts" in main navigation
   - See top-played tracks

2. **Filter by time range**
   - **This Week** - Last 7 days
   - **This Month** - Last 30 days
   - **All Time** - Complete history

3. **Chart data shown**
   - Rank (1-100, customizable)
   - Track name and artist
   - Play count
   - Like count
   - Average rating with stars
   - "Trending" badge for rising tracks

#### Playing from Charts

- Click play button next to any chart entry
- Instantly starts playing that track
- Adds to playback history
- Counts toward your play statistics

#### Leaderboards (future)

- Top raters by activity
- Most-followed users
- Best playlist creators
- Community contributors

### Privacy and Security

#### What's Public

- Username
- Tracks you've rated (unless private)
- Public playlists
- Like/play counts (aggregate)

#### What's Private

- Password (hashed, never stored plain)
- Email address (if provided)
- Private playlists
- Personal listening history

#### Security Features

- Passwords hashed with bcrypt (10 salt rounds)
- JWT tokens with 7-day expiration
- Secure HTTP-only cookies
- Rate limiting on login attempts
- CSRF protection on forms

## Advanced Search

Find exactly what you're looking for with powerful search filters.

### Basic Text Search

1. **Open search bar**
   - Located at top of Play tab
   - Press **S** keyboard shortcut to focus

2. **Enter search query**
   - Type artist name, track title, or author
   - Minimum 2 characters required
   - Results update as you type (300ms debounce)

3. **View results**
   - Up to 50 matches shown
   - Displays title, artist, year, rating
   - Play button for instant playback

### Using Filters

#### Open Filter Panel

- Click "Filters" button next to search bar
- Expands to show all filter options
- Filters combine with text search

#### Year Filters

1. **Set year range**
   - Adjust minimum year slider (1980-2024)
   - Adjust maximum year slider (1980-2024)
   - Shows matching track count

2. **Common presets**
   - 1980s classics: 1980-1989
   - 1990s era: 1990-1999
   - Modern remakes: 2000-2024

#### Chip Model Filters

**Available Options:**

- **MOS 6581** - Original C64 SID chip (R3/R4)
- **MOS 8580** - C64C/C128 SID chip
- **Any** - Include all chip types

**Usage:**

- Select one or multiple chips
- Helps find authentic vs enhanced sounds
- Useful for hardware-specific playlists

#### Duration Filters

1. **Set duration range**
   - Minimum duration in seconds (0-600)
   - Maximum duration in seconds (0-600)
   - Drag sliders or type exact values

2. **Common uses**
   - Filter out short intros: Min 60 seconds
   - Exclude long tracks: Max 180 seconds
   - Find specific lengths for playlists

#### Rating Filters

1. **Minimum community rating**
   - Filter by star rating (1-5)
   - Shows only tracks above threshold
   - Discover highly-rated gems

2. **Personal rating filter** (when logged in)
   - Show only tracks you've rated
   - Filter by your own ratings
   - Revisit favorites quickly

3. **Include unrated option**
   - Show tracks without ratings
   - Discover overlooked music
   - Help fill gaps in ratings

### Search Modifiers

#### Quoted Phrases

- Use quotes for exact match: `"test drive"`
- Searches for exact phrase, not individual words
- Case-insensitive matching

#### Wildcards

- Asterisk matches any characters: `hub*`
- Finds "Hubbard", "Hub", "Hubbell", etc.
- Useful for partial names

#### Field-Specific Search

- **By artist**: `artist:Hubbard`
- **By title**: `title:Commando`
- **By year**: `year:1985`
- Combine with other terms

### Sorting Results

**Sort Options:**

- **Relevance** (default) - Best match first
- **Rating** - Highest rated first
- **Year** - Newest or oldest first
- **Duration** - Shortest or longest first
- **Title** - Alphabetical A-Z or Z-A

**Changing Sort:**

1. Click sort dropdown
2. Select desired sort method
3. Results update immediately

### Special Features

#### Surprise Me Button

- Random track respecting filters
- Discovers hidden gems
- Different result each click
- Optional: Weight by rating for quality

#### Search History

- Last 10 searches automatically saved
- Quick re-run of previous searches
- Stored in browser localStorage
- "Clear History" button available

#### Saved Searches

1. **Save a search**
   - Configure filters and text
   - Click "Save Search" button
   - Name the search (e.g., "Energetic 80s")

2. **Access saved searches**
   - Dropdown shows all saved searches
   - One-click to run saved search
   - Edit or delete saved searches

3. **Share saved searches**
   - Generate URL with search parameters
   - Share with other users
   - Bookmark for quick access

### Search Tips

1. **Start broad, then filter**
   - Begin with text search
   - Add filters to narrow results
   - Remove filters if too few results

2. **Combine multiple filters**
   - Year + chip model + rating
   - Creates very specific queries
   - Finds exactly what you want

3. **Use wildcards for discovery**
   - `*commando*` finds variations
   - Discovers related tracks
   - Explores themes and remixes

4. **Save common searches**
   - Frequently used filters
   - Genre-specific queries
   - Quick access to favorites

## Personalizing Your Experience

### Station from Song

Create a personalized radio station based on a song you love:

1. **Start a station**
   - While a song is playing, click "Start Station"
   - ML creates a station of 20 similar tracks

2. **Adjust parameters**
   - **Personalization** (0-100%):
     - Higher: Boosts tracks you've liked before
     - Lower: Ignores your preferences
   - **Discovery** (0-100%):
     - Higher: More exploration, less similarity
     - Lower: Closer matches to the seed song

3. **Station playback**
   - Station name shows as "Station: [song title]"
   - Plays through similar tracks automatically
   - Can start new stations anytime

### Recently Played History

Track what you've been listening to:

1. **View history**
   - Sidebar in Play tab shows last 20 tracks
   - Includes title, artist, and when played

2. **Play again**
   - Click "Play Again" on any history entry
   - Quick way to revisit favorites

3. **Clear history**
   - Click "Clear History" to reset
   - Useful for fresh start or privacy

### Theme Switching

Customize the look of SIDFlow:

1. **Open Prefs tab**
   - Click "Prefs" in main navigation

2. **Choose a theme**
   - **C64 Light**: Bright, retro palette
   - **C64 Dark**: Dark mode with C64 colors
   - **Classic**: Traditional C64 aesthetic

3. **Instant feedback**
   - Theme changes immediately
   - Persists across browser sessions
   - Dark mode reduces eye strain

## Understanding Ratings

### Personal Ratings

- **Your Rating**: Shows how many stars you gave (if rated)
- Display format: "You rated: ★★★★☆"
- Helps you remember which tracks you loved
- Used by ML to improve recommendations

### Community Ratings

- **Average Rating**: Combined ratings from all users
- Display format: "★★★★☆ 4.2/5 (1.2K ratings)"
- Shows number of total ratings in parentheses
- Helps discover universally loved tracks

### E/M/C Dimensions

Hover over ratings to see detailed breakdown:

- **E (Energy)**: How energetic the track is (0-5)
- **M (Melody)**: Melodic complexity (0-5)
- **C (Complexity)**: Overall musical complexity (0-5)

These dimensions are extracted from audio features and help the ML model understand track characteristics.

### Trending Badge

- Appears on recently popular tracks
- Indicates rising popularity
- Helps discover tracks gaining traction

## Keyboard Shortcuts

### Playback

- **SPACE** - Play/Pause toggle
- **Arrow Right** - Next track
- **Arrow Left** - Previous track
- **L** - Like current track
- **D** - Dislike current track

### Volume

- **Arrow Up** - Volume up (+10%)
- **Arrow Down** - Volume down (-10%)
- **M** - Mute toggle

### Navigation

- **S** - Focus search bar
- **F** - Focus favorites button
- **?** - Show keyboard shortcuts help

### Smart Context

- Shortcuts automatically disabled when typing in input fields
- No accidental playback changes while searching
- Press **Escape** to exit input fields and re-enable shortcuts

## Tips and Tricks

### Discovering New Music

1. **Use mood presets strategically**
   - Try "Complex" for technically impressive tracks
   - Try "Energetic" for upbeat game music
   - Try "Dark" for atmospheric soundscapes

2. **Combine search with stations**
   - Search for an artist you like
   - Start a station from one of their tracks
   - Discover similar artists

3. **Explore folder trees**
   - Browse by composer in MUSICIANS folder
   - Try "Shuffle Folder Tree" for serendipity
   - Discover lesser-known works by famous composers

### Building Your Collection

1. **Favorite liberally**
   - Heart tracks you enjoy
   - Build a curated playlist over time
   - Use "Shuffle Favorites" for variety

2. **Rate strategically**
   - Like/dislike helps ML learn your taste
   - Don't overthink it - quick gut reactions work best
   - More ratings = better recommendations

3. **Check history**
   - Recently Played reminds you of discoveries
   - "Play Again" brings back memories
   - Clear history to start fresh

### Performance Tips

1. **First load may be slow**
   - WASM module initialization takes ~10-30 seconds
   - Subsequent playback is instant
   - Be patient on first song

2. **Search is instant**
   - 300ms debounce prevents overloading
   - Type naturally, results appear quickly
   - No need to press Enter

3. **Theme switching is instant**
   - No page reload required
   - Try different themes freely
   - Dark mode saves battery on OLED screens

### Advanced Usage

1. **Station parameters matter**
   - High personalization + low discovery = "more of what I like"
   - Low personalization + high discovery = "surprise me"
   - Adjust per mood and goal

2. **Charts show community taste**
   - All Time charts = classic favorites
   - This Week = current trends
   - Compare to find timeless vs trendy

3. **Browser folder structure**
   - MUSICIANS folder organized by composer
   - GAMES folder organized by game title
   - DEMOS folder organized by demo group
   - Learn the structure for faster navigation

## Troubleshooting

### No audio playing

1. Check volume isn't muted (press **M** to unmute)
2. Ensure volume slider is above 0%
3. Check browser audio permissions
4. Try refreshing the page

### Search not finding tracks

1. Verify you have a SID collection loaded
2. Check spelling of artist/title
3. Try searching with fewer characters
4. Visit Admin → Fetch to download HVSC

### Favorites not persisting

1. Check browser's localStorage is enabled
2. Don't browse in incognito/private mode
3. Try favoriting again after clearing browser cache

### Keyboard shortcuts not working

1. Click outside any input field first
2. Press **Escape** to exit input focus
3. Ensure browser isn't capturing the keys
4. Refresh page if still not working

## Next Steps

### For Regular Users

- Build your favorites collection
- Rate 20+ tracks to train the ML model
- Try all playback modes (mood, station, folder)
- Explore different time periods via Top Charts

### For Power Users

- Visit `/admin` for advanced features
- Fetch full HVSC collection (70K+ tracks)
- Adjust ML model preferences in Admin Prefs
- Monitor playback quality and audio rendering

### For Developers

- See `doc/developer.md` for setup instructions
- See `doc/technical-reference.md` for architecture
- See `doc/web-ui.md` for detailed feature documentation
- Check `PLANS.md` for roadmap and active work

## Getting Help

- Check `doc/web-ui.md` for technical details
- See troubleshooting sections in documentation
- Review keyboard shortcuts with **?** key
- Check server logs for backend issues

Enjoy exploring the world of C64 music with SIDFlow! 🎵

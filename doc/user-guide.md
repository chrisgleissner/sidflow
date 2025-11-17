# SIDFlow User Guide

A beginner-friendly guide to using SIDFlow's web interface for exploring, playing, and discovering C64 music.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Finding Music](#finding-music)
3. [Playing Music](#playing-music)
4. [Managing Favorites](#managing-favorites)
5. [Exploring Top Charts](#exploring-top-charts)
6. [Browsing Your Collection](#browsing-your-collection)
7. [Personalizing Your Experience](#personalizing-your-experience)
8. [Understanding Ratings](#understanding-ratings)
9. [Keyboard Shortcuts](#keyboard-shortcuts)
10. [Tips and Tricks](#tips-and-tricks)

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

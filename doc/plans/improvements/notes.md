# SIDFlow Improvements - Implementation Notes

This document contains implementation notes, decisions, and technical considerations for the improvements rollout.

---

## Phase 1: Onboarding

### Setup Wizard Technical Notes

**Implementation Approach:**
- Use `@clack/prompts` or similar for interactive CLI prompts
- Detect sidplayfp: Try executing `sidplayfp --version`, parse output
- Path validation: Check `fs.access` with appropriate permissions
- Disk space: Use `df` on Unix, `wmic` on Windows
- Sample download: Use existing fetch code, but limit to specific artists

**Sample SID Selection:**
- 5-10 songs from different artists
- Various moods and energy levels
- No ROM requirements
- Known good files from HVSC Update #83

**Edge Cases:**
- sidplayfp not in PATH → Prompt for path, offer install instructions
- Insufficient disk space → Show requirements, suggest cleanup
- Network issues → Offer offline mode with bundled samples
- Permission denied → Explain permissions, suggest alternative paths

### Progress Bars Technical Notes

**Libraries:**
- `cli-progress` - Full-featured, customizable
- `ora` - Simple spinners
- `chalk` - Colors

**Implementation Pattern:**
```typescript
import cliProgress from 'cli-progress';

const bar = new cliProgress.SingleBar({
  format: '{task} [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}',
  barCompleteChar: '\u2588',
  barIncompleteChar: '\u2591',
});

bar.start(total, 0, { task: 'Classifying' });
// Update in loop
bar.update(current);
bar.stop();
```

**Performance Considerations:**
- Update at most once per second to avoid terminal slowdown
- Use separate thread for progress updates in parallel operations
- Cache ETA calculations (exponential moving average)

### Error Messages Technical Notes

**Error Code Schema:**
```
SIDFLOW_Exxxx
where xxxx = 4-digit number

Ranges:
1000-1999: Configuration errors
2000-2999: Prerequisite errors  
3000-3999: File I/O errors
4000-4999: Network errors
5000-5999: Classification errors
6000-6999: Playback errors
7000-7999: Database errors
8000-8999: Model/training errors
9000-9999: Internal errors
```

**Error Message Template:**
```
Error [SIDFLOW_E2001]: sidplayfp not found in PATH

Possible causes:
  • sidplayfp is not installed
  • sidplayfp is installed but not in PATH
  • Incorrect PATH configuration

Solutions:
  1. Install sidplayfp:
     Ubuntu/Debian: sudo apt install sidplayfp
     macOS: brew install sidplayfp
     Windows: Download from https://...
  
  2. Specify path explicitly:
     --sidplay /path/to/sidplayfp
  
  3. Add to PATH:
     export PATH=$PATH:/path/to/sidplayfp/dir

More help: https://github.com/.../troubleshooting#E2001
```

---

## Phase 2: Stabilization

### Backup System Technical Notes

**Storage Format:**
- Compressed tar.gz of entire tags directory
- Filename: `ratings-backup-YYYY-MM-DD-HHmmss.tar.gz`
- Location: `./backups/` or configurable path
- Metadata: JSON sidecar with timestamp, file count, hash

**Compression:**
- Use `zlib` or `bun:compress`
- Target: 50-70% compression ratio
- Trade-off: Speed vs size (prefer speed)

**Retention Policy:**
- Keep last 5 by default
- Configurable via `.sidflow.json`
- Option to keep weekly/monthly backups longer
- Auto-cleanup on backup creation

**Verification:**
- Hash verification after backup
- Integrity check before restore
- Dry-run restore option

### Incremental Classification Technical Notes

**State Tracking:**
```json
{
  "version": "1.0",
  "files": {
    "path/to/song.sid": {
      "hash": "sha256:...",
      "classifiedAt": "2025-11-04T12:00:00Z",
      "modelVersion": "0.2.0",
      "featureVersion": "1.0",
      "cached": true
    }
  }
}
```

**Stored in:** `./workspace/classification-state.json`

**Hash Calculation:**
- Use SHA-256 of SID file content
- Cache hash to avoid re-reading large files
- Compare hash before classification

**Parallel Processing:**
- Use worker threads (Bun supports this)
- Thread count: `Math.min(cpus, config.threads || cpus)`
- Queue-based distribution
- Shared progress tracking

**Re-classification Triggers:**
- Model version changed
- Feature extractor version changed
- Force rebuild flag
- File hash changed (modified file)

### Graceful Degradation Technical Notes

**Error Recovery Strategy:**
1. Try operation
2. On failure, log error
3. Try fallback (if available)
4. Continue to next item
5. Collect all errors
6. Report at end

**Fallback Chain:**
```
Essentia.js → Heuristic features (BPM from filename, etc.)
sidplayfp metadata → Filename parsing
TF.js prediction → Neutral ratings (3,3,3)
LanceDB → JSON file-based search
```

**Error Report Format:**
```json
{
  "timestamp": "2025-11-04T12:00:00Z",
  "operation": "classification",
  "totalFiles": 1000,
  "successful": 987,
  "failed": 13,
  "errors": [
    {
      "file": "path/to/song.sid",
      "error": "Essentia extraction failed",
      "fallback": "Used heuristic features",
      "severity": "warning"
    }
  ]
}
```

---

## Phase 3: Playback Enhancements

### Real-time Controls Technical Notes

**Approach:**
- Use `readline` for keyboard input
- Non-blocking input with async handling
- Key bindings:
  - Space: Pause/Resume
  - N: Next
  - P: Previous
  - L: Like
  - D: Dislike
  - F: Favorite
  - B: Ban
  - Q: Quit

**Implementation:**
```typescript
import readline from 'readline';

readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);

process.stdin.on('keypress', (str, key) => {
  if (key.name === 'space') controller.pause();
  if (key.name === 'n') controller.skip();
  // ...
});
```

**State Management:**
- Track play state in controller
- Emit events for UI updates
- Persist state to disk periodically

### Smart Playlist Technical Notes

**Adaptive Algorithm:**
1. Start with base mood/filter query
2. Track user feedback in session
3. Calculate feedback score: likes - dislikes - (skips * 0.5)
4. Adjust weights: boost liked characteristics
5. Generate next batch with adjusted weights
6. Repeat

**Energy Curve Implementation:**
```typescript
interface EnergyCurve {
  duration: number; // minutes
  points: { time: number; energy: number }[];
}

const buildUp: EnergyCurve = {
  duration: 30,
  points: [
    { time: 0, energy: 2 },
    { time: 10, energy: 3 },
    { time: 20, energy: 4 },
    { time: 30, energy: 5 }
  ]
};
```

**Recently Played Filter:**
- Track last N songs played (configurable, default 50)
- Store in session state
- Filter out from recommendations
- Reset on new session

---

## Phase 4: Web Interface

### Technology Stack

**Backend:**
- Bun HTTP server (built-in)
- REST API (Express-like routing)
- WebSocket (for real-time updates)
- Static file serving

**Frontend Options:**

**Option A: React**
- Pros: Huge ecosystem, many libraries, familiar
- Cons: Bundle size, complexity
- Best for: Feature-rich UI with complex interactions

**Option B: Vue**
- Pros: Simple, performant, good docs
- Cons: Smaller ecosystem than React
- Best for: Balanced features and simplicity

**Option C: Svelte**
- Pros: Smallest bundle, fastest, simple
- Cons: Smaller ecosystem, less mature
- Best for: Performance-critical, lean UI

**Recommendation: Svelte for Phase 1, evaluate React for Phase 2**

### API Design

**RESTful Endpoints:**
```
GET    /api/songs                 List songs with pagination
GET    /api/songs/:id             Get song details
POST   /api/songs/:id/rate        Rate a song
GET    /api/playlists             List playlists
POST   /api/playlists             Create playlist
GET    /api/playlists/:id         Get playlist
PUT    /api/playlists/:id         Update playlist
DELETE /api/playlists/:id         Delete playlist
POST   /api/play                  Start playback session
GET    /api/play/status           Get playback status
POST   /api/play/action           Control playback (pause/skip/etc)
GET    /api/stats/collection      Collection statistics
GET    /api/stats/listening       Listening statistics
```

**WebSocket Events:**
```typescript
// Client → Server
{ type: 'subscribe', channel: 'playback' }
{ type: 'action', action: 'pause' }

// Server → Client
{ type: 'playback', event: 'started', song: {...} }
{ type: 'playback', event: 'progress', elapsed: 30 }
{ type: 'notification', message: 'Classification complete' }
```

### Audio Streaming

**Approach 1: Pre-convert to MP3/AAC**
- Pro: Browser-native playback, no custom codec
- Con: Storage overhead, conversion time
- Best for: Small collections

**Approach 2: Real-time conversion**
- Pro: No storage overhead
- Con: CPU usage, latency
- Best for: Large collections

**Approach 3: WebAssembly SID player**
- Pro: Native browser playback, no server conversion
- Con: Complex implementation, browser compatibility
- Best for: Future enhancement

**Recommendation: Approach 2 for Phase 1 (FFmpeg pipe to browser)**

---

## Phase 5: Analytics

### Visualization Libraries

**Options:**
- Chart.js - Simple, canvas-based
- D3.js - Powerful, flexible, steep learning curve
- Plotly - Interactive, scientific plots
- ECharts - Feature-rich, good performance

**Recommendation: Chart.js for MVP, D3.js for advanced features**

### Performance Considerations

**Large Dataset Handling:**
- Pagination for song lists (50-100 per page)
- Virtual scrolling for large tables
- Aggregate data on backend
- Cache computed statistics
- Use database indices

**Real-time Updates:**
- WebSocket for live stats
- Throttle updates (max 1/second)
- Batch updates when possible
- Use efficient diff algorithms

---

## Phase 6: Remote Access

### Security Considerations

**Must-Have:**
- HTTPS only (Let's Encrypt)
- Strong password requirements
- Rate limiting (prevent brute force)
- CSRF protection
- SQL injection prevention (use parameterized queries)
- XSS prevention (sanitize inputs)
- Session timeout
- Secure cookies (httpOnly, secure, sameSite)

**Authentication:**
- bcrypt for password hashing (cost factor: 12)
- JWT for API authentication
- Refresh token mechanism
- OAuth2 for future (Google, GitHub, etc.)

**Privacy:**
- User data isolation
- No tracking by default
- Opt-in analytics
- Data export capability
- Account deletion

**Compliance:**
- GDPR compliance (if EU users)
- Privacy policy
- Terms of service
- Cookie consent

### Scaling Considerations

**Single Server (Phase 1):**
- 100 concurrent users
- 10,000 songs per user
- Vertical scaling (bigger machine)

**Multi-Server (Future):**
- Load balancer
- Shared database
- Redis for sessions
- CDN for static files
- Object storage for audio

---

## Development Workflow

### Feature Flags

Use feature flags for gradual rollout:
```typescript
const features = {
  webUI: process.env.ENABLE_WEB_UI === 'true',
  remoteAccess: process.env.ENABLE_REMOTE === 'true',
  analytics: process.env.ENABLE_ANALYTICS === 'true'
};
```

### Testing Strategy

**Unit Tests:**
- All new functions
- Edge cases
- Error handling
- ≥90% coverage

**Integration Tests:**
- API endpoints
- Database operations
- File operations
- User workflows

**E2E Tests:**
- Complete user journeys
- Browser automation (Playwright)
- Real sidplayfp interaction
- Performance testing

**Manual Testing:**
- User acceptance testing
- Usability testing
- Browser compatibility
- Mobile responsiveness

### Performance Benchmarks

**Targets:**
- Page load: <2s
- API response: <100ms (p95)
- Search: <500ms
- Playlist generation: <1s
- Classification: >10 files/second

**Tools:**
- Lighthouse for web performance
- Apache Bench for API load testing
- Chrome DevTools for profiling
- Bun's built-in profiler

---

## Deployment

### Local Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev

# Run with hot reload
bun run watch

# Run tests
bun run test
```

### Production Build

```bash
# Build all packages
bun run build

# Run production server
bun run start

# Run with PM2 (process manager)
pm2 start bun --name sidflow -- run start
```

### Docker Support (Future)

```dockerfile
FROM oven/bun:latest
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production
COPY . .
RUN bun run build
CMD ["bun", "run", "start"]
```

---

## Monitoring and Maintenance

### Logging

**Levels:**
- DEBUG: Verbose diagnostic info
- INFO: General informational messages
- WARN: Warning messages (potential issues)
- ERROR: Error messages (operation failed)
- FATAL: Critical errors (service down)

**Storage:**
- File: `./logs/sidflow-YYYY-MM-DD.log`
- Rotation: Daily
- Retention: 30 days
- Format: JSON lines for easy parsing

### Metrics

**Track:**
- Request count and latency
- Error rates
- Database query performance
- Cache hit rates
- User activity
- Resource usage (CPU, memory, disk)

**Tools:**
- Prometheus (metrics collection)
- Grafana (visualization)
- Loki (log aggregation)

### Alerts

**Set up alerts for:**
- Service down (health check fails)
- High error rate (>5%)
- Slow response times (>1s p95)
- Low disk space (<10%)
- High CPU usage (>80% sustained)

---

## Migration Strategy

### Version Compatibility

**Data Format Changes:**
- Always add version field to data files
- Support reading old formats
- Auto-migrate on read
- Provide manual migration tool

**API Changes:**
- Version API endpoints (/api/v1/, /api/v2/)
- Maintain old versions for 6 months
- Announce deprecations clearly
- Provide migration guide

### Rollback Plan

**If deployment fails:**
1. Revert to previous version (git tag)
2. Restore database backup
3. Clear caches
4. Verify system health
5. Investigate issues
6. Fix and redeploy

---

## Documentation

### User Documentation

- [ ] Getting Started guide
- [ ] Tutorial videos
- [ ] CLI reference
- [ ] Web UI guide
- [ ] FAQ
- [ ] Troubleshooting
- [ ] Best practices

### Developer Documentation

- [ ] Architecture overview
- [ ] API documentation
- [ ] Database schema
- [ ] Contributing guide
- [ ] Code style guide
- [ ] Testing guide
- [ ] Deployment guide

### Operations Documentation

- [ ] Installation guide
- [ ] Configuration reference
- [ ] Backup procedures
- [ ] Monitoring setup
- [ ] Incident response
- [ ] Scaling guide

---

## Success Metrics

### Key Performance Indicators

**User Engagement:**
- Daily active users
- Session duration
- Playlists created
- Songs rated
- Feedback submitted

**System Health:**
- Uptime (target: 99.9%)
- Error rate (target: <1%)
- Response time (target: <100ms p95)
- Classification throughput (target: >10 files/s)

**User Satisfaction:**
- Net Promoter Score (NPS)
- Feature usage rates
- Support ticket volume
- GitHub issues/PRs
- Community activity

---

## Future Considerations

### Mobile Apps
- React Native for cross-platform
- Native apps for better performance
- Offline support crucial
- Background playback required

### Desktop Apps
- Electron wrapper around web UI
- System tray integration
- Native notifications
- Auto-updates

### Plugin System
- Define plugin API contract
- Sandboxed execution
- Plugin marketplace
- Community contributions

### Advanced Features
- Collaborative filtering
- Social networking
- Live streaming events
- AI-powered discovery
- Voice control
- Smart home integration

---

## Conclusion

These improvements will transform SIDFlow from a technical tool into a user-friendly platform. Focus on delivering value incrementally, starting with quick wins and building toward more ambitious features.

**Remember:**
- User feedback is essential
- Quality over quantity
- Iterate based on real usage
- Keep it simple and maintainable
- Document everything
- Have fun! 🎵

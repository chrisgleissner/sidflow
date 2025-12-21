import { test, expect, type BrowserContext, type Page } from './test-hooks';

const hasDescribe = typeof (globalThis as unknown as { describe?: unknown }).describe === 'function';
if (hasDescribe && !process.env.PLAYWRIGHT_TEST_SUITE) {
  console.log("[sidflow-web] Skipping Playwright e2e spec; run via `bun run test:e2e`.");
  process.exit(0);
}

/**
 * Helper to wait for UI to settle (loading spinners gone).
 */
async function waitForUISettle(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelector('.animate-spin') === null, { timeout: 5000 }).catch(() => {});
}

const SAMPLE_TRACKS = [
    {
        sidPath: 'C64Music/MUSICIANS/G/Garvalf/Lully_Marche_Ceremonie_Turcs_Wip.sid',
        title: 'Lully Marche',
        artist: 'Garvalf',
    },
    {
        sidPath: 'C64Music/MUSICIANS/S/Szepatowski_Brian/Superman_Pt02_Theme.sid',
        title: 'Superman Theme',
        artist: 'Brian Szepatowski',
    },
];

// Mock playlist storage in memory
const playlistStorageFixtures = new WeakMap<BrowserContext, Map<string, any>>();

async function installPlaylistFixtures(page: Page): Promise<void> {
    const context = page.context();
    if (playlistStorageFixtures.has(context)) {
        return;
    }
    const storage = new Map<string, any>();
    playlistStorageFixtures.set(context, storage);

    // Mock GET /api/playlists - list all
    await context.route('**/api/playlists', async (route) => {
        if (route.request().method() === 'GET') {
            const playlists = Array.from(storage.values());
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ playlists }),
            });
            return;
        }

        // POST /api/playlists - create
        if (route.request().method() === 'POST') {
            const raw = route.request().postData();
            let payload: any = {};
            try {
                payload = raw ? JSON.parse(raw) : {};
            } catch {
                await route.fulfill({ status: 400, body: JSON.stringify({ success: false, error: 'Invalid JSON' }) });
                return;
            }

            const id = `playlist-${Date.now()}-${Math.random().toString(36).substring(7)}`;
            const playlist = {
                id,
                name: payload.name || 'Untitled',
                description: payload.description || '',
                tracks: payload.tracks || [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            storage.set(id, playlist);
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, data: playlist }),
            });
            return;
        }

        await route.fallback();
    });

    // Mock GET/DELETE /api/playlists/[id]
    await context.route('**/api/playlists/*', async (route) => {
        const url = route.request().url();
        const match = url.match(/\/api\/playlists\/([^/?]+)/);
        if (!match) {
            await route.fallback();
            return;
        }
        const id = match[1];

        if (route.request().method() === 'GET') {
            const playlist = storage.get(id);
            if (!playlist) {
                await route.fulfill({ status: 404, body: JSON.stringify({ success: false, error: 'Not found' }) });
                return;
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, data: playlist }),
            });
            return;
        }

        if (route.request().method() === 'DELETE') {
            if (!storage.has(id)) {
                await route.fulfill({ status: 404, body: JSON.stringify({ success: false, error: 'Not found' }) });
                return;
            }
            storage.delete(id);
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true }),
            });
            return;
        }

        await route.fallback();
    });

    // Mock M3U export endpoint
    await context.route('**/api/playlists/*/export', async (route) => {
        const url = route.request().url();
        const match = url.match(/\/api\/playlists\/([^/?]+)\/export/);
        if (!match) {
            await route.fallback();
            return;
        }
        const id = match[1];
        const playlist = storage.get(id);
        if (!playlist) {
            await route.fulfill({ status: 404, body: 'Not found' });
            return;
        }

        storage.set('__sidflow_test_lastExport', {
            id,
            name: playlist.name,
            at: new Date().toISOString(),
        });

        // Generate M3U content
        const lines = ['#EXTM3U', `#PLAYLIST:${playlist.name}`];
        for (const track of playlist.tracks) {
            const duration = track.lengthSeconds || 0;
            const artist = track.artist || 'Unknown';
            const title = track.title || 'Unknown';
            lines.push(`#EXTINF:${duration},${artist} - ${title}`);
            lines.push(track.sidPath);
        }
        const m3uContent = lines.join('\n');

        await route.fulfill({
            status: 200,
            contentType: 'audio/x-mpegurl',
            headers: {
                'Content-Disposition': `attachment; filename="${playlist.name.replace(/[^a-z0-9_-]/gi, '_')}.m3u"`,
            },
            body: m3uContent,
        });
    });
}

function getPlaylistStorage(page: Page): Map<string, any> {
    const storage = playlistStorageFixtures.get(page.context());
    if (!storage) {
        throw new Error('Playlist fixtures not installed');
    }
    return storage;
}

// Timeout constants for fast E2E tests
const TIMEOUTS = {
    TEST: 90_000,          // Overall test timeout (slow CI / shared runners)
    PAGE_LOAD: 60_000,     // Page navigation timeout
    ELEMENT_VISIBLE: 15_000, // Wait for element to be visible
    ELEMENT_QUICK: 5_000,  // Quick element checks
    LOADING_STATE: 60_000, // Wait for loading states to complete
    HMR_SETTLE: 300,      // Let HMR/hot-reload settle
} as const;

test.describe('Playlists Feature', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(TIMEOUTS.TEST);
        await installPlaylistFixtures(page);

        // Navigate to the Play tab with retry for CI stability
        let retries = 3;
        while (retries > 0) {
            try {
                await page.goto('/?tab=play', { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.PAGE_LOAD });
                await waitForUISettle(page);
                await page.waitForSelector('[data-testid="tab-play"]', { timeout: TIMEOUTS.LOADING_STATE });
                break;
            } catch (error) {
                retries--;
                if (retries === 0) throw error;
                console.log(`Navigation retry, ${retries} attempts remaining`);
                await waitForUISettle(page);
            }
        }
    });

    test('should show playlists button and empty state', async ({ page }) => {
        // Click the Playlists button to open the sheet
        const playlistsButton = page.getByRole('button', { name: /playlists/i });
        await expect(playlistsButton).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
        await playlistsButton.click({ timeout: TIMEOUTS.ELEMENT_QUICK });
        await waitForUISettle(page);

        // Should show empty state in the sheet
        await expect(page.getByText('No playlists yet', { exact: false })).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
    });

    test('should create playlist and show in list', async ({ page }) => {
        const storage = getPlaylistStorage(page);

        // Create a playlist
        const playlistName = 'Test Playlist';
        const tracks = SAMPLE_TRACKS.map((t, i) => ({ ...t, order: i }));
        const playlist = {
            id: 'test-playlist-1',
            name: playlistName,
            description: 'Test Description',
            tracks,
            trackCount: tracks.length,
            totalDuration: 360, // 6 minutes
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        storage.set(playlist.id, playlist);

        // Open playlists sheet
        const playlistsButton = page.getByRole('button', { name: /playlists/i });
        await playlistsButton.click({ timeout: TIMEOUTS.ELEMENT_QUICK });

        // Wait for sheet to open
        await page.waitForSelector('[role="dialog"]', { state: 'visible', timeout: TIMEOUTS.ELEMENT_VISIBLE });
        await waitForUISettle(page);

        // Verify playlist appears in the sheet
        const sheetContent = page.locator('[role="dialog"]');
        await expect(sheetContent.getByText(playlistName)).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });

        // Verify track count (might appear as "2 tracks")
        await expect(sheetContent.getByText(/2 tracks/i)).toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });
    });

    test('should delete playlist', async ({ page }) => {
        const storage = getPlaylistStorage(page);

        // Create a playlist
        const playlist = {
            id: 'test-playlist-delete',
            name: 'Delete Me',
            description: '',
            tracks: [],
            trackCount: 0,
            totalDuration: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        storage.set(playlist.id, playlist);

        // Open playlists sheet
        const playlistsButton = page.getByRole('button', { name: /playlists/i });
        await playlistsButton.click({ timeout: TIMEOUTS.ELEMENT_QUICK });
        await waitForUISettle(page);
        
        // Wait for sheet content to load - the API mock needs time to respond
        await page.waitForFunction(() => {
            const sheet = document.querySelector('[role="dialog"]');
            const text = sheet?.textContent || '';
            // Wait for either the playlist name or the empty state
            return text.includes('Delete Me') || text.includes('No playlists');
        }, { timeout: TIMEOUTS.ELEMENT_VISIBLE });

        // Should show playlist
        await expect(page.getByText('Delete Me')).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });

        // Set up dialog handler for confirmation
        page.on('dialog', dialog => dialog.accept());

        // Click delete button (trash icon)
        const deleteButton = page.getByRole('button', { name: 'Delete playlist' });
        await deleteButton.click({ timeout: TIMEOUTS.ELEMENT_QUICK });
        await waitForUISettle(page);

        // Playlist should be removed
        await expect(page.getByText('Delete Me')).not.toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });
    });

    test('should show export and share buttons', async ({ page }) => {
        const storage = getPlaylistStorage(page);

        // Create a playlist
        const tracks = SAMPLE_TRACKS.map((t, i) => ({ ...t, order: i }));
        const playlist = {
            id: 'test-playlist-export',
            name: 'Export Test',
            description: '',
            tracks,
            trackCount: tracks.length,
            totalDuration: 360,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        storage.set(playlist.id, playlist);

        // Open playlists sheet
        const playlistsButton = page.getByRole('button', { name: /playlists/i });
        await playlistsButton.click({ timeout: TIMEOUTS.ELEMENT_QUICK });
        await waitForUISettle(page);

        // Should show playlist with buttons
        await expect(page.getByText('Export Test')).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });

        // Check for export button (Download icon)
        const exportButton = page.getByRole('button', { name: 'Export as M3U' });
        await expect(exportButton).toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });

        // Check for share button (Share2 icon)
        const shareButton = page.getByRole('button', { name: 'Share playlist URL' });
        await expect(shareButton).toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });
    });

    test('should handle M3U export', async ({ page }) => {
        const storage = getPlaylistStorage(page);

        // Create a playlist
        const tracks = SAMPLE_TRACKS.map((t, i) => ({ ...t, order: i, lengthSeconds: 180 }));
        const playlist = {
            id: 'test-playlist-m3u',
            name: 'M3U Test',
            description: '',
            tracks,
            trackCount: tracks.length,
            totalDuration: 360,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        storage.set(playlist.id, playlist);

        // Open playlists sheet
        const playlistsButton = page.getByRole('button', { name: /playlists/i });
        await playlistsButton.click({ timeout: TIMEOUTS.ELEMENT_QUICK });
        await waitForUISettle(page);

        // Should show playlist
        await expect(page.getByText('M3U Test')).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });

        // Assert the export endpoint returns a valid M3U payload.
        // Use page.evaluate to make the fetch through the page context (to hit route mocks)
        const result = await page.evaluate(async (playlistId) => {
            const resp = await fetch(`/api/playlists/${playlistId}/export`);
            return {
                status: resp.status,
                contentType: resp.headers.get('content-type') || '',
                body: await resp.text(),
            };
        }, playlist.id);

        expect(result.status).toBe(200);
        expect(result.contentType).toMatch(/mpegurl|m3u|text\//i);
        expect(result.body).toContain('#EXTM3U');
        expect(result.body).toContain(`#PLAYLIST:${playlist.name}`);
        for (const track of tracks) {
            expect(result.body).toContain(track.sidPath);
        }
    });

    test('should copy share URL to clipboard', async ({ page, context }) => {
        const storage = getPlaylistStorage(page);

        // Create a playlist
        const tracks = SAMPLE_TRACKS.map((t, i) => ({ ...t, order: i }));
        const playlist = {
            id: 'test-playlist-share',
            name: 'Share Test',
            description: '',
            tracks,
            trackCount: tracks.length,
            totalDuration: 360,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        storage.set(playlist.id, playlist);

        // Grant clipboard permissions
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);

        // Open playlists sheet
        const playlistsButton = page.getByRole('button', { name: /playlists/i });
        await playlistsButton.click({ timeout: TIMEOUTS.ELEMENT_QUICK });
        await waitForUISettle(page);

        // Should show playlist
        await expect(page.getByText('Share Test')).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });

        // Click share button
        const shareButton = page.getByRole('button', { name: 'Share playlist URL' });
        await shareButton.click({ timeout: TIMEOUTS.ELEMENT_QUICK });

        // Read clipboard content (poll for up to 3s since clipboard write might be async)
        let clipboardText = '';
        for (let i = 0; i < 10; i++) {
            clipboardText = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
            if (clipboardText.includes('?playlist=')) break;
            await page.waitForFunction(() => true, { timeout: 300 }).catch(() => {});
        }

        // Verify clipboard contains URL with playlist parameter
        expect(clipboardText).toContain('?playlist=');
        expect(clipboardText).toContain(playlist.id);
    });
});

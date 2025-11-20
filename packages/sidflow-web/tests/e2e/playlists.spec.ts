import { test, expect, type BrowserContext, type Page } from '@playwright/test';

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
                body: JSON.stringify({ success: true, data: { playlists } }),
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
    TEST: 20000,          // Overall test timeout (strict 20s max)
    PAGE_LOAD: 10000,     // Page navigation timeout
    ELEMENT_VISIBLE: 5000, // Wait for element to be visible
    ELEMENT_QUICK: 2000,  // Quick element checks
    LOADING_STATE: 10000, // Wait for loading states to complete
    HMR_SETTLE: 300,      // Let HMR/hot-reload settle
} as const;

test.describe('Playlists Feature', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        test.setTimeout(TIMEOUTS.TEST);
        await installPlaylistFixtures(page);

        // Navigate to the player
        await page.goto('/', { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.PAGE_LOAD });
        await page.waitForTimeout(TIMEOUTS.HMR_SETTLE);

        // Wait for the page to load
        await page.waitForSelector('[data-testid="tab-play"]', { timeout: TIMEOUTS.LOADING_STATE });
    });

    test.skip('should show playlists tab and empty state', async ({ page }) => {
        // TODO: Fix test - data-testid="tab-playlists" not found in UI
        // Click playlists tab
        await page.locator('[data-testid="tab-playlists"]').click({ timeout: TIMEOUTS.ELEMENT_QUICK });
        await page.waitForTimeout(TIMEOUTS.HMR_SETTLE);

        // Should show empty state
        await expect(page.getByText('No playlists yet', { exact: false }).first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
    });

    test.skip('should create playlist and show in list', async ({ page }) => {
        // SKIP: No playlists tab exists in UI yet
        const storage = getPlaylistStorage(page);

        // Create a playlist
        const playlistName = 'Test Playlist';
        const playlist = {
            id: 'test-playlist-1',
            name: playlistName,
            description: 'Test Description',
            tracks: SAMPLE_TRACKS.map(t => ({ ...t })),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        storage.set(playlist.id, playlist);

        // Navigate to playlists tab
        await page.locator('[data-testid="tab-playlists"]').click({ timeout: TIMEOUTS.ELEMENT_QUICK });
        await page.waitForTimeout(TIMEOUTS.HMR_SETTLE);

        // Should show playlist in list
        await expect(page.getByText(playlistName).first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });
        await expect(page.getByText('2 tracks', { exact: false }).first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });
    });

    test.skip('should delete playlist', async ({ page }) => {
        // SKIP: No playlists tab exists in UI yet
        const storage = getPlaylistStorage(page);

        // Create a playlist
        const playlist = {
            id: 'test-playlist-delete',
            name: 'Delete Me',
            description: '',
            tracks: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        storage.set(playlist.id, playlist);

        // Navigate to playlists tab
        await page.locator('[data-testid="tab-playlists"]').click({ timeout: TIMEOUTS.ELEMENT_QUICK });
        await page.waitForTimeout(TIMEOUTS.HMR_SETTLE);

        // Should show playlist
        await expect(page.getByText('Delete Me').first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });

        // Click delete button (trash icon)
        const deleteButton = page.locator('button:has([data-lucide="trash-2"])').first();
        await deleteButton.click({ timeout: TIMEOUTS.ELEMENT_QUICK });
        await page.waitForTimeout(TIMEOUTS.HMR_SETTLE);

        // Playlist should be removed
        await expect(page.getByText('Delete Me')).not.toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });
    });

    test.skip('should show export and share buttons', async ({ page }) => {
        // SKIP: No playlists tab exists in UI yet
        const storage = getPlaylistStorage(page);

        // Create a playlist
        const playlist = {
            id: 'test-playlist-export',
            name: 'Export Test',
            description: '',
            tracks: SAMPLE_TRACKS.map(t => ({ ...t })),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        storage.set(playlist.id, playlist);

        // Navigate to playlists tab
        await page.locator('[data-testid="tab-playlists"]').click({ timeout: TIMEOUTS.ELEMENT_QUICK });
        await page.waitForTimeout(TIMEOUTS.HMR_SETTLE);

        // Should show playlist with buttons
        await expect(page.getByText('Export Test').first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });

        // Check for export button (Download icon)
        const exportButton = page.locator('button:has([data-lucide="download"])').first();
        await expect(exportButton).toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });

        // Check for share button (Share2 icon)
        const shareButton = page.locator('button:has([data-lucide="share-2"])').first();
        await expect(shareButton).toBeVisible({ timeout: TIMEOUTS.ELEMENT_QUICK });
    });

    test.skip('should handle M3U export', async ({ page }) => {
        // SKIP: No playlists tab exists in UI yet
        const storage = getPlaylistStorage(page);

        // Create a playlist
        const playlist = {
            id: 'test-playlist-m3u',
            name: 'M3U Test',
            description: '',
            tracks: SAMPLE_TRACKS.map(t => ({ ...t, lengthSeconds: 180 })),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        storage.set(playlist.id, playlist);

        // Navigate to playlists tab
        await page.locator('[data-testid="tab-playlists"]').click({ timeout: TIMEOUTS.ELEMENT_QUICK });
        await page.waitForTimeout(TIMEOUTS.HMR_SETTLE);

        // Should show playlist
        await expect(page.getByText('M3U Test').first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });

        // Set up download listener
        const downloadPromise = page.waitForEvent('download', { timeout: TIMEOUTS.ELEMENT_VISIBLE });

        // Click export button
        const exportButton = page.locator('button:has([data-lucide="download"])').first();
        await exportButton.click({ timeout: TIMEOUTS.ELEMENT_QUICK });

        // Wait for download to start
        const download = await downloadPromise;

        // Verify download filename
        expect(download.suggestedFilename()).toMatch(/M3U[_-]Test\.m3u/i);
    });

    test.skip('should copy share URL to clipboard', async ({ page, context }) => {
        // SKIP: No playlists tab exists in UI yet
        const storage = getPlaylistStorage(page);

        // Create a playlist
        const playlist = {
            id: 'test-playlist-share',
            name: 'Share Test',
            description: '',
            tracks: SAMPLE_TRACKS.map(t => ({ ...t })),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        storage.set(playlist.id, playlist);

        // Grant clipboard permissions
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);

        // Navigate to playlists tab
        await page.locator('[data-testid="tab-playlists"]').click({ timeout: TIMEOUTS.ELEMENT_QUICK });
        await page.waitForTimeout(TIMEOUTS.HMR_SETTLE);

        // Should show playlist
        await expect(page.getByText('Share Test').first()).toBeVisible({ timeout: TIMEOUTS.ELEMENT_VISIBLE });

        // Click share button
        const shareButton = page.locator('button:has([data-lucide="share-2"])').first();
        await shareButton.click({ timeout: TIMEOUTS.ELEMENT_QUICK });
        await page.waitForTimeout(300); // Wait for clipboard write

        // Read clipboard content
        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());

        // Verify clipboard contains URL with playlist parameter
        expect(clipboardText).toContain('?playlist=');
        expect(clipboardText).toContain(playlist.id);
    });
});

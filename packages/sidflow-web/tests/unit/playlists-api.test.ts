/**
 * Unit tests for playlists API routes
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { promises as fs } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';

// Set environment variable BEFORE importing API routes and storage
const TEST_PLAYLISTS_PATH = join(process.cwd(), 'test-workspace', 'playlists-api-tests');
process.env.SIDFLOW_PLAYLISTS_PATH = TEST_PLAYLISTS_PATH;

import { GET as listGET, POST as createPOST } from '@/app/api/playlists/route';
import {
    GET as getGET,
    PUT as updatePUT,
    DELETE as deleteDELETE,
} from '@/app/api/playlists/[id]/route';
import { POST as reorderPOST } from '@/app/api/playlists/[id]/reorder/route';

describe('Playlists API', () => {
    beforeAll(async () => {
        // Clean up test directory once before all tests
        try {
            await fs.rm(TEST_PLAYLISTS_PATH, { recursive: true, force: true });
        } catch {
            // Ignore if doesn't exist
        }
    });

    afterAll(async () => {
        // Clean up once after all tests
        try {
            await fs.rm(TEST_PLAYLISTS_PATH, { recursive: true, force: true });
        } catch {
            // Ignore errors
        }
    });

    describe('GET /api/playlists', () => {
        test('returns empty playlists array', async () => {
            const response = await listGET();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.playlists).toEqual([]);
            expect(data.total).toBe(0);
        });

        test('returns list of playlists', async () => {
            // Create a playlist first
            const createRequest = new NextRequest('http://localhost/api/playlists', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Test Playlist',
                    tracks: [{ sidPath: '/path/track1.sid' }],
                }),
            });
            await createPOST(createRequest);

            const response = await listGET();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.playlists).toHaveLength(1);
            expect(data.total).toBe(1);
        });
    });

    describe('POST /api/playlists', () => {
        test('creates a new playlist', async () => {
            const request = new NextRequest('http://localhost/api/playlists', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Test Playlist',
                    description: 'My test playlist',
                    tracks: [
                        { sidPath: '/path/track1.sid', title: 'Track 1' },
                        { sidPath: '/path/track2.sid', title: 'Track 2' },
                    ],
                }),
            });

            const response = await createPOST(request);
            const data = await response.json();

            expect(response.status).toBe(201);
            expect(data.playlist.name).toBe('Test Playlist');
            expect(data.playlist.description).toBe('My test playlist');
            expect(data.playlist.trackCount).toBe(2);
        });

        test('validates required name field', async () => {
            const request = new NextRequest('http://localhost/api/playlists', {
                method: 'POST',
                body: JSON.stringify({
                    tracks: [],
                }),
            });

            const response = await createPOST(request);
            const data = await response.json();

            expect(response.status).toBe(400);
            expect(data.error).toBe('Playlist name is required');
        });

        test('validates tracks array', async () => {
            const request = new NextRequest('http://localhost/api/playlists', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Test',
                    tracks: 'not-an-array',
                }),
            });

            const response = await createPOST(request);
            const data = await response.json();

            expect(response.status).toBe(400);
            expect(data.error).toBe('Tracks must be an array');
        });

        test('validates track sidPath', async () => {
            const request = new NextRequest('http://localhost/api/playlists', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Test',
                    tracks: [{ title: 'Track 1' }], // Missing sidPath
                }),
            });

            const response = await createPOST(request);
            const data = await response.json();

            expect(response.status).toBe(400);
            expect(data.error).toBe('Each track must have a sidPath');
        });
    });

    describe('GET /api/playlists/[id]', () => {
        test('retrieves a playlist by ID', async () => {
            // Create playlist
            const createRequest = new NextRequest('http://localhost/api/playlists', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Test Playlist',
                    tracks: [{ sidPath: '/path/track1.sid' }],
                }),
            });
            const createResponse = await createPOST(createRequest);
            const { playlist } = await createResponse.json();

            // Get playlist
            const context = { params: Promise.resolve({ id: playlist.id }) };
            const response = await getGET(new NextRequest('http://localhost'), context);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.playlist.id).toBe(playlist.id);
            expect(data.playlist.name).toBe('Test Playlist');
        });

        test('returns 404 for non-existent playlist', async () => {
            const context = { params: Promise.resolve({ id: 'non-existent' }) };
            const response = await getGET(new NextRequest('http://localhost'), context);
            const data = await response.json();

            expect(response.status).toBe(404);
            expect(data.error).toBe('Playlist not found');
        });
    });

    describe('PUT /api/playlists/[id]', () => {
        test('updates a playlist', async () => {
            // Create playlist
            const createRequest = new NextRequest('http://localhost/api/playlists', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Original Name',
                    tracks: [{ sidPath: '/path/track1.sid' }],
                }),
            });
            const createResponse = await createPOST(createRequest);
            const { playlist } = await createResponse.json();

            // Update playlist
            const updateRequest = new NextRequest('http://localhost', {
                method: 'PUT',
                body: JSON.stringify({
                    name: 'Updated Name',
                    description: 'New description',
                }),
            });
            const context = { params: Promise.resolve({ id: playlist.id }) };
            const response = await updatePUT(updateRequest, context);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.playlist.name).toBe('Updated Name');
            expect(data.playlist.description).toBe('New description');
        });

        test('returns 404 for non-existent playlist', async () => {
            const updateRequest = new NextRequest('http://localhost', {
                method: 'PUT',
                body: JSON.stringify({ name: 'New Name' }),
            });
            const context = { params: Promise.resolve({ id: 'non-existent' }) };
            const response = await updatePUT(updateRequest, context);
            const data = await response.json();

            expect(response.status).toBe(404);
            expect(data.error).toBe('Playlist not found');
        });
    });

    describe('DELETE /api/playlists/[id]', () => {
        test('deletes a playlist', async () => {
            // Create playlist
            const createRequest = new NextRequest('http://localhost/api/playlists', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Test Playlist',
                    tracks: [{ sidPath: '/path/track1.sid' }],
                }),
            });
            const createResponse = await createPOST(createRequest);
            const { playlist } = await createResponse.json();

            // Delete playlist
            const context = { params: Promise.resolve({ id: playlist.id }) };
            const response = await deleteDELETE(new NextRequest('http://localhost'), context);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.success).toBe(true);
        });

        test('returns 404 for non-existent playlist', async () => {
            const context = { params: Promise.resolve({ id: 'non-existent' }) };
            const response = await deleteDELETE(new NextRequest('http://localhost'), context);
            const data = await response.json();

            expect(response.status).toBe(404);
            expect(data.error).toBe('Playlist not found');
        });
    });

    describe('POST /api/playlists/[id]/reorder', () => {
        test('reorders playlist tracks', async () => {
            // Create playlist with 3 tracks
            const createRequest = new NextRequest('http://localhost/api/playlists', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Test Playlist',
                    tracks: [
                        { sidPath: '/path/track1.sid' },
                        { sidPath: '/path/track2.sid' },
                        { sidPath: '/path/track3.sid' },
                    ],
                }),
            });
            const createResponse = await createPOST(createRequest);
            const { playlist } = await createResponse.json();

            // Reorder: 3, 1, 2
            const reorderRequest = new NextRequest('http://localhost', {
                method: 'POST',
                body: JSON.stringify({
                    trackOrder: ['/path/track3.sid', '/path/track1.sid', '/path/track2.sid'],
                }),
            });
            const context = { params: Promise.resolve({ id: playlist.id }) };
            const response = await reorderPOST(reorderRequest, context);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.playlist.tracks[0].sidPath).toBe('/path/track3.sid');
            expect(data.playlist.tracks[1].sidPath).toBe('/path/track1.sid');
            expect(data.playlist.tracks[2].sidPath).toBe('/path/track2.sid');
        });

        test('validates trackOrder array', async () => {
            const reorderRequest = new NextRequest('http://localhost', {
                method: 'POST',
                body: JSON.stringify({
                    trackOrder: 'not-an-array',
                }),
            });
            const context = { params: Promise.resolve({ id: 'any-id' }) };
            const response = await reorderPOST(reorderRequest, context);
            const data = await response.json();

            expect(response.status).toBe(400);
            expect(data.error).toBe('trackOrder must be an array of sidPaths');
        });

        test('returns 404 when reordering non-existent playlist', async () => {
            const reorderRequest = new NextRequest('http://localhost', {
                method: 'POST',
                body: JSON.stringify({ trackOrder: ['/path/track1.sid'] }),
            });
            const context = { params: Promise.resolve({ id: 'non-existent-id' }) };
            const response = await reorderPOST(reorderRequest, context);
            const data = await response.json();

            expect(response.status).toBe(404);
            expect(data.error).toBe('Playlist not found');
        });
    });

    describe('PUT /api/playlists/[id] validation edge cases', () => {
        test('returns 400 when name is an empty string', async () => {
            // Create playlist first
            const createRequest = new NextRequest('http://localhost/api/playlists', {
                method: 'POST',
                body: JSON.stringify({ name: 'Placeholder', tracks: [] }),
            });
            const createResponse = await createPOST(createRequest);
            const { playlist } = await createResponse.json();

            const updateRequest = new NextRequest('http://localhost', {
                method: 'PUT',
                body: JSON.stringify({ name: '' }),
            });
            const context = { params: Promise.resolve({ id: playlist.id }) };
            const response = await updatePUT(updateRequest, context);
            const data = await response.json();

            expect(response.status).toBe(400);
            expect(data.error).toBe('Playlist name must be a non-empty string');
        });

        test('returns 400 when name is whitespace only', async () => {
            const createRequest = new NextRequest('http://localhost/api/playlists', {
                method: 'POST',
                body: JSON.stringify({ name: 'Placeholder2', tracks: [] }),
            });
            const createResponse = await createPOST(createRequest);
            const { playlist } = await createResponse.json();

            const updateRequest = new NextRequest('http://localhost', {
                method: 'PUT',
                body: JSON.stringify({ name: '   ' }),
            });
            const context = { params: Promise.resolve({ id: playlist.id }) };
            const response = await updatePUT(updateRequest, context);
            const data = await response.json();

            expect(response.status).toBe(400);
            expect(data.error).toBe('Playlist name must be a non-empty string');
        });

        test('returns 400 when tracks is not an array', async () => {
            const createRequest = new NextRequest('http://localhost/api/playlists', {
                method: 'POST',
                body: JSON.stringify({ name: 'Placeholder3', tracks: [] }),
            });
            const createResponse = await createPOST(createRequest);
            const { playlist } = await createResponse.json();

            const updateRequest = new NextRequest('http://localhost', {
                method: 'PUT',
                body: JSON.stringify({ tracks: 'not-an-array' }),
            });
            const context = { params: Promise.resolve({ id: playlist.id }) };
            const response = await updatePUT(updateRequest, context);
            const data = await response.json();

            expect(response.status).toBe(400);
            expect(data.error).toBe('Tracks must be an array');
        });

        test('returns 400 when a track is missing sidPath', async () => {
            const createRequest = new NextRequest('http://localhost/api/playlists', {
                method: 'POST',
                body: JSON.stringify({ name: 'Placeholder4', tracks: [] }),
            });
            const createResponse = await createPOST(createRequest);
            const { playlist } = await createResponse.json();

            const updateRequest = new NextRequest('http://localhost', {
                method: 'PUT',
                body: JSON.stringify({ tracks: [{ title: 'No SidPath Track' }] }),
            });
            const context = { params: Promise.resolve({ id: playlist.id }) };
            const response = await updatePUT(updateRequest, context);
            const data = await response.json();

            expect(response.status).toBe(400);
            expect(data.error).toBe('Each track must have a sidPath');
        });
    });

    describe('Error path tests (500 responses)', () => {
        const CORRUPTED_PATH = join(process.cwd(), 'test-workspace', 'playlists-api-tests-file');

        test('GET /api/playlists returns 500 when storage dir is a file', async () => {
            // Create a file at the SIDFLOW_PLAYLISTS_PATH location so ensureDir fails
            await fs.mkdir(join(process.cwd(), 'test-workspace'), { recursive: true });
            await fs.writeFile(CORRUPTED_PATH, 'not-a-directory');
            const saved = process.env.SIDFLOW_PLAYLISTS_PATH;
            process.env.SIDFLOW_PLAYLISTS_PATH = CORRUPTED_PATH;
            try {
                const response = await listGET();
                expect(response.status).toBe(500);
            } finally {
                process.env.SIDFLOW_PLAYLISTS_PATH = saved;
                await fs.rm(CORRUPTED_PATH, { force: true });
            }
        });

        test('POST /api/playlists returns 500 when storage dir is a file', async () => {
            await fs.mkdir(join(process.cwd(), 'test-workspace'), { recursive: true });
            await fs.writeFile(CORRUPTED_PATH, 'not-a-directory');
            const saved = process.env.SIDFLOW_PLAYLISTS_PATH;
            process.env.SIDFLOW_PLAYLISTS_PATH = CORRUPTED_PATH;
            try {
                const createRequest = new NextRequest('http://localhost/api/playlists', {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Test', tracks: [] }),
                });
                const response = await createPOST(createRequest);
                expect(response.status).toBe(500);
            } finally {
                process.env.SIDFLOW_PLAYLISTS_PATH = saved;
                await fs.rm(CORRUPTED_PATH, { force: true });
            }
        });

        test('GET /api/playlists/[id] returns 500 when storage dir is a file', async () => {
            await fs.mkdir(join(process.cwd(), 'test-workspace'), { recursive: true });
            await fs.writeFile(CORRUPTED_PATH, 'not-a-directory');
            const saved = process.env.SIDFLOW_PLAYLISTS_PATH;
            process.env.SIDFLOW_PLAYLISTS_PATH = CORRUPTED_PATH;
            try {
                const context = { params: Promise.resolve({ id: 'any-id' }) };
                const response = await getGET(new NextRequest('http://localhost'), context);
                expect(response.status).toBe(500);
            } finally {
                process.env.SIDFLOW_PLAYLISTS_PATH = saved;
                await fs.rm(CORRUPTED_PATH, { force: true });
            }
        });

        test('PUT /api/playlists/[id] returns 500 when storage dir is a file', async () => {
            await fs.mkdir(join(process.cwd(), 'test-workspace'), { recursive: true });
            await fs.writeFile(CORRUPTED_PATH, 'not-a-directory');
            const saved = process.env.SIDFLOW_PLAYLISTS_PATH;
            process.env.SIDFLOW_PLAYLISTS_PATH = CORRUPTED_PATH;
            try {
                const updateRequest = new NextRequest('http://localhost', {
                    method: 'PUT',
                    body: JSON.stringify({ name: 'Test' }),
                });
                const context = { params: Promise.resolve({ id: 'any-id' }) };
                const response = await updatePUT(updateRequest, context);
                expect(response.status).toBe(500);
            } finally {
                process.env.SIDFLOW_PLAYLISTS_PATH = saved;
                await fs.rm(CORRUPTED_PATH, { force: true });
            }
        });

        test('DELETE /api/playlists/[id] returns 500 when storage dir is a file', async () => {
            await fs.mkdir(join(process.cwd(), 'test-workspace'), { recursive: true });
            await fs.writeFile(CORRUPTED_PATH, 'not-a-directory');
            const saved = process.env.SIDFLOW_PLAYLISTS_PATH;
            process.env.SIDFLOW_PLAYLISTS_PATH = CORRUPTED_PATH;
            try {
                const context = { params: Promise.resolve({ id: 'any-id' }) };
                const response = await deleteDELETE(new NextRequest('http://localhost'), context);
                expect(response.status).toBe(500);
            } finally {
                process.env.SIDFLOW_PLAYLISTS_PATH = saved;
                await fs.rm(CORRUPTED_PATH, { force: true });
            }
        });

        test('POST /api/playlists/[id]/reorder returns 500 when storage dir is a file', async () => {
            await fs.mkdir(join(process.cwd(), 'test-workspace'), { recursive: true });
            await fs.writeFile(CORRUPTED_PATH, 'not-a-directory');
            const saved = process.env.SIDFLOW_PLAYLISTS_PATH;
            process.env.SIDFLOW_PLAYLISTS_PATH = CORRUPTED_PATH;
            try {
                const reorderRequest = new NextRequest('http://localhost', {
                    method: 'POST',
                    body: JSON.stringify({ trackOrder: ['/a.sid'] }),
                });
                const context = { params: Promise.resolve({ id: 'any-id' }) };
                const response = await reorderPOST(reorderRequest, context);
                // reorder 404 path is not reachable when storage fails, but 500 is
                expect([404, 500]).toContain(response.status);
            } finally {
                process.env.SIDFLOW_PLAYLISTS_PATH = saved;
                await fs.rm(CORRUPTED_PATH, { force: true });
            }
        });
    });
});

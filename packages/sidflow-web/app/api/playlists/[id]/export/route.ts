/**
 * M3U Export endpoint for playlists
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPlaylist } from '@/lib/server/playlist-storage';

export async function GET(
    request: NextRequest,
    context: Promise<{ params: { id: string } }>
): Promise<NextResponse> {
    const { params } = await context;
    const { id } = params;

    try {
        const playlist = await getPlaylist(id);

        if (!playlist) {
            return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });
        }

        // Generate M3U content
        const m3uLines = ['#EXTM3U'];
        m3uLines.push(`#PLAYLIST:${playlist.name}`);

        for (const track of playlist.tracks) {
            // Add extended info if available
            const duration = track.lengthSeconds ?? 180; // Default to 3 minutes if unknown
            const title = track.title || track.sidPath.split('/').pop()?.replace('.sid', '') || 'Unknown';
            const artist = track.artist || 'Unknown';

            m3uLines.push(`#EXTINF:${duration},${artist} - ${title}`);
            m3uLines.push(track.sidPath);
        }

        const m3uContent = m3uLines.join('\n') + '\n';

        // Return as downloadable file
        return new NextResponse(m3uContent, {
            status: 200,
            headers: {
                'Content-Type': 'audio/x-mpegurl',
                'Content-Disposition': `attachment; filename="${playlist.name.replace(/[^a-z0-9]/gi, '_')}.m3u"`,
                'Cache-Control': 'no-cache',
            },
        });
    } catch (error) {
        console.error('Error exporting playlist:', error);
        return NextResponse.json(
            { error: 'Failed to export playlist' },
            { status: 500 }
        );
    }
}

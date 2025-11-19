/**
 * PlaylistBrowser - Browse and manage saved playlists
 */

'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { List, Play, Trash2, Clock, Music } from 'lucide-react';
import { listPlaylists, deletePlaylist } from '@/lib/api-client';
import type { Playlist } from '@/lib/types/playlist';

interface PlaylistBrowserProps {
    onLoadPlaylist?: (playlist: Playlist) => void;
}

function formatDuration(seconds: number | undefined): string {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDate(isoString: string): string {
    return new Date(isoString).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

export function PlaylistBrowser({ onLoadPlaylist }: PlaylistBrowserProps) {
    const [open, setOpen] = useState(false);
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadPlaylists = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await listPlaylists();
            if (response.error) {
                setError(response.error);
            } else {
                setPlaylists(response.playlists || []);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load playlists');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) {
            void loadPlaylists();
        }
    }, [open]);

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`Delete playlist "${name}"?`)) {
            return;
        }

        try {
            await deletePlaylist(id);
            setPlaylists(playlists.filter((p) => p.id !== id));
        } catch (err) {
            alert(`Failed to delete playlist: ${err instanceof Error ? err.message : String(err)}`);
        }
    };

    const handleLoadPlaylist = (playlist: Playlist) => {
        onLoadPlaylist?.(playlist);
        setOpen(false);
    };

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button variant="outline" size="sm">
                    <List className="h-4 w-4 mr-2" />
                    Playlists
                </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[400px] sm:w-[540px]">
                <SheetHeader>
                    <SheetTitle>My Playlists</SheetTitle>
                    <SheetDescription>
                        Browse and load your saved playlists
                    </SheetDescription>
                </SheetHeader>
                <div className="mt-4 h-full">
                    {loading && (
                        <div className="text-center py-8 text-muted-foreground">
                            Loading playlists...
                        </div>
                    )}
                    {error && (
                        <div className="text-center py-8 text-destructive">
                            {error}
                        </div>
                    )}
                    {!loading && !error && playlists.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground">
                            <Music className="h-12 w-12 mx-auto mb-2 opacity-50" />
                            <p>No playlists yet</p>
                            <p className="text-sm mt-1">Save your current queue to create a playlist</p>
                        </div>
                    )}
                    {!loading && !error && playlists.length > 0 && (
                        <ScrollArea className="h-[calc(100vh-200px)]">
                            <div className="space-y-3 pr-4">
                                {playlists.map((playlist) => (
                                    <div
                                        key={playlist.id}
                                        className="border rounded-lg p-4 space-y-2 hover:border-primary transition-colors"
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1 min-w-0">
                                                <h3 className="font-semibold text-lg truncate">
                                                    {playlist.name}
                                                </h3>
                                                {playlist.description && (
                                                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                                        {playlist.description}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                            <span className="flex items-center gap-1">
                                                <Music className="h-3 w-3" />
                                                {playlist.trackCount} tracks
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Clock className="h-3 w-3" />
                                                {formatDuration(playlist.totalDuration)}
                                            </span>
                                            <span className="ml-auto">
                                                {formatDate(playlist.updatedAt)}
                                            </span>
                                        </div>
                                        <div className="flex gap-2 pt-2">
                                            <Button
                                                size="sm"
                                                onClick={() => handleLoadPlaylist(playlist)}
                                                className="flex-1"
                                            >
                                                <Play className="h-3 w-3 mr-1" />
                                                Load
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleDelete(playlist.id, playlist.name)}
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}

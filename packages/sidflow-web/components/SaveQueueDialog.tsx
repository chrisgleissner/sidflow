/**
 * SaveQueueDialog - Dialog for saving current queue as a playlist
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Save, Loader2 } from 'lucide-react';
import { createPlaylist } from '@/lib/api-client';
import type { PlaylistTrack } from '@/components/play-tab-helpers';

interface SaveQueueDialogProps {
    currentQueue: PlaylistTrack[];
    onSaved?: (playlistId: string) => void;
}

export function SaveQueueDialog({ currentQueue, onSaved }: SaveQueueDialogProps) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        if (!name.trim()) {
            setError('Playlist name is required');
            return;
        }

        if (currentQueue.length === 0) {
            setError('Queue is empty');
            return;
        }

        setSaving(true);
        setError(null);

        try {
            const tracks = currentQueue.map((track) => ({
                sidPath: track.sidPath,
                title: track.metadata.title || track.displayName,
                artist: track.metadata.author,
                year: undefined, // Not available in RateTrackInfo.metadata
                game: undefined, // Not available in RateTrackInfo.metadata
                lengthSeconds: track.durationSeconds,
            }));

            const response = await createPlaylist(name.trim(), description.trim() || undefined, tracks);

            if (response.error) {
                setError(response.error);
                setSaving(false);
                return;
            }

            // Success
            onSaved?.(response.playlist.id);
            setOpen(false);
            setName('');
            setDescription('');
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save playlist');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={currentQueue.length === 0}>
                    <Save className="h-4 w-4 mr-2" />
                    Save Queue
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Save Current Queue</DialogTitle>
                    <DialogDescription>
                        Save the current queue ({currentQueue.length} tracks) as a playlist.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="playlist-name">Playlist Name *</Label>
                        <Input
                            id="playlist-name"
                            placeholder="My Awesome Playlist"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={saving}
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="playlist-description">Description (optional)</Label>
                        <Textarea
                            id="playlist-description"
                            placeholder="A collection of my favorite SID tunes..."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            disabled={saving}
                            rows={3}
                        />
                    </div>
                    {error && (
                        <div className="text-sm text-destructive">
                            {error}
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={saving || !name.trim()}>
                        {saving ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Saving...
                            </>
                        ) : (
                            <>
                                <Save className="h-4 w-4 mr-2" />
                                Save Playlist
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { User, Search, Loader2, Calendar, Music, Heart } from 'lucide-react';

interface UserProfile {
    user: {
        id: string;
        username: string;
        createdAt: string;
    };
    stats: {
        totalPlays: number;
        totalLikes: number;
        joinedAt: string;
    };
}

interface ProfileTabProps {
    onStatusChange?: (status: string, isError?: boolean) => void;
}

export function ProfileTab({ onStatusChange }: ProfileTabProps) {
    const [username, setUsername] = useState('');
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadProfile = async (searchUsername: string) => {
        if (!searchUsername.trim()) {
            setError('Please enter a username');
            return;
        }

        setIsLoading(true);
        setError(null);
        setProfile(null);

        try {
            const response = await fetch(`/api/users/${encodeURIComponent(searchUsername.trim())}`);
            const data = await response.json();

            if (data.success) {
                setProfile(data.data);
                onStatusChange?.(`Loaded profile for ${searchUsername}`, false);
            } else {
                setError(data.error || 'User not found');
                onStatusChange?.(data.error || 'User not found', true);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Network error';
            setError(message);
            onStatusChange?.(message, true);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        void loadProfile(username);
    };

    const formatDate = (dateString: string) => {
        try {
            return new Date(dateString).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            });
        } catch {
            return dateString;
        }
    };

    return (
        <Card className="c64-border">
            <CardHeader>
                <div className="flex items-center gap-2">
                    <User className="h-5 w-5" />
                    <CardTitle>USER PROFILES</CardTitle>
                </div>
                <CardDescription>
                    View user stats recorded on this server
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="flex gap-2">
                        <Input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Enter username to view profile"
                            disabled={isLoading}
                        />
                        <Button type="submit" disabled={isLoading}>
                            {isLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <>
                                    <Search className="h-4 w-4 mr-2" />
                                    Search
                                </>
                            )}
                        </Button>
                    </div>
                </form>

                {error && (
                    <div className="mt-6 text-center py-8 text-destructive">
                        <p>{error}</p>
                    </div>
                )}

                {profile && (
                    <div className="mt-6 space-y-6">
                        <div className="flex items-center gap-4 p-4 bg-accent/20 rounded-lg">
                            <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
                                <User className="h-8 w-8" />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold">{profile.user.username}</h3>
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Calendar className="h-3 w-3" />
                                    <span>Joined {formatDate(profile.stats.joinedAt)}</span>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Card>
                                <CardHeader className="pb-3">
                                    <div className="flex items-center gap-2">
                                        <Music className="h-4 w-4 text-blue-500" />
                                        <CardTitle className="text-sm">Total Plays</CardTitle>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-3xl font-bold">{profile.stats.totalPlays}</p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="pb-3">
                                    <div className="flex items-center gap-2">
                                        <Heart className="h-4 w-4 text-red-500" />
                                        <CardTitle className="text-sm">Total Likes</CardTitle>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-3xl font-bold">{profile.stats.totalLikes}</p>
                                </CardContent>
                            </Card>
                        </div>

                        {profile.stats.totalPlays === 0 && profile.stats.totalLikes === 0 && (
                            <div className="text-center py-4 text-muted-foreground">
                                <p>This user hasn't played any tracks yet</p>
                            </div>
                        )}
                    </div>
                )}

                {!profile && !error && !isLoading && (
                    <div className="mt-6 text-center py-8 text-muted-foreground">
                        <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>Enter a username to view their profile</p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

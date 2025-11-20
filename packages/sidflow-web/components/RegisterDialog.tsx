'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { UserPlus, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

interface RegisterDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSwitchToLogin?: () => void;
}

export function RegisterDialog({ open, onOpenChange, onSwitchToLogin }: RegisterDialogProps) {
    const { register } = useAuth();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        // Validation
        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
            setError('Username must be 3-20 characters (letters, numbers, underscore, hyphen only)');
            return;
        }

        setIsLoading(true);

        const result = await register(username, password);

        if (result.success) {
            setUsername('');
            setPassword('');
            setConfirmPassword('');
            setError(null);
            onOpenChange(false);
        } else {
            setError(result.error || 'Registration failed');
        }

        setIsLoading(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create SIDFlow Account</DialogTitle>
                    <DialogDescription>
                        Join the community to save favorites, create playlists, and more
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && (
                        <Alert variant="destructive">
                            {error}
                        </Alert>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="register-username">Username</Label>
                        <Input
                            id="register-username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Choose a username"
                            disabled={isLoading}
                            required
                        />
                        <p className="text-xs text-muted-foreground">
                            3-20 characters, letters, numbers, underscore, or hyphen
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="register-password">Password</Label>
                        <Input
                            id="register-password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter password"
                            disabled={isLoading}
                            required
                        />
                        <p className="text-xs text-muted-foreground">
                            At least 8 characters
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="register-confirm">Confirm Password</Label>
                        <Input
                            id="register-confirm"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Confirm password"
                            disabled={isLoading}
                            required
                        />
                    </div>

                    <div className="flex justify-between items-center gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={onSwitchToLogin}
                            disabled={isLoading}
                        >
                            Have an account?
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Creating...
                                </>
                            ) : (
                                <>
                                    <UserPlus className="mr-2 h-4 w-4" />
                                    Create Account
                                </>
                            )}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

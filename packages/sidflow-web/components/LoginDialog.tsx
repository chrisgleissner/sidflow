'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { LogIn, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

interface LoginDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSwitchToRegister?: () => void;
}

export function LoginDialog({ open, onOpenChange, onSwitchToRegister }: LoginDialogProps) {
    const { login } = useAuth();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        const result = await login(username, password);

        if (result.success) {
            setUsername('');
            setPassword('');
            setError(null);
            onOpenChange(false);
        } else {
            setError(result.error || 'Login failed');
        }

        setIsLoading(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Login to SIDFlow</DialogTitle>
                    <DialogDescription>
                        Enter your credentials to access your account
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && (
                        <Alert variant="destructive">
                            {error}
                        </Alert>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="login-username">Username</Label>
                        <Input
                            id="login-username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Enter username"
                            disabled={isLoading}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="login-password">Password</Label>
                        <Input
                            id="login-password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter password"
                            disabled={isLoading}
                            required
                        />
                    </div>

                    <div className="flex justify-between items-center gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={onSwitchToRegister}
                            disabled={isLoading}
                        >
                            Need an account?
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Logging in...
                                </>
                            ) : (
                                <>
                                    <LogIn className="mr-2 h-4 w-4" />
                                    Login
                                </>
                            )}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

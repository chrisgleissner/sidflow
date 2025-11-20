'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { User, LogOut, LogIn, UserPlus } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { LoginDialog } from './LoginDialog';
import { RegisterDialog } from './RegisterDialog';

export function UserMenu() {
    const { user, logout, isLoading } = useAuth();
    const [showLogin, setShowLogin] = useState(false);
    const [showRegister, setShowRegister] = useState(false);

    const handleLogout = async () => {
        await logout();
    };

    const switchToRegister = () => {
        setShowLogin(false);
        setShowRegister(true);
    };

    const switchToLogin = () => {
        setShowRegister(false);
        setShowLogin(true);
    };

    if (isLoading) {
        return null;
    }

    if (user) {
        return (
            <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 text-sm">
                    <User className="h-4 w-4" />
                    <span className="hidden sm:inline">{user.username}</span>
                </div>
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleLogout}
                    title="Logout"
                >
                    <LogOut className="h-4 w-4" />
                </Button>
            </div>
        );
    }

    return (
        <>
            <div className="flex items-center gap-2">
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowLogin(true)}
                    aria-label="Log in"
                    data-testid="user-menu-login"
                >
                    <LogIn className="h-4 w-4 mr-1" />
                    <span className="hidden sm:inline">Login</span>
                </Button>
                <Button
                    size="sm"
                    variant="default"
                    onClick={() => setShowRegister(true)}
                    aria-label="Sign up"
                    data-testid="user-menu-signup"
                >
                    <UserPlus className="h-4 w-4 mr-1" />
                    <span className="hidden sm:inline">Sign Up</span>
                </Button>
            </div>

            <LoginDialog
                open={showLogin}
                onOpenChange={setShowLogin}
                onSwitchToRegister={switchToRegister}
            />
            <RegisterDialog
                open={showRegister}
                onOpenChange={setShowRegister}
                onSwitchToLogin={switchToLogin}
            />
        </>
    );
}

'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface PrefsTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
}

const COLOR_SCHEMES = [
  { value: 'c64-light', label: 'C64 Light Blue', description: 'Authentic C64 light blue background' },
  { value: 'c64-dark', label: 'C64 Dark Mode', description: 'Black background with C64 colors' },
  { value: 'classic', label: 'Classic Purple', description: 'Original purple theme' },
  { value: 'system', label: 'System Default', description: 'Follow system preferences' },
];

const FONT_SCHEMES = [
  { value: 'c64', label: 'C64 Font', description: 'Press Start 2P (C64-style)' },
  { value: 'mono', label: 'Monospace', description: 'Courier New' },
  { value: 'sans', label: 'Sans Serif', description: 'Arial / Helvetica' },
];

export function PrefsTab({ onStatusChange }: PrefsTabProps) {
  const [colorScheme, setColorScheme] = useState('system');
  const [fontScheme, setFontScheme] = useState('mono');

  // Load preferences from localStorage on mount
  useEffect(() => {
    const savedColor = localStorage.getItem('sidflow-color-scheme') || 'system';
    const savedFont = localStorage.getItem('sidflow-font-scheme') || 'mono';
    
    setColorScheme(savedColor);
    setFontScheme(savedFont);
    
    applyTheme(savedColor, savedFont);
  }, []);

  const applyTheme = (color: string, font: string) => {
    const html = document.documentElement;
    
    // Apply color scheme
    if (color === 'system') {
      html.removeAttribute('data-theme');
    } else {
      html.setAttribute('data-theme', color);
    }
    
    // Apply font scheme
    html.classList.remove('font-c64', 'font-mono', 'font-sans');
    html.classList.add(`font-${font}`);
  };

  const handleColorChange = (value: string) => {
    setColorScheme(value);
    localStorage.setItem('sidflow-color-scheme', value);
    applyTheme(value, fontScheme);
    onStatusChange(`Color scheme changed to: ${COLOR_SCHEMES.find(s => s.value === value)?.label}`);
  };

  const handleFontChange = (value: string) => {
    setFontScheme(value);
    localStorage.setItem('sidflow-font-scheme', value);
    applyTheme(colorScheme, value);
    onStatusChange(`Font changed to: ${FONT_SCHEMES.find(s => s.value === value)?.label}`);
  };

  return (
    <div className="space-y-6">
      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">PREFERENCES</CardTitle>
          <CardDescription className="text-muted-foreground">
            Customize your SIDFlow experience
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <label htmlFor="color-scheme" className="text-sm font-medium block">
              COLOR SCHEME
            </label>
            <Select value={colorScheme} onValueChange={handleColorChange}>
              <SelectTrigger id="color-scheme">
                <SelectValue placeholder="Select color scheme" />
              </SelectTrigger>
              <SelectContent>
                {COLOR_SCHEMES.map((scheme) => (
                  <SelectItem key={scheme.value} value={scheme.value}>
                    <div>
                      <div className="font-bold">{scheme.label}</div>
                      <div className="text-xs text-muted-foreground">{scheme.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Choose your preferred color palette. System Default follows your OS theme settings.
            </p>
          </div>

          <div className="space-y-3">
            <label htmlFor="font-scheme" className="text-sm font-medium block">
              FONT FAMILY
            </label>
            <Select value={fontScheme} onValueChange={handleFontChange}>
              <SelectTrigger id="font-scheme">
                <SelectValue placeholder="Select font family" />
              </SelectTrigger>
              <SelectContent>
                {FONT_SCHEMES.map((scheme) => (
                  <SelectItem key={scheme.value} value={scheme.value}>
                    <div>
                      <div className="font-bold">{scheme.label}</div>
                      <div className="text-xs text-muted-foreground">{scheme.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              C64 Font provides an authentic retro experience with the Press Start 2P typeface.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="text-sm petscii-text text-accent">COLOR SCHEME PREVIEW</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="h-12 rounded border-2 border-border bg-background" />
              <p className="text-xs text-center">Background</p>
            </div>
            <div className="space-y-2">
              <div className="h-12 rounded border-2 border-border bg-foreground" />
              <p className="text-xs text-center">Foreground</p>
            </div>
            <div className="space-y-2">
              <div className="h-12 rounded border-2 border-border bg-primary" />
              <p className="text-xs text-center">Primary</p>
            </div>
            <div className="space-y-2">
              <div className="h-12 rounded border-2 border-border bg-accent" />
              <p className="text-xs text-center">Accent</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="text-sm petscii-text text-accent">ABOUT SETTINGS</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-xs">
            <p>
              Your preferences are stored in your browser's local storage and will persist across sessions.
            </p>
            <p>
              Settings are per-browser and per-device. Use the same browser to maintain your preferences.
            </p>
            <p className="text-muted-foreground">
              Note: Preferences are not synced between different browsers or devices.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

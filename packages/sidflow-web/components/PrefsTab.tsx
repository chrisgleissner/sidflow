'use client';

import { useState, useEffect, useCallback, useRef, type ChangeEvent } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  getPreferences,
  updatePreferences,
  listHvscFolders,
  type FolderListing,
  type PreferencesPayload,
} from '@/lib/api-client';
import { formatApiError } from '@/lib/format-error';
import { FolderOpen } from 'lucide-react';

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
  const [prefsInfo, setPrefsInfo] = useState<PreferencesPayload | null>(null);
  const [folderListing, setFolderListing] = useState<FolderListing | null>(null);
  const [customPath, setCustomPath] = useState('');
  const [kernalPath, setKernalPath] = useState('');
  const [basicPath, setBasicPath] = useState('');
  const [isSavingCollection, setIsSavingCollection] = useState(false);
  const [isSavingRom, setIsSavingRom] = useState(false);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const kernalFileInputRef = useRef<HTMLInputElement | null>(null);
  const basicFileInputRef = useRef<HTMLInputElement | null>(null);

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

  const loadPreferences = useCallback(async () => {
    const response = await getPreferences();
    if (response.success) {
      setPrefsInfo(response.data);
      setCustomPath(response.data.preferences.sidBasePath ?? '');
      setKernalPath(
        response.data.preferences.kernalRomPath ??
          response.data.sidplayfpConfig.kernalRomPath ??
          ''
      );
      setBasicPath(
        response.data.preferences.basicRomPath ??
          response.data.sidplayfpConfig.basicRomPath ??
          ''
      );
    } else {
      onStatusChange(`Failed to load preferences: ${formatApiError(response)}`, true);
    }
  }, [onStatusChange]);

  const loadFolders = useCallback(
    async (relative: string) => {
      setIsLoadingFolders(true);
      setFolderError(null);
      try {
        const response = await listHvscFolders(relative);
        if (response.success) {
          setFolderListing(response.data);
        } else {
          const message = formatApiError(response);
          setFolderError(message);
          onStatusChange(`Unable to list folders: ${message}`, true);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFolderError(message);
        onStatusChange(`Unable to list folders: ${message}`, true);
      } finally {
        setIsLoadingFolders(false);
      }
    },
    [onStatusChange]
  );

  const refreshPreferences = useCallback(async () => {
    await loadPreferences();
    await loadFolders('');
  }, [loadPreferences, loadFolders]);

  useEffect(() => {
    void refreshPreferences();
  }, [refreshPreferences]);

  const saveCollectionPath = useCallback(
    async (nextPath: string | null) => {
      setIsSavingCollection(true);
      try {
        const response = await updatePreferences({ sidBasePath: nextPath });
        if (response.success) {
          setPrefsInfo(response.data);
          setCustomPath(response.data.preferences.sidBasePath ?? '');
          onStatusChange(
            nextPath
              ? `Using SID subset at ${response.data.activeCollectionPath}`
              : 'SID collection reset to HVSC default'
          );
        } else {
          onStatusChange(`Unable to save preference: ${formatApiError(response)}`, true);
        }
      } catch (error) {
        onStatusChange(
          `Unable to save preference: ${error instanceof Error ? error.message : String(error)}`,
          true
        );
      } finally {
        setIsSavingCollection(false);
      }
    },
    [onStatusChange]
  );

  const saveRomPath = useCallback(
    async (key: 'kernal' | 'basic', rawValue: string | null) => {
      setIsSavingRom(true);
      const trimmed = rawValue?.trim() ?? '';
      const normalized = trimmed.length > 0 ? trimmed : null;
      const payload =
        key === 'kernal' ? { kernalRomPath: normalized } : { basicRomPath: normalized };
      try {
        const response = await updatePreferences(payload);
        if (response.success) {
          setPrefsInfo(response.data);
          setKernalPath(
            response.data.preferences.kernalRomPath ?? response.data.sidplayfpConfig.kernalRomPath ?? ''
          );
          setBasicPath(
            response.data.preferences.basicRomPath ?? response.data.sidplayfpConfig.basicRomPath ?? ''
          );
          const label = key === 'kernal' ? 'KERNAL' : 'BASIC';
          const message = normalized
            ? `${label} ROM path set to ${normalized}`
            : `${label} ROM path cleared`;
          onStatusChange(message);
        } else {
          onStatusChange(`Unable to save ROM path: ${formatApiError(response)}`, true);
        }
      } catch (error) {
        onStatusChange(
          `Unable to save ROM path: ${error instanceof Error ? error.message : String(error)}`,
          true
        );
      } finally {
        setIsSavingRom(false);
      }
    },
    [onStatusChange]
  );

  const handleUseFolder = useCallback(async () => {
    if (!folderListing) {
      return;
    }
    await saveCollectionPath(folderListing.absolutePath);
  }, [folderListing, saveCollectionPath]);

  const handleFolderUp = useCallback(() => {
    if (!folderListing) {
      return;
    }
    const parts = folderListing.relativePath.split('/').filter(Boolean);
    if (parts.length === 0) {
      void loadFolders('');
      return;
    }
    parts.pop();
    void loadFolders(parts.join('/'));
  }, [folderListing, loadFolders]);

  const handleResetCollection = useCallback(async () => {
    await saveCollectionPath(null);
  }, [saveCollectionPath]);

  const handleCustomPathSave = useCallback(async () => {
    const value = customPath.trim();
    await saveCollectionPath(value.length > 0 ? value : null);
  }, [customPath, saveCollectionPath]);

  const handleBrowseFile = useCallback((kind: 'kernal' | 'basic') => {
    const target = kind === 'kernal' ? kernalFileInputRef.current : basicFileInputRef.current;
    target?.click();
  }, []);

  const handleFileSelected = useCallback(
    (kind: 'kernal' | 'basic', event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const [file] = input.files ?? [];
      const withPath = file as File & { path?: string; webkitRelativePath?: string };

      const resolvedPath =
        (withPath && (withPath.path || withPath.webkitRelativePath || withPath.name)) ||
        input.value ||
        '';

      if (kind === 'kernal') {
        setKernalPath(resolvedPath);
      } else {
        setBasicPath(resolvedPath);
      }

      input.value = '';
    },
    []
  );

  return (
    <div className="space-y-6">
      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">SID COLLECTION</CardTitle>
          <CardDescription className="text-muted-foreground">
            Limit playback, rating, training, and classification to a specific folder.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="space-y-1">
            <p className="font-semibold text-foreground">
              Active collection:{' '}
              <span className="font-mono text-xs">{prefsInfo?.activeCollectionPath ?? '…'}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {prefsInfo?.preferenceSource === 'custom'
                ? 'Using a custom subset.'
                : 'Using the full HVSC mirror.'}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Browse HVSC folders</p>
            {folderListing ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-muted-foreground">
                  <span className="truncate">
                    {folderListing.absolutePath}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleFolderUp}
                      disabled={folderListing.relativePath.length === 0 || isLoadingFolders}
                    >
                      Up
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => loadFolders('')}
                      disabled={isLoadingFolders}
                    >
                      Root
                    </Button>
                  </div>
                </div>
                {folderError && (
                  <p className="text-xs text-destructive">{folderError}</p>
                )}
                <div className="rounded border border-border/60 bg-muted/30 p-2">
                  {folderListing.entries.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No subfolders.</p>
                  ) : (
                    <div className="grid gap-1">
                      {folderListing.entries.map((entry) => (
                        <button
                          key={entry.path}
                          type="button"
                          onClick={() => loadFolders(entry.path)}
                          className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-background/70 text-foreground"
                          disabled={isLoadingFolders}
                        >
                          <span className="font-mono">{entry.name}</span>
                          {entry.hasChildren && <span className="text-muted-foreground">›</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  onClick={handleUseFolder}
                  disabled={isSavingCollection || !folderListing}
                  className="w-full"
                >
                  Use This Folder
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Loading folder tree…</p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Custom path</p>
            <div className="flex flex-col gap-2 md:flex-row">
              <Input
                value={customPath}
                onChange={(event) => setCustomPath(event.target.value)}
                placeholder="Enter absolute path"
              />
              <Button
                variant="secondary"
                onClick={handleCustomPathSave}
                disabled={isSavingCollection}
              >
                Apply
              </Button>
              <Button
                variant="outline"
                onClick={handleResetCollection}
                disabled={isSavingCollection}
              >
                Reset
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter an absolute path to any SID directory. Reset to go back to the default HVSC
              mirror.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">SIDPLAY ROMS</CardTitle>
          <CardDescription className="text-muted-foreground">
            Point sidplayfp to the correct KERNAL and BASIC ROM dumps.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <input
            ref={kernalFileInputRef}
            type="file"
            className="hidden"
            onChange={(event) => handleFileSelected('kernal', event)}
          />
          <input
            ref={basicFileInputRef}
            type="file"
            className="hidden"
            onChange={(event) => handleFileSelected('basic', event)}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">KERNAL ROM</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-center gap-2">
                  <Input
                    value={kernalPath}
                    onChange={(event) => setKernalPath(event.target.value)}
                    placeholder="/path/to/kernal"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Browse for KERNAL ROM"
                    onClick={() => handleBrowseFile('kernal')}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => saveRomPath('kernal', kernalPath)}
                  disabled={isSavingRom}
                >
                  Save
                </Button>
                <Button
                  variant="outline"
                  onClick={() => saveRomPath('kernal', null)}
                  disabled={isSavingRom}
                >
                  Clear
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">BASIC ROM</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-center gap-2">
                  <Input
                    value={basicPath}
                    onChange={(event) => setBasicPath(event.target.value)}
                    placeholder="/path/to/basic"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Browse for BASIC ROM"
                    onClick={() => handleBrowseFile('basic')}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => saveRomPath('basic', basicPath)}
                  disabled={isSavingRom}
                >
                  Save
                </Button>
                <Button
                  variant="outline"
                  onClick={() => saveRomPath('basic', null)}
                  disabled={isSavingRom}
                >
                  Clear
                </Button>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">
              Config file:{' '}
              <span className="font-mono text-foreground">
                {prefsInfo?.sidplayfpConfig.path ?? 'Not detected'}
              </span>
            </p>
            {!prefsInfo?.sidplayfpConfig.exists && (
              <p className="text-xs text-muted-foreground">
                The file will be created automatically the next time you save a ROM path.
              </p>
            )}
            <textarea
              readOnly
              value={
                prefsInfo?.sidplayfpConfig.contents?.length
                  ? prefsInfo.sidplayfpConfig.contents
                  : '(sidplayfp.ini not found)'
              }
              className="h-48 w-full resize-y rounded border border-border/60 bg-background/70 p-3 font-mono text-xs text-foreground"
            />
          </div>
        </CardContent>
      </Card>

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

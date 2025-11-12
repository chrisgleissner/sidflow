'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { usePreferences } from '@/context/preferences-context';
import { THEME_OPTIONS, FONT_OPTIONS, PLAYBACK_ENGINES, type BrowserPreferences } from '@/lib/preferences/schema';
import { useRomManifest } from '@/lib/preferences/use-rom-manifest';
import type { RomManifestBundle } from '@/lib/preferences/types';
import { installRomBundle } from '@/lib/preferences/rom-installer';

const ROM_ROLES = ['basic', 'kernal', 'chargen'] as const;
type RomRole = (typeof ROM_ROLES)[number];

interface PublicPrefsTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
}

interface AdapterAvailability {
  id: BrowserPreferences['playbackEngine'];
  label: string;
  available: boolean;
  reasons: string[];
  latencyMs?: number;
}

const ADAPTER_LABELS: Record<BrowserPreferences['playbackEngine'], string> = {
  wasm: 'In-browser WASM (default)',
  'sidplayfp-cli': 'sidplayfp CLI (local bridge)',
  'stream-wav': 'Streaming WAV (server cache)',
  'stream-m4a': 'Streaming M4A (server cache)',
  ultimate64: 'Ultimate 64 Hardware',
};

export function PublicPrefsTab({ onStatusChange }: PublicPrefsTabProps) {
  const { status, preferences, updatePreferences } = usePreferences();
  const { status: manifestStatus, manifest, error: manifestError, refresh } = useRomManifest();
  const [isInstallingBundle, setIsInstallingBundle] = useState(false);
  const [adapterAvailability, setAdapterAvailability] = useState<AdapterAvailability[]>([]);
  const [pendingRomFiles, setPendingRomFiles] = useState<Record<string, Partial<Record<RomRole, File>>>>({});

  const canInteract = status === 'ready';

  useEffect(() => {
    const loadAvailability = async () => {
      try {
        const response = await fetch('/api/playback/detect', { headers: { Accept: 'application/json' } });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = (await response.json()) as {
          success: boolean;
          data?: { adapters: Record<string, { available: boolean; reasons?: string[]; latencyMs?: number }> };
          error?: string;
        };
        if (!payload.success || !payload.data) {
          throw new Error(payload.error ?? 'Adapter detection failed');
        }
        const entries: AdapterAvailability[] = PLAYBACK_ENGINES.map((engine) => {
          const record = payload.data!.adapters[engine] ?? { available: false, reasons: ['Unknown adapter'] };
          return {
            id: engine,
            label: ADAPTER_LABELS[engine],
            available: Boolean(record.available),
            reasons: record.reasons ?? [],
            latencyMs: record.latencyMs,
          };
        });
        setAdapterAvailability(entries);
      } catch (error) {
        console.warn('[PublicPrefsTab] Failed to load adapter availability', error);
        setAdapterAvailability(
          PLAYBACK_ENGINES.map((engine) => ({
            id: engine,
            label: ADAPTER_LABELS[engine],
            available: engine === 'wasm',
            reasons: engine === 'wasm' ? [] : ['Detection error'],
          }))
        );
      }
    };
    void loadAvailability();
  }, []);

  const selectedBundle = useMemo(() => {
    if (!manifest) {
      return null;
    }
    return manifest.bundles.find((bundle) => bundle.id === preferences.romBundleId) ?? null;
  }, [manifest, preferences.romBundleId]);

  const handleThemeChange = useCallback(
    async (next: BrowserPreferences['theme']) => {
      await updatePreferences({ theme: next });
      onStatusChange(`Theme updated to ${next}`);
    },
    [onStatusChange, updatePreferences]
  );

  const handleFontChange = useCallback(
    async (next: BrowserPreferences['font']) => {
      await updatePreferences({ font: next });
      onStatusChange(`Font updated to ${next}`);
    },
    [onStatusChange, updatePreferences]
  );

  const handlePlaybackEngineChange = useCallback(
    async (next: BrowserPreferences['playbackEngine']) => {
      await updatePreferences({ playbackEngine: next });
      onStatusChange(`Playback engine set to ${ADAPTER_LABELS[next]}`);
    },
    [onStatusChange, updatePreferences]
  );

  const handleUltimate64Toggle = useCallback(async (enabled: boolean) => {
    if (!enabled) {
      await updatePreferences({ ultimate64: null });
      onStatusChange('Ultimate 64 configuration disabled');
      return;
    }
    const next = preferences.ultimate64 ?? { host: '127.0.0.1', https: false };
    await updatePreferences({ ultimate64: next });
    onStatusChange('Ultimate 64 configuration enabled');
  }, [preferences.ultimate64, onStatusChange, updatePreferences]);

  const handleUltimateField = useCallback(
    async (field: 'host' | 'secretHeader' | 'https', value: string | boolean) => {
      const current = preferences.ultimate64 ?? { host: '127.0.0.1', https: false };
      const next = {
        ...current,
        [field]: field === 'https' ? Boolean(value) : String(value),
      };
      if (typeof next.secretHeader === 'string' && next.secretHeader.trim().length === 0) {
        delete (next as { secretHeader?: string }).secretHeader;
      }
      await updatePreferences({ ultimate64: next });
      onStatusChange('Ultimate 64 preferences updated');
    },
    [preferences.ultimate64, onStatusChange, updatePreferences]
  );

  const handleTrainingToggle = useCallback(
    async (enabled: boolean) => {
      await updatePreferences({
        training: {
          ...preferences.training,
          enabled,
        },
      });
      onStatusChange(enabled ? 'Local training enabled' : 'Local training disabled');
    },
    [preferences.training, onStatusChange, updatePreferences]
  );

  const handleTrainingField = useCallback(
    async (
      field: 'iterationBudget' | 'syncCadenceMinutes' | 'allowUpload',
      value: number | boolean
    ) => {
      await updatePreferences({
        training: {
          ...preferences.training,
          [field]: value,
        },
      });
      onStatusChange('Training preferences updated');
    },
    [preferences.training, onStatusChange, updatePreferences]
  );

  const handleCacheField = useCallback(
    async (field: 'maxEntries' | 'maxBytes' | 'preferOffline', value: number | boolean) => {
      await updatePreferences({
        localCache: {
          ...preferences.localCache,
          [field]: value,
        },
      });
      onStatusChange('Offline cache preferences updated');
    },
    [preferences.localCache, onStatusChange, updatePreferences]
  );

  const handleRomFileSelect = useCallback((bundleId: string, role: RomRole, file: File | null) => {
    setPendingRomFiles((previous) => {
      const next = { ...previous };
      const current = { ...(next[bundleId] ?? {}) };
      if (file) {
        current[role] = file;
      } else {
        delete current[role];
      }
      if (Object.keys(current).length === 0) {
        delete next[bundleId];
      } else {
        next[bundleId] = current;
      }
      return next;
    });
  }, []);

  const handleBundleInstall = useCallback(
    async (bundle: RomManifestBundle) => {
      setIsInstallingBundle(true);
      try {
        const suppliedFiles = pendingRomFiles[bundle.id] ?? {};
        const result = await installRomBundle(bundle, suppliedFiles);
        if (!result.success) {
          const reason = result.error ?? 'Validation failed – double-check supplied ROMs';
          throw new Error(reason);
        }
        await updatePreferences({ romBundleId: bundle.id });
        setPendingRomFiles((previous) => {
          const next = { ...previous };
          delete next[bundle.id];
          return next;
        });
        onStatusChange(`ROM bundle "${bundle.label}" validated and stored locally`);
      } catch (error) {
        onStatusChange(
          `Failed to validate ROM bundle: ${error instanceof Error ? error.message : String(error)}`,
          true
        );
      } finally {
        setIsInstallingBundle(false);
      }
    },
    [onStatusChange, pendingRomFiles, updatePreferences]
  );

  const handleBundleClear = useCallback(async () => {
    await updatePreferences({ romBundleId: null });
    onStatusChange('ROM bundle selection cleared');
  }, [onStatusChange, updatePreferences]);

  const installationStatus = useMemo(() => {
    if (!manifest) {
      return 'loading';
    }
    if (selectedBundle) {
      return 'ready';
    }
    return preferences.romBundleId ? 'unknown' : 'none';
  }, [manifest, selectedBundle, preferences.romBundleId]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Preferences</h2>
        <p className="text-sm text-muted-foreground">
          Personalise playback, offline behaviour, and local training. These settings stay on this device.
        </p>
      </header>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">Theme & Typography</CardTitle>
          <CardDescription>Pick appearance presets applied instantly on this browser.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase">Theme</span>
            <Select
              value={preferences.theme}
              onValueChange={(value) => void handleThemeChange(value as BrowserPreferences['theme'])}
              disabled={!canInteract}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                {THEME_OPTIONS.map((theme) => (
                  <SelectItem key={theme} value={theme} className="capitalize">
                    {theme.replace(/-/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase">Font</span>
            <Select
              value={preferences.font}
              onValueChange={(value) => void handleFontChange(value as BrowserPreferences['font'])}
              disabled={!canInteract}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select font" />
              </SelectTrigger>
              <SelectContent>
                {FONT_OPTIONS.map((font) => (
                  <SelectItem key={font} value={font} className="capitalize">
                    {font}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">Playback Engine</CardTitle>
          <CardDescription>Choose the preferred renderer; SIDFlow falls back automatically when unavailable.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Select
            value={preferences.playbackEngine}
            onValueChange={(value) => void handlePlaybackEngineChange(value as BrowserPreferences['playbackEngine'])}
            disabled={!canInteract}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select engine" />
            </SelectTrigger>
            <SelectContent>
              {adapterAvailability.map((adapter) => (
                <SelectItem
                  key={adapter.id}
                  value={adapter.id}
                  disabled={!adapter.available}
                  className="flex flex-col items-start"
                >
                  <span className="font-semibold">{adapter.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {adapter.available ? 'Available' : adapter.reasons.join(', ') || 'Unavailable'}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            The selected engine is attempted first. If it fails runtime checks, SIDFlow uses the next available option.
          </p>
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">Ultimate 64 Hardware</CardTitle>
          <CardDescription>Optional configuration for dispatching playback to a local Ultimate 64 or C64 Ultimate.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(preferences.ultimate64)}
              onChange={(event) => void handleUltimate64Toggle(event.target.checked)}
            />
            <span>Enable Ultimate 64 integration</span>
          </label>
          {preferences.ultimate64 && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <span className="text-xs uppercase text-muted-foreground">Host</span>
                <Input
                  value={preferences.ultimate64.host}
                  onChange={(event) => void handleUltimateField('host', event.target.value)}
                  placeholder="192.168.0.64"
                />
              </div>
              <div className="grid gap-1">
                <span className="text-xs uppercase text-muted-foreground">Secret Header</span>
                <Input
                  value={preferences.ultimate64.secretHeader ?? ''}
                  onChange={(event) => void handleUltimateField('secretHeader', event.target.value)}
                  placeholder="Optional auth token"
                />
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={preferences.ultimate64.https}
                  onChange={(event) => void handleUltimateField('https', event.target.checked)}
                />
                <span>Use HTTPS</span>
              </label>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">Local Training</CardTitle>
          <CardDescription>Tune on-device model updates without blocking playback.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={preferences.training.enabled}
              onChange={(event) => void handleTrainingToggle(event.target.checked)}
            />
            <span>Enable background training</span>
          </label>
          <div className="grid gap-2 md:grid-cols-3">
            <div className="grid gap-1">
              <span className="text-xs uppercase text-muted-foreground">Iteration Budget</span>
              <Input
                type="number"
                min={1}
                max={10000}
                value={preferences.training.iterationBudget}
                onChange={(event) =>
                  void handleTrainingField('iterationBudget', Number(event.target.value) || 1)
                }
              />
            </div>
            <div className="grid gap-1">
              <span className="text-xs uppercase text-muted-foreground">Sync Every (minutes)</span>
              <Input
                type="number"
                min={5}
                max={1440}
                value={preferences.training.syncCadenceMinutes}
                onChange={(event) =>
                  void handleTrainingField('syncCadenceMinutes', Number(event.target.value) || 5)
                }
              />
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={preferences.training.allowUpload}
                onChange={(event) => void handleTrainingField('allowUpload', event.target.checked)}
              />
              <span>Allow upload of anonymised deltas</span>
            </label>
          </div>
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">Offline Cache</CardTitle>
          <CardDescription>Manage how many sessions are cached locally for offline playback.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="grid gap-1 md:w-64">
            <span className="text-xs uppercase text-muted-foreground">Max Entries</span>
            <Input
              type="number"
              min={0}
              max={500}
              value={preferences.localCache.maxEntries}
              onChange={(event) =>
                void handleCacheField('maxEntries', Number(event.target.value) || 0)
              }
            />
          </div>
          <div className="grid gap-1 md:w-64">
            <span className="text-xs uppercase text-muted-foreground">Max Storage (bytes)</span>
            <Input
              type="number"
              min={0}
              max={512 * 1024 * 1024}
              value={preferences.localCache.maxBytes}
              onChange={(event) =>
                void handleCacheField('maxBytes', Number(event.target.value) || 0)
              }
            />
            <span className="text-[11px] text-muted-foreground">
              Default is 33,554,432 bytes (~32 MB). Increase for larger queues when offline.
            </span>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={preferences.localCache.preferOffline}
              onChange={(event) => void handleCacheField('preferOffline', event.target.checked)}
            />
            <span>Prefer offline playback when cached tracks exist</span>
          </label>
        </CardContent>
      </Card>

      <Card className="c64-border">
        <CardHeader>
          <CardTitle className="petscii-text text-accent">ROM Bundles</CardTitle>
          <CardDescription>
            Validate curated ROM bundles before playback. Supply your own ROM files; SIDFlow never distributes copyrighted assets.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          {manifestStatus === 'loading' && <p className="text-muted-foreground text-sm">Loading manifest…</p>}
          {manifestStatus === 'error' && (
            <div className="space-y-2">
              <p className="text-destructive text-sm">Failed to load manifest: {manifestError}</p>
              <Button variant="outline" size="sm" onClick={() => refresh()}>
                Retry
              </Button>
            </div>
          )}
          {manifestStatus === 'ready' && manifest && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Generated {new Date(manifest.generatedAt).toLocaleString()} · Version {manifest.version}
              </p>
              <div className="grid gap-2">
                {manifest.bundles.map((bundle) => {
                  const isActive = preferences.romBundleId === bundle.id;
                  const pending = pendingRomFiles[bundle.id] ?? {};
                  const fileDescriptors = ROM_ROLES.map((role) => ({
                    role,
                    descriptor: bundle.files[role],
                  }));
                  return (
                    <div
                      key={bundle.id}
                      className={`border border-border/70 rounded-md p-3 flex flex-col gap-3 ${
                        isActive ? 'bg-accent/10' : 'bg-background'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold text-foreground">{bundle.label}</p>
                          <p className="text-xs text-muted-foreground">
                            Default chip: {bundle.defaultChip.toUpperCase()} · Updated {new Date(bundle.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => void handleBundleInstall(bundle)}
                            disabled={
                              isInstallingBundle ||
                              fileDescriptors.some(({ role }) => !pending[role])
                            }
                          >
                            {isActive ? 'Re-Validate' : 'Validate & Select'}
                          </Button>
                          {isActive && (
                            <Button variant="ghost" size="sm" onClick={() => void handleBundleClear()}>
                              Clear
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="grid gap-3">
                        {fileDescriptors.map(({ role, descriptor }) => (
                          <div key={role} className="grid gap-1">
                            <label
                              className="text-xs text-muted-foreground"
                              htmlFor={`${bundle.id}-${role}`}
                            >
                              {role.toUpperCase()} ROM · {descriptor.size} bytes · SHA-256 {descriptor.sha256}
                            </label>
                            <Input
                              id={`${bundle.id}-${role}`}
                              type="file"
                              accept=".bin,.rom,.prg"
                              onChange={(event) => {
                                const file = event.target.files?.[0] ?? null;
                                handleRomFileSelect(bundle.id, role, file);
                              }}
                              disabled={isInstallingBundle}
                            />
                            <p className="text-[11px] text-muted-foreground truncate">
                              {pending[role]?.name ?? 'No file selected'}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {manifest.allowManualSelection && (
                <Button variant="outline" size="sm" onClick={() => void handleBundleClear()}>
                  Use manual ROM paths
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                Status: {installationStatus}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import type { RomManifest } from '@/lib/preferences/types';

export type RomManifestStatus = 'idle' | 'loading' | 'ready' | 'error';

interface RomManifestState {
  status: RomManifestStatus;
  manifest: RomManifest | null;
  error: string | null;
}

export function useRomManifest() {
  const [state, setState] = useState<RomManifestState>({ status: 'idle', manifest: null, error: null });

  const fetchManifest = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    try {
      const response = await fetch('/api/prefs/rom-manifest', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(`Unexpected response: ${response.status}`);
      }
      const payload = (await response.json()) as { success: boolean; data?: RomManifest; error?: string };
      if (!payload.success || !payload.data) {
        throw new Error(payload.error ?? 'Manifest unavailable');
      }
      setState({ status: 'ready', manifest: payload.data, error: null });
    } catch (error) {
      setState({
        status: 'error',
        manifest: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    if (state.status === 'idle') {
      void fetchManifest();
    }
  }, [state.status, fetchManifest]);

  return {
    status: state.status,
    manifest: state.manifest,
    error: state.error,
    refresh: fetchManifest,
    isLoading: state.status === 'loading',
  };
}

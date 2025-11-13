'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_BROWSER_PREFERENCES,
  migratePreferences,
  type BrowserPreferences,
} from '@/lib/preferences/schema';
import {
  clearLocalStoragePreferences,
  readPreferencesFromIndexedDb,
  readPreferencesFromLocalStorage,
  writePreferencesToIndexedDb,
  writePreferencesToLocalStorage,
} from '@/lib/preferences/storage';
import { updateFeedbackRuntimePreferences } from '@/lib/feedback/runtime';

export type PreferencesStatus = 'loading' | 'ready';

interface PreferencesContextValue {
  status: PreferencesStatus;
  preferences: BrowserPreferences;
  updatePreferences: (
    updater:
      | Partial<BrowserPreferences>
      | ((current: BrowserPreferences) => BrowserPreferences | Partial<BrowserPreferences>)
  ) => Promise<void>;
  reload: () => Promise<void>;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function applyTheme(preferences: BrowserPreferences): void {
  if (typeof document === 'undefined') {
    return;
  }
  const html = document.documentElement;

  if (preferences.theme === 'system') {
    html.removeAttribute('data-theme');
  } else {
    html.setAttribute('data-theme', preferences.theme);
  }

  html.classList.remove('font-c64', 'font-mono', 'font-sans');
  html.classList.add(`font-${preferences.font}`);
}

function mergePreferences(
  current: BrowserPreferences,
  update:
    | Partial<BrowserPreferences>
    | ((existing: BrowserPreferences) => BrowserPreferences | Partial<BrowserPreferences>)
): BrowserPreferences {
  const nextPatch = typeof update === 'function' ? update(current) : update;
  const merged = {
    ...current,
    ...(nextPatch ?? {}),
  } as BrowserPreferences;
  merged.version = DEFAULT_BROWSER_PREFERENCES.version;
  merged.migratedFrom = current.migratedFrom ?? merged.migratedFrom ?? null;
  return merged;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PreferencesStatus>('loading');
  const [preferences, setPreferences] = useState<BrowserPreferences>(DEFAULT_BROWSER_PREFERENCES);
  const bootstrapRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const writeAll = useCallback(async (next: BrowserPreferences) => {
    writePreferencesToLocalStorage(next);
    try {
      await writePreferencesToIndexedDb(next);
    } catch (error) {
      console.warn('[PreferencesProvider] Failed to persist to IndexedDB', error);
    }
  }, []);

  const load = useCallback(async () => {
    if (bootstrapRef.current) {
      await bootstrapRef.current;
      return;
    }

    const task = (async () => {
      const localRaw = readPreferencesFromLocalStorage();
      const localPreferences = migratePreferences(localRaw);
      if (mountedRef.current) {
        setPreferences(localPreferences);
        setStatus('loading');
        applyTheme(localPreferences);
      }

      const indexed = await readPreferencesFromIndexedDb();
      const indexedPreferences = indexed ? migratePreferences(indexed) : null;
      const effective = indexedPreferences ?? localPreferences ?? DEFAULT_BROWSER_PREFERENCES;
      if (mountedRef.current) {
        setPreferences(effective);
        setStatus('ready');
      }
      applyTheme(effective);
      if (indexedPreferences) {
        writePreferencesToLocalStorage(indexedPreferences);
      }
    })();

    bootstrapRef.current = task;
    try {
      await task;
    } finally {
      bootstrapRef.current = null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    updateFeedbackRuntimePreferences(preferences);
  }, [preferences]);

  const updatePreferences = useCallback<PreferencesContextValue['updatePreferences']>(
    async (updater) => {
      let next: BrowserPreferences | null = null;
      setPreferences((current) => {
        const merged = mergePreferences(current, updater);
        next = merged;
        return merged;
      });
      const resolved = next ?? DEFAULT_BROWSER_PREFERENCES;
      applyTheme(resolved);
      await writeAll(resolved);
    },
    [writeAll]
  );

  const reload = useCallback(async () => {
    clearLocalStoragePreferences();
    await load();
  }, [load]);

  const value = useMemo<PreferencesContextValue>(
    () => ({ status, preferences, updatePreferences, reload }),
    [status, preferences, updatePreferences, reload]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within PreferencesProvider');
  }
  return context;
}

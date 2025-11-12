'use client';

import { useEffect } from 'react';

const SERVICE_WORKER_PATH = '/sw.js';

export function ServiceWorkerBridge() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    if (process.env.NEXT_PUBLIC_DISABLE_SW === '1') {
      console.debug('[ServiceWorkerBridge] Registration disabled via NEXT_PUBLIC_DISABLE_SW');
      return;
    }

    let cancelled = false;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH, {
          scope: '/',
        });
        if (!cancelled) {
          console.debug('[ServiceWorkerBridge] Service worker registered', {
            scope: registration.scope,
          });
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[ServiceWorkerBridge] Failed to register service worker', error);
        }
      }
    };

    void register();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

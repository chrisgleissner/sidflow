'use client';

import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

/**
 * Component that checks if the browser is in cross-origin isolated mode.
 * This is required for SharedArrayBuffer support in AudioWorklet.
 */
export function CrossOriginIsolatedCheck() {
  const [isIsolated, setIsIsolated] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if we're in a browser environment
    if (typeof window === 'undefined') {
      return;
    }

    // Check crossOriginIsolated status
    const isolated = window.crossOriginIsolated === true;
    setIsIsolated(isolated);

    if (!isolated) {
      console.error('[CrossOriginIsolatedCheck] crossOriginIsolated is false!');
      console.error('SharedArrayBuffer will not be available for AudioWorklet.');
      console.error('Expected headers:');
      console.error('  Cross-Origin-Opener-Policy: same-origin');
      console.error('  Cross-Origin-Embedder-Policy: require-corp');
    } else {
      console.log('[CrossOriginIsolatedCheck] ✓ crossOriginIsolated is true');
    }
  }, []);

  // Don't render anything if isolated or still checking
  if (isIsolated === null || isIsolated === true) {
    return null;
  }

  // Show error if not isolated
  return (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-2xl px-4">
      <Alert variant="destructive" className="border-2 border-red-600 bg-red-50 dark:bg-red-950">
        <AlertCircle className="h-5 w-5" />
        <AlertTitle className="text-lg font-bold">Cross-Origin Isolation Not Enabled</AlertTitle>
        <AlertDescription className="mt-2 space-y-2">
          <p className="font-semibold">
            High-performance audio features are unavailable.
          </p>
          <p className="text-sm">
            The server must send these HTTP headers:
          </p>
          <ul className="list-disc list-inside text-sm space-y-1 pl-2">
            <li>
              <code className="bg-red-100 dark:bg-red-900 px-1 py-0.5 rounded">
                Cross-Origin-Opener-Policy: same-origin
              </code>
            </li>
            <li>
              <code className="bg-red-100 dark:bg-red-900 px-1 py-0.5 rounded">
                Cross-Origin-Embedder-Policy: require-corp
              </code>
            </li>
          </ul>
          <p className="text-sm mt-2">
            <strong>To fix:</strong> Check your Next.js middleware configuration and ensure
            these headers are being set for all routes.
          </p>
        </AlertDescription>
      </Alert>
    </div>
  );
}

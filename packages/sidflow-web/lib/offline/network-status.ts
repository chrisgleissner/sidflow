import { useEffect, useState } from 'react';

export interface NetworkStatus {
  isOnline: boolean;
}

export function getCurrentNetworkStatus(): NetworkStatus {
  if (typeof navigator === 'undefined') {
    return { isOnline: true };
  }
  return { isOnline: navigator.onLine };
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(getCurrentNetworkStatus);

  useEffect(() => {
    const handleOnline = () => setStatus({ isOnline: true });
    const handleOffline = () => setStatus({ isOnline: false });

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return status;
}

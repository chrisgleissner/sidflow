"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface Toast {
  id: string;
  message: string;
  variant: 'info' | 'success' | 'error';
  duration: number;
}

interface ToastContextValue {
  showToast: (message: string, options?: { variant?: Toast['variant']; duration?: number }) => void;
  toasts: Toast[];
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback(
    (message: string, options?: { variant?: Toast['variant']; duration?: number }) => {
      const toast: Toast = {
        id: crypto.randomUUID(),
        message,
        variant: options?.variant ?? 'info',
        duration: options?.duration ?? 5000,
      };
      setToasts((previous) => [...previous, toast]);
      setTimeout(() => {
        setToasts((previous) => previous.filter((item) => item.id !== toast.id));
      }, toast.duration);
    },
    []
  );

  const value = useMemo(() => ({ showToast, toasts }), [showToast, toasts]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToastContext(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToastContext must be used inside ToastProvider');
  }
  return context;
}

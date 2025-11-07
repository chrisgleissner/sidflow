'use client';

import { useEffect } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

interface StatusDisplayProps {
  status: string;
  isError?: boolean;
  onClear?: () => void;
}

export function StatusDisplay({ status, isError, onClear }: StatusDisplayProps) {
  useEffect(() => {
    if (!isError && status && onClear) {
      const timer = setTimeout(() => {
        onClear();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [status, isError, onClear]);

  if (!status) {
    return null;
  }

  const Icon = isError ? AlertCircle : status.includes('...') ? Info : CheckCircle2;
  const variant = isError ? 'destructive' : 'default';

  return (
    <Alert variant={variant} className="pr-12">
      <Icon className="h-4 w-4" />
      <AlertDescription>{status}</AlertDescription>
      {onClear && (
        <button
          type="button"
          aria-label="Dismiss status message"
          onClick={onClear}
          className="absolute right-3 top-3 text-lg leading-none text-muted-foreground hover:text-foreground transition-colors"
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </Alert>
  );
}

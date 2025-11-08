import { useToastContext } from '@/context/toast-context';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

const iconMap = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle,
};

const colorMap: Record<'info' | 'success' | 'error', string> = {
  info: 'text-blue-200 bg-blue-900/70 border-blue-700',
  success: 'text-green-200 bg-green-900/70 border-green-700',
  error: 'text-red-200 bg-red-900/70 border-red-700',
};

export function ToastViewport() {
  const { toasts } = useToastContext();

  return (
    <div className="fixed pointer-events-none z-50 top-4 right-4 flex flex-col gap-2 w-[320px] max-w-full">
      {toasts.map((toast) => {
        const Icon = iconMap[toast.variant];
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-md border px-3 py-2 shadow-lg transition-all ${colorMap[toast.variant]}`}
          >
            <Icon className="h-4 w-4 shrink-0 mt-0.5" />
            <p className="text-sm leading-tight text-white">{toast.message}</p>
          </div>
        );
      })}
    </div>
  );
}

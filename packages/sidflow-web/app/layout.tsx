import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/context/toast-context';
import { ToastViewport } from '@/components/ToastViewport';
import { CrossOriginIsolatedCheck } from '@/components/CrossOriginIsolatedCheck';

export const metadata: Metadata = {
  title: 'SIDFlow Control Panel',
  description: 'Local web interface for SIDFlow - play, rate, and classify SID music',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased font-c64">
        <ToastProvider>
          <CrossOriginIsolatedCheck />
          {children}
          <ToastViewport />
        </ToastProvider>
      </body>
    </html>
  );
}

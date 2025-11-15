import { Suspense } from 'react';
import { SidflowApp } from '@/components/SidflowApp';

export default function PublicHome() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <SidflowApp persona="public" />
    </Suspense>
  );
}

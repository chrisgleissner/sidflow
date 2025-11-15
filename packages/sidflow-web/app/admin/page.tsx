import { Suspense } from 'react';
import { SidflowApp } from '@/components/SidflowApp';

export default function AdminHome() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <SidflowApp persona="admin" />
    </Suspense>
  );
}

'use client';

import { AdminPrefsTab } from './AdminPrefsTab';
import { PublicPrefsTab } from './PublicPrefsTab';
import { useAdminCapabilities } from '@/context/admin-capability';

interface PrefsTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
}

export function PrefsTab(props: PrefsTabProps) {
  const { isAdmin } = useAdminCapabilities();
  return isAdmin ? <AdminPrefsTab {...props} /> : <PublicPrefsTab {...props} />;
}

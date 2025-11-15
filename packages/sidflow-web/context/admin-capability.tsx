'use client';

import { createContext, useContext, useMemo } from 'react';

export type Persona = 'public' | 'admin';

interface AdminCapability {
  persona: Persona;
  isAdmin: boolean;
}

const AdminCapabilityContext = createContext<AdminCapability | null>(null);

interface AdminCapabilityProviderProps {
  persona: Persona;
  children: React.ReactNode;
}

export function AdminCapabilityProvider({ persona, children }: AdminCapabilityProviderProps) {
  const value = useMemo<AdminCapability>(
    () => ({
      persona,
      isAdmin: persona === 'admin',
    }),
    [persona]
  );

  return <AdminCapabilityContext.Provider value={value}>{children}</AdminCapabilityContext.Provider>;
}

export function useAdminCapabilities(): AdminCapability {
  const context = useContext(AdminCapabilityContext);
  if (!context) {
    throw new Error('useAdminCapabilities must be used within an AdminCapabilityProvider');
  }
  return context;
}

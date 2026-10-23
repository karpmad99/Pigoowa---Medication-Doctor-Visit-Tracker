import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AccountAppProvider } from '@/app/accountApp';
import type { AccountAppDependencies } from '@/app/accountAppContext';
import { accountRoutes } from '@/app/accountRoutes';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { createSupabaseProfileApi } from '@/features/auth/profile';
import { createSupabaseAuthApi } from '@/features/auth/supabaseAuthApi';
import type { AppConfig } from '@/lib/config';
import { createLocalServices } from '@/services/local/createLocalServices';
import { createTabStorage } from '@/services/local/storage';
import type { AppServices } from '@/services/repositories';
import { createPigoowaClient } from '@/services/supabase/client';
import { createSupabaseServices } from '@/services/supabase/createSupabaseServices';
import { getUserTimeZone } from '@/utils/clock';

/**
 * Starts the build with accounts (loaded by src/main.tsx only when both Supabase variables are set, so the
 * public demonstration never downloads this code). One Supabase client for the whole page, made with the
 * public key; each signed-in user gets her own services on top of it (src/app/SessionServices.tsx).
 */
export function renderAccountApp(
  rootElement: HTMLElement,
  config: Extract<AppConfig, { kind: 'accounts' }>,
): void {
  const client = createPigoowaClient(config);
  const authApi = createSupabaseAuthApi(client);
  const profiles = createSupabaseProfileApi(client);

  let demoServices: AppServices | null = null;
  const dependencies: AccountAppDependencies = {
    createAccountServices: ({ timeZone, onSessionLost }) =>
      createSupabaseServices({ client, timeZone, onSessionLost }),
    createDemoServices: () => {
      if (demoServices === null) {
        // The demonstration keeps its fictional data in this browser, exactly as the build without accounts.
        demoServices = createLocalServices();
        demoServices.storageMigration.run();
      }
      return demoServices;
    },
  };

  const router = createBrowserRouter(accountRoutes);
  createRoot(rootElement).render(
    <StrictMode>
      <AuthProvider api={authApi} profiles={profiles} browserTimeZone={getUserTimeZone()}>
        <AccountAppProvider dependencies={dependencies} tabStorage={createTabStorage()}>
          <RouterProvider router={router} />
        </AccountAppProvider>
      </AuthProvider>
    </StrictMode>,
  );
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ServicesProvider } from '@/app/ServicesProvider';
import { routes } from '@/app/routes';
import { ErrorState } from '@/components/ui/ErrorState';
import { readAppConfig } from '@/lib/config';
import { createLocalServices } from '@/services/local/createLocalServices';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

// Two builds from one code base (src/lib/config.ts): the public demonstration, and one with accounts.
const config = readAppConfig(import.meta.env);

if (config.kind === 'invalid') {
  createRoot(rootElement).render(
    <StrictMode>
      <div className="mx-auto max-w-xl p-6">
        <ErrorState
          title="Konfiguracja aplikacji jest nieprawidłowa"
          message={`${config.problem} Sprawdź plik .env (wzór: .env.example).`}
        />
      </div>
    </StrictMode>,
  );
} else if (config.kind === 'accounts') {
  // Loaded only now, so the demonstration never downloads the account code.
  void import('./accountMain').then(({ renderAccountApp }) => {
    renderAccountApp(rootElement, config);
  });
} else {
  const router = createBrowserRouter(routes);
  // Data lives in this browser's localStorage (see README: not secure storage).
  const services = createLocalServices();
  // Before anything is rendered or read: bring data stored in the old format up to date, with a
  // backup (PROJECT_SPEC §10.5). Its result is shown by <MigrationNotice> when something needs attention.
  services.storageMigration.run();

  createRoot(rootElement).render(
    <StrictMode>
      <ServicesProvider services={services}>
        <RouterProvider router={router} />
      </ServicesProvider>
    </StrictMode>,
  );
}

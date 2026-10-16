import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ServicesProvider } from '@/app/ServicesProvider';
import { routes } from '@/app/routes';
import { createLocalServices } from '@/services/local/createLocalServices';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

const router = createBrowserRouter(routes);
// Data lives in this browser's localStorage for now (see README: not secure storage).
const services = createLocalServices();

createRoot(rootElement).render(
  <StrictMode>
    <ServicesProvider services={services}>
      <RouterProvider router={router} />
    </ServicesProvider>
  </StrictMode>,
);

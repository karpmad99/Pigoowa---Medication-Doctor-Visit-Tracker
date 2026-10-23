import type { RouteObject } from 'react-router';
import { Spinner } from '@/components/ui/Spinner';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { applicationPages } from './routes';
import { SessionServices } from './SessionServices';

// The build WITH accounts: the sign-in and sign-up pages stand outside the application, and the application
// is reached through the session gate, which chooses whose data the services reach (SessionServices.tsx).
// Kept apart from ./routes.tsx so that the public demonstration never loads any of the account code.
export const accountRoutes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    path: '/',
    element: <SessionServices />,
    HydrateFallback: () => <Spinner />,
    children: applicationPages,
  },
];

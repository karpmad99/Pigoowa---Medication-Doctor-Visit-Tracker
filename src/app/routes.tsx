import type { RouteObject } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { AppointmentsPage } from '@/pages/AppointmentsPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { MedicationsPage } from '@/pages/MedicationsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

// Kept as plain data (not created here) so tests can build an in-memory router from it.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'medications', element: <MedicationsPage /> },
      { path: 'appointments', element: <AppointmentsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

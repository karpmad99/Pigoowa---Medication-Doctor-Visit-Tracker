import type { RouteObject } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { Spinner } from '@/components/ui/Spinner';
import { AddAppointmentPage } from '@/pages/AddAppointmentPage';
import { AddMedicationPage } from '@/pages/AddMedicationPage';
import { AppointmentsPage } from '@/pages/AppointmentsPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { DoseHistoryPage } from '@/pages/DoseHistoryPage';
import { DosesPage } from '@/pages/DosesPage';
import { EditAppointmentPage } from '@/pages/EditAppointmentPage';
import { EditMedicationPage } from '@/pages/EditMedicationPage';
import { MedicationsPage } from '@/pages/MedicationsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

// The component preview and the data page exist only while developing: `import.meta.env.DEV` is replaced by the
// literal `false` in production builds, so this route and its page are dropped from the bundle.
const developmentRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: 'dev/components',
        lazy: async () => {
          const { ComponentsPreviewPage } = await import('@/pages/ComponentsPreviewPage');
          return { Component: ComponentsPreviewPage };
        },
      },
      {
        path: 'dev/data',
        lazy: async () => {
          const { DevDataPage } = await import('@/pages/DevDataPage');
          return { Component: DevDataPage };
        },
      },
    ]
  : [];

// Kept as plain data (not created here) so tests can build an in-memory router from it.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    // Shown only while a lazily loaded route (the development preview) is still downloading.
    HydrateFallback: () => <Spinner />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'doses', element: <DosesPage /> },
      { path: 'doses/history', element: <DoseHistoryPage /> },
      { path: 'medications', element: <MedicationsPage /> },
      { path: 'medications/new', element: <AddMedicationPage /> },
      { path: 'medications/:medicationId/edit', element: <EditMedicationPage /> },
      { path: 'appointments', element: <AppointmentsPage /> },
      { path: 'appointments/new', element: <AddAppointmentPage /> },
      { path: 'appointments/:appointmentId/edit', element: <EditAppointmentPage /> },
      ...developmentRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

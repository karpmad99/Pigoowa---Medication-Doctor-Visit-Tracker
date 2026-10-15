import type { Id, Timestamp } from '@/types/primitives';

/** Lifecycle state chosen by the user. It is separate from the appointment's date and time. */
export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled';

export interface Appointment {
  id: Id;
  doctorName: string | null;
  specialty: string | null;
  /** The instant the visit takes place. */
  scheduledAt: Timestamp;
  location: string | null;
  notes: string | null;
  status: AppointmentStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

import { createContext } from 'react';
import type { AppServices } from '@/services/repositories';

/** Holds the application's services. `null` means no ServicesProvider is above in the tree. */
export const ServicesContext = createContext<AppServices | null>(null);

import { create } from 'zustand';

/** Counts slow requests only; never stores URLs, account data, or tokens. */
export const useApiConnectionStore = create<{ slowRequests: number }>(() => ({ slowRequests: 0 }));

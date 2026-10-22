import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { services } from '@/services';
import type { GateScan, OverstayRules, PlateFrame } from '@/types';
import { useCurrentUser } from './useSession';

export function useIsGateStaff() {
  const { user } = useCurrentUser();
  return { gate: user?.role === 'ADMIN' || user?.role === 'PARKING_OPERATOR', patrol: Boolean(user?.role && user.role !== 'USER') };
}

/** Refreshes itself before the two-minute pass expires. */
export function useGatePass(vehicleId?: string) {
  return useQuery({
    queryKey: ['gate-pass', vehicleId ?? ''],
    queryFn: () => services.gates.gatePass(vehicleId!),
    enabled: Boolean(vehicleId),
    refetchInterval: 60_000,
    staleTime: 50_000,
  });
}

export function useGateZones(enabled = true) {
  return useQuery({ queryKey: ['gate-zones'], queryFn: () => services.gates.zones(), enabled });
}

export function useVisits(zoneId?: string) {
  return useQuery({ queryKey: ['gate-visits', zoneId ?? ''], queryFn: () => services.gates.visits(zoneId!), enabled: Boolean(zoneId), refetchInterval: 30_000 });
}

export function useGateScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ direction, scan }: { direction: 'entry' | 'exit'; scan: GateScan }) =>
      direction === 'entry' ? services.gates.entry(scan) : services.gates.exit(scan),
    onSuccess: (result, { scan }) => {
      queryClient.setQueryData(['gate-occupancy', scan.zoneId], result.occupancy);
      void queryClient.invalidateQueries({ queryKey: ['gate-visits'] });
      void queryClient.invalidateQueries({ queryKey: ['gate-occupancy'] });
    },
  });
}

/** SmartGate's live count; entries and exits update it straight from their response. */
export function useOccupancy(zoneId?: string) {
  return useQuery({ queryKey: ['gate-occupancy', zoneId ?? ''], queryFn: () => services.gates.occupancy(zoneId!), enabled: Boolean(zoneId), refetchInterval: 30_000 });
}

/** Cameras and recent automatic events; refreshes often so the owner sees cars as they pass. */
export function useGateLive(zoneId?: string) {
  return useQuery({ queryKey: ['gate-live', zoneId ?? ''], queryFn: () => services.gates.live(zoneId!), enabled: Boolean(zoneId), refetchInterval: 3_000 });
}

export function useMarkReviewed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => services.gates.markReviewed(eventId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['gate-live'] }),
  });
}

export function useRecognizePlate() {
  return useMutation({ mutationFn: ({ zoneId, frame }: { zoneId: string; frame: PlateFrame }) => services.gates.recognize(zoneId, frame) });
}

export function usePlateLookup() {
  return useMutation({ mutationFn: ({ zoneId, plate }: { zoneId: string; plate: string }) => services.gates.lookup(zoneId, plate) });
}

export function useSaveRules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ zoneId, rules }: { zoneId: string; rules: OverstayRules }) => services.gates.saveRules(zoneId, rules),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['gate-zones'] }),
  });
}

export function usePatrolCheck() {
  return useMutation({ mutationFn: ({ zoneId, plate }: { zoneId: string; plate: string }) => services.gates.patrolCheck(zoneId, plate) });
}

export function usePatrolIssue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ zoneId, plate }: { zoneId: string; plate: string }) => services.gates.patrolIssue(zoneId, plate),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['violations'] }),
  });
}

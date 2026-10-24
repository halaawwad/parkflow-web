import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CheckpointStatus, GeoPoint, ReportedAvailability, TravelMode } from '@/types';
import type { RouteSummaryRequest } from '@/services';
import { services } from '@/services';
import { useInAppNotificationStore } from '@/store/inAppNotificationStore';
import { queryKeys } from './queryKeys';
import { useUserId } from './useSession';

/** Road alerts, driver reports, routes and trust points — the features ported from Wusool. */

export function useCheckpoints() {
  return useQuery({
    queryKey: queryKeys.checkpoints(),
    queryFn: () => services.roads.listCheckpoints(),
    // Report weights decay with age, so statuses drift even with no new posts.
    refetchInterval: 60_000,
  });
}

export function useRoadFeed() {
  return useQuery({
    queryKey: queryKeys.roadFeed(),
    queryFn: () => services.roads.feed(),
  });
}

function useRoadInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['roads'] });
    void queryClient.invalidateQueries({ queryKey: ['route'] });
    void queryClient.invalidateQueries({ queryKey: ['trust'] });
  };
}

export function useReportCheckpoint() {
  const userId = useUserId();
  const invalidate = useRoadInvalidation();
  return useMutation({
    mutationFn: (input: { checkpointId: string; status: CheckpointStatus }) =>
      services.roads.report({ userId: userId!, ...input }),
    onSuccess: (result) => {
      invalidate();
      useInAppNotificationStore.getState().show(result.points?.notification);
    },
  });
}

export function useReportZone() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { zoneId: string; availability: ReportedAvailability }) =>
      services.roads.reportZone({ userId: userId!, ...input }),
    onSuccess: (result) => {
      useInAppNotificationStore.getState().show(result.points?.notification);
      void queryClient.invalidateQueries({ queryKey: ['zones'] });
      void queryClient.invalidateQueries({ queryKey: ['zone'] });
      void queryClient.invalidateQueries({ queryKey: ['trust'] });
    },
  });
}

export function useRoute(
  from?: GeoPoint,
  to?: GeoPoint,
  options?: {
    profile?: TravelMode;
    mode?: 'checkpoint-aware' | 'fastest';
    snapDestination?: boolean;
    maxAlternatives?: number;
  },
) {
  return useQuery({
    queryKey: queryKeys.route(from, to, options?.mode, options?.profile),
    queryFn: () => services.routing.getRoute(from!, to!, options),
    enabled: Boolean(from && to),
    staleTime: 60_000,
    retry: false,
  });
}

/** Optional AI overview of a route; fetched only when asked for (route details opened). */
export function useRouteSummary(input: RouteSummaryRequest | undefined) {
  return useQuery({
    queryKey: ['route-summary', input] as const,
    queryFn: () => services.routing.summarize(input!),
    enabled: Boolean(input),
    staleTime: 30 * 60_000,
    retry: false,
  });
}

export function useTrust() {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.trust(userId ?? 'anonymous'),
    queryFn: () => services.trust.get(userId!),
    enabled: Boolean(userId),
  });
}

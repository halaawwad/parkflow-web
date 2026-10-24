import { useEffect, useState } from 'react';
import type { CheckpointObservation, CheckpointReportStatus } from '@/types/road';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GeoPoint, ReportedAvailability } from '@/types';
import { services } from '@/services';
import { useInAppNotificationStore } from '@/store/inAppNotificationStore';
import { queryKeys } from './queryKeys';
import { useUserId } from './useSession';

/** Road alerts, driver reports, routes and trust points — the features ported from Wusool. */

export function useCheckpoints() {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const query=useQuery({
    queryKey: queryKeys.checkpoints(),
    queryFn: ({signal}) => services.roads.listCheckpoints(signal),
    refetchInterval: 15_000,
    refetchOnReconnect: 'always',
  });
  // Conservatively hide expired cached evidence even while disconnected.
  const data=query.data?.map(cp=>{
    const expired=cp.directions?.some(d=>d.expiresAt && Date.parse(d.expiresAt)<=now);
    return !expired ? cp : {...cp,status:'unknown' as const,assumed:true,directions:cp.directions?.map(d=>d.expiresAt && Date.parse(d.expiresAt)<=now ? {...d,status:'unknown' as const,confidence:'unknown' as const,confirmationCount:0,reportCount:0,reports:[]} : d)};
  });
  return {...query,data};
}

export function useConfirmCheckpoint() {
 const invalidate=useRoadInvalidation();
 return useMutation({networkMode:'always',mutationFn:(input:CheckpointObservation & {checkpointId:string;reportId:string})=>services.roads.confirm(input),onSuccess:()=>invalidate()});
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
    networkMode: 'always',
    mutationFn: (input: CheckpointObservation & { checkpointId: string; status: CheckpointReportStatus }) =>
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
    mode?: 'checkpoint-aware' | 'fastest';
    snapDestination?: boolean;
    maxAlternatives?: number;
  },
) {
  return useQuery({
    queryKey: queryKeys.route(from, to, options?.mode),
    queryFn: () => services.routing.getRoute(from!, to!, options),
    enabled: Boolean(from && to),
    staleTime: 60_000,
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

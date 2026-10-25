import type { RoutingService } from '../types';
import type { RouteResult, RouteStep } from '@/types';
import { normalizeGeoPoint, normalizeGeoPoints } from '@/utils/coordinates';
import { api } from './apiClient';

const normalizeSteps = (steps?: RouteStep[]): RouteStep[] | undefined =>
  steps?.flatMap((step) => {
    const location = normalizeGeoPoint(step.location);
    return location ? [{ ...step, location, geometry: normalizeGeoPoints(step.geometry) }] : [];
  });

const normalizeRoute = (route: RouteResult): RouteResult => ({
  ...route,
  coordinates: normalizeGeoPoints(route.coordinates),
  steps: normalizeSteps(route.steps),
  rejected: route.rejected.map((item) => ({
    ...item,
    coordinates: normalizeGeoPoints(item.coordinates),
  })),
  alternatives: route.alternatives.map((alternative) => ({
    ...alternative,
    coordinates: normalizeGeoPoints(alternative.coordinates),
    steps: normalizeSteps(alternative.steps),
  })),
  trafficSegments: route.trafficSegments
    ?.map((segment) => ({
      ...segment,
      coordinates: normalizeGeoPoints(segment.coordinates),
    }))
    .filter((segment) => segment.coordinates.length >= 2),
  snappedDestination: normalizeGeoPoint(route.snappedDestination),
});

export const httpRoutingService: RoutingService = {
  async summarize(input) {
    try {
      const result = await api<{ summary: string | null }>('/routes/summary', { method: 'POST', body: input });
      return result.summary;
    } catch {
      // Optional: an unconfigured or unavailable AI simply means no overview.
      return null;
    }
  },
  async getRoute(origin, destination, options) {
    const route = await api<RouteResult>('/routes/plan', {
      method: 'POST',
      body: { origin, destination, ...options },
    });
    return normalizeRoute(route);
  },
};

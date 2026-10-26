import { useCallback, useEffect, useState } from 'react';
import type { GeoPoint } from '@/types';
import { getCurrentLocation } from '@/utils/deviceLocation';

export type LocationStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable';

/**
 * GPS is treated as a nice-to-have, never a requirement: the map falls back to
 * central Ramallah and the user can still pick a zone by tapping it, scanning a
 * QR code or typing the zone code.
 */
export function useUserLocation(enabled = true) {
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [location, setLocation] = useState<GeoPoint | undefined>();

  const request = useCallback(async () => {
    setStatus('requesting');
    // Permission dialogs and GPS both fail in plenty of ordinary ways (airplane
    // mode, no fix indoors, an emulator). None should break the map.
    const result = await getCurrentLocation();
    if (!result.ok) {
      setStatus(result.error === 'denied' ? 'denied' : 'unavailable');
      return undefined;
    }
    const point: GeoPoint = { latitude: result.position.latitude, longitude: result.position.longitude };
    setLocation(point);
    setStatus('granted');
    return point;
  }, []);

  useEffect(() => {
    if (!enabled || status !== 'idle') return;
    void request();
  }, [enabled, status, request]);

  return { location, status, request };
}

import { Platform } from 'react-native';
import type { GateService, PlateFrame } from '@/types';
import { api, mutation, query, segment } from './apiClient';

/** A camera frame as an upload: web frames are data URIs, native ones file URIs. */
async function frameForm(frame: PlateFrame, fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (Platform.OS === 'web') {
    // fetch turns a data URI into a Blob without a network call.
    form.append('image', await (await fetch(frame.uri)).blob(), 'plate');
  } else {
    form.append('image', { uri: frame.uri, name: 'plate', type: frame.mimeType ?? 'image/jpeg' } as unknown as Blob);
  }
  return form;
}

export const httpGateService: GateService = {
  gatePass: (vehicleId) => api(`/gate-pass${query({ vehicleId })}`),
  zones: () => api('/gate/zones'),
  visits: (zoneId) => api(`/gate/zones/${segment(zoneId)}/visits`),
  // Every scan is a new event, so these skip the retry-key cache that `mutation` keeps per body.
  entry: (scan) => api('/gate/entry', { method: 'POST', body: scan }),
  exit: (scan) => api('/gate/exit', { method: 'POST', body: scan }),
  occupancy: (zoneId) => api(`/gate/zones/${segment(zoneId)}/occupancy`),
  lookup: (zoneId, plate) => api(`/gate/lookup${query({ zoneId, plate })}`),
  recognize: async (zoneId, frame) => api('/gate/recognize', { method: 'POST', form: await frameForm(frame, { zoneId }) }),
  station: (zoneId, direction) => api(`/gate/zones/${segment(zoneId)}/stations`, { method: 'POST', body: { direction } }),
  sendFrame: async (deviceId, frame) => api(`/gate/devices/${segment(deviceId)}/frames`, { method: 'POST', form: await frameForm(frame) }),
  live: (zoneId) => api(`/gate/zones/${segment(zoneId)}/live`),
  markReviewed: (eventId) => api(`/gate/events/${segment(eventId)}/reviewed`, { method: 'POST', body: {} }),
  saveRules: (zoneId, rules) => api(`/gate/zones/${segment(zoneId)}/rules`, { method: 'PATCH', body: rules }),
  patrolCheck: (zoneId, plate) => api(`/enforcement/check${query({ zoneId, plate })}`),
  patrolIssue: (zoneId, plate) => mutation('/enforcement/violations', { zoneId, plate }),
};

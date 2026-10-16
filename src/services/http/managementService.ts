import type { AdminUser, AdminRoadReport, AdminAppeal, AdminAuditLog, ManagementZone, ManagementOperator, ManagementSummary, Availability } from '@/types/management';
import { api, query, segment } from './apiClient';

// Reuses the existing bearer-token/refresh flow; no new login or session mode.
export const managementService = {
  summary: () => api<ManagementSummary>('/admin/summary'),
  users: (search = '') => api<AdminUser[]>('/admin/users' + query({ query: search.trim() || undefined })),
  updateUser: (id: string, input: { role?: AdminUser['role']; status?: AdminUser['status'] }) => api(`/admin/users/${segment(id)}`, { method: 'PATCH', body: input }),
  zones: () => api<ManagementZone[]>('/admin/parking-zones'),
  updateZone: (id: string, input: {name?: string; nameAr?: string; active?: boolean; capacity?: number}) => api<ManagementZone>(`/admin/parking-zones/${segment(id)}`, { method: 'PATCH', body: input }),
  updateAvailability: (zoneId: string, availability: Availability, source: 'ADMIN' | 'OPERATOR') => api(`/admin/parking-zones/${segment(zoneId)}/availability`, { method: 'POST', body: { availability, source, confidence: 1 } }),
  saveHours: (zoneId: string, hours: ManagementZone['operatingHours']) => api(`/admin/parking-zones/${segment(zoneId)}/hours`, { method: 'PATCH', body: { hours } }),
  saveTariff: (zoneId: string, input: {name: string; hourlyRate: number; incrementMinutes: number; freeMinutes: number; minimumCharge: number; dailyCap?: number; maxStayMinutes?: number; validFrom: string}) => api(`/admin/parking-zones/${segment(zoneId)}/tariffs`, { method: 'POST', body: input }),
  reports: () => api<AdminRoadReport[]>('/admin/road-reports'),
  moderateReport: (id: string, hidden: boolean) => api<AdminRoadReport>(`/admin/road-reports/${segment(id)}`, { method: 'PATCH', body: { hidden } }),
  appeals: () => api<AdminAppeal[]>('/admin/appeals'),
  decideAppeal: (id: string, input: {status: 'approved' | 'rejected'; decisionNote: string}) => api<AdminAppeal>(`/admin/appeals/${segment(id)}`, { method: 'PATCH', body: input }),
  auditLogs: () => api<AdminAuditLog[]>('/admin/audit-logs'),
  operators: () => api<ManagementOperator[]>('/admin/operators'),
  createOperator: (input: {name: string; type: string}) => api<ManagementOperator>('/admin/operators', {method: 'POST', body: input}),
  assignOperator: (operatorId: string, userId: string) => api(`/admin/operators/${segment(operatorId)}/users`, {method: 'POST', body: {userId}}),
  createZone: (input: {operatorId: string; code: string; name: string; nameAr: string; city: string; cityAr: string; latitude: number; longitude: number; kind: ManagementZone['kind']; capacity: number; defaultMode: 'start_stop'; supportedModes: Array<'start_stop' | 'prepaid'>; supportedEntryMethods: Array<'manual' | 'qr' | 'zone_code' | 'gps'>; active: boolean}) => api<ManagementZone>('/admin/parking-zones', {method: 'POST', body: input}),
};
export const services = { admin: managementService };

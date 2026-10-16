import type { User } from './user';
export type AdminRole = User['role'];
export type AdminStatus = 'ACTIVE' | 'SUSPENDED';

export interface AdminUser {
  id: string;
  phone?: string | null;
  email?: string | null;
  fullName: string;
  role: Exclude<AdminRole, undefined>;
  status: AdminStatus;
  createdAt: string;
}

export interface AdminZone {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  city: string;
  cityAr: string;
  capacity: number | null;
  active: boolean;
}

export interface AdminRoadReport {
  id: string;
  checkpointId?: string;
  status?: string;
  hidden: boolean;
  reportedAt: string;
  note?: string | null;
  checkpoint?: { nameEn: string; nameAr: string };
  user?: { fullName: string };
}

export interface AdminAppeal {
  id: string;
  userId: string;
  violationId: string;
  status: string;
  submittedAt: string;
  decisionNote?: string | null;
  reference: string;
  reason: string;
  notes: string;
  user?: { fullName: string; email: string | null };
  violation?: { plateNumber: string; reason: string; reasonAr: string; amount: number; status: string };
}

export interface AdminAuditLog {
  id: string;
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  createdAt: string;
  actor?: { fullName: string; email: string | null };
}


export type Availability = 'available' | 'limited' | 'full' | 'unknown';
export interface ManagementZone extends AdminZone {
  canManageZone?: boolean;
  canUpdateAvailability?: boolean;
  operatorId: string;
  description: string | null;
  address: string | null;
  kind: 'street' | 'garage' | 'lot' | 'private';
  latitude: number;
  longitude: number;
  tariffs: Array<{ id: string; hourlyRate: number; incrementMinutes: number; freeMinutes: number; minimumCharge: number; dailyCap: number | null; maxStayMinutes: number | null; validFrom: string; validTo: string | null }>;
  operatingHours: Array<{ weekday: number; opensAt: string; closesAt: string; closed: boolean }>;
}
export interface ManagementOperator { id: string; name: string; type: string; users: Array<{userId: string}> }
export interface ManagementSummary { activeUsers: number; suspendedUsers: number; activeZones: number; visibleReports: number; openAppeals: number }

export interface OperatorAccess {hasAccess:boolean;canManageStaff:boolean;canViewAnalytics:boolean}
export interface StaffMember {
  operatorId:string;userId:string;canViewAnalytics:boolean;canUpdateAvailability:boolean;
  user:{id:string;fullName:string;email:string|null;status:'ACTIVE'|'SUSPENDED'};
}
export interface OperatorAnalytics {
  window:{startTime:string;endTime:string};
  zones:Array<{zoneId:string;name:string;nameAr:string;capacity:number|null;activeSessions:number;
    reservationConversion:{total:number;checkedIn:number;rate:number|null};feedQuality:{samples:number};
    latestObservation:{recordedAt:string;source:string;occupiedSpaces:number|null;occupancyPercent:number|null}|null;
  }>;
}

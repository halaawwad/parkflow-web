import { NOTIFICATION_TYPES, type AppNotification, type NotificationType } from '../types/notification';

const text = (value: unknown): string => typeof value === 'string' ? value : '';
const date = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
};

/** Validate untrusted API/socket data before grouping dates or rendering React children. */
export function normalizeNotification(value: unknown): AppNotification | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const n = value as Record<string, unknown>;
  const id = text(n.id).trim();
  const createdAt = date(n.createdAt);
  if (!id || !createdAt) return null;
  const title = text(n.title) || text(n.titleAr);
  const body = text(n.body) || text(n.bodyAr);
  const type = NOTIFICATION_TYPES.includes(n.type as NotificationType) ? n.type as NotificationType : 'system';
  // Keep navigation internal and ignore malformed deep links.
  const href = typeof n.href === 'string' && /^\/(?!\/)/.test(n.href) && !/[\\\s]/.test(n.href) ? n.href : undefined;
  return {
    id, userId: text(n.userId), type, title, body,
    titleAr: text(n.titleAr) || title,
    bodyAr: text(n.bodyAr) || body,
    createdAt, readAt: date(n.readAt), href,
    parkingSessionId: text(n.parkingSessionId) || undefined,
    violationId: text(n.violationId) || undefined,
    vehicleId: text(n.vehicleId) || undefined,
  };
}

export function normalizeNotifications(value: unknown): AppNotification[] {
  if (!Array.isArray(value)) throw new Error('Invalid notification response');
  const seen = new Set<string>();
  return value.flatMap(item => {
    const notification = normalizeNotification(item);
    if (!notification || seen.has(notification.id)) return [];
    seen.add(notification.id);
    return [notification];
  });
}

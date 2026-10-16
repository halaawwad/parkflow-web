/// <reference types="node" />
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import NotificationsScreen from '../app/notifications';
import { getNotificationIcon, NOTIFICATION_ICONS, ALERT_NOTIFICATION_TYPES } from '../src/components/domain/notificationIcons';
import { normalizeNotification, normalizeNotifications } from '../src/utils/notifications';
import { useInAppNotificationStore } from '../src/store/inAppNotificationStore';
import { NOTIFICATION_TYPES } from '../src/types/notification';

const query = vi.hoisted(() => ({
  data: [] as unknown[], isPending: false, isError: false, error: undefined as unknown,
  refetch: vi.fn(), isRefetching: false,
}));

vi.mock('react-native', () => ({
  View: ({ children }: any) => <div>{children}</div>,
  SectionList: ({ sections, renderItem, renderSectionHeader, ListEmptyComponent }: any) => <div>
    {sections.length ? sections.map((section: any) => <section key={section.key}>
      {renderSectionHeader({ section })}
      {section.data.map((item: any) => <React.Fragment key={item.id}>{renderItem({ item })}</React.Fragment>)}
    </section>) : ListEmptyComponent}
  </div>,
}));
vi.mock('lucide-react-native', () => {
  const icon = (name: string) => () => <svg data-icon={name} />;
  return Object.fromEntries(['Bell', 'BellRing', 'CircleParking', 'CircleCheck', 'CircleAlert',
    'Gift', 'ScrollText', 'Wallet', 'Gavel', 'Timer', 'Car'].map(name => [name, icon(name)]));
});
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/ui', () => ({
  Screen: ({ children }: any) => <main>{children}</main>,
  AppText: ({ children }: any) => <span>{children}</span>,
  AppHeader: ({ title, trailing }: any) => <header>{title}{trailing}</header>,
  PressableScale: ({ children, accessibilityLabel }: any) => <button aria-label={accessibilityLabel}>{children}</button>,
  SkeletonGroup: () => <div data-state="loading" />,
  ErrorState: ({ onRetry }: any) => <button data-state="error" onClick={onRetry}>Retry</button>,
  EmptyState: ({ title }: any) => <div data-state="empty">{title}</div>,
}));
vi.mock('@/theme/ThemeProvider', () => ({ useTheme: () => ({ colors: {} }) }));
vi.mock('@/hooks/useLocale', () => ({ useLocale: () => ({ t: (key: string) => key, row: 'row', dateLocale: 'en-US', locale: 'ar' }) }));
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => query,
  useMarkNotificationRead: () => ({ mutate: vi.fn() }),
  useMarkAllNotificationsRead: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/utils/haptics', () => ({ haptics: { select: vi.fn(), light: vi.fn() } }));

const notification = (type: unknown = 'gate_entry', extra: Record<string, unknown> = {}) => ({
  id: 'notice-1', userId: 'test-user', type, title: 'Gate entry', body: 'Parking notification',
  titleAr: 'دخول الموقف', bodyAr: 'إشعار موقف', createdAt: '2026-10-16T09:00:00.000Z', ...extra,
});

beforeEach(() => {
  Object.assign(query, { data: [], isPending: false, isError: false, error: undefined, isRefetching: false });
  useInAppNotificationStore.setState({ current: undefined, shown: new Set() });
});

describe('notification rendering regression', () => {
  it.each(['gate_entry', 'overstay_warning', 'future_notification', '__proto__', 'constructor', 'toString'])('renders %s without an undefined or inherited Icon', type => {
    // Deliberately bypass normalization to exercise the screen's own icon fallback.
    query.data = [notification(type)];
    const html = renderToStaticMarkup(<NotificationsScreen />);
    const expected = type === 'gate_entry' ? 'CircleParking' : type === 'overstay_warning' ? 'Timer' : 'Bell';
    expect(html).toContain(`data-icon="${expected}"`);
    expect(html).toContain('دخول الموقف');
    expect(html).toContain('notifications.markAllRead');
  });

  it('shows loading, empty, error/retry, and populated states', () => {
    query.isPending = true;
    expect(renderToStaticMarkup(<NotificationsScreen />)).toContain('data-state="loading"');
    query.isPending = false;
    expect(renderToStaticMarkup(<NotificationsScreen />)).toContain('data-state="empty"');
    query.isError = true;
    expect(renderToStaticMarkup(<NotificationsScreen />)).toContain('data-state="error"');
    query.isError = false;
    query.data = normalizeNotifications([notification('overstay_warning')]);
    const populated = renderToStaticMarkup(<NotificationsScreen />);
    expect(populated).toContain('data-icon="Timer"');
    expect(populated).not.toContain('data-state="empty"');
  });

  it('rejects a malformed list response and safely skips invalid rows and duplicate IDs', () => {
    expect(() => normalizeNotifications(null)).toThrow('Invalid notification response');
    expect(() => normalizeNotifications({ notifications: [] })).toThrow('Invalid notification response');
    const rows = normalizeNotifications([null, 42, {}, notification('gate_entry', { id: '' }),
      notification('gate_entry', { createdAt: null }), notification('gate_entry', { createdAt: 'bad-date' }),
      notification('future_notification', { title: {}, titleAr: null, body: ['bad'], bodyAr: 42, href: {} }),
      notification('gate_entry')]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'system', title: '', titleAr: '', body: '', bodyAr: '' });
    query.data = rows;
    expect(() => renderToStaticMarkup(<NotificationsScreen />)).not.toThrow();
  });

  it('normalizes dates, nullable read state, translations, and malformed links', () => {
    const row = normalizeNotification(notification('gate_entry', {
      createdAt: '2026-10-16T12:00:00+03:00', readAt: null, titleAr: null, bodyAr: {}, href: 'https://example.invalid',
    }));
    expect(row).toMatchObject({ createdAt: '2026-10-16T09:00:00.000Z', titleAr: 'Gate entry', bodyAr: 'Parking notification' });
    expect(row?.readAt).toBeUndefined();
    expect(row?.href).toBeUndefined();
    expect(normalizeNotification(notification('gate_entry', { href: '/gate/session-1' }))?.href).toBe('/gate/session-1');
  });

  it('keeps malformed socket notifications out of the shared banner store', () => {
    const store = useInAppNotificationStore.getState();
    store.show(notification('gate_entry', { title: {}, createdAt: null }) as any);
    expect(useInAppNotificationStore.getState().current).toBeUndefined();
    store.show(notification('future_notification', { titleAr: {} }) as any);
    expect(useInAppNotificationStore.getState().current).toMatchObject({ type: 'system', titleAr: 'Gate entry' });
    expect(getNotificationIcon(null)).toBe(NOTIFICATION_ICONS.system);
    expect(ALERT_NOTIFICATION_TYPES).toContain('overstay_warning');
  });

  it('maps every notification type currently emitted by backend notify calls', () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : []);
    const emitted = new Set<string>();
    for (const path of files('server/src')) {
      const source = readFileSync(path, 'utf8');
      // notify(tx, userId, 'literal') or a conditional of two literal event types.
      for (const match of source.matchAll(/\bnotify\(\s*\w+\s*,\s*[^,]+,\s*(?:[^,'?]+\?\s*)?'([a-z_]+)'(?:\s*:\s*'([a-z_]+)')?/g)) {
        emitted.add(match[1]);
        if (match[2]) emitted.add(match[2]);
      }
    }
    expect(emitted).toContain('gate_entry');
    expect(emitted).toContain('overstay_warning');
    expect(emitted).toContain('ride_request');
    expect(emitted).toContain('spot_confirmed');
    for (const type of emitted) {
      expect(NOTIFICATION_TYPES, type).toContain(type);
      expect(Object.hasOwn(NOTIFICATION_ICONS, type), type).toBe(true);
    }
  });
});

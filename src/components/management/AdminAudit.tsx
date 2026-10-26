import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { ClipboardList } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';

import { services } from '@/services/http/managementService';
import type { AdminAuditLog } from '@/types/management';
import { useAuthStore } from '@/store/authStore';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/spacing';
import { formatDateTime } from '@/utils/time';
import { AppButton, AppText, Card, EmptyState, ErrorState, InlineNotice, SearchField } from '@/components/ui';

type AuditRecord = AdminAuditLog & {
  actor?: { fullName?: string | null; email?: string | null } | null;
};

const localText = {
  en: {
    title: 'Audit history',
    subtitle: 'Administrative actions are read-only.',
    search: 'Search by action, resource, or actor',
    noResults: 'No audit events match this search.',
    loading: 'Loading audit history…',
    loadFailed: 'Could not load the latest audit events.',
    refresh: 'Refresh',
    showMore: 'Show more',
    showLess: 'Show less',
    actor: 'Actor',
    resource: 'Resource',
    unknown: 'Unknown',
    actions: {
      decide: 'Appeal decision',
      moderate: 'Report moderation',
      update: 'Updated',
      create: 'Created',
      check_in: 'Checked in',
      reservation_recovery: 'Reservation recovery',
    },
    resources: {
      appeal: 'Appeal',
      road_report: 'Road report',
      availability: 'Zone availability',
      'parking-reservation': 'Parking reservation',
    },
  },
  ar: {
    title: 'سجل التدقيق',
    subtitle: 'إجراءات الإدارة للقراءة فقط.',
    search: 'ابحث عن الإجراء أو المورد أو المنفذ',
    noResults: 'لا توجد أحداث تدقيق مطابقة للبحث.',
    loading: 'جارٍ تحميل سجل التدقيق…',
    loadFailed: 'تعذّر تحميل أحدث أحداث التدقيق.',
    refresh: 'تحديث',
    showMore: 'عرض المزيد',
    showLess: 'عرض أقل',
    actor: 'المنفذ',
    resource: 'المورد',
    unknown: 'غير معروف',
    actions: {
      decide: 'قرار اعتراض',
      moderate: 'إدارة بلاغ',
      update: 'تحديث',
      create: 'إنشاء',
      check_in: 'تسجيل دخول',
      reservation_recovery: 'معالجة حجز',
    },
    resources: {
      appeal: 'اعتراض',
      road_report: 'بلاغ طريق',
      availability: 'توفر المنطقة',
      'parking-reservation': 'حجز موقف',
    },
  },
} as const;

export function AdminAudit() {
  const { colors } = useTheme();
  const { locale, row, dateLocale } = useLocale();
  const labels = localText[locale === 'ar' ? 'ar' : 'en'];
  const userId = useAuthStore((state) => state.user?.id ?? 'admin');
  const isAdmin = useAuthStore((state) => state.user?.role === 'ADMIN');
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  const query = useQuery({
    queryKey: ['admin', 'audit', userId],
    queryFn: services.admin.auditLogs,
    enabled: isAdmin,
  });

  const events = (query.data ?? []) as AuditRecord[];
  const queryText = search.trim().toLowerCase();
  const filtered = useMemo(() => events.filter((event) => [
    event.action,
    event.resourceType,
    event.resourceId,
    event.actor?.fullName,
    event.actor?.email,
    event.actorUserId,
  ].some((value) => String(value ?? '').toLowerCase().includes(queryText))), [events, queryText]);
  const visible = showAll ? filtered : filtered.slice(0, 15);

  const actionLabel = (action: string) => labels.actions[action as keyof typeof labels.actions] ?? humanize(action, labels.unknown);
  const resourceLabel = (resource: string) => labels.resources[resource as keyof typeof labels.resources] ?? humanize(resource, labels.unknown);

  if (!isAdmin) return null;
  if (query.isPending && !query.data) return <AppText color="textSecondary">{labels.loading}</AppText>;
  if (query.error && !query.data) return <ErrorState compact error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{ flexDirection: row, justifyContent: 'space-between', alignItems: 'center', gap: spacing.md }}>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <AppText variant="h3">{labels.title}</AppText>
          <AppText variant="caption" color="textSecondary">{labels.subtitle}</AppText>
        </View>
        <AppButton label={labels.refresh} variant="ghost" size="sm" fullWidth={false} onPress={() => void query.refetch()} loading={query.isFetching} style={{ paddingHorizontal: spacing.md, backgroundColor: colors.track }} />
      </View>

      <SearchField value={search} onChangeText={(value) => { setSearch(value); setShowAll(false); }} placeholder={labels.search} />

      {query.error ? <InlineNotice tone="danger" title={labels.loadFailed} /> : null}

      {visible.length === 0 ? (
        <EmptyState compact icon={<ClipboardList size={28} color={colors.brand} />} title={labels.noResults} />
      ) : (
        <View style={{ gap: spacing.md }}>
          {visible.map((event) => (
            <Card key={event.id} padding="lg" tone="outline" style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: row, alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md }}>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <AppText variant="title">{actionLabel(event.action)}</AppText>
                  <AppText variant="caption" color="textSecondary">{formatDateTime(event.createdAt, dateLocale)}</AppText>
                </View>
                <AppText variant="caption" color="textTertiary">{event.id.slice(0, 8)}</AppText>
              </View>
              <AppText variant="bodySm" color="textSecondary">{labels.resource} · {resourceLabel(event.resourceType)} · {event.resourceId.slice(0, 12)}</AppText>
              <AppText variant="caption" color="textSecondary">{labels.actor} · {event.actor?.fullName ?? labels.unknown}{event.actor?.email ? ` · ${event.actor.email}` : ''}</AppText>
            </Card>
          ))}
          {filtered.length > 15 ? <AppButton label={showAll ? labels.showLess : labels.showMore} variant="ghost" size="sm" fullWidth={false} onPress={() => setShowAll((value) => !value)} /> : null}
        </View>
      )}
    </View>
  );
}

function humanize(value: string, fallback: string): string {
  if (!value) return fallback;
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export default AdminAudit;

import { CheckpointReview } from './CheckpointReview';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Flag, ShieldAlert, UserRound } from 'lucide-react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { services } from '@/services/http/managementService';
import type { AdminAppeal, AdminRoadReport } from '@/types/management';
import { useAuthStore } from '@/store/authStore';
import { useLocale } from '@/hooks/useLocale';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/spacing';
import { radius } from '@/theme/radius';
import { formatDateTime } from '@/utils/time';
import {
  AppButton,
  AppText,
  BottomSheet,
  Card,
  EmptyState,
  ErrorState,
  InlineNotice,
  SearchField,
  Segmented,
  StatusBadge,
  TextField,
} from '@/components/ui';

type ReviewKind = 'reports' | 'appeals';

type ReportRecord = AdminRoadReport & {
  checkpoint?: { name?: string; nameEn?: string; nameAr?: string } | null;
  user?: { fullName?: string | null } | null;
  status?: string | null;
};

type AppealRecord = AdminAppeal & {
  reason?: string | null;
  reasonAr?: string | null;
  notes?: string | null;
  user?: { fullName?: string | null; email?: string | null } | null;
  violation?: {
    plateNumber?: string | null;
    reason?: string | null;
    reasonAr?: string | null;
    amount?: number | null;
    status?: string | null;
  } | null;
  status: string;
};

const localText = {
  en: {
    reports: 'Road reports',
    appeals: 'Appeals',
    reportSearch: 'Search by checkpoint, reporter, or status',
    appealSearch: 'Search by plate, user, reason, or status',
    all: 'All',
    open: 'Open',
    closed: 'Closed',
    noReports: 'No road reports match this search.',
    noAppeals: 'No appeals match this filter.',
    report: 'Report',
    reportedBy: 'Reported by',
    checkpoint: 'Checkpoint',
    status: 'Status',
    reported: 'Reported',
    visible: 'Visible',
    hidden: 'Hidden',
    hide: 'Hide report',
    restore: 'Restore report',
    hideTitle: 'Hide this road report?',
    restoreTitle: 'Restore this road report?',
    hideBody: 'Hiding removes this report from the public road feed. You can restore it later.',
    restoreBody: 'Restoring makes this report visible in the public road feed again.',
    confirmHide: 'Hide report',
    confirmRestore: 'Restore report',
    cancel: 'Cancel',
    appealStatus: 'Status',
    appealReason: 'Reason',
    notes: 'Notes',
    violation: 'Violation',
    plate: 'Plate',
    amount: 'Amount',
    decision: 'Decision',
    approve: 'Approve',
    reject: 'Reject',
    decisionNote: 'Decision note',
    decisionNoteHint: 'Explain the decision to the driver (at least 5 characters).',
    decisionTitle: 'Confirm appeal decision',
    approveConsequence: 'Approving cancels the violation and notifies the driver.',
    rejectConsequence: 'Rejecting keeps the violation payable and notifies the driver.',
    confirmApprove: 'Approve appeal',
    confirmReject: 'Reject appeal',
    alreadyClosed: 'This appeal is already closed.',
    paidLocked: 'A paid violation cannot be decided again.',
    showMore: 'Show more',
    showLess: 'Show less',
    loading: 'Loading reviews…',
    refresh: 'Refresh',
    updated: 'Review updated successfully.',
    updateFailed: 'Could not update this review.',
    loadFailed: 'Could not load the latest reviews.',
    invalidNote: 'Add at least 5 characters.',
    unknown: 'Unknown',
    pending: 'Pending',
    under_review: 'Under review',
    more_info: 'More information requested',
    submitted: 'Submitted',
    approved: 'Approved',
    rejected: 'Rejected',
    unverified: 'Unverified',
    verified: 'Verified',
    expired: 'Expired',
    removed: 'Removed',
  },
  ar: {
    reports: 'بلاغات الطريق',
    appeals: 'الاعتراضات',
    reportSearch: 'ابحث عن نقطة التفتيش أو المبلّغ أو الحالة',
    appealSearch: 'ابحث عن اللوحة أو المستخدم أو السبب أو الحالة',
    all: 'الكل',
    open: 'مفتوحة',
    closed: 'مغلقة',
    noReports: 'لا توجد بلاغات طريق مطابقة للبحث.',
    noAppeals: 'لا توجد اعتراضات مطابقة لهذا المرشح.',
    report: 'بلاغ',
    reportedBy: 'أبلغ بواسطة',
    checkpoint: 'نقطة التفتيش',
    status: 'الحالة',
    reported: 'تاريخ البلاغ',
    visible: 'ظاهر',
    hidden: 'مخفي',
    hide: 'إخفاء البلاغ',
    restore: 'استعادة البلاغ',
    hideTitle: 'إخفاء بلاغ الطريق؟',
    restoreTitle: 'استعادة بلاغ الطريق؟',
    hideBody: 'إخفاء البلاغ يزيله من موجز الطريق العام. يمكنك استعادته لاحقاً.',
    restoreBody: 'ستظهر البلاغات المستعادة في موجز الطريق العام مجدداً.',
    confirmHide: 'إخفاء البلاغ',
    confirmRestore: 'استعادة البلاغ',
    cancel: 'إلغاء',
    appealStatus: 'الحالة',
    appealReason: 'السبب',
    notes: 'ملاحظات',
    violation: 'المخالفة',
    plate: 'اللوحة',
    amount: 'المبلغ',
    decision: 'القرار',
    approve: 'قبول',
    reject: 'رفض',
    decisionNote: 'ملاحظة القرار',
    decisionNoteHint: 'اشرح القرار للسائق (5 أحرف على الأقل).',
    decisionTitle: 'تأكيد قرار الاعتراض',
    approveConsequence: 'قبول الاعتراض يلغي المخالفة ويبلغ السائق.',
    rejectConsequence: 'رفض الاعتراض يبقي المخالفة مستحقة ويبلغ السائق.',
    confirmApprove: 'قبول الاعتراض',
    confirmReject: 'رفض الاعتراض',
    alreadyClosed: 'هذا الاعتراض مغلق بالفعل.',
    paidLocked: 'لا يمكن اتخاذ قرار جديد بشأن مخالفة مدفوعة.',
    showMore: 'عرض المزيد',
    showLess: 'عرض أقل',
    loading: 'جارٍ تحميل المراجعات…',
    refresh: 'تحديث',
    updated: 'تم تحديث المراجعة بنجاح.',
    updateFailed: 'تعذّر تحديث هذه المراجعة.',
    loadFailed: 'تعذّر تحميل أحدث المراجعات.',
    invalidNote: 'أضف 5 أحرف على الأقل.',
    unknown: 'غير معروف',
    pending: 'قيد الانتظار',
    under_review: 'قيد المراجعة',
    more_info: 'مطلوب مزيد من المعلومات',
    submitted: 'مُرسل',
    approved: 'مقبول',
    rejected: 'مرفوض',
    unverified: 'غير موثق',
    verified: 'موثق',
    expired: 'منتهي',
    removed: 'محذوف',
  },
} as const;

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  switch (status.toLowerCase()) {
    case 'approved':
      return 'success';
    case 'rejected':
      return 'danger';
    case 'hidden':
      return 'danger';
    case 'visible':
      return 'success';
    case 'submitted':
    case 'under_review':
    case 'more_info':
    case 'pending':
      return 'warning';
    default:
      return 'neutral';
  }
}

function normalizeStatus(status: string | null | undefined): string {
  return (status ?? 'pending').toLowerCase().replace(/\s+/g, '_');
}

function isOpenAppeal(status: string | null | undefined): boolean {
  return ['submitted', 'under_review', 'more_info', 'pending'].includes(normalizeStatus(status));
}

function canDecideAppeal(appeal: AppealRecord | null | undefined): boolean {
  return Boolean(appeal && isOpenAppeal(appeal.status) && normalizeStatus(appeal.violation?.status) !== 'paid');
}

export interface AdminReviewsProps {
  kind: ReviewKind;
}

export function AdminReviews({ kind }: AdminReviewsProps) {
  const { colors } = useTheme();
  const { locale, row, dateLocale, textAlign } = useLocale();
  const labels = localText[locale === 'ar' ? 'ar' : 'en'];
  const userId = useAuthStore((state) => state.user?.id ?? 'admin');
  const isAdmin = useAuthStore((state) => state.user?.role === 'ADMIN');
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [appealFilter, setAppealFilter] = useState<'all' | 'open' | 'closed'>('open');
  const [showAll, setShowAll] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportRecord | null>(null);
  const [appealTarget, setAppealTarget] = useState<{ appeal: AppealRecord; decision: 'approved' | 'rejected' } | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [success, setSuccess] = useState(false);

  const query = useQuery<ReportRecord[] | AppealRecord[]>({
    queryKey: ['admin', kind, userId],
    queryFn: async () => (kind === 'reports' ? await services.admin.reports() : await services.admin.appeals()) as ReportRecord[] | AppealRecord[],
    enabled: isAdmin,
  });

  const moderateReport = useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) => services.admin.moderateReport(id, hidden),
    onSuccess: async () => {
      setReportTarget(null);
      setSuccess(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin'] }),
        queryClient.invalidateQueries({ queryKey: ['road-reports'] }),
        queryClient.invalidateQueries({ queryKey: ['roads'] }),
      ]);
    },
  });

  const decideAppeal = useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: 'approved' | 'rejected'; note: string }) =>
      services.admin.decideAppeal(id, { status, decisionNote: note }),
    onSuccess: async () => {
      setAppealTarget(null);
      setDecisionNote('');
      setSuccess(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin'] }),
        queryClient.invalidateQueries({ queryKey: ['violations'] }),
        queryClient.invalidateQueries({ queryKey: ['trust'] }),
      ]);
    },
  });

  const reports = (query.data ?? []) as ReportRecord[];
  const appeals = (query.data ?? []) as AppealRecord[];
  const queryText = search.trim().toLowerCase();

  const filteredReports = useMemo(() => reports.filter((report) => {
    if (!queryText) return true;
    const checkpoint = report.checkpoint?.nameAr ?? report.checkpoint?.nameEn ?? report.checkpoint?.name ?? report.checkpointId ?? '';
    return [checkpoint, report.user?.fullName, report.status, report.note, report.id].some((value) =>
      String(value ?? '').toLowerCase().includes(queryText),
    );
  }), [reports, queryText]);

  const filteredAppeals = useMemo(() => appeals.filter((appeal) => {
    const open = isOpenAppeal(appeal.status);
    if (appealFilter === 'open' && !open) return false;
    if (appealFilter === 'closed' && open) return false;
    if (!queryText) return true;
    const violation = appeal.violation;
    return [
      appeal.user?.fullName,
      appeal.user?.email,
      appeal.reason,
      appeal.reasonAr,
      appeal.notes,
      appeal.status,
      violation?.plateNumber,
      violation?.reason,
      violation?.reasonAr,
    ].some((value) => String(value ?? '').toLowerCase().includes(queryText));
  }), [appeals, appealFilter, queryText]);

  const items = kind === 'reports' ? filteredReports : filteredAppeals;
  const visibleItems = showAll ? items : items.slice(0, 10);
  const hasMore = items.length > 10;

  const statusLabel = (status: string | null | undefined) => labels[normalizeStatus(status) as keyof typeof labels] ?? status ?? labels.unknown;

  if (!isAdmin) return null;

  if (query.isPending && !query.data) {
    return <AppText color="textSecondary">{labels.loading}</AppText>;
  }

  if (query.error && !query.data) {
    return <ErrorState compact error={query.error} onRetry={() => void query.refetch()} />;
  }

  const closeSheets = () => {
    setReportTarget(null);
    setAppealTarget(null);
    setDecisionNote('');
  };

  return (
    <View style={{ gap: spacing.lg }}>
      {kind === 'reports' ? <CheckpointReview /> : null}
      <View style={{ flexDirection: row, alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <AppText variant="h3">{kind === 'reports' ? labels.reports : labels.appeals}</AppText>
          <AppText variant="caption" color="textSecondary">{items.length}</AppText>
        </View>
        <AppButton label={labels.refresh} variant="ghost" size="sm" fullWidth={false} onPress={() => void query.refetch()} loading={query.isFetching} style={{ paddingHorizontal: spacing.md, backgroundColor: colors.track }} />
      </View>

      <SearchField
        value={search}
        onChangeText={(value) => { setSearch(value); setShowAll(false); setSuccess(false); }}
        placeholder={kind === 'reports' ? labels.reportSearch : labels.appealSearch}
      />

      {kind === 'appeals' ? (
        <Segmented
          variant="inset"
          value={appealFilter}
          onChange={(value) => { setAppealFilter(value); setShowAll(false); }}
          options={[
            { value: 'open', label: labels.open, badge: appeals.filter((item) => isOpenAppeal(item.status)).length },
            { value: 'closed', label: labels.closed, badge: appeals.filter((item) => !isOpenAppeal(item.status)).length },
            { value: 'all', label: labels.all, badge: appeals.length },
          ]}
        />
      ) : null}

      {success ? <InlineNotice tone="success" title={labels.updated} /> : null}
      {query.error ? <InlineNotice tone="danger" title={labels.loadFailed} /> : null}
      {moderateReport.error || decideAppeal.error ? <InlineNotice tone="danger" title={labels.updateFailed} /> : null}

      {visibleItems.length === 0 ? (
        <EmptyState compact icon={kind === 'reports' ? <Flag size={28} color={colors.brand} /> : <ShieldAlert size={28} color={colors.brand} />} title={kind === 'reports' ? labels.noReports : labels.noAppeals} />
      ) : (
        <View style={{ gap: spacing.md }}>
          {kind === 'reports'
            ? (visibleItems as ReportRecord[]).map((report) => {
                const checkpoint = locale === 'ar'
                  ? report.checkpoint?.nameAr ?? report.checkpoint?.nameEn ?? report.checkpointId
                  : report.checkpoint?.nameEn ?? report.checkpoint?.name ?? report.checkpointId;
                const hidden = Boolean(report.hidden);
                return (
                  <Card key={report.id} padding="lg" style={{ gap: spacing.md }}>
                    <View style={{ flexDirection: row, alignItems: 'flex-start', gap: spacing.md }}>
                      <View style={{ flex: 1, gap: spacing.xs }}>
                        <AppText variant="title">{checkpoint || labels.report}</AppText>
                        <AppText variant="caption" color="textSecondary">{labels.checkpoint} · {report.checkpointId ?? report.id.slice(0, 8)}</AppText>
                        {report.status ? <AppText variant="caption" color="textSecondary">{labels.status} · {statusLabel(report.status)}</AppText> : null}
                        <AppText variant="caption" color="textSecondary">{labels.reported} · {formatDateTime(report.reportedAt, dateLocale)}</AppText>
                      </View>
                      <StatusBadge label={hidden ? labels.hidden : labels.visible} tone={hidden ? 'danger' : 'success'} size="sm" />
                    </View>
                    <View style={{ flexDirection: row, alignItems: 'center', gap: spacing.sm }}>
                      <UserRound size={16} color={colors.textTertiary} />
                      <AppText variant="caption" color="textSecondary">{labels.reportedBy} · {report.user?.fullName ?? labels.unknown}</AppText>
                    </View>
                    {report.note ? <AppText variant="bodySm" color="textSecondary" style={{ textAlign }}>{report.note}</AppText> : null}
                    <AppButton
                      label={hidden ? labels.restore : labels.hide}
                      variant={hidden ? 'tonal' : 'danger'}
                      size="sm"
                      fullWidth={false}
                      onPress={() => { setSuccess(false); setReportTarget(report); }}
                    />
                  </Card>
                );
              })
            : (visibleItems as AppealRecord[]).map((appeal) => {
                const open = isOpenAppeal(appeal.status);
                const canDecide = canDecideAppeal(appeal);
                const violation = appeal.violation;
                const reason = locale === 'ar' ? appeal.reasonAr ?? appeal.reason : appeal.reason;
                return (
                  <Card key={appeal.id} padding="lg" style={{ gap: spacing.md }}>
                    <View style={{ flexDirection: row, alignItems: 'flex-start', gap: spacing.md }}>
                      <View style={{ flex: 1, gap: spacing.xs }}>
                        <AppText variant="title">{violation?.plateNumber ?? appeal.id.slice(0, 8)}</AppText>
                        <AppText variant="caption" color="textSecondary">{appeal.user?.fullName ?? labels.unknown}{appeal.user?.email ? ` · ${appeal.user.email}` : ''}</AppText>
                        <AppText variant="caption" color="textSecondary">{formatDateTime(appeal.submittedAt, dateLocale)}</AppText>
                      </View>
                      <StatusBadge label={statusLabel(appeal.status)} tone={statusTone(appeal.status)} size="sm" />
                    </View>
                    {reason ? <Detail label={labels.appealReason} value={reason} textAlign={textAlign} /> : null}
                    {appeal.notes ? <Detail label={labels.notes} value={appeal.notes} textAlign={textAlign} /> : null}
                    {violation ? (
                      <View style={{ gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }}>
                        <AppText variant="label">{labels.violation}</AppText>
                        <AppText variant="caption" color="textSecondary">{labels.plate} · {violation.plateNumber ?? labels.unknown}</AppText>
                        {violation.amount != null ? <AppText variant="caption" color="textSecondary">{labels.amount} · {violation.amount}</AppText> : null}
                        <AppText variant="caption" color="textSecondary">{violation.reason ?? violation.reasonAr ?? labels.unknown}</AppText>
                      </View>
                    ) : null}
                    {open && canDecide ? (
                      <View style={{ flexDirection: row, gap: spacing.sm, flexWrap: 'wrap' }}>
                        <AppButton label={labels.approve} variant="tonal" size="sm" fullWidth={false} onPress={() => { setSuccess(false); setDecisionNote(''); setAppealTarget({ appeal, decision: 'approved' }); }} />
                        <AppButton label={labels.reject} variant="danger" size="sm" fullWidth={false} onPress={() => { setSuccess(false); setDecisionNote(''); setAppealTarget({ appeal, decision: 'rejected' }); }} />
                      </View>
                    ) : null}
                    {open && !canDecide ? <InlineNotice tone="warning" title={labels.paidLocked} /> : null}
                  </Card>
                );
              })}
          {hasMore ? <AppButton label={showAll ? labels.showLess : labels.showMore} variant="ghost" size="sm" fullWidth={false} onPress={() => setShowAll((value) => !value)} /> : null}
        </View>
      )}

      <BottomSheet
        visible={Boolean(reportTarget)}
        onClose={() => setReportTarget(null)}
        title={reportTarget?.hidden ? labels.restoreTitle : labels.hideTitle}
        subtitle={reportTarget?.hidden ? labels.restoreBody : labels.hideBody}
        dismissible={!moderateReport.isPending}
      >
        <View style={{ gap: spacing.md }}>
          <AppButton
            label={reportTarget?.hidden ? labels.confirmRestore : labels.confirmHide}
            variant={reportTarget?.hidden ? 'tonal' : 'danger'}
            onPress={() => {
              if (!reportTarget) return;
              moderateReport.mutate({ id: reportTarget.id, hidden: !reportTarget.hidden });
            }}
            loading={moderateReport.isPending}
          />
          {moderateReport.error ? <InlineNotice tone="danger" title={labels.updateFailed} /> : null}
          <AppButton label={labels.cancel} variant="ghost" onPress={() => setReportTarget(null)} disabled={moderateReport.isPending} />
        </View>
      </BottomSheet>

      <BottomSheet
        visible={Boolean(appealTarget)}
        onClose={closeSheets}
        title={labels.decisionTitle}
        subtitle={appealTarget?.decision === 'approved' ? labels.approveConsequence : labels.rejectConsequence}
        dismissible={!decideAppeal.isPending}
        scrollable
      >
        <View style={{ gap: spacing.lg }}>
          <StatusBadge label={appealTarget?.decision === 'approved' ? labels.approve : labels.reject} tone={appealTarget?.decision === 'approved' ? 'success' : 'danger'} />
          <TextField
            label={labels.decisionNote}
            hint={labels.decisionNoteHint}
            value={decisionNote}
            onChangeText={setDecisionNote}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            inputStyle={{ minHeight: 110, paddingVertical: spacing.md, alignItems: 'flex-start' }}
            error={decisionNote.length > 0 && decisionNote.trim().length < 5 ? labels.invalidNote : undefined}
          />
          <AppButton
            label={appealTarget?.decision === 'approved' ? labels.confirmApprove : labels.confirmReject}
            variant={appealTarget?.decision === 'approved' ? 'tonal' : 'danger'}
            disabled={!appealTarget || decisionNote.trim().length < 5 || !canDecideAppeal(appealTarget?.appeal)}
            loading={decideAppeal.isPending}
            onPress={() => {
              if (!appealTarget || decisionNote.trim().length < 5 || !canDecideAppeal(appealTarget.appeal)) return;
              decideAppeal.mutate({ id: appealTarget.appeal.id, status: appealTarget.decision, note: decisionNote.trim() });
            }}
          />
          {decideAppeal.error ? <InlineNotice tone="danger" title={labels.updateFailed} /> : null}
          <AppButton label={labels.cancel} variant="ghost" onPress={closeSheets} disabled={decideAppeal.isPending} />
          {!canDecideAppeal(appealTarget?.appeal)
            ? <InlineNotice tone="warning" title={isOpenAppeal(appealTarget?.appeal.status) ? labels.paidLocked : labels.alreadyClosed} />
            : null}
        </View>
      </BottomSheet>
    </View>
  );
}

function Detail({ label, value, textAlign }: { label: string; value: string; textAlign: 'left' | 'right' }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="bodySm" color="textSecondary" style={{ textAlign }}>{value}</AppText>
    </View>
  );
}

export default AdminReviews;

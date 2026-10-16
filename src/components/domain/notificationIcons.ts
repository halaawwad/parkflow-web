import {
  Bell,
  BellRing,
  CircleParking,
  CircleCheck,
  CircleAlert,
  Gift,
  ScrollText,
  Wallet as WalletIcon,
  Gavel,
  Timer,
  Car,
} from 'lucide-react-native';
import type { NotificationType } from '@/types';

/** One icon per notification kind, shared by the inbox and the on-screen banner. */
export const NOTIFICATION_ICONS: Record<NotificationType, typeof Bell> = {
  parking_started: CircleParking,
  parking_reminder: BellRing,
  parking_expiring: Timer,
  parking_completed: CircleCheck,
  low_balance: WalletIcon,
  topup_success: WalletIcon,
  payment_success: CircleCheck,
  payment_failed: CircleAlert,
  violation_issued: ScrollText,
  appeal_updated: Gavel,
  points_awarded: Gift,
  reward_paid: WalletIcon,
  gate_entry: CircleParking,
  overstay_warning: Timer,
  ride_request: Car,
  ride_accepted: CircleCheck,
  ride_declined: CircleAlert,
  ride_booking_cancelled: CircleAlert,
  ride_cancelled: CircleAlert,
  ride_completed: CircleCheck,
  spot_request: CircleParking,
  spot_confirmed: CircleCheck,
  spot_declined: CircleAlert,
  spot_cancelled: CircleAlert,
  spot_checked_in: CircleParking,
  spot_expired: Timer,
  system: Bell,
};

/** API/socket payloads can contain newer event types or unexpected values. */
export function getNotificationIcon(type: unknown): typeof Bell {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(NOTIFICATION_ICONS, type)
    ? NOTIFICATION_ICONS[type as NotificationType]
    : Bell;
}

/** Notices that need action get the alert tone; the rest stay neutral. */
export const ALERT_NOTIFICATION_TYPES: NotificationType[] = [
  'violation_issued',
  'payment_failed',
  'low_balance',
  'parking_expiring',
  'overstay_warning',
];

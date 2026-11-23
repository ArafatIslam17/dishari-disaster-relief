import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { formatShortTime, formatTaka } from '../i18n';
import { useApiData } from './kit';

/** Relief fund (sandbox payment gateway): shared by the donation pages and the dashboard card. */
export type PaymentMethod = 'bkash' | 'nagad' | 'rocket' | 'visa' | 'mastercard';
export type DonationStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export interface DonationReceipt {
  id: string;
  transactionId: string;
  amountBdt: number;
  status: DonationStatus;
  paymentMethod: PaymentMethod | null;
  isAnonymous: boolean;
  donorName: string | null;
  operationId: string | null;
  operationName: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface FundSummary {
  totalBdt: number;
  completedCount: number;
  latest: DonationReceipt[];
}

export function useFundSummary(operationId?: string | null) {
  return useApiData(
    (signal) => api.get<FundSummary>(`/api/donations/summary${operationId ? `?operationId=${operationId}` : ''}`, signal),
    [operationId ?? null],
  );
}

/** Donor as shown publicly: anonymous donors never carry a name. */
export function useDonorName() {
  const { t } = useTranslation();
  return (d: Pick<DonationReceipt, 'donorName' | 'isAnonymous'>) => (d.isAnonymous || !d.donorName ? t('donate.anonymousDonor') : d.donorName);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

export function RecentDonations({ items, limit = 10 }: { items: DonationReceipt[]; limit?: number }) {
  const { t } = useTranslation();
  const donor = useDonorName();
  if (items.length === 0) return <p className="muted small">{t('donate.recentEmpty')}</p>;
  return (
    <ul className="donor-list">
      {items.slice(0, limit).map((d) => {
        const anonymous = d.isAnonymous || !d.donorName;
        return (
          <li key={d.id}>
            <span className={`donor-avatar${anonymous ? ' is-anon' : ''}`} aria-hidden>
              {anonymous ? '?' : initials(d.donorName ?? '')}
            </span>
            <span className="donor-text">
              <span className="donor-name">{donor(d)}</span>
              <span className="donor-sub">
                {d.paymentMethod ? t(`donate.methods.${d.paymentMethod}`) : ''}
                {d.completedAt ? ` · ${formatShortTime(d.completedAt)}` : ''}
              </span>
            </span>
            <strong className="donor-amount">{formatTaka(d.amountBdt)}</strong>
          </li>
        );
      })}
    </ul>
  );
}

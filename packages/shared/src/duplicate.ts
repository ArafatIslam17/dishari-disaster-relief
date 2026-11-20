import {
  DUPLICATE_LIKELY_THRESHOLD,
  DUPLICATE_POSSIBLE_THRESHOLD,
  type PairLabel,
} from './constants.js';
import { boundedLevenshtein } from './phone.js';
import { haversineMetres, nameSimilarity } from './similarity.js';

/**
 * What the scorer needs about a household. `phone` is the raw normalised number
 * (server side, or the device's own organisation); `phoneHmac` is the per-operation
 * HMAC every authorised client holds (DECISIONS C5).
 */
export interface ScoringHousehold {
  headName: string;
  phone?: string | null;
  phoneHmac?: string | null;
  memberCount: number;
  unionKey: string;
  wardKey: string;
  gps?: { lat: number; lng: number } | null;
}

export interface SignalScores {
  phone: number | null;
  name: number;
  location: number;
  familySize: number;
}

export interface DuplicateScore {
  score: number;
  label: PairLabel | null;
  signals: SignalScores;
}

/** Weights from DECISIONS §4, tuned on the labelled synthetic set (docs/EVALUATION.md). */
export const DUPLICATE_WEIGHTS = {
  phone: 0.4,
  name: 0.4,
  location: 0.15,
  familySize: 0.05,
} as const;

export function phoneSignal(a: ScoringHousehold, b: ScoringHousehold): number | null {
  if (a.phone && b.phone) {
    if (a.phone === b.phone) return 1;
    return boundedLevenshtein(a.phone, b.phone, 1) <= 1 ? 0.7 : 0;
  }
  if (a.phoneHmac && b.phoneHmac) return a.phoneHmac === b.phoneHmac ? 1 : 0;
  return null;
}

export function locationSignal(a: ScoringHousehold, b: ScoringHousehold): number {
  if (a.gps && b.gps) {
    const d = haversineMetres(a.gps, b.gps);
    if (d <= 50) return 1;
    if (d <= 300) return 0.6;
    return 0;
  }
  if (a.unionKey !== b.unionKey) return 0;
  return a.wardKey === b.wardKey ? 1 : 0.4;
}

export function familySizeSignal(a: number, b: number): number {
  const d = Math.abs(a - b);
  if (d === 0) return 1;
  if (d === 1) return 0.6;
  if (d === 2) return 0.25;
  return 0;
}

/**
 * A missing phone on either side is uncertainty, not a neutral signal: renormalising it away
 * let two different people with similar names in one ward score "likely" (tuned on the labelled
 * set, docs/EVALUATION.md). It contributes a fixed low value instead.
 */
export const MISSING_PHONE_SIGNAL = 0.2;

export function labelFor(score: number): PairLabel | null {
  if (score >= DUPLICATE_LIKELY_THRESHOLD) return 'likely';
  if (score >= DUPLICATE_POSSIBLE_THRESHOLD) return 'possible';
  return null;
}

/** Weighted similarity over phone, name, location and family size (DECISIONS section 4). */
export function scoreHouseholds(
  a: ScoringHousehold,
  b: ScoringHousehold,
  weights: Record<keyof typeof DUPLICATE_WEIGHTS, number> = DUPLICATE_WEIGHTS,
  missingPhone: number = MISSING_PHONE_SIGNAL,
): DuplicateScore {
  const signals: SignalScores = {
    phone: phoneSignal(a, b),
    name: nameSimilarity(a.headName, b.headName),
    location: locationSignal(a, b),
    familySize: familySizeSignal(a.memberCount, b.memberCount),
  };
  let total = 0;
  let weightSum = 0;
  for (const key of Object.keys(weights) as (keyof typeof DUPLICATE_WEIGHTS)[]) {
    const v = key === 'phone' ? (signals.phone ?? missingPhone) : signals[key];
    total += v * weights[key];
    weightSum += weights[key];
  }
  const score = weightSum === 0 ? 0 : Math.round((total / weightSum) * 1000) / 1000;
  return { score, label: labelFor(score), signals };
}

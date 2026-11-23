import type { CoverageLabel } from '@relief/shared';

/** Coverage rolled up per upazila, as /coverage returns it (counts of 1 to 4 arrive as "<5" for the public). */
export interface UpazilaFigure {
  upazila: string;
  upazilaBn: string | null;
  registered: number | string;
  served: number | string;
  unserved: number | string;
  areas: number;
  noRecords: number;
  label: CoverageLabel;
  servedPercent: number | null;
  lastDistributionAt: string | null;
}

/**
 * Upazila centres for the live map. Feni district first (the demo operation); an upazila missing
 * here is still counted in the card, just not pinned.
 */
const PLACES: Record<string, [number, number]> = {
  'feni sadar': [23.0159, 91.3976],
  fulgazi: [23.1333, 91.4333],
  parshuram: [23.2167, 91.4333],
  chhagalnaiya: [23.0333, 91.5167],
  daganbhuiyan: [22.9333, 91.3167],
  sonagazi: [22.85, 91.3833],
};

export function placeOf(upazila: string): [number, number] | null {
  return PLACES[upazila.trim().toLowerCase().replace(/\s+/g, ' ')] ?? null;
}

export type PinKind = 'active' | 'attention';

/** Navy "active relief" once distribution has reached the area; gold while nobody there is served or nothing is recorded yet. */
export function pinKind(u: Pick<UpazilaFigure, 'label'>): PinKind {
  return u.label === 'partly_served' || u.label === 'fully_served' ? 'active' : 'attention';
}

import type { CoverageLabel } from './constants.js';

/**
 * Coverage label for one area (DECISIONS C11). A zero-household area is always
 * `no_records`, even when anonymous distributions exist, so it never looks served.
 */
export function coverageLabel(registered: number, served: number): CoverageLabel {
  if (registered <= 0) return 'no_records';
  if (served <= 0) return 'not_served';
  if (served >= registered) return 'fully_served';
  return 'partly_served';
}

/** Served percentage rounded down, so 99.6% never reads as 100%. */
export function servedPercent(registered: number, served: number): number | null {
  if (registered <= 0) return null;
  return Math.floor((Math.min(served, registered) / registered) * 100);
}

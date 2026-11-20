/**
 * `pnpm --filter @relief/api exec tsx sim/tune.ts`: tunes the duplicate scorer on a labelled synthetic
 * set drawn from the same distribution as evaluation E1 (several seeds, no database needed).
 * Thresholds stay fixed at likely >= 0.80, possible >= 0.65 (DECISIONS C12).
 */
import { DUPLICATE_POSSIBLE_THRESHOLD, scoreHouseholds, type ScoringHousehold } from '@relief/shared';
import { mistypePhone, mobile, personName, rng, varyName } from '../src/synthetic.js';

type W = { phone: number; name: number; location: number; familySize: number };
interface Rec extends ScoringHousehold {
  id: number;
}

/** Same generator as evaluate.ts E1: base set, labelled variants by another organisation, unrelated households. */
export function labelledSet(seed: number, baseN = 500, dupN = 150, negN = 300) {
  const r = rng(seed);
  const wards = ['1', '2', '3'];
  const unions = ['mirzanagar', 'amzadhat'];
  const recs: Rec[] = [];
  const truth = new Set<string>();
  let id = 0;
  const area = () => ({ unionKey: unions[Math.floor(r() * 2)] as string, wardKey: wards[Math.floor(r() * 3)] as string });
  const bases: Rec[] = [];
  for (let i = 0; i < baseN; i++) {
    const rec = { id: id++, headName: personName(r), phone: r() < 0.85 ? mobile(r) : null, memberCount: 1 + Math.floor(r() * 9), ...area() };
    bases.push(rec);
    recs.push(rec);
  }
  for (const b of [...bases].sort(() => r() - 0.5).slice(0, dupN)) {
    const p = r();
    const phone = !b.phone ? (r() < 0.5 ? mobile(r) : null) : p < 0.65 ? b.phone : p < 0.8 ? mistypePhone(r, b.phone) : null;
    const rec: Rec = {
      id: id++,
      headName: r() < 0.6 ? varyName(r, b.headName) : b.headName,
      phone,
      memberCount: r() < 0.7 ? b.memberCount : Math.max(1, b.memberCount + (r() < 0.5 ? -1 : 1)),
      unionKey: b.unionKey,
      wardKey: r() < 0.75 ? b.wardKey : (wards[Math.floor(r() * 3)] as string),
    };
    recs.push(rec);
    truth.add(`${b.id}|${rec.id}`);
  }
  for (let i = 0; i < negN; i++) recs.push({ id: id++, headName: personName(r), phone: r() < 0.85 ? mobile(r) : null, memberCount: 1 + Math.floor(r() * 9), ...area() });
  return { recs, truth };
}

interface PairSignals {
  truth: boolean;
  phone: number | null;
  name: number;
  location: number;
  familySize: number;
}

/** Signals do not depend on weights: compute them once per same-union pair. */
function pairSignals(sets: ReturnType<typeof labelledSet>[]): { pairs: PairSignals[]; positives: number } {
  const pairs: PairSignals[] = [];
  let positives = 0;
  for (const { recs, truth } of sets) {
    positives += truth.size;
    for (let i = 0; i < recs.length; i++) {
      for (let j = i + 1; j < recs.length; j++) {
        const a = recs[i] as Rec;
        const b = recs[j] as Rec;
        if (a.unionKey !== b.unionKey) continue;
        const sig = scoreHouseholds(a, b).signals;
        if (sig.name < 0.5 && sig.phone !== 1) continue; // cannot reach 0.65 under any grid point
        pairs.push({ truth: truth.has(`${a.id}|${b.id}`) || truth.has(`${b.id}|${a.id}`), ...sig });
      }
    }
  }
  return { pairs, positives };
}

function evaluate(data: ReturnType<typeof pairSignals>, w: W, missing: number) {
  let tp = 0;
  let fp = 0;
  const sum = w.phone + w.name + w.location + w.familySize;
  for (const p of data.pairs) {
    const score = ((p.phone ?? missing) * w.phone + p.name * w.name + p.location * w.location + p.familySize * w.familySize) / sum;
    if (score < DUPLICATE_POSSIBLE_THRESHOLD) continue;
    if (p.truth) tp++;
    else fp++;
  }
  return { precision: tp / Math.max(1, tp + fp), recall: tp / data.positives };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('tune.ts')) {
  const data = pairSignals([11, 22, 33].map((s) => labelledSet(s)));
  const rows: { w: W; missing: number; precision: number; recall: number }[] = [];
  for (const phone of [0.35, 0.4, 0.45, 0.5])
    for (const name of [0.3, 0.35, 0.4])
      for (const location of [0.05, 0.1, 0.15])
        for (const missing of [0.1, 0.2, 0.3]) {
          const familySize = Math.round((1 - phone - name - location) * 100) / 100;
          if (familySize < 0.05) continue;
          const w = { phone, name, location, familySize };
          rows.push({ w, missing, ...evaluate(data, w, missing) });
        }
  const current = rows.find((x) => x.w.phone === 0.4 && x.w.name === 0.35 && x.w.location === 0.1 && x.missing === 0.3);
  const ok = rows.filter((x) => x.precision >= 0.9 && x.recall >= 0.8).sort((a, b) => b.precision + b.recall - (a.precision + a.recall));
  console.info(JSON.stringify({ evaluated: rows.length, current, meetingTarget: ok.length, best: ok.slice(0, 8) }, null, 1));
}

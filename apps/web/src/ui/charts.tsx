import type { CSSProperties } from 'react';
import { formatNumber } from '../i18n';

/** Dishari charts: plain HTML/SVG, no library. Each chart carries a text alternative for screen readers. */

export interface BarDatum {
  key: string;
  label: string;
  a: number;
  b: number;
}

/** Rounds the axis maximum up to a friendly step (1, 2, 2.5 or 5 × 10^n) so gridlines read cleanly. */
function niceMax(v: number): number {
  if (v <= 0) return 4;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * exp;
}

/** Paired columns (a = registered, b = served) per category, with five horizontal gridlines. */
export function PairedBars({ data, label, aName, bName }: { data: BarDatum[]; label: string; aName: string; bName: string }) {
  const max = niceMax(Math.max(0, ...data.map((d) => Math.max(d.a, d.b))));
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(max * f));
  const summary = `${label}. ${data.map((d) => `${d.label}: ${aName} ${formatNumber(d.a)}, ${bName} ${formatNumber(d.b)}`).join('; ')}`;
  return (
    <div className="bars" role="img" aria-label={summary}>
      <div className="bars-axis" aria-hidden>
        {ticks.map((v, i) => (
          <span key={i}>{formatNumber(v)}</span>
        ))}
      </div>
      <div className="bars-plot" aria-hidden>
        <div className="bars-grid">
          {ticks.map((_, i) => (
            <span key={i} />
          ))}
        </div>
        <div className="bars-cols" style={{ gridTemplateColumns: `repeat(${Math.max(1, data.length)}, minmax(0, 1fr))` }}>
          {data.map((d, i) => (
            <div className="bars-col" key={d.key} style={{ '--i': i } as CSSProperties}>
              <div className="bars-pair">
                <span className="bar bar-a" style={{ height: `${(d.a / max) * 100}%` }} />
                <span className="bar bar-b" style={{ height: `${(d.b / max) * 100}%` }} />
              </div>
              <span className="bars-label" title={d.label}>
                {d.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export interface DonutSlice {
  key: string;
  value: number;
  className: string;
}

/** Ring chart; slices are stroke dashes on one circle so the gaps stay even. */
export function Donut({ slices, centre, centreSub, label }: { slices: DonutSlice[]; centre: string; centreSub: string; label: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const total = slices.reduce((n, s) => n + s.value, 0);
  const shown = slices.filter((s) => s.value > 0);
  const gap = shown.length > 1 ? 3 : 0;
  let offset = 0;
  return (
    <figure className="donut" role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" aria-hidden focusable="false">
        <circle className="donut-track" cx="50" cy="50" r={r} />
        {total > 0 &&
          shown.map((s) => {
            const len = (s.value / total) * c;
            const dash = Math.max(0.01, len - gap);
            const el = <circle key={s.key} className={`donut-slice ${s.className}`} cx="50" cy="50" r={r} strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offset} />;
            offset += len;
            return el;
          })}
      </svg>
      <figcaption aria-hidden>
        <strong>{centre}</strong>
        <span>{centreSub}</span>
      </figcaption>
    </figure>
  );
}

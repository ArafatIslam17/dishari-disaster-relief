import { lazy, Suspense, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ChevronRight, Download, FileText, HandCoins, House, MapPinOff, PackageCheck, Send, TriangleAlert } from 'lucide-react';
import type { CoverageLabel, DistributionDTO, HouseholdDTO } from '@relief/shared';
import { api, downloadFile } from '../api/client';
import { useSession } from '../auth/session';
import { formatNumber, formatPercent, formatTaka, formatTime } from '../i18n';
import { CountUp } from '../ui/motion';
import { RecentDonations, useFundSummary } from '../ui/fund';
import { Donut, PairedBars, type BarDatum } from '../ui/charts';
import { pinKind, placeOf, type UpazilaFigure } from '../ui/map-places';
import { useOperation, useQueueCounts } from '../layouts';
import { useNotificationText } from '../ui/notifications';
import {
  CoverageChip,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHead,
  Segmented,
  SelectField,
  ShortCode,
  StatusMark,
  StatusTag,
  TextField,
  useApiData,
  useErrorText,
  useToast,
  type MarkKind,
} from '../ui/kit';

function NeedOperation() {
  const { t } = useTranslation();
  return <Empty title={t('nav.noOperation')} mark="no_records" />;
}

function areaName(lang: string, a: { upazila: string; unionName: string; ward: string; upazilaBn?: string | null; unionBn?: string | null }) {
  const bn = lang === 'bn';
  return { upazila: bn && a.upazilaBn ? a.upazilaBn : a.upazila, union: bn && a.unionBn ? a.unionBn : a.unionName, ward: a.ward };
}

/** Figures that are 0 read lighter so the eye lands on the non-zero cells. */
function Num({ n }: { n: number | string }) {
  return <span className={Number(n) === 0 ? 'zero' : undefined}>{formatNumber(n)}</span>;
}

// ---------- UC22 View Area Coverage (FR21) ----------
interface CoverageRowDTO {
  areaId: string;
  upazila: string;
  unionName: string;
  ward: string;
  upazilaBn: string | null;
  unionBn: string | null;
  registered: number | string;
  served: number | string;
  unserved: number | string;
  anonymousDistributions: number;
  lastDistributionAt: string | null;
  label: CoverageLabel;
}

const LABEL_ORDER: CoverageLabel[] = ['fully_served', 'partly_served', 'not_served', 'no_records'];

/** Relief fund: what donors gave through the sandbox payment gateway for this operation. */
/** Leaflet loads in its own chunk the first time a map is on screen. */
const LiveMap = lazy(() => import('../ui/live-map'));

function LiveMapCard({ upazilas }: { upazilas: UpazilaFigure[] | null }) {
  const { t, i18n } = useTranslation();
  const name = (u: UpazilaFigure) => (i18n.language === 'bn' && u.upazilaBn ? u.upazilaBn : u.upazila);
  const pinned = (upazilas ?? []).filter((u) => placeOf(u.upazila));
  return (
    <section className="card map-card is-paired" aria-labelledby="map-title">
      <div className="card-head">
        <div>
          <h2 id="map-title">
            <span className="live-dot" aria-hidden />
            {t('map.title')}
          </h2>
          <p className="card-sub">{t('map.sub')}</p>
        </div>
        <ul className="map-legend" aria-label={t('map.legend')}>
          <li>
            <span className="legend-pin is-active" aria-hidden />
            {t('map.active')}
          </li>
          <li>
            <span className="legend-pin is-attention" aria-hidden />
            {t('map.attention')}
          </li>
        </ul>
      </div>
      <div className="live-map">
        {upazilas ? (
          <Suspense fallback={<Loading rows={3} />}>
            <LiveMap upazilas={upazilas} />
          </Suspense>
        ) : (
          <Loading rows={3} />
        )}
      </div>
      {pinned.length > 0 && (
        <ul className="visually-hidden" aria-label={t('map.listLabel')}>
          {pinned.map((u) => (
            <li key={u.upazila}>
              {t('map.listItem', { name: name(u), status: t(`map.${pinKind(u)}`), registered: formatNumber(u.registered), served: formatNumber(u.served) })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FundCard({ operationId }: { operationId: string | null }) {
  const { t } = useTranslation();
  const fund = useFundSummary(operationId);
  return (
    <section className="card fund-card is-paired" aria-labelledby="fund-title">
      <div className="card-head">
        <div>
          <h2 id="fund-title">{t('donate.fundTitle')}</h2>
          <p className="card-sub">{t('donate.fundSub')}</p>
        </div>
        <span className="kpi-icon tone-tile-gold" aria-hidden>
          <HandCoins size={20} />
        </span>
      </div>
      {fund.error ? (
        <p className="muted small">{t('errors.unexpected')}</p>
      ) : !fund.data ? (
        <Loading rows={2} />
      ) : (
        <>
          <p className="fund-figure">
            <span className="visually-hidden">{t('donate.totalRaised')}: </span>
            <CountUp value={Number(fund.data.totalBdt)} format={formatTaka} duration={1100} />
          </p>
          <p className="fund-count">{t('donate.donations', { count: fund.data.completedCount, n: formatNumber(fund.data.completedCount) })}</p>
          <RecentDonations items={fund.data.latest} limit={4} />
        </>
      )}
      <p className="card-foot">
        <Link to="/donate">{t('donate.fundOpen')}</Link>
      </p>
    </section>
  );
}

export function CoveragePage() {
  const { t, i18n } = useTranslation();
  const { current, publicView } = useOperation();
  const session = useSession();
  // The public portal sees exactly what an observer sees.
  const role = publicView ? 'OBSERVER' : session.role;
  const base = publicView ? '/api/public/operations' : '/api/operations';
  const [params, setParams] = useSearchParams();
  const filter = { upazila: params.get('upazila') ?? '', union: params.get('union') ?? '', ward: params.get('ward') ?? '' };
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
  const all = useApiData(
    (signal) => (current ? api.get<{ rows: CoverageRowDTO[]; upazilas: UpazilaFigure[] }>(`${base}/${current.id}/coverage`, signal) : Promise.resolve(null)),
    [current?.id, base],
  );
  const data = useApiData(
    (signal) =>
      current
        ? api.get<{ rows: CoverageRowDTO[]; upazilas?: UpazilaFigure[]; totals: { registered: number; served: number; areas: number; noRecords: number }; lastUpdated: string | null; generatedAt: string }>(
            `${base}/${current.id}/coverage?${qs}`,
            signal,
          )
        : Promise.resolve(null),
    [current?.id, qs, base],
  );
  const queues = useQueueCounts(publicView ? null : (role ?? null), current?.id, 'coverage');
  if (!current) return <NeedOperation />;
  const options = (key: 'upazila' | 'unionName' | 'ward') =>
    [...new Set((all.data?.rows ?? []).filter((r) => (key === 'upazila' ? true : !filter.upazila || r.upazila === filter.upazila) && (key !== 'ward' || !filter.union || r.unionName === filter.union)).map((r) => r[key]))].sort();
  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === 'upazila') {
      next.delete('union');
      next.delete('ward');
    }
    if (k === 'union') next.delete('ward');
    setParams(next, { replace: true });
  };
  const rows = data.data?.rows ?? [];
  const byLabel = Object.fromEntries(LABEL_ORDER.map((l) => [l, rows.filter((r) => r.label === l).length])) as Record<CoverageLabel, number>;
  const coordinator = role === 'GROUP_COORDINATOR';
  const totals = data.data?.totals ?? { registered: 0, served: 0, areas: 0, noRecords: 0 };
  const unservedTotal = Math.max(0, Number(totals.registered) - Number(totals.served));
  const servedRatio = Number(totals.registered) > 0 ? Number(totals.served) / Number(totals.registered) : 0;
  // Group by the next level down from the current filter: upazila, then union, then ward.
  const groupKey = (r: CoverageRowDTO) => {
    const n = areaName(i18n.language, r);
    if (filter.union) return { key: r.ward, label: `${t('coverage.ward')} ${r.ward}` };
    if (filter.upazila) return { key: r.unionName, label: n.union };
    return { key: r.upazila, label: n.upazila };
  };
  const grouped = new Map<string, BarDatum>();
  for (const r of rows) {
    const g = groupKey(r);
    const cur = grouped.get(g.key) ?? { key: g.key, label: g.label, a: 0, b: 0 };
    cur.a += Number(r.registered) || 0;
    cur.b += Number(r.served) || 0;
    grouped.set(g.key, cur);
  }
  // Ward cells of 1 to 4 arrive as "<5" for observers and the public, so the top level charts the
  // upazila rollup (suppressed only at upazila level) instead of summing suppressed ward cells.
  if (!filter.upazila && data.data?.upazilas) {
    grouped.clear();
    for (const u of data.data.upazilas) {
      const label = areaName(i18n.language, { upazila: u.upazila, upazilaBn: u.upazilaBn, unionName: '', ward: '' }).upazila;
      grouped.set(u.upazila, { key: u.upazila, label, a: Number(u.registered) || 0, b: Number(u.served) || 0 });
    }
  }
  const bars = [...grouped.values()].sort((x, y) => y.a - x.a).slice(0, 8);
  const firstNotServed = rows.find((r) => r.label === 'not_served');
  const queueItems: { key: string; title: string; sub: string; count: number; mark: MarkKind; to?: string; urgent?: boolean }[] = [];
  const qc = queues.data ?? {};
  if (qc.conflicts) queueItems.push({ key: 'conflicts', title: t('coverage.queueConflicts'), sub: t('coverage.queueConflictsSub'), count: qc.conflicts, mark: 'conflict', to: '/app/conflicts', urgent: true });
  if (qc.duplicates) queueItems.push({ key: 'duplicates', title: t('coverage.queueDuplicates'), sub: t('coverage.queueDuplicatesSub'), count: qc.duplicates, mark: 'duplicate', to: '/app/duplicates', urgent: true });
  if (qc.flags) queueItems.push({ key: 'flags', title: t('coverage.queueFlags'), sub: t('coverage.queueFlagsSub'), count: qc.flags, mark: 'failed', to: '/app/flags' });
  if (byLabel.not_served > 0)
    queueItems.push({
      key: 'not_served',
      title: t('coverage.queueNotServed'),
      sub: t('coverage.queueNotServedSub'),
      count: byLabel.not_served,
      mark: 'not_served',
      to: coordinator && firstNotServed ? `/app/coverage/${firstNotServed.areaId}/unserved` : undefined,
    });
  if (byLabel.no_records > 0) queueItems.push({ key: 'no_records', title: t('coverage.queueNoRecords'), sub: t('coverage.queueNoRecordsSub'), count: byLabel.no_records, mark: 'no_records' });
  const clear = (
    <button type="button" className="btn btn-ghost" onClick={() => setParams({}, { replace: true })}>
      {t('common.clear')}
    </button>
  );
  return (
    <>
      <PageHead title={t('coverage.title')} lead={t('coverage.intro')} />
      {role === 'OBSERVER' && <Notice>{t('coverage.observerNote')}</Notice>}
      <div className="toolbar" role="search" aria-label={t('coverage.filters')}>
        <SelectField label={t('coverage.filterUpazila')} value={filter.upazila} onChange={(e) => setFilter('upazila', e.target.value)}>
          <option value="">{t('coverage.all')}</option>
          {options('upazila').map((o) => (
            <option key={o}>{o}</option>
          ))}
        </SelectField>
        <SelectField label={t('coverage.filterUnion')} value={filter.union} onChange={(e) => setFilter('union', e.target.value)}>
          <option value="">{t('coverage.all')}</option>
          {options('unionName').map((o) => (
            <option key={o}>{o}</option>
          ))}
        </SelectField>
        <SelectField label={t('coverage.filterWard')} value={filter.ward} onChange={(e) => setFilter('ward', e.target.value)}>
          <option value="">{t('coverage.all')}</option>
          {options('ward').map((o) => (
            <option key={o}>{o}</option>
          ))}
        </SelectField>
        {qs && clear}
      </div>
      {data.loading && !data.data && <Loading rows={6} />}
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.data && (
        <>
          <section className="kpi-grid" aria-label={t('coverage.summary')}>
            <article className="kpi">
              <div className="kpi-head">
                <h2 className="kpi-label">{t('coverage.registered')}</h2>
                <span className="kpi-icon tone-tile-navy" aria-hidden>
                  <House size={20} />
                </span>
              </div>
              <p className="kpi-figure">
                <CountUp value={Number(totals.registered)} />
              </p>
              <p className="kpi-foot tone-foot-sky">{t('coverage.kpiAreas', { count: Number(totals.areas), n: formatNumber(totals.areas) })}</p>
            </article>
            <article className="kpi">
              <div className="kpi-head">
                <h2 className="kpi-label">{t('coverage.served')}</h2>
                <span className="kpi-icon tone-tile-teal" aria-hidden>
                  <PackageCheck size={20} />
                </span>
              </div>
              <p className="kpi-figure">
                <CountUp value={Number(totals.served)} />
              </p>
              <p className="kpi-foot tone-foot-ok">
                <StatusMark kind="served" />
                {t('coverage.kpiRate', { pct: formatPercent(servedRatio) })}
              </p>
            </article>
            <article className="kpi">
              <div className="kpi-head">
                <h2 className="kpi-label">{t('coverage.unserved')}</h2>
                <span className="kpi-icon tone-tile-gold" aria-hidden>
                  <TriangleAlert size={20} />
                </span>
              </div>
              <p className="kpi-figure">
                <CountUp value={unservedTotal} />
              </p>
              <p className="kpi-foot tone-foot-gold">
                <StatusMark kind="not_served" />
                {t('coverage.kpiStillWaiting')}
              </p>
            </article>
            <article className="kpi">
              <div className="kpi-head">
                <h2 className="kpi-label">{t('coverage.noRecordAreasLabel')}</h2>
                <span className="kpi-icon tone-tile-slate" aria-hidden>
                  <MapPinOff size={20} />
                </span>
              </div>
              <p className="kpi-figure">
                <CountUp value={Number(totals.noRecords)} />
              </p>
              <p className="kpi-foot tone-foot-slate">
                <StatusMark kind="no_records" />
                {t('coverage.kpiNoRecords')}
              </p>
            </article>
          </section>
          <div className="dash-grid">
            <section className="card chart-card" aria-labelledby="by-area-title">
              <div className="card-head">
                <div>
                  <h2 id="by-area-title">{t('coverage.byAreaTitle')}</h2>
                  <p className="card-sub">{t('coverage.byAreaSub')}</p>
                </div>
                <ul className="chart-key" aria-hidden>
                  <li>
                    <span className="key-swatch key-a" />
                    {t('coverage.registered')}
                  </li>
                  <li>
                    <span className="key-swatch key-b" />
                    {t('coverage.served')}
                  </li>
                </ul>
              </div>
              {bars.length > 0 ? (
                <PairedBars data={bars} label={t('coverage.byAreaChart')} aName={t('coverage.registered')} bName={t('coverage.served')} />
              ) : (
                <p className="muted small">{t('common.noResults')}</p>
              )}
              <p className="card-foot">
                <span>{t('common.lastUpdated', { time: formatTime(data.data.lastUpdated) })}</span>
                <span className="subtle">{t('coverage.notSyncedNote')}</span>
              </p>
            </section>
            <div className="dash-side">
              <section className="card" aria-labelledby="breakdown-title">
                <div className="card-head">
                  <h2 id="breakdown-title">{t('coverage.breakdownTitle')}</h2>
                  <span className="card-meta">{t('coverage.breakdownTotal', { count: rows.length, n: formatNumber(rows.length) })}</span>
                </div>
                <div className="breakdown">
                  <Donut
                    label={`${t('coverage.breakdownTitle')}: ${LABEL_ORDER.map((l) => `${t(`coverage.${l}`)} ${formatNumber(byLabel[l])}`).join(', ')}`}
                    centre={formatPercent(servedRatio)}
                    centreSub={t('coverage.breakdownCentre')}
                    slices={LABEL_ORDER.map((l) => ({ key: l, value: byLabel[l], className: `slice-${l}` }))}
                  />
                  <ul className="legend legend-stack" aria-label={t('coverage.byLabel')}>
                    {LABEL_ORDER.map((l) => (
                      <li key={l}>
                        <span className={`key-dot slice-${l}`} aria-hidden />
                        <span className="grow">{t(`coverage.${l}`)}</span>
                        <strong>{formatNumber(byLabel[l])}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
              <section className="card" aria-labelledby="queue-title">
                <div className="card-head">
                  <div>
                    <h2 id="queue-title">{t('coverage.queueTitle')}</h2>
                    <p className="card-sub">{t('coverage.queueSub')}</p>
                  </div>
                  {queueItems.length > 0 && <span className="badge-count">{formatNumber(queueItems.length)}</span>}
                </div>
                {queueItems.length === 0 ? (
                  <p className="queue-empty">
                    <StatusMark kind="synced" />
                    {t('coverage.queueEmpty')}
                  </p>
                ) : (
                  <ul className="queue">
                    {queueItems.map((q) => {
                      const body = (
                        <>
                          <span className={`queue-mark tone-${q.mark}`} aria-hidden>
                            <StatusMark kind={q.mark} size={14} />
                          </span>
                          <span className="queue-text">
                            <span className="queue-title">{q.title}</span>
                            <span className="queue-sub">{q.sub}</span>
                          </span>
                          <span className="queue-count">{formatNumber(q.count)}</span>
                          {q.to && <span className={`queue-cta${q.urgent ? ' is-urgent' : ''}`}>{t('coverage.queueOpen')}</span>}
                        </>
                      );
                      return (
                        <li key={q.key}>
                          {q.to ? (
                            <Link className="queue-item" to={q.to}>
                              {body}
                            </Link>
                          ) : (
                            <div className="queue-item">{body}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
            <LiveMapCard upazilas={all.data?.upazilas ?? null} />
            <FundCard operationId={current?.id ?? null} />
          </div>
          <section className="card table-card" aria-labelledby="ward-table-title">
            <div className="card-head">
              <div>
                <h2 id="ward-table-title">{t('coverage.tableTitle')}</h2>
                <p className="card-sub">{t('coverage.tableSub')}</p>
              </div>
            </div>
          {rows.length === 0 ? (
            <Empty title={t('common.noResults')} mark="no_records" action={qs ? clear : undefined} />
          ) : (
            <div className="table-wrap stack-table" tabIndex={0} role="region" aria-label={t('coverage.title')}>
              <table>
                <caption className="visually-hidden">{t('coverage.title')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('coverage.area')}</th>
                    <th scope="col">{t('coverage.label')}</th>
                    <th scope="col" className="num">
                      {t('coverage.registered')}
                    </th>
                    <th scope="col" className="num">
                      {t('coverage.served')}
                    </th>
                    <th scope="col" className="num">
                      {t('coverage.unserved')}
                    </th>
                    <th scope="col" className="num">
                      {t('coverage.anonymous')}
                    </th>
                    <th scope="col">{t('coverage.lastDistribution')}</th>
                    {coordinator && <th scope="col">{t('common.actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const n = areaName(i18n.language, r);
                    return (
                      <tr key={r.areaId}>
                        <td className="stack-head">
                          {n.upazila}, {n.union}
                          <span className="cell-sub">
                            {t('coverage.ward')} {n.ward}
                          </span>
                        </td>
                        <td data-label={t('coverage.label')}>
                          <CoverageChip label={r.label} />
                        </td>
                        <td className="num" data-label={t('coverage.registered')}>
                          <Num n={r.registered} />
                        </td>
                        <td className="num" data-label={t('coverage.served')}>
                          <Num n={r.served} />
                        </td>
                        <td className="num" data-label={t('coverage.unserved')}>
                          <Num n={r.unserved} />
                        </td>
                        <td className="num" data-label={t('coverage.anonymous')}>
                          <Num n={r.anonymousDistributions} />
                        </td>
                        <td data-label={t('coverage.lastDistribution')} className="nowrap">
                          {r.lastDistributionAt ? formatTime(r.lastDistributionAt) : <span className="zero">—</span>}
                        </td>
                        {coordinator && (
                          <td>
                            {Number(r.unserved) > 0 && (
                              <Link className="row-link" to={`/app/coverage/${r.areaId}/unserved`}>
                                {t('coverage.unservedLink')}
                              </Link>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          </section>
        </>
      )}
    </>
  );
}

// ---------- UC21 View Unserved Households (FR22) ----------
export function UnservedPage() {
  const { areaId = '' } = useParams();
  const { t } = useTranslation();
  const { current } = useOperation();
  const toast = useToast();
  const errorText = useErrorText();
  const data = useApiData(
    (signal) =>
      current ? api.get<{ households: HouseholdDTO[]; lastUpdated: string | null }>(`/api/operations/${current.id}/areas/${areaId}/unserved`, signal) : Promise.resolve(null),
    [current?.id, areaId],
  );
  const [sending, setSending] = useState(false);
  if (!current) return <NeedOperation />;
  const release = async () => {
    setSending(true);
    try {
      await api.post(`/api/operations/${current.id}/areas/${areaId}/unserved/release`);
      toast(t('unserved.releasedOk'));
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setSending(false);
    }
  };
  const households = data.data?.households ?? [];
  return (
    <>
      <PageHead
        title={t('unserved.title')}
        lead={t('unserved.dashIntro')}
        back={{ to: '/app/coverage', label: t('coverage.title') }}
        actions={
          households.length > 0 ? (
            <button type="button" className="btn btn-primary" disabled={sending || current.status !== 'active'} onClick={() => void release()}>
              <Send size={18} aria-hidden />
              {t('unserved.release')}
            </button>
          ) : undefined
        }
        meta={data.data ? <span>{t('common.lastUpdated', { time: formatTime(data.data.lastUpdated) })}</span> : undefined}
      />
      {data.loading && <Loading />}
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.data && households.length === 0 && <Empty title={t('unserved.allServed')} mark="served" />}
      {households.length > 0 && (
        <div className="table-wrap stack-table" tabIndex={0} role="region" aria-label={t('unserved.title')}>
          <table>
            <caption className="visually-hidden">{t('unserved.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('household.shortCode')}</th>
                <th scope="col">{t('household.headName')}</th>
                <th scope="col" className="num">
                  {t('household.members')}
                </th>
                <th scope="col">{t('common.organisation')}</th>
                <th scope="col">{t('households.registered')}</th>
              </tr>
            </thead>
            <tbody>
              {households.map((h) => (
                <tr key={h.id}>
                  <td className="stack-head">
                    <Link to={`/app/households/${h.id}`}>
                      <ShortCode code={h.shortCode} size="sm" />
                    </Link>
                  </td>
                  <td data-label={t('household.headName')}>{h.headName}</td>
                  <td className="num" data-label={t('household.members')}>
                    {formatNumber(h.memberCount)}
                  </td>
                  <td data-label={t('common.organisation')}>{h.organisationName}</td>
                  <td data-label={t('households.registered')} className="nowrap">
                    {formatTime(h.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------- UC17 Resolve Conflicts (FR17) ----------
interface ConflictDTO {
  id: string;
  householdId: string;
  shortCode: string;
  fieldName: string;
  localValue: unknown;
  serverValue: unknown;
  resolvedValue: unknown;
  status: string;
  createdAt: string;
  localUserName: string;
  localOrganisationName: string;
  localDeviceLabel: string;
  localTime: string;
  serverUserName: string | null;
  serverOrganisationName: string | null;
  serverDeviceLabel: string | null;
  serverTime: string | null;
  canResolve: boolean;
}

function showValue(field: string, v: unknown, t: (k: string) => string): string {
  if (v === null || v === undefined) return '—';
  if (field === 'gps') return v === 'hidden' ? t('household.mobileHidden') : `${(v as { lat: number }).lat}, ${(v as { lng: number }).lng}`;
  return String(v);
}

export function ConflictsPage() {
  const { t } = useTranslation();
  const { current } = useOperation();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') === 'resolved' ? 'resolved' : 'open';
  const data = useApiData(
    (signal) => (current ? api.get<{ conflicts: ConflictDTO[] }>(`/api/conflicts?operationId=${current.id}&status=${status}`, signal) : Promise.resolve(null)),
    [current?.id, status],
  );
  if (!current) return <NeedOperation />;
  return (
    <>
      <PageHead
        title={t('conflicts.title')}
        lead={t('conflicts.intro')}
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => setParams(status === 'open' ? { status: 'resolved' } : {})}>
            {status === 'open' ? t('conflicts.showResolved') : t('conflicts.showOpen')}
          </button>
        }
      />
      {data.loading && <Loading />}
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.data && data.data.conflicts.length === 0 && (
        <Empty title={status === 'open' ? t('conflicts.none') : t('conflicts.noneResolved')} mark="synced">
          {status === 'open' ? t('conflicts.noneHint') : undefined}
        </Empty>
      )}
      {data.data && data.data.conflicts.length > 0 && (
        <div className="table-wrap stack-table" tabIndex={0} role="region" aria-label={t('conflicts.title')}>
          <table>
            <caption className="visually-hidden">{t('conflicts.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('household.shortCode')}</th>
                <th scope="col">{t('conflicts.field')}</th>
                <th scope="col">{t('conflicts.current')}</th>
                <th scope="col">{t('conflicts.incoming')}</th>
                <th scope="col">{t('common.time')}</th>
                <th scope="col">{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {data.data.conflicts.map((c) => (
                <tr key={c.id}>
                  <td className="stack-head">
                    <Link to={`/app/conflicts/${c.id}`}>
                      <ShortCode code={c.shortCode} size="sm" />
                    </Link>
                  </td>
                  <td data-label={t('conflicts.field')}>{t(`conflicts.fields.${c.fieldName}`)}</td>
                  <td data-label={t('conflicts.current')}>{showValue(c.fieldName, c.serverValue, t)}</td>
                  <td data-label={t('conflicts.incoming')}>{showValue(c.fieldName, c.localValue, t)}</td>
                  <td data-label={t('common.time')} className="nowrap">
                    {formatTime(c.createdAt)}
                  </td>
                  <td data-label={t('common.status')}>
                    <StatusTag status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function ConflictDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const errorText = useErrorText();
  const data = useApiData((signal) => api.get<{ conflict: ConflictDTO }>(`/api/conflicts/${id}`, signal), [id]);
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (data.loading) return <Loading />;
  if (data.error || !data.data) return <ErrorState error={data.error} onRetry={data.reload} />;
  const c = data.data.conflict;
  const resolve = async (value: unknown) => {
    setError(null);
    try {
      await api.post(`/api/conflicts/${id}/resolve`, { value });
      toast(t('conflicts.resolved'));
      navigate('/app/conflicts');
    } catch (err) {
      setError(`${t('conflicts.notSaved')} ${errorText(err)}`);
    }
  };
  const parseCustom = () => (c.fieldName === 'memberCount' ? parseInt(custom, 10) : custom.trim());
  const by = (who: string | null, org: string | null, device: string | null, time: string | null) =>
    t('conflicts.enteredBy', { user: who ?? '—', org: org ?? '—', device: device ?? '—', time: formatTime(time) });
  const editable = c.status === 'open' && c.canResolve && c.fieldName !== 'gps' && c.fieldName !== 'areaId';
  return (
    <>
      <PageHead
        title={t(`conflicts.fields.${c.fieldName}`)}
        back={{ to: '/app/conflicts', label: t('conflicts.title') }}
        meta={
          <>
            <ShortCode code={c.shortCode} size="sm" />
            <StatusTag status={c.status} />
            <Link to={`/app/households/${c.householdId}`}>{t('households.history')}</Link>
          </>
        }
      />
      {!c.canResolve && <Notice tone="warn">{t('conflicts.mobileOnly')}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="compare">
        {[
          { title: t('conflicts.current'), value: c.serverValue, who: by(c.serverUserName, c.serverOrganisationName, c.serverDeviceLabel, c.serverTime) },
          { title: t('conflicts.incoming'), value: c.localValue, who: by(c.localUserName, c.localOrganisationName, c.localDeviceLabel, c.localTime) },
        ].map((side) => (
          <section key={side.title} className="compare-side" aria-label={side.title}>
            <h2>{side.title}</h2>
            <p className="compare-value">{showValue(c.fieldName, side.value, t)}</p>
            <p className="compare-by">{side.who}</p>
            {c.status === 'open' && c.canResolve && side.value !== 'hidden' && (
              <div>
                <button type="button" className="btn btn-primary" onClick={() => void resolve(side.value)}>
                  {t('conflicts.choose')}
                </button>
              </div>
            )}
          </section>
        ))}
      </div>
      {c.status === 'resolved' && <Notice tone="ok">{`${t('statuses.resolved')}: ${showValue(c.fieldName, c.resolvedValue, t)}`}</Notice>}
      {editable && (
        <form
          className="panel"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void resolve(parseCustom());
          }}
        >
          <TextField
            label={t('conflicts.custom')}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            inputMode={c.fieldName === 'memberCount' ? 'numeric' : 'text'}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={!custom.trim()}>
              {t('conflicts.resolve')}
            </button>
            <Link className="btn btn-ghost" to="/app/conflicts">
              {t('conflicts.leaveOpen')}
            </Link>
          </div>
        </form>
      )}
    </>
  );
}

// ---------- UC18 Review Possible Duplicates (FR19) ----------
interface PairRow {
  id: string;
  score: number;
  label: string;
  status: string;
  shortCodeA: string;
  shortCodeB: string;
  headNameA: string | null;
  headNameB: string | null;
  organisationA: string;
  organisationB: string;
  createdAt: string;
}

type PairStatus = 'pending_review' | 'linked' | 'not_duplicate';

export function DuplicatesPage() {
  const { t } = useTranslation();
  const { current } = useOperation();
  const [params, setParams] = useSearchParams();
  const status = (['linked', 'not_duplicate'].includes(params.get('status') ?? '') ? params.get('status') : 'pending_review') as PairStatus;
  const data = useApiData(
    (signal) => (current ? api.get<{ pairs: PairRow[] }>(`/api/duplicates?operationId=${current.id}&status=${status}`, signal) : Promise.resolve(null)),
    [current?.id, status],
  );
  if (!current) return <NeedOperation />;
  return (
    <>
      <PageHead title={t('duplicates.title')} lead={t('duplicates.intro')} />
      <Segmented<PairStatus>
        label={t('common.status')}
        value={status}
        onChange={(s) => setParams({ status: s })}
        options={(['pending_review', 'linked', 'not_duplicate'] as const).map((s) => ({ value: s, label: t(`duplicates.tabs.${s}`) }))}
      />
      {data.loading && <Loading />}
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.data && data.data.pairs.length === 0 && <Empty title={t('duplicates.none')} mark="duplicate" />}
      {data.data && data.data.pairs.length > 0 && (
        <div className="table-wrap stack-table" tabIndex={0} role="region" aria-label={t('duplicates.title')}>
          <table>
            <caption className="visually-hidden">{t('duplicates.title')}</caption>
            <thead>
              <tr>
                <th scope="col" className="num">
                  {t('duplicates.score')}
                </th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col">{t('duplicates.householdA')}</th>
                <th scope="col">{t('duplicates.householdB')}</th>
                <th scope="col">{t('common.time')}</th>
              </tr>
            </thead>
            <tbody>
              {data.data.pairs.map((p) => (
                <tr key={p.id}>
                  <td className="num stack-head">
                    <Link className="row-link" to={`/app/duplicates/${p.id}`}>
                      {formatNumber(Math.round(p.score * 100))}%
                    </Link>
                  </td>
                  <td data-label={t('common.status')}>
                    <StatusTag status={p.label} />
                  </td>
                  <td data-label={t('duplicates.householdA')}>
                    <span>
                      {p.headNameA} <ShortCode code={p.shortCodeA} size="sm" />
                      <span className="cell-sub">{p.organisationA}</span>
                    </span>
                  </td>
                  <td data-label={t('duplicates.householdB')}>
                    <span>
                      {p.headNameB} <ShortCode code={p.shortCodeB} size="sm" />
                      <span className="cell-sub">{p.organisationB}</span>
                    </span>
                  </td>
                  <td data-label={t('common.time')} className="nowrap">
                    {formatTime(p.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function DuplicateDetailPage() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const data = useApiData(
    (signal) =>
      api.get<{
        pair: {
          id: string;
          score: number;
          label: string;
          status: string;
          signals: Record<string, number | null>;
          a: HouseholdDTO;
          b: HouseholdDTO;
          areas: { area_id: string; upazila: string; union_name: string; ward: string }[];
        };
      }>(`/api/duplicates/${id}`, signal),
    [id],
  );
  if (data.loading && !data.data) return <Loading />;
  if (data.error || !data.data) return <ErrorState error={data.error} onRetry={data.reload} />;
  const p = data.data.pair;
  const act = async (path: 'link' | 'not-duplicate' | 'undo', message: string) => {
    try {
      await api.post(`/api/duplicates/${id}/${path}`);
      toast(message);
      data.reload();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };
  const area = (aid: string) => {
    const a = p.areas.find((x) => x.area_id === aid);
    return a ? `${a.upazila}, ${a.union_name}, ${i18n.language === 'bn' ? 'ওয়ার্ড' : 'ward'} ${a.ward}` : '';
  };
  const fields: { key: string; label: string; a: string; b: string }[] = [
    { key: 'name', label: t('household.headName'), a: p.a.headName ?? '—', b: p.b.headName ?? '—' },
    { key: 'mobile', label: t('household.mobile'), a: p.a.mobile ?? p.a.mobileMasked ?? '—', b: p.b.mobile ?? p.b.mobileMasked ?? '—' },
    { key: 'members', label: t('household.members'), a: formatNumber(p.a.memberCount), b: formatNumber(p.b.memberCount) },
    { key: 'area', label: t('household.area'), a: area(p.a.areaId), b: area(p.b.areaId) },
    { key: 'org', label: t('common.organisation'), a: p.a.organisationName, b: p.b.organisationName },
  ];
  return (
    <>
      <PageHead
        title={`${t('duplicates.pairTitle')}: ${formatNumber(Math.round(p.score * 100))}%`}
        back={{ to: '/app/duplicates', label: t('duplicates.title') }}
        meta={
          <>
            <StatusTag status={p.label} />
            <StatusTag status={p.status} />
          </>
        }
      />
      <div className="grid-2">
        <section className="panel" aria-labelledby="signals-title">
          <h2 id="signals-title">{t('duplicates.signals')}</h2>
          {(['phone', 'name', 'location', 'familySize'] as const).map((s) => {
            const v = p.signals[s];
            const pct = v === null || v === undefined ? null : Math.round(v * 100);
            return (
              <div key={s} className="signal-meter">
                <span className="small">{t(`duplicates.signal.${s}`)}</span>
                <span className="bar" aria-hidden>
                  <span style={{ width: `${pct ?? 0}%` }} />
                </span>
                <span className="pct">{pct === null ? '—' : `${formatNumber(pct)}%`}</span>
              </div>
            );
          })}
        </section>
        <section className="panel" aria-labelledby="codes-title">
          <h2 id="codes-title">{t('duplicates.codes')}</h2>
          <dl className="dl">
            <dt>{t('duplicates.householdA')}</dt>
            <dd>
              <ShortCode code={p.a.shortCode} size="sm" /> · <Link to={`/app/households/${p.a.id}`}>{t('households.history')}</Link>
            </dd>
            <dt>{t('duplicates.householdB')}</dt>
            <dd>
              <ShortCode code={p.b.shortCode} size="sm" /> · <Link to={`/app/households/${p.b.id}`}>{t('households.history')}</Link>
            </dd>
          </dl>
        </section>
      </div>
      <div className="diff" role="table" aria-label={t('duplicates.compare')}>
        <div className="diff-row head" role="row">
          <span className="k" role="columnheader">
            {t('duplicates.detail')}
          </span>
          <span role="columnheader">{t('duplicates.householdA')}</span>
          <span role="columnheader">{t('duplicates.householdB')}</span>
        </div>
        {fields.map((f) => {
          const differs = f.a !== f.b;
          return (
            <div key={f.key} className={`diff-row${differs ? ' differs' : ''}`} role="row">
              <span className="k" role="rowheader">
                {f.label}
                {differs && (
                  <span className="diff-flag">
                    <StatusMark kind="conflict" size={10} />
                    {t('duplicates.differs')}
                  </span>
                )}
              </span>
              <span className="v" role="cell">
                {f.a}
              </span>
              <span className="v" role="cell">
                {f.b}
              </span>
            </div>
          );
        })}
      </div>
      <div className="decision-bar">
        <span className="grow">{p.status === 'pending_review' ? t('duplicates.decide') : t(`duplicates.decided.${p.status}`, { defaultValue: '' })}</span>
        {p.status === 'pending_review' && (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => void act('not-duplicate', t('duplicates.notDuplicate'))}>
              {t('duplicates.different')}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void act('link', t('duplicates.linked'))}>
              {t('duplicates.same')}
            </button>
          </>
        )}
        {p.status === 'linked' && (
          <button type="button" className="btn btn-danger" onClick={() => void act('undo', t('duplicates.undone'))}>
            {t('duplicates.undo')}
          </button>
        )}
      </div>
    </>
  );
}

// ---------- UC19 Review Duplicate Distribution Flags (FR20) ----------
interface FlagRow {
  id: string;
  status: string;
  note: string | null;
  itemName: string;
  itemNameBn: string | null;
  unit: string;
  firstAt: string;
  firstOrganisation: string;
  firstQuantity: number;
  firstShortCode: string | null;
  firstStatus: string;
  secondAt: string;
  secondOrganisation: string;
  secondQuantity: number;
  secondShortCode: string | null;
  secondStatus: string;
  createdAt: string;
  reviewedByName: string | null;
  householdInDuplicateReview: boolean;
}

export function FlagsPage() {
  const { t, i18n } = useTranslation();
  const { current } = useOperation();
  const [params, setParams] = useSearchParams();
  const reviewed = params.get('status') === 'reviewed';
  const data = useApiData(
    (signal) => (current ? api.get<{ flags: FlagRow[] }>(`/api/flags?operationId=${current.id}&status=${reviewed ? 'reviewed' : 'pending'}`, signal) : Promise.resolve(null)),
    [current?.id, reviewed],
  );
  if (!current) return <NeedOperation />;
  return (
    <>
      <PageHead
        title={t('flags.title')}
        lead={t('flags.intro')}
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => setParams(reviewed ? {} : { status: 'reviewed' })}>
            {reviewed ? t('flags.showPending') : t('flags.showReviewed')}
          </button>
        }
      />
      {data.loading && <Loading />}
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.data && data.data.flags.length === 0 && <Empty title={t('flags.none')} mark="synced" />}
      {data.data && data.data.flags.length > 0 && (
        <div className="table-wrap stack-table" tabIndex={0} role="region" aria-label={t('flags.title')}>
          <table>
            <caption className="visually-hidden">{t('flags.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('flags.item')}</th>
                <th scope="col">{t('flags.first')}</th>
                <th scope="col">{t('flags.second')}</th>
                <th scope="col">{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {data.data.flags.map((f) => (
                <tr key={f.id}>
                  <td className="stack-head">
                    <Link className="row-link" to={`/app/flags/${f.id}`}>
                      {i18n.language === 'bn' && f.itemNameBn ? f.itemNameBn : f.itemName}
                    </Link>
                  </td>
                  <td data-label={t('flags.first')}>
                    <span>
                      {f.firstOrganisation}
                      <span className="cell-sub">{formatTime(f.firstAt)}</span>
                    </span>
                  </td>
                  <td data-label={t('flags.second')}>
                    <span>
                      {f.secondOrganisation}
                      <span className="cell-sub">{formatTime(f.secondAt)}</span>
                    </span>
                  </td>
                  <td data-label={t('common.status')}>
                    <StatusTag status={f.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function FlagDetailPage() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const errorText = useErrorText();
  const data = useApiData((signal) => api.get<{ flag: FlagRow }>(`/api/flags/${id}`, signal), [id]);
  const [decision, setDecision] = useState<'justified' | 'repeat'>('repeat');
  const [note, setNote] = useState('');
  if (data.loading && !data.data) return <Loading />;
  if (data.error || !data.data) return <ErrorState error={data.error} onRetry={data.reload} />;
  const f = data.data.flag;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/api/flags/${id}/review`, { decision, note });
      toast(t('flags.saved'));
      data.reload();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };
  const item = i18n.language === 'bn' && f.itemNameBn ? f.itemNameBn : f.itemName;
  return (
    <>
      <PageHead title={item} back={{ to: '/app/flags', label: t('flags.title') }} meta={<StatusTag status={f.status} />} />
      {f.householdInDuplicateReview && <Notice tone="warn">{t('flags.inReview')}</Notice>}
      <div className="compare">
        {[
          { title: t('flags.first'), org: f.firstOrganisation, at: f.firstAt, qty: f.firstQuantity, code: f.firstShortCode, status: f.firstStatus },
          { title: t('flags.second'), org: f.secondOrganisation, at: f.secondAt, qty: f.secondQuantity, code: f.secondShortCode, status: f.secondStatus },
        ].map((s) => (
          <section key={s.title} className="compare-side" aria-label={s.title}>
            <h2>{s.title}</h2>
            <p className="compare-value">
              {formatNumber(s.qty)} <span className="muted small">{f.unit}</span>
            </p>
            <dl className="dl">
              <dt>{t('common.organisation')}</dt>
              <dd>{s.org}</dd>
              <dt>{t('common.time')}</dt>
              <dd>{formatTime(s.at)}</dd>
              <dt>{t('household.shortCode')}</dt>
              <dd>{s.code ? <ShortCode code={s.code} size="sm" /> : '—'}</dd>
              <dt>{t('common.status')}</dt>
              <dd>
                <StatusTag status={s.status} />
              </dd>
            </dl>
          </section>
        ))}
      </div>
      {f.status === 'pending' ? (
        <form className="panel" onSubmit={submit}>
          <fieldset className="choice-group">
            <legend>{t('flags.decision')}</legend>
            <div className="choice-row">
              {(['justified', 'repeat'] as const).map((d) => (
                <label key={d} className="check">
                  <input type="radio" name="decision" checked={decision === d} onChange={() => setDecision(d)} />
                  {t(`flags.${d}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <TextField label={t('common.note')} help={t('flags.noteHelp')} value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
          <button type="submit" className="btn btn-primary" disabled={note.trim().length < 3}>
            {t('flags.saveDecision')}
          </button>
        </form>
      ) : (
        <Notice tone="ok">
          <span>
            <StatusTag status={f.status} /> {f.note} ({f.reviewedByName})
          </span>
        </Notice>
      )}
    </>
  );
}

// ---------- Households: dashboard search (UC14) and UC23 history ----------
export function HouseholdsPage() {
  const { t } = useTranslation();
  const { current } = useOperation();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [term, setTerm] = useState(q);
  const data = useApiData(
    (signal) => (current ? api.get<{ households: HouseholdDTO[] }>(`/api/operations/${current.id}/households?q=${encodeURIComponent(q)}`, signal) : Promise.resolve(null)),
    [current?.id, q],
  );
  if (!current) return <NeedOperation />;
  return (
    <>
      <PageHead title={t('households.title')} />
      <form
        className="toolbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(term ? { q: term } : {});
        }}
      >
        <TextField label={t('households.searchLabel')} type="search" value={term} onChange={(e) => setTerm(e.target.value)} autoComplete="off" spellCheck={false} />
        <button type="submit" className="btn btn-primary">
          {t('common.search')}
        </button>
      </form>
      {data.loading && <Loading />}
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.data && data.data.households.length === 0 && <Empty title={t('search.none')} mark="not_served" />}
      {data.data && data.data.households.length > 0 && (
        <div className="table-wrap stack-table" tabIndex={0} role="region" aria-label={t('households.title')}>
          <table>
            <caption className="visually-hidden">{t('households.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('household.shortCode')}</th>
                <th scope="col">{t('household.headName')}</th>
                <th scope="col">{t('household.mobile')}</th>
                <th scope="col" className="num">
                  {t('household.members')}
                </th>
                <th scope="col">{t('common.organisation')}</th>
              </tr>
            </thead>
            <tbody>
              {data.data.households.map((h) => (
                <tr key={h.id}>
                  <td className="stack-head">
                    <Link to={`/app/households/${h.id}`}>
                      <ShortCode code={h.shortCode} size="sm" />
                    </Link>
                  </td>
                  <td data-label={t('household.headName')}>{h.redacted ? t('household.redacted') : h.headName}</td>
                  <td data-label={t('household.mobile')} className="tabular">
                    {h.mobile ?? h.mobileMasked ?? '—'}
                  </td>
                  <td className="num" data-label={t('household.members')}>
                    {formatNumber(h.memberCount)}
                  </td>
                  <td data-label={t('common.organisation')}>{h.organisationName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

interface HistoryEntry {
  id: string;
  action: string;
  entityType: string;
  changedFields: string[] | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  userName: string | null;
  organisationName: string | null;
  deviceLabel: string | null;
}

export function HouseholdDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const detail = useApiData(
    (signal) => api.get<{ household: HouseholdDTO; area: { upazila: string; union_name: string; ward: string }; distributions: DistributionDTO[] }>(`/api/households/${id}`, signal),
    [id],
  );
  const history = useApiData((signal) => api.get<{ history: HistoryEntry[] }>(`/api/households/${id}/history`, signal), [id]);
  if (detail.loading && !detail.data) return <Loading />;
  if (detail.error || !detail.data) return <ErrorState error={detail.error} onRetry={detail.reload} />;
  const { household: h, area } = detail.data;
  return (
    <>
      <PageHead
        title={h.redacted ? t('household.redactedTitle') : (h.headName ?? '')}
        back={{ to: '/app/households', label: t('households.title') }}
        meta={<span>{t('household.version', { n: h.version })}</span>}
      />
      <div className="grid-2">
        <article className="hh-card">
          <div className="hh-card-head">
            <span className="hh-card-label">{t('household.shortCode')}</span>
            <ShortCode code={h.shortCode} />
          </div>
          {h.redacted ? (
            <p>{t('household.redacted')}</p>
          ) : (
            <dl className="dl">
              <dt>{t('household.mobile')}</dt>
              <dd>{h.mobile ?? h.mobileMasked ?? '—'}</dd>
              <dt>{t('household.members')}</dt>
              <dd>{formatNumber(h.memberCount)}</dd>
              <dt>{t('household.area')}</dt>
              <dd>
                {area.upazila}, {area.union_name}, {area.ward}
              </dd>
              <dt>{t('common.organisation')}</dt>
              <dd>{h.organisationName}</dd>
            </dl>
          )}
        </article>
        <section className="panel" aria-labelledby="dist-title">
          <h2 id="dist-title">{t('household.pastDistributions')}</h2>
          {detail.data.distributions.length === 0 ? (
            <p className="muted">{t('household.noDistributions')}</p>
          ) : (
            <ul className="list history-list">
              {detail.data.distributions.map((d) => (
                <li key={d.id} className={d.status === 'voided' ? 'voided' : undefined}>
                  <div className="history-head">
                    <strong className="tabular">{formatTime(d.distributedAt)}</strong>
                    <span className="small muted">{d.organisationName}</span>
                    {d.status === 'voided' && <StatusTag status="voided" label={t('distribution.voided', { reason: d.cancelReason ?? '' })} />}
                  </div>
                  <span className="history-items small">{t('households.itemsGiven', { count: d.items.reduce((s, i) => s + i.quantity, 0) })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section className="panel" aria-labelledby="history-title">
        <h2 id="history-title">{t('households.historyTitle')}</h2>
        {history.loading && <Loading />}
        {history.error ? <Notice tone="error">{t('households.historyEmpty')}</Notice> : null}
        {history.data && (
          <ol className="list history-list">
            {history.data.history.map((e) => (
              <li key={e.id}>
                <div className="history-head">
                  <strong>{t(`households.actions.${e.action.replace(/\./g, '_')}`, { defaultValue: e.action })}</strong>
                  <span className="small muted tabular">{formatTime(e.createdAt)}</span>
                </div>
                <span className="small muted">
                  {[e.userName, e.organisationName, e.deviceLabel].filter(Boolean).join(' · ')}
                  {e.changedFields?.length ? ` · ${t('audit.fields')}: ${e.changedFields.map((f) => t(`conflicts.fields.${f}`, { defaultValue: f })).join(', ')}` : ''}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

// ---------- UC25 Generate Reports (FR26) ----------
export function ReportsPage() {
  const { t } = useTranslation();
  const session = useSession();
  const { current, publicView } = useOperation();
  const role = publicView ? 'OBSERVER' : session.role;
  const errorText = useErrorText();
  const [type, setType] = useState(role === 'GROUP_COORDINATOR' ? 'organisation' : 'operation');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  if (!current) return <NeedOperation />;
  const generate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const q = new URLSearchParams({ operationId: current.id, format });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    try {
      const path = type === 'organisation' ? '/api/reports/organisation' : publicView ? '/api/public/reports/operation-summary' : '/api/reports/operation-summary';
      const { empty } = await downloadFile(`${path}?${q.toString()}`);
      setMessage(empty ? { tone: 'warn', text: t('reports.empty') } : { tone: 'ok', text: t('reports.ready') });
    } catch (err) {
      setMessage({ tone: 'error', text: `${t('reports.failed')} ${errorText(err)}` });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHead title={t('reports.title')} lead={t('reports.intro')} />
      <form className="panel" onSubmit={generate} style={{ maxWidth: '44rem' }}>
        <SelectField label={t('reports.type')} value={type} onChange={(e) => setType(e.target.value)}>
          {role === 'GROUP_COORDINATOR' && <option value="organisation">{t('reports.organisation')}</option>}
          {role !== 'GROUP_COORDINATOR' && <option value="operation">{t('reports.operation')}</option>}
        </SelectField>
        <div className="form-grid">
          <TextField label={t('reports.from')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextField label={t('reports.to')} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        <p className="small muted">{t('reports.rangeHelp')}</p>
        <fieldset className="choice-group">
          <legend>{t('reports.format')}</legend>
          <div className="choice-row">
            {(['pdf', 'csv'] as const).map((f) => (
              <label key={f} className="check">
                <input type="radio" name="format" checked={format === f} onChange={() => setFormat(f)} />
                {f.toUpperCase()}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {format === 'pdf' ? <FileText size={18} aria-hidden /> : <Download size={18} aria-hidden />}
          {busy ? t('reports.generating') : t('reports.generate')}
        </button>
        <div aria-live="polite" className="mt-4">
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
        </div>
      </form>
    </>
  );
}

// ---------- UC20 View Notifications (dashboard) ----------
interface ServerNotification {
  id: string;
  type: string;
  params: Record<string, string | number>;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export function NotificationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const text = useNotificationText();
  const data = useApiData((signal) => api.get<{ notifications: ServerNotification[]; unread: number }>('/api/notifications', signal), []);
  const open = async (n: ServerNotification) => {
    if (!n.isRead) await api.post(`/api/notifications/${n.id}/read`).catch(() => undefined);
    if (n.link) navigate(n.link);
    else data.reload();
  };
  const unread = data.data?.unread ?? 0;
  return (
    <>
      <PageHead
        title={t('notifications.title')}
        actions={
          unread > 0 ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                void api.post('/api/notifications/read-all').then(data.reload);
              }}
            >
              {t('notifications.markAll')}
            </button>
          ) : undefined
        }
      />
      {data.loading && !data.data && <Loading />}
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.data && data.data.notifications.length === 0 && (
        <Empty title={t('notifications.none')} mark="synced">
          {t('notifications.noneHint')}
        </Empty>
      )}
      {data.data && data.data.notifications.length > 0 && (
        <ul className="list panel">
          {data.data.notifications.map((n) => (
            <li key={n.id} className={`list-row${n.isRead ? '' : ' unread'}`}>
              <span className="list-main">
                <span className={n.isRead ? undefined : 'list-title'}>{text(n.type, n.params)}</span>
                <span className="list-sub tabular">{formatTime(n.createdAt)}</span>
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void open(n)}>
                {t('common.open')}
                <ChevronRight size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

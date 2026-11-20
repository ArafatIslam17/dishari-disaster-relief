import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Download, FileText, Send } from 'lucide-react';
import type { CoverageLabel, DistributionDTO, HouseholdDTO } from '@relief/shared';
import { api, downloadFile } from '../api/client';
import { useSession } from '../auth/session';
import { formatNumber, formatTime } from '../i18n';
import { useOperation } from '../layouts';
import { useNotificationText } from './field';
import {
  CoverageChip,
  Empty,
  ErrorState,
  Loading,
  Notice,
  SelectField,
  ShortCode,
  StatusTag,
  TextField,
  useApiData,
  useErrorText,
  useToast,
} from '../ui/kit';

function NeedOperation() {
  const { t } = useTranslation();
  return <Notice>{t('nav.noOperation')}</Notice>;
}

function areaName(lang: string, a: { upazila: string; unionName: string; ward: string; upazilaBn?: string | null; unionBn?: string | null }) {
  const bn = lang === 'bn';
  return { upazila: bn && a.upazilaBn ? a.upazilaBn : a.upazila, union: bn && a.unionBn ? a.unionBn : a.unionName, ward: a.ward };
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

export function CoveragePage() {
  const { t, i18n } = useTranslation();
  const { current } = useOperation();
  const { role } = useSession();
  const [params, setParams] = useSearchParams();
  const filter = { upazila: params.get('upazila') ?? '', union: params.get('union') ?? '', ward: params.get('ward') ?? '' };
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
  const all = useApiData(
    (signal) => (current ? api.get<{ rows: CoverageRowDTO[] }>(`/api/operations/${current.id}/coverage`, signal) : Promise.resolve(null)),
    [current?.id],
  );
  const data = useApiData(
    (signal) =>
      current
        ? api.get<{ rows: CoverageRowDTO[]; totals: { registered: number; served: number; areas: number; noRecords: number }; lastUpdated: string | null; generatedAt: string }>(
            `/api/operations/${current.id}/coverage?${qs}`,
            signal,
          )
        : Promise.resolve(null),
    [current?.id, qs],
  );
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
  return (
    <>
      <h1>{t('coverage.title')}</h1>
      <p className="muted">{t('coverage.intro')}</p>
      {role === 'OBSERVER' && <Notice>{t('coverage.observerNote')}</Notice>}
      <div className="toolbar">
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
      </div>
      {data.loading && !data.data && <Loading rows={6} />}
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.data && (
        <>
          <div className="stats">
            <div className="stat">
              <div className="value">{formatNumber(data.data.totals.registered)}</div>
              <div className="label">{t('coverage.registered')}</div>
            </div>
            <div className="stat">
              <div className="value">{formatNumber(data.data.totals.served)}</div>
              <div className="label">{t('coverage.served')}</div>
            </div>
            <div className="stat">
              <div className="value">{formatNumber(data.data.totals.registered - data.data.totals.served)}</div>
              <div className="label">{t('coverage.unserved')}</div>
            </div>
            <div className="stat">
              <div className="value">{formatNumber(data.data.totals.noRecords)}</div>
              <div className="label">{t('coverage.noRecordAreas', { n: '' }).trim()}</div>
            </div>
          </div>
          <p className="small muted">
            {t('common.lastUpdated', { time: formatTime(data.data.lastUpdated) })}. {t('coverage.notSyncedNote')}
          </p>
          {data.data.rows.length === 0 ? (
            <Empty title={t('common.noResults')} />
          ) : (
            <div className="table-wrap">
              <table>
                <caption className="visually-hidden">{t('coverage.title')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('coverage.filterUpazila')}</th>
                    <th scope="col">{t('coverage.filterUnion')}</th>
                    <th scope="col">{t('coverage.filterWard')}</th>
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
                    <th scope="col">{t('coverage.label')}</th>
                    <th scope="col">{t('coverage.lastDistribution')}</th>
                    {role === 'GROUP_COORDINATOR' && <th scope="col">{t('common.actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.data.rows.map((r) => {
                    const n = areaName(i18n.language, r);
                    return (
                      <tr key={r.areaId}>
                        <td>{n.upazila}</td>
                        <td>{n.union}</td>
                        <td>{n.ward}</td>
                        <td className="num">{formatNumber(r.registered)}</td>
                        <td className="num">{formatNumber(r.served)}</td>
                        <td className="num">{formatNumber(r.unserved)}</td>
                        <td className="num">{formatNumber(r.anonymousDistributions)}</td>
                        <td>
                          <CoverageChip label={r.label} />
                        </td>
                        <td>{r.lastDistributionAt ? formatTime(r.lastDistributionAt) : '—'}</td>
                        {role === 'GROUP_COORDINATOR' && (
                          <td>
                            {Number(r.unserved) > 0 && <Link to={`/app/coverage/${r.areaId}/unserved`}>{t('coverage.unservedLink')}</Link>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
  return (
    <>
      <p>
        <Link to="/app/coverage">{t('common.back')}</Link>
      </p>
      <h1>{t('unserved.title')}</h1>
      <p className="muted">{t('unserved.dashIntro')}</p>
      {data.loading && <Loading />}
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.data && (
        <>
          <p className="small muted">{t('common.lastUpdated', { time: formatTime(data.data.lastUpdated) })}</p>
          {data.data.households.length === 0 ? (
            <Empty title={t('unserved.allServed')} />
          ) : (
            <>
              <button type="button" className="btn btn-primary" disabled={sending || current.status !== 'active'} onClick={() => void release()}>
                <Send size={18} aria-hidden />
                {t('unserved.release')}
              </button>
              <div className="table-wrap" style={{ marginTop: 16 }}>
                <table>
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
                    {data.data.households.map((h) => (
                      <tr key={h.id}>
                        <td>
                          <Link to={`/app/households/${h.id}`}>
                            <ShortCode code={h.shortCode} size="sm" />
                          </Link>
                        </td>
                        <td>{h.headName}</td>
                        <td className="num">{formatNumber(h.memberCount)}</td>
                        <td>{h.organisationName}</td>
                        <td>{formatTime(h.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
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
      <div className="panel-head">
        <h1>{t('conflicts.title')}</h1>
        <button type="button" className="btn btn-quiet" onClick={() => setParams(status === 'open' ? { status: 'resolved' } : {})}>
          {status === 'open' ? t('conflicts.showResolved') : t('conflicts.showOpen')}
        </button>
      </div>
      <p className="muted">{t('conflicts.intro')}</p>
      {data.loading && <Loading />}
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.data && data.data.conflicts.length === 0 && <Empty title={t('conflicts.none')} />}
      {data.data && data.data.conflicts.length > 0 && (
        <div className="table-wrap">
          <table>
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
                  <td>
                    <Link to={`/app/conflicts/${c.id}`}>
                      <ShortCode code={c.shortCode} size="sm" />
                    </Link>
                  </td>
                  <td>{t(`conflicts.fields.${c.fieldName}`)}</td>
                  <td>{showValue(c.fieldName, c.serverValue, t)}</td>
                  <td>{showValue(c.fieldName, c.localValue, t)}</td>
                  <td>{formatTime(c.createdAt)}</td>
                  <td>
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
      <p>
        <Link to="/app/conflicts">{t('common.back')}</Link>
      </p>
      <h1>
        {t(`conflicts.fields.${c.fieldName}`)}: <ShortCode code={c.shortCode} size="sm" />
      </h1>
      {!c.canResolve && <Notice tone="warn">{t('conflicts.mobileOnly')}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid-2">
        {[
          { title: t('conflicts.current'), value: c.serverValue, who: by(c.serverUserName, c.serverOrganisationName, c.serverDeviceLabel, c.serverTime) },
          { title: t('conflicts.incoming'), value: c.localValue, who: by(c.localUserName, c.localOrganisationName, c.localDeviceLabel, c.localTime) },
        ].map((side) => (
          <section key={side.title} className="panel">
            <h2>{side.title}</h2>
            <p style={{ fontSize: '1.4rem', fontWeight: 700 }}>{showValue(c.fieldName, side.value, t)}</p>
            <p className="small muted">{side.who}</p>
            {c.status === 'open' && c.canResolve && side.value !== 'hidden' && (
              <button type="button" className="btn btn-primary" onClick={() => void resolve(side.value)}>
                {t('conflicts.choose')}
              </button>
            )}
          </section>
        ))}
      </div>
      {c.status === 'resolved' && <Notice tone="ok">{t('statuses.resolved')}: {showValue(c.fieldName, c.resolvedValue, t)}</Notice>}
      {editable && (
        <form
          className="panel"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void resolve(parseCustom());
          }}
        >
          <TextField label={t('conflicts.custom')} value={custom} onChange={(e) => setCustom(e.target.value)} inputMode={c.fieldName === 'memberCount' ? 'numeric' : 'text'} />
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={!custom.trim()}>
              {t('conflicts.resolve')}
            </button>
            <Link className="btn btn-quiet" to="/app/conflicts">
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

export function DuplicatesPage() {
  const { t } = useTranslation();
  const { current } = useOperation();
  const [params, setParams] = useSearchParams();
  const status = (['linked', 'not_duplicate'].includes(params.get('status') ?? '') ? params.get('status') : 'pending_review') as string;
  const data = useApiData(
    (signal) => (current ? api.get<{ pairs: PairRow[] }>(`/api/duplicates?operationId=${current.id}&status=${status}`, signal) : Promise.resolve(null)),
    [current?.id, status],
  );
  if (!current) return <NeedOperation />;
  return (
    <>
      <h1>{t('duplicates.title')}</h1>
      <p className="muted">{t('duplicates.intro')}</p>
      <div className="toolbar" role="tablist">
        {(['pending_review', 'linked', 'not_duplicate'] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={status === s} className={`btn ${status === s ? 'btn-primary' : 'btn-quiet'}`} onClick={() => setParams({ status: s })}>
            {t(`duplicates.tabs.${s}`)}
          </button>
        ))}
      </div>
      {data.loading && <Loading />}
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.data && data.data.pairs.length === 0 && <Empty title={t('duplicates.none')} />}
      {data.data && data.data.pairs.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col" className="num">
                  {t('duplicates.score')}
                </th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col">A</th>
                <th scope="col">B</th>
                <th scope="col">{t('common.time')}</th>
              </tr>
            </thead>
            <tbody>
              {data.data.pairs.map((p) => (
                <tr key={p.id}>
                  <td className="num">
                    <Link to={`/app/duplicates/${p.id}`}>{formatNumber(Math.round(p.score * 100))}%</Link>
                  </td>
                  <td>
                    <StatusTag status={p.label} />
                  </td>
                  <td>
                    {p.headNameA} <ShortCode code={p.shortCodeA} size="sm" />
                    <br />
                    <span className="small muted">{p.organisationA}</span>
                  </td>
                  <td>
                    {p.headNameB} <ShortCode code={p.shortCodeB} size="sm" />
                    <br />
                    <span className="small muted">{p.organisationB}</span>
                  </td>
                  <td>{formatTime(p.createdAt)}</td>
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
  return (
    <>
      <p>
        <Link to="/app/duplicates">{t('common.back')}</Link>
      </p>
      <h1>
        {t('duplicates.title')}: {formatNumber(Math.round(p.score * 100))}% <StatusTag status={p.label} /> <StatusTag status={p.status} />
      </h1>
      <section className="panel">
        <h2>{t('duplicates.signals')}</h2>
        <dl className="dl">
          {(['phone', 'name', 'location', 'familySize'] as const).map((s) => (
            <div key={s} style={{ display: 'contents' }}>
              <dt>{t(`duplicates.signal.${s}`)}</dt>
              <dd>{p.signals[s] === null || p.signals[s] === undefined ? '—' : `${formatNumber(Math.round((p.signals[s] as number) * 100))}%`}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="grid-2">
        {[p.a, p.b].map((h) => (
          <section key={h.id} className="hh-card">
            <ShortCode code={h.shortCode} />
            <dl className="dl">
              <dt>{t('household.headName')}</dt>
              <dd>{h.headName}</dd>
              <dt>{t('household.mobile')}</dt>
              <dd>{h.mobile ?? h.mobileMasked ?? '—'}</dd>
              <dt>{t('household.members')}</dt>
              <dd>{formatNumber(h.memberCount)}</dd>
              <dt>{t('household.area')}</dt>
              <dd>{area(h.areaId)}</dd>
              <dt>{t('common.organisation')}</dt>
              <dd>{h.organisationName}</dd>
            </dl>
            <p>
              <Link to={`/app/households/${h.id}`}>{t('households.history')}</Link>
            </p>
          </section>
        ))}
      </div>
      <div className="form-actions">
        {p.status === 'pending_review' && (
          <>
            <button type="button" className="btn btn-primary" onClick={() => void act('link', t('duplicates.linked'))}>
              {t('duplicates.same')}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => void act('not-duplicate', t('duplicates.notDuplicate'))}>
              {t('duplicates.different')}
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
      <div className="panel-head">
        <h1>{t('flags.title')}</h1>
        <button type="button" className="btn btn-quiet" onClick={() => setParams(reviewed ? {} : { status: 'reviewed' })}>
          {reviewed ? t('flags.showPending') : t('flags.showReviewed')}
        </button>
      </div>
      <p className="muted">{t('flags.intro')}</p>
      {data.loading && <Loading />}
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.data && data.data.flags.length === 0 && <Empty title={t('flags.none')} />}
      {data.data && data.data.flags.length > 0 && (
        <div className="table-wrap">
          <table>
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
                  <td>
                    <Link to={`/app/flags/${f.id}`}>{i18n.language === 'bn' && f.itemNameBn ? f.itemNameBn : f.itemName}</Link>
                  </td>
                  <td>
                    {f.firstOrganisation}, {formatTime(f.firstAt)}
                  </td>
                  <td>
                    {f.secondOrganisation}, {formatTime(f.secondAt)}
                  </td>
                  <td>
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
      <p>
        <Link to="/app/flags">{t('common.back')}</Link>
      </p>
      <h1>
        {t('flags.title')}: {item}
      </h1>
      {f.householdInDuplicateReview && <Notice tone="warn">{t('flags.inReview')}</Notice>}
      <div className="grid-2">
        {[
          { title: t('flags.first'), org: f.firstOrganisation, at: f.firstAt, qty: f.firstQuantity, code: f.firstShortCode, status: f.firstStatus },
          { title: t('flags.second'), org: f.secondOrganisation, at: f.secondAt, qty: f.secondQuantity, code: f.secondShortCode, status: f.secondStatus },
        ].map((s) => (
          <section key={s.title} className="panel">
            <h2>{s.title}</h2>
            <dl className="dl">
              <dt>{t('common.organisation')}</dt>
              <dd>{s.org}</dd>
              <dt>{t('common.time')}</dt>
              <dd>{formatTime(s.at)}</dd>
              <dt>{t('distribution.quantity')}</dt>
              <dd>
                {formatNumber(s.qty)} {f.unit}
              </dd>
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
          <fieldset style={{ border: 0, padding: 0 }}>
            <legend className="label">
              <strong>{t('common.status')}</strong>
            </legend>
            {(['justified', 'repeat'] as const).map((d) => (
              <label key={d} className="check">
                <input type="radio" name="decision" checked={decision === d} onChange={() => setDecision(d)} />
                {t(`flags.${d}`)}
              </label>
            ))}
          </fieldset>
          <TextField label={t('common.note')} value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={note.trim().length < 3}>
            {t('common.save')}
          </button>
        </form>
      ) : (
        <Notice tone="ok">
          <StatusTag status={f.status} /> {f.note} ({f.reviewedByName})
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
      <h1>{t('households.title')}</h1>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(term ? { q: term } : {});
        }}
      >
        <TextField label={t('households.searchLabel')} type="search" value={term} onChange={(e) => setTerm(e.target.value)} />
        <button type="submit" className="btn btn-primary">
          {t('common.search')}
        </button>
      </form>
      {data.loading && <Loading />}
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.data && data.data.households.length === 0 && <Empty title={t('search.none')} />}
      {data.data && data.data.households.length > 0 && (
        <div className="table-wrap">
          <table>
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
                  <td>
                    <Link to={`/app/households/${h.id}`}>
                      <ShortCode code={h.shortCode} size="sm" />
                    </Link>
                  </td>
                  <td>{h.redacted ? t('household.redacted') : h.headName}</td>
                  <td className="short-code-sm">{h.mobile ?? h.mobileMasked ?? '—'}</td>
                  <td className="num">{formatNumber(h.memberCount)}</td>
                  <td>{h.organisationName}</td>
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
  const { t, i18n } = useTranslation();
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
      <p>
        <Link to="/app/households">{t('common.back')}</Link>
      </p>
      <div className="grid-2">
        <section className="hh-card">
          <ShortCode code={h.shortCode} />
          {h.redacted ? (
            <p>{t('household.redacted')}</p>
          ) : (
            <dl className="dl">
              <dt>{t('household.headName')}</dt>
              <dd>{h.headName}</dd>
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
          <p className="small muted">{t('household.version', { n: h.version })}</p>
        </section>
        <section className="panel">
          <h2>{t('household.pastDistributions')}</h2>
          {detail.data.distributions.length === 0 ? (
            <p className="muted">{t('household.noDistributions')}</p>
          ) : (
            <ul className="list">
              {detail.data.distributions.map((d) => (
                <li key={d.id} className="list-row">
                  <span>
                    {formatTime(d.distributedAt)}, {d.organisationName}
                    {d.status === 'voided' && <span className="tag tag-danger"> {t('distribution.voided', { reason: d.cancelReason ?? '' })}</span>}
                  </span>
                  <span className="small">{d.items.reduce((s, i) => s + i.quantity, 0)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section className="panel">
        <h2>{t('households.historyTitle')}</h2>
        {history.loading && <Loading />}
        {history.error ? <Notice tone="error">{t('households.historyEmpty')}</Notice> : null}
        {history.data && (
          <ol className="list">
            {history.data.history.map((e) => (
              <li key={e.id} style={{ padding: '10px 0' }}>
                <strong>{t(`households.actions.${e.action.replace(/\./g, '_')}`, { defaultValue: e.action })}</strong>{' '}
                <span className="muted">{formatTime(e.createdAt)}</span>
                <br />
                <span className="small">
                  {[e.userName, e.organisationName, e.deviceLabel].filter(Boolean).join(', ')}
                  {e.changedFields?.length ? `. ${t('audit.fields')}: ${e.changedFields.map((f) => t(`conflicts.fields.${f}`, { defaultValue: f })).join(', ')}` : ''}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <span hidden lang={i18n.language} />
    </>
  );
}

// ---------- UC25 Generate Reports (FR26) ----------
export function ReportsPage() {
  const { t } = useTranslation();
  const { role } = useSession();
  const { current } = useOperation();
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
      const path = type === 'organisation' ? '/api/reports/organisation' : '/api/reports/operation-summary';
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
      <h1>{t('reports.title')}</h1>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <form className="panel" onSubmit={generate}>
        <SelectField label={t('reports.type')} value={type} onChange={(e) => setType(e.target.value)}>
          {role === 'GROUP_COORDINATOR' && <option value="organisation">{t('reports.organisation')}</option>}
          {role !== 'GROUP_COORDINATOR' && <option value="operation">{t('reports.operation')}</option>}
        </SelectField>
        <div className="grid-2">
          <TextField label={t('reports.from')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextField label={t('reports.to')} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <fieldset style={{ border: 0, padding: 0, marginBottom: 16 }}>
          <legend className="label">
            <strong>{t('reports.format')}</strong>
          </legend>
          {(['pdf', 'csv'] as const).map((f) => (
            <label key={f} className="check">
              <input type="radio" name="format" checked={format === f} onChange={() => setFormat(f)} />
              {f.toUpperCase()}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {format === 'pdf' ? <FileText size={18} aria-hidden /> : <Download size={18} aria-hidden />}
          {t('reports.generate')}
        </button>
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
  return (
    <>
      <div className="panel-head">
        <h1>{t('notifications.title')}</h1>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => {
            void api.post('/api/notifications/read-all').then(data.reload);
          }}
        >
          {t('notifications.markAll')}
        </button>
      </div>
      {data.loading && !data.data && <Loading />}
      {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
      {data.data && data.data.notifications.length === 0 && <Empty title={t('notifications.none')} />}
      {data.data && data.data.notifications.length > 0 && (
        <ul className="list panel">
          {data.data.notifications.map((n) => (
            <li key={n.id} className="list-row">
              <span>
                {n.isRead ? text(n.type, n.params) : <strong>{text(n.type, n.params)}</strong>}
                <br />
                <span className="small muted">{formatTime(n.createdAt)}</span>
              </span>
              <button type="button" className="btn btn-quiet" onClick={() => void open(n)}>
                {t('common.open')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

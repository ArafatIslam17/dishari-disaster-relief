import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  Bell,
  ClipboardList,
  Download,
  HandHeart,
  LayoutDashboard,
  MapPin,
  Search as SearchIcon,
  Settings as SettingsIcon,
  UserPlus,
} from 'lucide-react';
import { HEAD_NAME_RE, normalisePhone, type Gps, type ReliefItemDTO } from '@relief/shared';
import { api } from '../api/client';
import { useSession } from '../auth/session';
import { formatNumber, formatTime } from '../i18n';
import { useSyncStatus } from '../layouts';
import type { DistributionRow, LocalArea, NoticeRow } from '../local/db';
import { localStore, type HouseholdView, type SimilarMatch } from '../local/store';
import { syncManager } from '../local/sync';
import { SetPinPage } from './public';
import { Empty, Notice, SelectField, ShortCode, Stepper, TextField, useConfirm, useErrorText, useToast } from '../ui/kit';

/** Re-runs `load` whenever the local store changes. */
function useLocalData<T>(load: () => Promise<T>, deps: unknown[]): T | undefined {
  const [data, setData] = useState<T>();
  const loadMemo = useCallback(load, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    const run = () => void loadMemo().then((d) => alive && setData(d));
    run();
    const unsub = localStore.subscribe(run);
    return () => {
      alive = false;
      unsub();
    };
  }, [loadMemo]);
  return data;
}

function useAreaLabel() {
  const { i18n } = useTranslation();
  return (a: LocalArea | undefined) => {
    if (!a) return '';
    const bn = i18n.language === 'bn';
    const up = bn && a.upazilaBn ? a.upazilaBn : a.upazila;
    const un = bn && a.unionBn ? a.unionBn : a.unionName;
    return `${up}, ${un}, ${bn ? 'ওয়ার্ড' : 'ward'} ${a.ward}`;
  };
}

function itemLabel(item: ReliefItemDTO | undefined, lang: string): string {
  if (!item) return '';
  return lang === 'bn' && item.itemNameBn ? item.itemNameBn : item.itemName;
}

// ---------- Home ----------
interface OperationRow {
  id: string;
  name: string;
  status: string;
  relation: string;
}

export function FieldHome() {
  const { t } = useTranslation();
  const { local, setOperation, serverSession, role } = useSession();
  const status = useSyncStatus();
  const errorText = useErrorText();
  const [ops, setOps] = useState<OperationRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const opName = useLocalData(async () => (await localStore.db.meta.get('operationName'))?.value as string | undefined, []);
  const counts = useLocalData(async () => ({ areas: (await localStore.selectedAreas()).length, households: localStore.householdCount() }), []);

  useEffect(() => {
    if (local?.operationId || !serverSession) return;
    api
      .get<{ operations: OperationRow[] }>('/api/operations')
      .then((r) => setOps(r.operations.filter((o) => o.relation === 'member' && o.status === 'active')))
      .catch(setError);
  }, [local?.operationId, serverSession]);

  const choose = async (op: OperationRow) => {
    await localStore.db.meta.put({ key: 'operationName', value: op.name });
    await setOperation(op.id);
  };

  if (!local?.operationId) {
    return (
      <>
        <h1>{t('field.homeTitle')}</h1>
        {error ? <Notice tone="error">{errorText(error)}</Notice> : null}
        {!serverSession && <Notice tone="offline">{t('areas.needOnline')}</Notice>}
        {ops && ops.length === 0 && <Notice>{t('field.noOperations')}</Notice>}
        {ops && ops.length > 0 && (
          <section className="panel">
            <h2>{t('field.chooseOperation')}</h2>
            <ul className="list">
              {ops.map((o) => (
                <li key={o.id}>
                  <button type="button" className="btn btn-quiet btn-block" onClick={() => void choose(o)}>
                    {o.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  const tiles = [
    { to: '/field/households/new', icon: UserPlus, label: t('field.actions.newHousehold') },
    { to: '/field/search', icon: SearchIcon, label: t('field.actions.search') },
    { to: '/field/anonymous', icon: HandHeart, label: t('field.actions.anonymous') },
    { to: '/field/areas', icon: Download, label: t('field.actions.areas') },
    { to: '/field/unserved', icon: ClipboardList, label: t('field.actions.unserved') },
    { to: '/field/notifications', icon: Bell, label: t('field.actions.notifications') },
    { to: '/field/settings', icon: SettingsIcon, label: t('field.actions.settings') },
  ];
  if (role === 'GROUP_COORDINATOR') tiles.push({ to: '/app/coverage', icon: LayoutDashboard, label: t('field.openDashboard') });

  return (
    <>
      <h1>{t('field.homeTitle')}</h1>
      <p className="muted">
        {t('field.operation')}: <strong>{opName}</strong>
        <br />
        {t('field.areasDownloaded', { n: formatNumber(counts?.areas ?? 0) })}, {t('field.householdsStored', { n: formatNumber(counts?.households ?? 0) })}
      </p>
      {status.skewMinutes !== 0 && <Notice tone="warn">{t('status.skew', { minutes: Math.abs(status.skewMinutes) })}</Notice>}
      {counts && counts.areas === 0 && <Notice tone="warn">{t('field.downloadFirst')}</Notice>}
      <div className="action-grid">
        {tiles.map(({ to, icon: Icon, label }) => (
          <Link key={to} to={to} className="action-tile">
            <Icon size={28} aria-hidden />
            {label}
          </Link>
        ))}
      </div>
    </>
  );
}

// ---------- UC10 Download Area Data ----------
interface BootstrapResponse {
  areas: (LocalArea & { householdCount: number })[];
  items: ReliefItemDTO[];
  phoneKey: string;
  operationStatus: string;
}

export function AreasPage() {
  const { t } = useTranslation();
  const { local, serverSession } = useSession();
  const toast = useToast();
  const errorText = useErrorText();
  const areaLabel = useAreaLabel();
  const [boot, setBoot] = useState<BootstrapResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const localAreas = useLocalData(() => localStore.db.areas.toArray(), []);

  useEffect(() => {
    if (!local?.operationId || !serverSession) return;
    api
      .get<BootstrapResponse>(`/api/sync/bootstrap?operationId=${local.operationId}`)
      .then(async (b) => {
        await localStore.setPhoneKey(b.phoneKey);
        await localStore.storeAreasAndItems(b.areas.map((a) => ({ ...a, downloadedAt: null, cursor: '0' })), b.items);
        setBoot(b);
      })
      .catch((err) => setMessage({ tone: 'error', text: errorText(err) }));
  }, [local?.operationId, serverSession, errorText]);

  const rows = (boot?.areas ?? []).filter((a) => {
    const q = filter.trim().toLowerCase();
    return !q || [a.upazila, a.unionName, a.ward, a.upazilaBn ?? '', a.unionBn ?? ''].some((s) => s.toLowerCase().includes(q));
  });
  const downloaded = new Map((localAreas ?? []).filter((a) => a.downloadedAt).map((a) => [a.id, a]));

  const download = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.quota && est.usage !== undefined && est.quota - est.usage < 20 * 1024 * 1024) {
        setMessage({ tone: 'warn', text: t('areas.lowStorage') }); // UC10 5.a
        return;
      }
      await navigator.storage?.persist?.();
      await localStore.selectAreas([...selected]);
      const result = await syncManager.syncNow('manual');
      if (result?.ok) {
        setMessage({ tone: 'ok', text: t('areas.done') });
        toast(t('areas.done'));
        setSelected(new Set());
      } else setMessage({ tone: 'error', text: t('areas.failed') }); // UC10 4.a
    } catch {
      setMessage({ tone: 'error', text: t('areas.failed') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>{t('areas.title')}</h1>
      <p className="muted">{t('areas.intro')}</p>
      {!serverSession && <Notice tone="offline">{t('areas.needOnline')}</Notice>}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <TextField label={t('areas.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
      <ul className="list panel">
        {rows.map((a) => {
          const have = downloaded.get(a.id);
          return (
            <li key={a.id}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={selected.has(a.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(a.id);
                    else next.delete(a.id);
                    setSelected(next);
                  }}
                />
                <span>
                  <strong>{areaLabel(a)}</strong>
                  <br />
                  <span className="small muted">
                    {t('areas.households', { n: formatNumber(a.householdCount) })},{' '}
                    {have?.downloadedAt
                      ? t('areas.downloaded', { time: formatTime(have.downloadedAt), n: formatNumber(localStore.households().filter((h) => h.areaId === a.id).length) })
                      : t('areas.notDownloaded')}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn btn-signal btn-block btn-lg" disabled={busy || selected.size === 0 || !serverSession} onClick={() => void download()}>
        <Download size={20} aria-hidden />
        {busy ? t('areas.downloading') : t('areas.download')}
      </button>
    </>
  );
}

// ---------- UC11 / UC12 Register Household ----------
/** Every visit (also from the bottom bar while a card is showing) starts a fresh registration. */
export function NewHouseholdRoute() {
  const location = useLocation();
  return <NewHouseholdPage key={location.key} />;
}

function NewHouseholdPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const areaLabel = useAreaLabel();
  const areas = useLocalData(() => localStore.selectedAreas(), []);
  const [consent, setConsent] = useState<'unknown' | 'given' | 'refused'>('unknown');
  const [showEnglish, setShowEnglish] = useState(i18n.language === 'en');
  const [form, setForm] = useState({ headName: '', mobile: '', memberCount: 4, areaId: '' });
  const [gps, setGps] = useState<Gps | null>(null);
  const [gpsState, setGpsState] = useState<'off' | 'taking' | 'saved' | 'failed'>('off');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [matches, setMatches] = useState<SimilarMatch[] | null>(null);
  const [saved, setSaved] = useState<HouseholdView | null>(null);
  const [consentAt] = useState(() => new Date());

  useEffect(() => {
    if (!form.areaId && areas && areas.length === 1) setForm((f) => ({ ...f, areaId: areas[0]?.id ?? '' }));
  }, [areas, form.areaId]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!HEAD_NAME_RE.test(form.headName.trim()) || form.headName.trim().length < 2) e.headName = t('validation.name_latin_only');
    if (form.mobile.trim() && !normalisePhone(form.mobile)) e.mobile = t('validation.invalid_phone');
    if (form.memberCount < 1 || form.memberCount > 50) e.memberCount = t('validation.required');
    if (!form.areaId) e.areaId = t('validation.choose_area');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const takeGps = (on: boolean) => {
    if (!on) {
      setGps(null);
      setGpsState('off');
      return;
    }
    setGpsState('taking');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGps({ lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 });
        setGpsState('saved');
      },
      () => setGpsState('failed'),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const input = () => ({ areaId: form.areaId, headName: form.headName.trim(), mobile: form.mobile.trim() || null, memberCount: form.memberCount, gps });

  const check = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    const found = await localStore.findSimilar(input()); // UC12
    if (found.length === 0) await save();
    else setMatches(found);
  };

  const save = async () => {
    try {
      const h = await localStore.saveHousehold(input(), consentAt);
      setSaved(h);
      toast(t('household.saved'));
      syncManager.soon();
    } catch {
      toast(t('household.failed'), 'error');
    }
  };

  if (saved) {
    return (
      <>
        <h1>{t('household.saved')}</h1>
        <div className="hh-card">
          <span className="small muted">{t('household.shortCode')}</span>
          <ShortCode code={saved.shortCode} />
          <p>
            <strong>{saved.headName}</strong>
            <br />
            {t('household.members')}: {formatNumber(saved.memberCount)}
          </p>
          <p className="small">{t('household.writeCode')}</p>
        </div>
        <div className="form-actions">
          <Link className="btn btn-signal btn-lg" to={`/field/households/${saved.id}/distribute`}>
            {t('household.distribute')}
          </Link>
          <button type="button" className="btn btn-quiet btn-lg" onClick={() => navigate('/field/households/new')}>
            {t('field.actions.newHousehold')}
          </button>
        </div>
      </>
    );
  }

  if (consent !== 'given') {
    return (
      <>
        <h1>{t('household.newTitle')}</h1>
        <section className="panel">
          <h2>{t('household.consentTitle')}</h2>
          <p className="small muted">{t('household.consentRead')}</p>
          <p lang="bn" style={{ fontSize: '1.1rem' }}>
            {t('household.consentText')}
          </p>
          <button type="button" className="link-button" onClick={() => setShowEnglish((v) => !v)} aria-expanded={showEnglish}>
            English
          </button>
          {showEnglish && (
            <p lang="en" className="muted">
              {t('household.consentEnglish')}
            </p>
          )}
        </section>
        {consent === 'refused' ? (
          <>
            <Notice tone="warn">{t('household.refusedHelp')}</Notice>
            <Link className="btn btn-signal btn-block btn-lg" to="/field/anonymous">
              {t('field.actions.anonymous')}
            </Link>
          </>
        ) : (
          <div className="form-actions">
            <button type="button" className="btn btn-signal btn-lg btn-block" onClick={() => setConsent('given')}>
              {t('household.consentGiven')}
            </button>
            <button type="button" className="btn btn-quiet btn-lg btn-block" onClick={() => setConsent('refused')}>
              {t('household.consentRefused')}
            </button>
          </div>
        )}
      </>
    );
  }

  if (matches) {
    return (
      <>
        <h1>{t('household.similarTitle')}</h1>
        <p>{t('household.similarIntro')}</p>
        <ul className="list panel">
          {matches.map((m) => (
            <li key={m.household.id} className="match">
              <div className="list-row">
                <div>
                  <span className="list-title">{m.household.headName}</span> <ShortCode code={m.household.shortCode} size="sm" />
                  <br />
                  <span className="small muted">
                    {areaLabel(localStore.area(m.household.areaId))}, {t('household.members')} {formatNumber(m.household.memberCount)},{' '}
                    {m.household.organisationName}
                  </span>
                  <br />
                  <span className={`tag ${m.label === 'likely' ? 'tag-danger' : 'tag-warn'}`}>{t(`statuses.${m.label}`)}</span>{' '}
                  <span className="small">{t('household.score', { score: formatNumber(Math.round(m.score * 100)) + '%' })}</span>
                </div>
                <Link className="btn btn-quiet" to={`/field/households/${m.household.id}`}>
                  {t('household.useExisting')}
                </Link>
              </div>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-signal btn-block btn-lg" onClick={() => void save()}>
          {t('household.confirmNew')}
        </button>
        <button type="button" className="btn btn-quiet btn-block" style={{ marginTop: 12 }} onClick={() => setMatches(null)}>
          {t('common.back')}
        </button>
      </>
    );
  }

  return (
    <>
      <h1>{t('household.newTitle')}</h1>
      {areas && areas.length === 0 && <Notice tone="warn">{t('field.downloadFirst')}</Notice>}
      <form onSubmit={check} noValidate>
        <TextField
          label={t('household.headName')}
          value={form.headName}
          onChange={(e) => setForm({ ...form, headName: e.target.value })}
          autoComplete="off"
          autoCapitalize="words"
          lang="en"
          error={errors.headName}
        />
        <TextField
          label={`${t('household.mobile')}`}
          type="tel"
          inputMode="tel"
          value={form.mobile}
          onChange={(e) => setForm({ ...form, mobile: e.target.value })}
          error={errors.mobile}
        />
        <Stepper label={t('household.members')} value={form.memberCount} onChange={(n) => setForm({ ...form, memberCount: n })} error={errors.memberCount} />
        <SelectField label={t('household.area')} value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })} error={errors.areaId}>
          <option value="">—</option>
          {areas?.map((a) => (
            <option key={a.id} value={a.id}>
              {areaLabel(a)}
            </option>
          ))}
        </SelectField>
        <label className="check">
          <input type="checkbox" checked={gpsState !== 'off'} onChange={(e) => takeGps(e.target.checked)} />
          <span>
            {t('household.gpsConsent')}
            {gpsState === 'taking' && <span className="small muted"> {t('household.gpsTaking')}</span>}
            {gpsState === 'saved' && <span className="small"> {t('household.gpsSaved')}</span>}
            {gpsState === 'failed' && <span className="small"> {t('household.gpsFailed')}</span>}
          </span>
        </label>
        <button type="submit" className="btn btn-signal btn-block btn-lg">
          {t('household.saveNew')}
        </button>
      </form>
    </>
  );
}

// ---------- UC14 Search Household ----------
export function SearchPage() {
  const { t } = useTranslation();
  const areaLabel = useAreaLabel();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<HouseholdView[] | null>(null);
  useEffect(() => {
    const handle = setTimeout(() => {
      if (q.trim().length < 2) setResults(null);
      else void localStore.search(q).then(setResults);
    }, 150);
    return () => clearTimeout(handle);
  }, [q]);
  return (
    <>
      <h1>{t('search.title')}</h1>
      <TextField label={t('search.label')} help={t('search.hint')} type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {results && (
        <p role="status" className="muted">
          {results.length > 0 ? t('search.results', { count: results.length }) : t('search.none')}
        </p>
      )}
      {results && results.length === 0 && (
        <Empty title={t('search.none')}>
          <p>{t('search.noneHint')}</p>
          <Link className="btn btn-quiet" to="/field/households/new">
            {t('search.registerNew')}
          </Link>
        </Empty>
      )}
      {results && results.length > 0 && (
        <ul className="list panel">
          {results.map((h) => (
            <li key={h.id}>
              <Link className="list-row" to={`/field/households/${h.id}`}>
                <span>
                  <span className="list-title">{h.headName ?? t('household.redacted')}</span>
                  <br />
                  <span className="small muted">
                    {areaLabel(localStore.area(h.areaId))}, {h.organisationName}
                  </span>
                </span>
                <ShortCode code={h.shortCode} size="sm" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------- Household detail, UC13 entry and UC15 cancel ----------
export function HouseholdPage() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const { local } = useSession();
  const toast = useToast();
  const areaLabel = useAreaLabel();
  const confirm = useConfirm();
  const data = useLocalData(async () => {
    const h = localStore.getHousehold(id);
    const ds = h ? await localStore.distributionsFor(id) : [];
    const items = new Map((await localStore.db.items.toArray()).map((i) => [i.id, i]));
    const voidable = new Set<string>();
    for (const d of ds) if (await localStore.canVoid(d)) voidable.add(d.id);
    return { h, ds, items, voidable };
  }, [id]);
  if (!data) return null;
  const { h, ds, items, voidable } = data;
  if (!h) return <Notice tone="warn">{t('household.notFound')}</Notice>;
  const own = h.organisationId === local?.organisationId;

  const cancel = async (d: DistributionRow) => {
    const reason = await confirm.ask(`${t('distribution.cancel')}. ${t('distribution.cancelWindow')}`, true);
    if (!reason) return;
    await localStore.voidDistribution(d.id, reason);
    toast(t('distribution.cancelled'));
    syncManager.soon();
  };

  return (
    <>
      <div className="hh-card">
        <span className="small muted">{t('household.shortCode')}</span>
        <ShortCode code={h.shortCode} />
        {h.redacted ? (
          <p>{t('household.redacted')}</p>
        ) : (
          <dl className="dl">
            <dt>{t('household.headName')}</dt>
            <dd>{h.headName}</dd>
            <dt>{t('household.mobile')}</dt>
            <dd>{own ? (h.mobile ?? '—') : h.mobileMasked ? `${h.mobileMasked}` : t('household.mobileHidden')}</dd>
            <dt>{t('household.members')}</dt>
            <dd>{formatNumber(h.memberCount)}</dd>
            <dt>{t('household.area')}</dt>
            <dd>{areaLabel(localStore.area(h.areaId))}</dd>
          </dl>
        )}
        <p className="small muted" style={{ marginTop: 12 }}>
          {t('household.registeredBy', { org: h.organisationName })}
          {h.pending === 1 && (
            <>
              {' '}
              <span className="tag tag-warn">{t('household.pendingSync')}</span>
            </>
          )}
        </p>
        {h.linked.length > 0 && (
          <p className="small">
            {t('household.linked', {
              codes: h.linked.map((l) => localStore.getHousehold(l)?.shortCode ?? '').filter(Boolean).join(', ') || h.linked.length,
            })}
          </p>
        )}
      </div>
      {!h.redacted && (
        <div className="form-actions" style={{ marginBottom: 16 }}>
          <Link className="btn btn-signal btn-lg" to={`/field/households/${h.id}/distribute`}>
            {t('household.distribute')}
          </Link>
          <Link className="btn btn-quiet btn-lg" to={`/field/households/${h.id}/edit`}>
            {t('household.edit')}
          </Link>
        </div>
      )}
      <section className="panel">
        <h2>{t('household.pastDistributions')}</h2>
        {ds.length === 0 ? (
          <p className="muted">{t('household.noDistributions')}</p>
        ) : (
          <ul className="list">
            {ds.map((d) => (
              <li key={d.id} style={{ padding: '12px 0' }}>
                <strong>{formatTime(d.distributedAt)}</strong> <span className="small muted">{t('distribution.by', { org: d.organisationName })}</span>
                {d.status === 'voided' && <span className="tag tag-danger"> {t('distribution.voided', { reason: d.cancelReason ?? '' })}</span>}
                {d.pending === 1 && <span className="tag tag-warn"> {t('household.pendingSync')}</span>}
                <br />
                {d.items.map((i) => `${itemLabel(items.get(i.itemId), i18n.language)} ${formatNumber(i.quantity)} ${items.get(i.itemId)?.unit ?? ''}`).join(', ')}
                {voidable.has(d.id) && (
                  <div>
                    <button type="button" className="btn btn-danger" style={{ marginTop: 8 }} onClick={() => void cancel(d)}>
                      {t('distribution.cancel')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {confirm.dialog}
    </>
  );
}

export function EditHouseholdPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { local } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const areaLabel = useAreaLabel();
  const areas = useLocalData(() => localStore.selectedAreas(), []);
  const h = localStore.getHousehold(id);
  const [form, setForm] = useState(() => ({
    headName: h?.headName ?? '',
    mobile: h?.mobile ?? '',
    memberCount: h?.memberCount ?? 1,
    areaId: h?.areaId ?? '',
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!h) return <Notice tone="warn">{t('household.notFound')}</Notice>;
  const own = h.organisationId === local?.organisationId;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!HEAD_NAME_RE.test(form.headName.trim())) err.headName = t('validation.name_latin_only');
    if (own && form.mobile.trim() && !normalisePhone(form.mobile)) err.mobile = t('validation.invalid_phone');
    setErrors(err);
    if (Object.keys(err).length > 0) return;
    const changed = await localStore.updateHousehold(id, {
      headName: form.headName,
      ...(own ? { mobile: form.mobile.trim() ? form.mobile : null } : {}),
      memberCount: form.memberCount,
      areaId: form.areaId,
    });
    toast(changed ? t('household.editSaved') : t('household.noChanges'));
    if (changed) syncManager.soon();
    navigate(`/field/households/${id}`);
  };
  return (
    <>
      <h1>{t('household.editTitle')}</h1>
      <ShortCode code={h.shortCode} size="sm" />
      <form onSubmit={submit} noValidate style={{ marginTop: 16 }}>
        <TextField label={t('household.headName')} value={form.headName} onChange={(e) => setForm({ ...form, headName: e.target.value })} error={errors.headName} lang="en" />
        {own ? (
          <TextField label={t('household.mobile')} type="tel" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} error={errors.mobile} />
        ) : (
          <p className="muted">{t('errors.mobile_not_editable')}</p>
        )}
        <Stepper label={t('household.members')} value={form.memberCount} onChange={(n) => setForm({ ...form, memberCount: n })} />
        <SelectField label={t('household.area')} value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })}>
          {areas?.map((a) => (
            <option key={a.id} value={a.id}>
              {areaLabel(a)}
            </option>
          ))}
        </SelectField>
        <div className="form-actions">
          <button type="submit" className="btn btn-signal btn-lg">
            {t('common.save')}
          </button>
          <Link className="btn btn-quiet btn-lg" to={`/field/households/${id}`}>
            {t('common.cancel')}
          </Link>
        </div>
      </form>
    </>
  );
}

// ---------- UC13 Record Relief Distribution ----------
export function DistributePage({ anonymous = false }: { anonymous?: boolean }) {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const areaLabel = useAreaLabel();
  const items = useLocalData(async () => (await localStore.db.items.toArray()).filter((i) => i.active), []);
  const areas = useLocalData(() => localStore.selectedAreas(), []);
  const h = anonymous ? undefined : localStore.getHousehold(id);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [areaId, setAreaId] = useState(h?.areaId ?? '');
  const [elsewhere, setElsewhere] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const past = useLocalData(async () => (h ? localStore.distributionsFor(h.id) : []), [h?.id]);
  const allItems = useLocalData(async () => new Map((await localStore.db.items.toArray()).map((i) => [i.id, i])), []);

  if (!anonymous && !h) return <Notice tone="warn">{t('household.notFound')}</Notice>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const chosen = Object.entries(qty)
      .filter(([, n]) => n > 0)
      .map(([itemId, quantity]) => ({ itemId, quantity }));
    if (chosen.length === 0) return setError(t('validation.choose_item'));
    if (!areaId) return setError(t('validation.choose_area'));
    try {
      await localStore.saveDistribution({ areaId, householdId: h?.id ?? null, items: chosen, receivedElsewhereToday: elsewhere });
      toast(t('distribution.saved'));
      syncManager.soon();
      navigate(h ? `/field/households/${h.id}` : '/field');
    } catch {
      setError(t('distribution.failed'));
    }
  };

  return (
    <>
      <h1>{anonymous ? t('distribution.anonymousTitle') : t('distribution.title')}</h1>
      {anonymous && <p className="muted">{t('distribution.anonymousIntro')}</p>}
      {h && (
        <p>
          <strong>{h.headName}</strong> <ShortCode code={h.shortCode} size="sm" />
        </p>
      )}
      {past && past.length > 0 && (
        <Notice>
          <strong>{t('household.pastDistributions')}:</strong>{' '}
          {past
            .filter((d) => d.status === 'recorded')
            .slice(0, 3)
            .map((d) => `${formatTime(d.distributedAt)} (${d.organisationName}): ${d.items.map((i) => itemLabel(allItems?.get(i.itemId), i18n.language)).join(', ')}`)
            .join('; ')}
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <form onSubmit={submit} noValidate>
        {anonymous && (
          <SelectField label={t('common.area')} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            <option value="">—</option>
            {areas?.map((a) => (
              <option key={a.id} value={a.id}>
                {areaLabel(a)}
              </option>
            ))}
          </SelectField>
        )}
        <fieldset className="panel" style={{ margin: '0 0 16px' }}>
          <legend className="label">
            <strong>{t('distribution.items')}</strong>
          </legend>
          {items && items.length === 0 && <p className="muted">{t('distribution.noItems')}</p>}
          {items?.map((it) => (
            <div key={it.id} className="item-row">
              <span>
                <strong>{itemLabel(it, i18n.language)}</strong> <span className="small muted">({it.unit})</span>
              </span>
              <Stepper label={`${t('distribution.quantity')}: ${itemLabel(it, i18n.language)}`} min={0} max={10000} value={qty[it.id] ?? 0} onChange={(n) => setQty({ ...qty, [it.id]: n })} />
            </div>
          ))}
        </fieldset>
        {!anonymous && (
          <label className="check">
            <input type="checkbox" checked={elsewhere} onChange={(e) => setElsewhere(e.target.checked)} />
            {t('distribution.receivedElsewhere')}
          </label>
        )}
        <button type="submit" className="btn btn-signal btn-block btn-lg">
          {t('distribution.confirm')}
        </button>
      </form>
    </>
  );
}

// ---------- UC16 Synchronise Data ----------
export function SyncPage() {
  const { t } = useTranslation();
  const status = useSyncStatus();
  const { serverSession } = useSession();
  const toast = useToast();
  const rows = useLocalData(() => localStore.outboxRows(), []);
  const run = async () => {
    const r = await syncManager.syncNow('manual');
    if (r) toast(r.ok ? t('sync.completed') : t('sync.interrupted'), r.ok ? 'ok' : 'error');
  };
  const r = status.lastResult;
  return (
    <>
      <h1>{t('sync.title')}</h1>
      <p className="muted">{t('sync.intro')}</p>
      {(status.needsLogin || !serverSession) && (
        <Notice tone="warn">
          {t('sync.authNeeded')} <Link to="/login">{t('auth.login')}</Link>
        </Notice>
      )}
      {status.revoked && <Notice tone="error">{t('sync.revoked')}</Notice>}
      {r && (
        <Notice tone={r.ok ? 'ok' : 'error'}>
          <strong>{r.ok ? t('sync.completed') : t('sync.interrupted')}</strong>
          <br />
          {t('sync.result', {
            uploaded: formatNumber(r.uploaded),
            duplicates: formatNumber(r.duplicates),
            conflicts: formatNumber(r.conflicts),
            downloaded: formatNumber(r.downloadedHouseholds + r.downloadedDistributions),
          })}
        </Notice>
      )}
      <button type="button" className="btn btn-signal btn-block btn-lg" disabled={status.running || !serverSession} onClick={() => void run()}>
        {status.running ? t('status.syncing') : t('sync.now')}
      </button>
      <section className="panel" style={{ marginTop: 16 }}>
        <h2>
          {t('sync.queue')} <span className="badge-count">{formatNumber(status.pending)}</span>
        </h2>
        {rows && rows.length === 0 ? (
          <p className="muted">{t('sync.queueEmpty')}</p>
        ) : (
          <ul className="list">
            {rows?.map((o) => (
              <li key={o.eventId} className="list-row">
                <span>
                  {t(`sync.types.${o.type}`, { defaultValue: o.type })}
                  <br />
                  <span className="small muted">
                    {formatTime(o.createdAt)}
                    {o.attempts > 0 ? `, ${t('sync.attempts', { count: o.attempts })}` : ''}
                  </span>
                </span>
                <span className={`tag ${o.status === 'failed' ? 'tag-danger' : 'tag-warn'}`}>{t(`statuses.${o.status === 'failed' ? 'failed' : 'pending'}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

// ---------- UC21 (field side): unserved lists received at sync ----------
export function FieldUnservedPage() {
  const { t } = useTranslation();
  const areaLabel = useAreaLabel();
  const data = useLocalData(async () => {
    const releases = (await localStore.db.releases.toArray()).sort((a, b) => b.releasedAt.localeCompare(a.releasedAt));
    const served = new Set((await localStore.db.distributions.toArray()).filter((d) => d.status === 'recorded' && d.householdId).map((d) => d.householdId as string));
    return { releases, served };
  }, []);
  if (!data) return null;
  return (
    <>
      <h1>{t('unserved.title')}</h1>
      <p className="muted">{t('unserved.fieldIntro')}</p>
      {data.releases.length === 0 && <Empty title={t('unserved.none')} />}
      {data.releases.map((r) => (
        <section key={r.id} className="panel">
          <div className="panel-head">
            <h2>
              <MapPin size={18} aria-hidden /> {areaLabel(localStore.area(r.areaId))}
            </h2>
            <span className="small muted">{t('unserved.released', { time: formatTime(r.releasedAt), name: r.releasedByName })}</span>
          </div>
          <p>{t('unserved.count', { count: r.householdIds.length })}</p>
          <ul className="list">
            {r.householdIds.map((hid) => {
              const h = localStore.getHousehold(hid);
              return (
                <li key={hid}>
                  {h ? (
                    <Link className="list-row" to={`/field/households/${hid}`}>
                      <span className="list-title">{h.headName}</span>
                      <span>
                        <ShortCode code={h.shortCode} size="sm" /> {data.served.has(hid) && <span className="tag tag-ok">{t('unserved.servedSince')}</span>}
                      </span>
                    </Link>
                  ) : (
                    <span className="list-row muted">{t('household.notFound')}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

// ---------- UC20 notifications on the phone (server + local) ----------
interface ServerNotification {
  id: string;
  type: string;
  params: Record<string, string | number>;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export function useNotificationText() {
  const { t } = useTranslation();
  return (type: string, params: Record<string, string | number>) => {
    const p: Record<string, string | number> = { ...params };
    if (typeof p.field === 'string') p.field = t(`conflicts.fields.${p.field}`, { defaultValue: p.field });
    if (typeof p.label === 'string') p.label = t(`statuses.${p.label}`, { defaultValue: p.label });
    if (typeof p.decision === 'string') p.decision = t(`statuses.${p.decision}`, { defaultValue: p.decision });
    if (typeof p.reason === 'string') p.reason = t(`errors.${p.reason}`, { defaultValue: p.reason });
    return t(`notifications.types.${type}`, { ...p, defaultValue: type });
  };
}

export function FieldNotificationsPage() {
  const { t } = useTranslation();
  const { serverSession } = useSession();
  const text = useNotificationText();
  const notices = useLocalData(() => localStore.notices(), []);
  const [server, setServer] = useState<ServerNotification[]>([]);
  useEffect(() => {
    if (serverSession) api.get<{ notifications: ServerNotification[] }>('/api/notifications').then((r) => setServer(r.notifications)).catch(() => undefined);
  }, [serverSession]);
  const all = useMemo(
    () =>
      [
        ...(notices ?? []).map((n: NoticeRow) => ({ id: n.id, type: n.type, params: n.params, link: n.link, isRead: n.read === 1, createdAt: n.createdAt })),
        ...server,
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [notices, server],
  );
  const markAll = async () => {
    await localStore.markNoticesRead();
    if (serverSession) await api.post('/api/notifications/read-all').catch(() => undefined);
    setServer((s) => s.map((n) => ({ ...n, isRead: true })));
  };
  return (
    <>
      <div className="panel-head">
        <h1>{t('notifications.title')}</h1>
        <button type="button" className="btn btn-quiet" onClick={() => void markAll()}>
          {t('notifications.markAll')}
        </button>
      </div>
      {all.length === 0 ? (
        <Empty title={t('notifications.none')} />
      ) : (
        <ul className="list panel">
          {all.map((n) => (
            <li key={n.id} className="list-row">
              <span>
                {n.isRead ? text(n.type, n.params) : <strong>{text(n.type, n.params)}</strong>}
                <br />
                <span className="small muted">{formatTime(n.createdAt)}</span>
              </span>
              {n.link?.startsWith('/field') && (
                <Link className="btn btn-quiet" to={n.link}>
                  {t('common.open')}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------- Settings ----------
export function FieldSettingsPage() {
  const { t } = useTranslation();
  const { local, logout, role } = useSession();
  const navigate = useNavigate();
  const status = useSyncStatus();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted);
  }, []);
  return (
    <>
      <h1>{t('settings.title')}</h1>
      <section className="panel">
        <h2>{t('settings.device')}</h2>
        <dl className="dl">
          <dt>{t('common.user')}</dt>
          <dd>{local?.fullName}</dd>
          <dt>{t('common.organisation')}</dt>
          <dd>{local?.organisationName}</dd>
          <dt>{t('settings.prefix')}</dt>
          <dd>
            <span className="short-code-sm">{local?.devicePrefix}</span>
          </dd>
          <dt>{t('settings.storage')}</dt>
          <dd>{persisted ? t('settings.persisted') : t('settings.notPersisted')}</dd>
        </dl>
      </section>
      <section className="panel">
        <h2>{t('pin.changePin')}</h2>
        <SetPinPage embedded />
      </section>
      {role === 'GROUP_COORDINATOR' && (
        <Link className="btn btn-quiet btn-block" to="/app/coverage" style={{ marginBottom: 16 }}>
          {t('field.openDashboard')}
        </Link>
      )}
      {status.pending > 0 && <Notice tone="warn">{t('settings.logoutPending', { n: status.pending })}</Notice>}
      <button
        type="button"
        className="btn btn-danger btn-block"
        onClick={() => {
          void logout().then(() => navigate('/unlock'));
        }}
      >
        {t('settings.logout')}
      </button>
    </>
  );
}

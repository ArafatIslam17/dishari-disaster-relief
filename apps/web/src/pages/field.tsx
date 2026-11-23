import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  Bell,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Download,
  HandCoins,
  HandHeart,
  House,
  LayoutDashboard,
  Map as MapIcon,
  MapPin,
  Package,
  PencilLine,
  RefreshCw,
  Search as SearchIcon,
  Settings as SettingsIcon,
  UserPlus,
  type LucideIcon,
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
import { useNotificationText } from '../ui/notifications';
import { Empty, Notice, PageHead, SelectField, ShortCode, StatusTag, Stepper, TextField, useConfirm, useErrorText, useToast } from '../ui/kit';

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

type Tone = 'navy' | 'sky' | 'teal' | 'gold' | 'rose' | 'slate';

/** A home menu row: duotone icon tile, title, one-line description, chevron. */
function MenuLink({ to, icon: Icon, label, sub, tone = 'navy', end }: { to: string; icon: LucideIcon; label: string; sub?: string; tone?: Tone; end?: ReactNode }) {
  return (
    <li>
      <Link to={to}>
        <span className={`menu-icon tone-tile-${tone}`} aria-hidden>
          <Icon size={22} />
        </span>
        <span className="menu-label">
          {label}
          {sub && <span className="menu-sub">{sub}</span>}
        </span>
        {end}
        <ChevronRight size={18} className="chev" aria-hidden />
      </Link>
    </li>
  );
}

function NotOnPhone() {
  const { t } = useTranslation();
  return (
    <>
      <PageHead title={t('household.notFoundTitle')} back={{ to: '/field/search' }} />
      <Notice tone="warn">{t('household.notFound')}</Notice>
    </>
  );
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
  const unreadNotices = useLocalData(async () => (await localStore.notices()).filter((n) => n.read !== 1).length, []);

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
        <PageHead title={t('field.homeTitle')} lead={t('field.chooseIntro')} />
        {error ? <Notice tone="error">{errorText(error)}</Notice> : null}
        {!serverSession && <Notice tone="offline">{t('areas.needOnline')}</Notice>}
        {ops && ops.length === 0 && (
          <Empty title={t('field.noOperationsTitle')} mark="pending">
            {t('field.noOperations')}
          </Empty>
        )}
        {ops && ops.length > 0 && (
          <section aria-labelledby="choose-op">
            <h2 id="choose-op" className="menu-group-title">
              {t('field.chooseOperation')}
            </h2>
            <ul className="menu-list">
              {ops.map((o) => (
                <li key={o.id}>
                  <button type="button" className="menu-button" onClick={() => void choose(o)}>
                    <span className="menu-icon tone-tile-navy" aria-hidden>
                      <MapPin size={22} />
                    </span>
                    <span className="menu-label">{o.name}</span>
                    <ChevronRight size={18} className="chev" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  return (
    <>
      <header className="home-head">
        <h1>{t('field.homeTitle')}</h1>
        <p className="home-op">
          {t('field.operation')}: <strong>{opName}</strong>
        </p>
      </header>
      <dl className="home-stats">
        <div>
          <dt className="visually-hidden">{t('field.stats.areas')}</dt>
          <dd className="figure">{formatNumber(counts?.areas ?? 0)}</dd>
          <dd className="stat-icon" aria-hidden>
            <MapIcon size={20} />
          </dd>
          <dd className="figure-label" aria-hidden>
            {t('field.stats.areas')}
          </dd>
        </div>
        <div>
          <dt className="visually-hidden">{t('field.stats.households')}</dt>
          <dd className="figure">{formatNumber(counts?.households ?? 0)}</dd>
          <dd className="stat-icon" aria-hidden>
            <House size={20} />
          </dd>
          <dd className="figure-label" aria-hidden>
            {t('field.stats.households')}
          </dd>
        </div>
        <div>
          <dt className="visually-hidden">{t('field.stats.waiting')}</dt>
          <dd className="figure">{formatNumber(status.pending)}</dd>
          <dd className={`stat-icon${status.pending > 0 ? ' is-pending' : ' is-ok'}`} aria-hidden>
            {status.pending > 0 ? <RefreshCw size={20} /> : <CheckCircle2 size={20} />}
          </dd>
          <dd className="figure-label" aria-hidden>
            {t('field.stats.waiting')}
          </dd>
        </div>
      </dl>
      {status.skewMinutes !== 0 && <Notice tone="warn">{t('status.skew', { minutes: Math.abs(status.skewMinutes) })}</Notice>}
      {counts && counts.areas === 0 && (
        <Notice tone="warn">
          <p>{t('field.downloadFirst')}</p>
          <Link className="btn btn-secondary btn-sm" to="/field/areas">
            <Download size={16} aria-hidden />
            {t('field.getAreas')}
          </Link>
        </Notice>
      )}
      <Link to="/field/households/new" className="hoist">
        <span className="hoist-icon">
          <UserPlus size={26} aria-hidden />
        </span>
        <span className="hoist-text">
          {t('field.actions.newHousehold')}
          <span className="hoist-sub">{t('field.hoistSub')}</span>
        </span>
        <span className="hoist-cta" aria-hidden>
          {t('field.hoistCta')}
          <ArrowRight size={18} />
        </span>
      </Link>
      <h2 className="menu-group-title">{t('field.groupWork')}</h2>
      <ul className="menu-list">
        <MenuLink to="/field/search" icon={SearchIcon} tone="navy" label={t('field.actions.search')} sub={t('field.menuSub.search')} />
        <MenuLink to="/field/anonymous" icon={HandHeart} tone="teal" label={t('field.actions.anonymous')} sub={t('field.menuSub.anonymous')} />
        <MenuLink to="/field/unserved" icon={ClipboardList} tone="gold" label={t('field.actions.unserved')} sub={t('field.menuSub.unserved')} />
        <MenuLink to="/donate" icon={HandCoins} tone="rose" label={t('donate.nav')} sub={t('donate.navSub')} />
      </ul>
      <h2 className="menu-group-title">{t('field.groupPhone')}</h2>
      <ul className="menu-list">
        <MenuLink to="/field/areas" icon={Download} tone="sky" label={t('field.actions.areas')} sub={t('field.menuSub.areas')} />
        <MenuLink
          to="/field/notifications"
          icon={Bell}
          tone="rose"
          label={t('field.actions.notifications')}
          sub={t('field.menuSub.notifications')}
          end={unreadNotices ? <span className="badge-count">{formatNumber(unreadNotices)}</span> : null}
        />
        <MenuLink to="/field/settings" icon={SettingsIcon} tone="slate" label={t('field.actions.settings')} sub={t('field.menuSub.settings')} />
        {role === 'GROUP_COORDINATOR' && <MenuLink to="/app/coverage" icon={LayoutDashboard} tone="navy" label={t('field.openDashboard')} sub={t('field.menuSub.dashboard')} />}
      </ul>
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
      <PageHead title={t('areas.title')} lead={t('areas.intro')} back={{ to: '/field' }} />
      {!serverSession && <Notice tone="offline">{t('areas.needOnline')}</Notice>}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <TextField label={t('areas.filter')} type="search" value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" spellCheck={false} />
      {boot && rows.length === 0 && <Empty title={t('areas.noMatch')} />}
      {!boot && serverSession && !message && (
        <div className="loading" aria-busy="true" role="status">
          <span className="visually-hidden">{t('app.loading')}</span>
          <div className="skeleton" style={{ width: '88%' }} />
          <div className="skeleton" style={{ width: '72%' }} />
          <div className="skeleton" style={{ width: '80%' }} />
        </div>
      )}
      {rows.length > 0 && (
        <ul className="list panel choice-list">
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
                  <span className="check-text">
                    <strong>{areaLabel(a)}</strong>
                    <span className="small muted">
                      {t('areas.households', { n: formatNumber(a.householdCount) })}
                      {' · '}
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
      )}
      <div className="action-stack">
        <button type="button" className="btn btn-primary btn-block btn-lg" disabled={busy || selected.size === 0 || !serverSession} onClick={() => void download()}>
          <Download size={20} aria-hidden />
          {busy ? t('areas.downloading') : t('areas.download')}
        </button>
        <p className="small muted" aria-live="polite">
          {t('areas.selected', { count: selected.size })}
        </p>
      </div>
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
    // Focus the first field that needs attention (WDG: focus the first error on submit).
    const first = ['headName', 'mobile', 'memberCount', 'areaId'].find((k) => e[k]);
    if (first) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-field="${first}"] input, [data-field="${first}"] select`)?.focus());
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
        <PageHead title={t('household.saved')} />
        <article className="hh-card">
          <div className="hh-card-head">
            <span className="hh-card-label">{t('household.shortCode')}</span>
            <ShortCode code={saved.shortCode} />
          </div>
          <dl className="dl">
            <dt>{t('household.headName')}</dt>
            <dd>{saved.headName}</dd>
            <dt>{t('household.members')}</dt>
            <dd>{formatNumber(saved.memberCount)}</dd>
          </dl>
          <p className="hh-meta">{t('household.writeCode')}</p>
        </article>
        <div className="action-stack">
          <Link className="btn btn-primary btn-lg btn-block" to={`/field/households/${saved.id}/distribute`}>
            <HandHeart size={20} aria-hidden />
            {t('household.distribute')}
          </Link>
          <button type="button" className="btn btn-secondary btn-lg btn-block" onClick={() => navigate('/field/households/new')}>
            <UserPlus size={20} aria-hidden />
            {t('household.registerAnother')}
          </button>
        </div>
      </>
    );
  }

  if (consent !== 'given') {
    return (
      <>
        <PageHead title={t('household.newTitle')} back={{ to: '/field' }} />
        <section className="consent" aria-labelledby="consent-title">
          <h2 id="consent-title">{t('household.consentTitle')}</h2>
          <p className="small muted">{t('household.consentRead')}</p>
          <p lang="bn" className="consent-text">
            {t('household.consentText')}
          </p>
          <button type="button" className="link-button" onClick={() => setShowEnglish((v) => !v)} aria-expanded={showEnglish}>
            {showEnglish ? t('household.hideEnglish') : t('household.showEnglish')}
          </button>
          {showEnglish && (
            <p lang="en" className="consent-en">
              {t('household.consentEnglish')}
            </p>
          )}
        </section>
        {consent === 'refused' ? (
          <>
            <Notice tone="warn">{t('household.refusedHelp')}</Notice>
            <Link className="btn btn-primary btn-block btn-lg" to="/field/anonymous">
              <HandHeart size={20} aria-hidden />
              {t('field.actions.anonymous')}
            </Link>
          </>
        ) : (
          <div className="action-stack">
            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => setConsent('given')}>
              {t('household.consentGiven')}
            </button>
            <button type="button" className="btn btn-secondary btn-lg btn-block" onClick={() => setConsent('refused')}>
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
        <PageHead title={t('household.similarTitle')} lead={t('household.similarIntro')} />
        <ul className="list">
          {matches.map((m) => (
            <li key={m.household.id} className="match">
              <div className="row">
                <span className="list-title">{m.household.headName}</span>
                <ShortCode code={m.household.shortCode} size="sm" />
              </div>
              <span className="small muted">
                {areaLabel(localStore.area(m.household.areaId))} · {t('household.members')} {formatNumber(m.household.memberCount)} · {m.household.organisationName}
              </span>
              <div className="row">
                <StatusTag status={m.label} />
                <span className="small">{t('household.score', { score: formatNumber(Math.round(m.score * 100)) + '%' })}</span>
              </div>
              <Link className="btn btn-secondary btn-block" to={`/field/households/${m.household.id}`}>
                {t('household.useExisting')}
              </Link>
            </li>
          ))}
        </ul>
        <div className="action-stack mt-5">
          <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => void save()}>
            {t('household.confirmNew')}
          </button>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setMatches(null)}>
            {t('household.backToForm')}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead title={t('household.newTitle')} meta={<StatusTag status="ok" label={t('household.consentRecorded')} />} />
      {areas && areas.length === 0 && (
        <Notice tone="warn">
          <p>{t('field.downloadFirst')}</p>
          <Link className="btn btn-secondary btn-sm" to="/field/areas">
            {t('field.getAreas')}
          </Link>
        </Notice>
      )}
      <form onSubmit={check} noValidate>
        <div data-field="headName">
          <TextField
            label={t('household.headName')}
            value={form.headName}
            onChange={(e) => setForm({ ...form, headName: e.target.value })}
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            lang="en"
            name="headName"
            error={errors.headName}
          />
        </div>
        <div data-field="mobile">
          <TextField
            label={t('household.mobile')}
            help={t('household.mobileHelp')}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            name="mobile"
            value={form.mobile}
            onChange={(e) => setForm({ ...form, mobile: e.target.value })}
            error={errors.mobile}
          />
        </div>
        <div data-field="memberCount">
          <Stepper label={t('household.members')} value={form.memberCount} onChange={(n) => setForm({ ...form, memberCount: n })} error={errors.memberCount} />
        </div>
        <div data-field="areaId">
          <SelectField label={t('household.area')} value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })} error={errors.areaId} name="areaId">
            <option value="">{t('common.choose')}</option>
            {areas?.map((a) => (
              <option key={a.id} value={a.id}>
                {areaLabel(a)}
              </option>
            ))}
          </SelectField>
        </div>
        <label className="check">
          <input type="checkbox" checked={gpsState !== 'off'} onChange={(e) => takeGps(e.target.checked)} />
          <span className="check-text">
            {t('household.gpsConsent')}
            <span className="small muted" aria-live="polite">
              {gpsState === 'taking' && t('household.gpsTaking')}
              {gpsState === 'saved' && t('household.gpsSaved')}
              {gpsState === 'failed' && t('household.gpsFailed')}
            </span>
          </span>
        </label>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-block btn-lg">
            {t('household.saveNew')}
          </button>
        </div>
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
      <PageHead title={t('search.title')} />
      <TextField
        label={t('search.label')}
        help={t('search.hint')}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      <p role="status" className="small muted">
        {results && results.length > 0 ? t('search.results', { count: results.length }) : !results ? t('search.startHint') : ''}
      </p>
      {results && results.length === 0 && (
        <Empty
          title={t('search.none')}
          mark="not_served"
          action={
            <Link className="btn btn-secondary" to="/field/households/new">
              <UserPlus size={18} aria-hidden />
              {t('search.registerNew')}
            </Link>
          }
        >
          {t('search.noneHint')}
        </Empty>
      )}
      {results && results.length > 0 && (
        <ul className="list panel">
          {results.map((h) => (
            <li key={h.id}>
              <Link className="list-row" to={`/field/households/${h.id}`}>
                <span className="list-main">
                  <span className="list-title">{h.headName ?? t('household.redacted')}</span>
                  <span className="list-sub">
                    {areaLabel(localStore.area(h.areaId))} · {h.organisationName}
                  </span>
                </span>
                <span className="list-end">
                  <ShortCode code={h.shortCode} size="sm" />
                  <ChevronRight size={18} className="chev" aria-hidden />
                </span>
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
  if (!h) return <NotOnPhone />;
  const own = h.organisationId === local?.organisationId;

  const cancel = async (d: DistributionRow) => {
    const reason = await confirm.ask(`${t('distribution.cancel')}. ${t('distribution.cancelWindow')}`, true, { confirmLabel: t('distribution.cancel') });
    if (!reason) return;
    await localStore.voidDistribution(d.id, reason);
    toast(t('distribution.cancelled'));
    syncManager.soon();
  };

  return (
    <>
      <PageHead title={h.redacted ? t('household.redactedTitle') : h.headName} back={{ to: '/field/search' }} />
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
            <dd>{own ? (h.mobile ?? '—') : h.mobileMasked ? `${h.mobileMasked}` : t('household.mobileHidden')}</dd>
            <dt>{t('household.members')}</dt>
            <dd>{formatNumber(h.memberCount)}</dd>
            <dt>{t('household.area')}</dt>
            <dd>{areaLabel(localStore.area(h.areaId))}</dd>
          </dl>
        )}
        <p className="hh-meta">
          {t('household.registeredBy', { org: h.organisationName })}
          {h.pending === 1 && <StatusTag status="pending" label={t('household.pendingSync')} />}
        </p>
        {h.linked.length > 0 && (
          <p className="hh-meta">
            <StatusTag status="linked" />
            {t('household.linked', {
              codes: h.linked.map((l) => localStore.getHousehold(l)?.shortCode ?? '').filter(Boolean).join(', ') || h.linked.length,
            })}
          </p>
        )}
      </article>
      {!h.redacted && (
        <div className="action-stack">
          <Link className="btn btn-primary btn-lg btn-block" to={`/field/households/${h.id}/distribute`}>
            <HandHeart size={20} aria-hidden />
            {t('household.distribute')}
          </Link>
          <Link className="btn btn-secondary btn-block" to={`/field/households/${h.id}/edit`}>
            <PencilLine size={18} aria-hidden />
            {t('household.edit')}
          </Link>
        </div>
      )}
      <section className="panel mt-5" aria-labelledby="past-title">
        <h2 id="past-title">{t('household.pastDistributions')}</h2>
        {ds.length === 0 ? (
          <p className="muted">{t('household.noDistributions')}</p>
        ) : (
          <ul className="list history-list">
            {ds.map((d) => (
              <li key={d.id} className={d.status === 'voided' ? 'voided' : undefined}>
                <div className="history-head">
                  <strong className="tabular">{formatTime(d.distributedAt)}</strong>
                  <span className="small muted">{t('distribution.by', { org: d.organisationName })}</span>
                  {d.status === 'voided' && <StatusTag status="voided" label={t('distribution.voided', { reason: d.cancelReason ?? '' })} />}
                  {d.pending === 1 && <StatusTag status="pending" label={t('household.pendingSync')} />}
                </div>
                <span className="history-items">
                  {d.items.map((i) => `${itemLabel(items.get(i.itemId), i18n.language)} ${formatNumber(i.quantity)} ${items.get(i.itemId)?.unit ?? ''}`).join(', ')}
                </span>
                {voidable.has(d.id) && (
                  <div>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => void cancel(d)}>
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
  if (!h) return <NotOnPhone />;
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
      <PageHead title={t('household.editTitle')} back={{ to: `/field/households/${id}` }} meta={<ShortCode code={h.shortCode} size="sm" />} />
      <form onSubmit={submit} noValidate>
        <TextField
          label={t('household.headName')}
          value={form.headName}
          onChange={(e) => setForm({ ...form, headName: e.target.value })}
          error={errors.headName}
          lang="en"
          autoComplete="off"
          spellCheck={false}
        />
        {own ? (
          <TextField label={t('household.mobile')} type="tel" inputMode="tel" autoComplete="off" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} error={errors.mobile} />
        ) : (
          <Notice>{t('errors.mobile_not_editable')}</Notice>
        )}
        <Stepper label={t('household.members')} value={form.memberCount} onChange={(n) => setForm({ ...form, memberCount: n })} />
        <SelectField label={t('household.area')} value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })}>
          {areas?.map((a) => (
            <option key={a.id} value={a.id}>
              {areaLabel(a)}
            </option>
          ))}
        </SelectField>
        <div className="action-stack mt-5">
          <button type="submit" className="btn btn-primary btn-lg btn-block">
            {t('common.save')}
          </button>
          <Link className="btn btn-secondary btn-block" to={`/field/households/${id}`}>
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

  if (!anonymous && !h) return <NotOnPhone />;

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
  const recent = (past ?? []).filter((d) => d.status === 'recorded').slice(0, 3);

  return (
    <>
      <PageHead
        title={anonymous ? t('distribution.anonymousTitle') : t('distribution.title')}
        back={{ to: h ? `/field/households/${h.id}` : '/field' }}
        lead={anonymous ? t('distribution.anonymousIntro') : undefined}
        meta={
          h ? (
            <>
              <strong>{h.headName}</strong>
              <ShortCode code={h.shortCode} size="sm" />
            </>
          ) : undefined
        }
      />
      {recent.length > 0 && (
        <Notice>
          <strong>{t('distribution.recent')}</strong>
          <ul className="list">
            {recent.map((d) => (
              <li key={d.id} className="small">
                <span className="tabular">{formatTime(d.distributedAt)}</span> · {d.organisationName}: {d.items.map((i) => itemLabel(allItems?.get(i.itemId), i18n.language)).join(', ')}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <form onSubmit={submit} noValidate>
        {anonymous && (
          <SelectField label={t('common.area')} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            <option value="">{t('common.choose')}</option>
            {areas?.map((a) => (
              <option key={a.id} value={a.id}>
                {areaLabel(a)}
              </option>
            ))}
          </SelectField>
        )}
        <fieldset className="fieldset">
          <legend>{t('distribution.items')}</legend>
          {items && items.length === 0 && <p className="muted">{t('distribution.noItems')}</p>}
          {items?.map((it) => (
            <div key={it.id} className="item-row" data-active={(qty[it.id] ?? 0) > 0}>
              <span className="item-icon" aria-hidden>
                <Package size={22} />
              </span>
              <span className="item-name">
                <strong>{itemLabel(it, i18n.language)}</strong>
                <span className="item-unit">{it.unit}</span>
              </span>
              <Stepper
                label={`${t('distribution.quantity')}: ${itemLabel(it, i18n.language)}`}
                hideLabel
                min={0}
                max={10000}
                value={qty[it.id] ?? 0}
                onChange={(n) => setQty({ ...qty, [it.id]: n })}
              />
            </div>
          ))}
        </fieldset>
        {!anonymous && (
          <label className="check">
            <input type="checkbox" checked={elsewhere} onChange={(e) => setElsewhere(e.target.checked)} />
            <span className="check-text">{t('distribution.receivedElsewhere')}</span>
          </label>
        )}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-block btn-lg">
            {t('distribution.confirm')}
          </button>
        </div>
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
      <PageHead title={t('sync.title')} lead={t('sync.intro')} />
      {(status.needsLogin || !serverSession) && (
        <Notice tone="warn">
          <p>{t('sync.authNeeded')}</p>
          <Link className="btn btn-secondary btn-sm" to="/login">
            {t('auth.login')}
          </Link>
        </Notice>
      )}
      {status.revoked && <Notice tone="error">{t('sync.revoked')}</Notice>}
      {r && (
        <Notice tone={r.ok ? 'ok' : 'error'}>
          <strong>{r.ok ? t('sync.completed') : t('sync.interrupted')}</strong>
          <span>
            {t('sync.result', {
              uploaded: formatNumber(r.uploaded),
              duplicates: formatNumber(r.duplicates),
              conflicts: formatNumber(r.conflicts),
              downloaded: formatNumber(r.downloadedHouseholds + r.downloadedDistributions),
            })}
          </span>
        </Notice>
      )}
      <button type="button" className="btn btn-primary btn-block btn-lg" disabled={status.running || !serverSession} onClick={() => void run()}>
        <RefreshCw size={20} aria-hidden />
        {status.running ? t('status.syncing') : t('sync.now')}
      </button>
      <section className="panel mt-5" aria-labelledby="queue-title">
        <div className="section-title">
          <h2 id="queue-title">{t('sync.queue')}</h2>
          <span className={`badge-count${status.pending === 0 ? ' badge-quiet' : ''}`}>{formatNumber(status.pending)}</span>
        </div>
        {rows && rows.length === 0 ? (
          <p className="muted">{t('sync.queueEmpty')}</p>
        ) : (
          <ul className="list">
            {rows?.map((o) => (
              <li key={o.eventId} className="list-row">
                <span className="list-main">
                  <span className="list-title">{t(`sync.types.${o.type}`, { defaultValue: o.type })}</span>
                  <span className="list-sub tabular">
                    {formatTime(o.createdAt)}
                    {o.attempts > 0 ? ` · ${t('sync.attempts', { count: o.attempts })}` : ''}
                  </span>
                </span>
                <StatusTag status={o.status === 'failed' ? 'failed' : 'pending'} />
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
      <PageHead title={t('unserved.title')} lead={t('unserved.fieldIntro')} back={{ to: '/field' }} />
      {data.releases.length === 0 && (
        <Empty title={t('unserved.none')} mark="no_records">
          {t('unserved.noneHint')}
        </Empty>
      )}
      {data.releases.map((r) => (
        <section key={r.id} className="panel" aria-labelledby={`rel-${r.id}`}>
          <div className="section-title">
            <h2 id={`rel-${r.id}`}>
              <MapPin size={18} aria-hidden /> {areaLabel(localStore.area(r.areaId))}
            </h2>
          </div>
          <p className="small muted">
            {t('unserved.released', { time: formatTime(r.releasedAt), name: r.releasedByName })} · {t('unserved.count', { count: r.householdIds.length })}
          </p>
          <ul className="list">
            {r.householdIds.map((hid) => {
              const h = localStore.getHousehold(hid);
              return (
                <li key={hid}>
                  {h ? (
                    <Link className="list-row" to={`/field/households/${hid}`}>
                      <span className="list-main">
                        <span className="list-title">{h.headName}</span>
                        <ShortCode code={h.shortCode} size="sm" />
                      </span>
                      <span className="list-end">
                        {data.served.has(hid) ? <StatusTag status="ok" label={t('unserved.servedSince')} /> : <StatusTag status="pending" label={t('unserved.waiting')} />}
                        <ChevronRight size={18} className="chev" aria-hidden />
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
  const unread = all.filter((n) => !n.isRead).length;
  return (
    <>
      <PageHead
        title={t('notifications.title')}
        back={{ to: '/field' }}
        actions={
          unread > 0 ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void markAll()}>
              {t('notifications.markAll')}
            </button>
          ) : undefined
        }
      />
      {all.length === 0 ? (
        <Empty title={t('notifications.none')} mark="synced">
          {t('notifications.noneHint')}
        </Empty>
      ) : (
        <ul className="list panel">
          {all.map((n) => (
            <li key={n.id} className={`list-row${n.isRead ? '' : ' unread'}`}>
              <span className="list-main">
                <span className={n.isRead ? undefined : 'list-title'}>{text(n.type, n.params)}</span>
                <span className="list-sub tabular">{formatTime(n.createdAt)}</span>
              </span>
              {n.link?.startsWith('/field') && (
                <Link className="btn btn-secondary btn-sm" to={n.link}>
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
      <PageHead title={t('settings.title')} back={{ to: '/field' }} />
      <section className="panel" aria-labelledby="device-title">
        <h2 id="device-title">{t('settings.device')}</h2>
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
          <dd>
            <StatusTag status={persisted ? 'ok' : 'pending'} label={persisted ? t('settings.persisted') : t('settings.notPersisted')} />
          </dd>
        </dl>
      </section>
      <section className="panel" aria-labelledby="pin-title">
        <h2 id="pin-title">{t('pin.changePin')}</h2>
        <SetPinPage embedded />
      </section>
      {role === 'GROUP_COORDINATOR' && (
        <ul className="menu-list">
          <MenuLink to="/app/coverage" icon={LayoutDashboard} label={t('field.openDashboard')} />
        </ul>
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

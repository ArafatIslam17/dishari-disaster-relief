import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
  Archive,
  Bell,
  Building2,
  ClipboardList,
  Copy,
  FileText,
  GitCompareArrows,
  Home,
  HandCoins,
  LayoutDashboard,
  ListChecks,
  LogIn,
  LogOut,
  Map as MapIcon,
  Menu,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  ShieldAlert,
  Smartphone,
  Tags,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  UserRound,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@relief/shared';
import { api } from './api/client';
import { useSession } from './auth/session';
import { formatNumber, formatShortTime } from './i18n';
import { syncManager } from './local/sync';
import { Brand, LangSwitch, StatusMark, ThemeToggle, useApiData, type MarkKind } from './ui/kit';
import { useActiveIndicator, usePresence, useScrollReveal } from './ui/motion';

// ---------- field app shell ----------
export function useSyncStatus() {
  return useSyncExternalStore(syncManager.subscribe, syncManager.getStatus);
}

/** Announces the outcome of every sync (manual or automatic) to screen readers once. */
function useSyncAnnouncement(): string {
  const { t } = useTranslation();
  const status = useSyncStatus();
  const [text, setText] = useState('');
  const last = useRef(status.lastResult);
  useEffect(() => {
    if (status.lastResult && status.lastResult !== last.current) {
      setText(status.lastResult.ok ? t('sync.completed') : t('sync.interrupted'));
    }
    last.current = status.lastResult;
  }, [status.lastResult, t]);
  return text;
}

export function FieldLayout() {
  const { t } = useTranslation();
  const status = useSyncStatus();
  const { serverSession } = useSession();
  const announcement = useSyncAnnouncement();
  const mainRef = useRef<HTMLElement>(null);
  useScrollReveal(mainRef);
  useEffect(() => syncManager.start(() => serverSession), [serverSession]);
  const failed = !!status.lastResult && !status.lastResult.ok && status.pending > 0;
  const state: 'running' | 'failed' | 'pending' | 'synced' = status.running ? 'running' : failed ? 'failed' : status.pending > 0 ? 'pending' : 'synced';
  const mark: MarkKind = state === 'synced' ? 'synced' : state === 'failed' ? 'failed' : 'pending';
  return (
    <div className="field-shell">
      <a className="skip-link" href="#main">
        {t('app.skip')}
      </a>
      <header className="status-bar">
        <div className="status-row">
          <Link to="/field" className="brand brand-link">
            <Brand size={40} />
          </Link>
          <span className="status-actions">
            <LangSwitch compact />
            <ThemeToggle />
            <ProfileMenu pending={status.pending} />
          </span>
        </div>
      </header>
      <main id="main" className="field-main" ref={mainRef}>
        <div className="sync-strip">
          <Link to="/field/sync" className="sync-chip" data-state={state}>
            <StatusMark key={mark} kind={mark} size={12} />
            <span className="sync-chip-text">
              <span className="sync-chip-main">
                {state === 'running' ? t('status.syncing') : status.pending > 0 ? t('status.pending', { count: status.pending }) : t('status.allSynced')}
              </span>
              <span className="sync-chip-sub">{status.lastSyncAt ? t('status.lastSyncShort', { time: formatShortTime(status.lastSyncAt) }) : t('status.neverSynced')}</span>
            </span>
          </Link>
          <span className="net" data-online={status.online}>
            {status.online ? <Wifi size={16} aria-hidden /> : <WifiOff size={16} aria-hidden />}
            {status.online ? t('status.online') : t('status.offline')}
          </span>
        </div>
        {(!serverSession || status.needsLogin) && (
          <p className="status-login">
            <Link to="/login">{t('status.loginToSync')}</Link>
          </p>
        )}
        <span className="visually-hidden" role="status" aria-live="polite">
          {announcement}
        </span>
        <div className="route-stage">
          <Outlet />
        </div>
      </main>
      <FieldBottomBar pending={status.pending} />
    </div>
  );
}

/**
 * Field header profile: the volunteer's initials open a small panel with their name, role, a link
 * to Settings and Sign out. A disclosure (not a menu role), rendered only while open, so its links
 * never add to the page's link list.
 */
function ProfileMenu({ pending }: { pending: number }) {
  const { t } = useTranslation();
  const { local, user, logout } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const panel = usePresence(open, 140);
  const name = local?.fullName ?? user?.fullName ?? '';
  const role = local?.role ?? user?.role;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="profile" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="profile-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('profile.open', { name })}
        onClick={() => setOpen((v) => !v)}
      >
        {initials(name) || <UserRound size={18} aria-hidden />}
      </button>
      {panel.mounted && (
        <div id={panelId} className="profile-pop" data-state={open ? 'open' : 'closed'} inert={panel.closing || undefined}>
          <div className="profile-head">
            <span className="who-avatar" aria-hidden>
              {initials(name)}
            </span>
            <div className="profile-id">
              <p className="profile-name">{name}</p>
              {role && <span className="role-badge">{t(`roles.${role}`)}</span>}
            </div>
          </div>
          <Link to="/field/settings" className="profile-item" onClick={() => setOpen(false)}>
            <SettingsIcon size={18} aria-hidden />
            {t('field.actions.settings')}
          </Link>
          {pending > 0 && <p className="profile-warn">{t('settings.logoutPending', { n: pending })}</p>}
          <button
            type="button"
            className="profile-item is-danger"
            onClick={() => {
              setOpen(false);
              void logout().then(() => navigate('/unlock'));
            }}
          >
            <LogOut size={18} aria-hidden />
            {t('profile.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}

function FieldBottomBar({ pending }: { pending: number }) {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const barRef = useRef<HTMLElement>(null);
  useActiveIndicator(barRef, 'a[aria-current="page"] .nav-pill', [pathname, i18n.language]);
  return (
    <nav className="bottom-bar" aria-label={t('nav.fieldMenu')} ref={barRef}>
      <span className="bar-indicator" aria-hidden />
      <NavLink to="/field" end>
        <span className="nav-pill">
          <Home size={22} aria-hidden />
        </span>
        {t('nav.home')}
      </NavLink>
      <NavLink to="/field/search">
        <span className="nav-pill">
          <Search size={22} aria-hidden />
        </span>
        {t('nav.search')}
      </NavLink>
      <NavLink to="/field/households/new">
        <span className="nav-pill">
          <UserPlus size={22} aria-hidden />
        </span>
        {t('nav.newHousehold')}
      </NavLink>
      <NavLink to="/field/sync" aria-label={pending > 0 ? `${t('nav.sync')}, ${t('status.pending', { count: pending })}` : undefined}>
        <span className="nav-pill">
          <RefreshCw size={22} aria-hidden />
          {pending > 0 && (
            <span className="badge-count nav-badge" aria-hidden>
              {formatNumber(pending)}
            </span>
          )}
        </span>
        {t('nav.sync')}
      </NavLink>
    </nav>
  );
}

// ---------- dashboard: selected operation ----------
export interface OperationSummary {
  id: string;
  name: string;
  status: 'active' | 'closed';
  startDate: string;
  endDate: string | null;
  closedAt: string | null;
  disasterType: { en: string; bn: string };
  membershipStatus: string | null;
  relation: 'admin' | 'member' | 'observer' | 'system' | 'none';
}

interface OperationContextValue {
  operations: OperationSummary[];
  current: OperationSummary | null;
  /** True on the public observer portal: no session, public aggregated endpoints only. */
  publicView: boolean;
  select(id: string): void;
  reload(): void;
}
const OperationContext = createContext<OperationContextValue | null>(null);
export function useOperation(): OperationContextValue {
  const v = useContext(OperationContext);
  if (!v) throw new Error('OperationProvider missing');
  return v;
}

const OP_KEY = 'relief.dashboard.operation';

export function OperationProvider({ children, publicView = false }: { children: ReactNode; publicView?: boolean }) {
  const list = useApiData(
    (signal) => api.get<{ operations: OperationSummary[] }>(publicView ? '/api/public/operations' : '/api/operations', signal),
    [publicView],
  );
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return localStorage.getItem(OP_KEY);
    } catch {
      return null;
    }
  });
  const usable = useMemo(() => (list.data?.operations ?? []).filter((o) => o.relation !== 'none'), [list.data]);
  const current = usable.find((o) => o.id === selected) ?? usable[0] ?? null;
  const value = useMemo<OperationContextValue>(
    () => ({
      operations: list.data?.operations ?? [],
      current,
      publicView,
      select: (id) => {
        setSelected(id);
        try {
          localStorage.setItem(OP_KEY, id);
        } catch {
          /* storage unavailable */
        }
      },
      reload: list.reload,
    }),
    [list.data, current, list.reload, publicView],
  );
  return <OperationContext.Provider value={value}>{children}</OperationContext.Provider>;
}

// ---------- dashboard shell ----------
/** Two-letter avatar from a full name (Latin or Bangla). */
function initials(name: string | undefined): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => Array.from(p)[0] ?? '')
    .join('')
    .toUpperCase();
}

type QueueKey = 'conflicts' | 'duplicates' | 'flags';
interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  group: 'main' | 'review' | 'setup' | 'admin';
  queue?: QueueKey;
}

const GC: Role = 'GROUP_COORDINATOR';
const OA: Role = 'OPERATION_ADMINISTRATOR';
const SA: Role = 'SYSTEM_ADMINISTRATOR';
const OB: Role = 'OBSERVER';

/** Open review items per queue, so the rail shows where decisions wait (UI audit F41). */
export function useQueueCounts(role: Role | null, operationId: string | undefined, path: string) {
  return useApiData(
    async (signal): Promise<Partial<Record<QueueKey, number>>> => {
      if (!operationId || (role !== GC && role !== OA)) return {};
      const q = `operationId=${operationId}`;
      const flags = api
        .get<{ flags: unknown[] }>(`/api/flags?${q}&status=pending`, signal)
        .then((r) => r.flags.length)
        .catch(() => 0);
      if (role === OA) return { flags: await flags };
      const [conflicts, duplicates, f] = await Promise.all([
        api
          .get<{ conflicts: unknown[] }>(`/api/conflicts?${q}&status=open`, signal)
          .then((r) => r.conflicts.length)
          .catch(() => 0),
        api
          .get<{ pairs: unknown[] }>(`/api/duplicates?${q}&status=pending_review`, signal)
          .then((r) => r.pairs.length)
          .catch(() => 0),
        flags,
      ]);
      return { conflicts, duplicates, flags: f };
    },
    [role, operationId, path],
  );
}

/** Mobile drawer state for the dashboard sidebar: closes on navigation and on Escape, focuses the first link. */
function useDrawer() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    navRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return { open, setOpen, navRef, toggleRef };
}

function MenuToggle({ open, setOpen, toggleRef }: Pick<ReturnType<typeof useDrawer>, 'open' | 'setOpen' | 'toggleRef'>) {
  const { t } = useTranslation();
  return (
    <button
      ref={toggleRef}
      type="button"
      className="icon-btn menu-toggle"
      aria-expanded={open}
      aria-label={open ? t('nav.closeMenu') : t('nav.menu')}
      onClick={() => setOpen((v) => !v)}
    >
      <span className="toggle-icons" aria-hidden>
        <Menu size={20} className="ti-menu" />
        <X size={20} className="ti-close" />
      </span>
    </button>
  );
}

/** Operation picker in the dashboard header (staff and public portal). */
function OperationSelect() {
  const { t } = useTranslation();
  const { operations, current, select } = useOperation();
  const usable = operations.filter((o) => o.relation !== 'none');
  return (
    <div className="op-select" data-status={current?.status ?? 'none'}>
      <span className="op-dot" aria-hidden />
      <label htmlFor="op-select" className="visually-hidden">
        {t('nav.operation')}
      </label>
      {usable.length > 0 ? (
        <select id="op-select" value={current?.id ?? ''} onChange={(e) => select(e.target.value)}>
          {usable.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.status === 'closed' ? ` (${t('statuses.closed')})` : ''}
            </option>
          ))}
        </select>
      ) : (
        <span className="muted small">{t('nav.noOperation')}</span>
      )}
    </div>
  );
}

/**
 * Public observer portal (no log-in): live area-level coverage, the operation report, the live map
 * and the relief fund for donors and citizens. No account block, no notifications, no log-out;
 * staff reach their workspace through "Staff login".
 */
/** Sidebar motion shared by both dashboards: the travelling active pill and below-the-fold reveals. */
function useDashMotion() {
  const { i18n } = useTranslation();
  const { pathname } = useLocation();
  const sectionsRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  useActiveIndicator(sectionsRef, 'a[aria-current="page"]', [pathname, i18n.language]);
  useScrollReveal(mainRef);
  return { sectionsRef, mainRef };
}

export function PublicDashboardLayout() {
  const { t } = useTranslation();
  const { open, setOpen, navRef, toggleRef } = useDrawer();
  const { sectionsRef, mainRef } = useDashMotion();
  const items: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
    { to: '/', label: t('nav.coverage'), icon: MapIcon, end: true },
    { to: '/public/reports', label: t('nav.reports'), icon: FileText },
  ];
  return (
    <div className="dash dash-public">
      <a className="skip-link" href="#main">
        {t('app.skip')}
      </a>
      <aside className="dash-nav" data-open={open} aria-label={t('nav.menu')} ref={navRef}>
        <div className="dash-nav-inner">
          <Link to="/" className="brand">
            <Brand size={40} />
          </Link>
          <nav aria-label={t('nav.sections')} className="nav-sections" ref={sectionsRef}>
            <span className="nav-indicator" aria-hidden />
            <div>
              <p className="group-title">{t('portal.group')}</p>
              {items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end}>
                  <Icon size={18} aria-hidden />
                  <span className="nav-label">{label}</span>
                </NavLink>
              ))}
            </div>
          </nav>
          <div className="nav-foot portal-foot">
            <p className="portal-foot-text">{t('portal.donatePitch')}</p>
            <Link to="/donate" className="btn btn-signal portal-donate">
              <HandCoins size={18} aria-hidden />
              {t('donate.nav')}
            </Link>
          </div>
        </div>
      </aside>
      <button type="button" className="drawer-scrim" data-open={open} aria-hidden={!open} aria-label={t('nav.closeMenu')} tabIndex={-1} onClick={() => setOpen(false)} />
      <div className="dash-body">
        <header className="dash-top">
          <MenuToggle open={open} setOpen={setOpen} toggleRef={toggleRef} />
          <OperationSelect />
          <span className="portal-chip">{t('portal.badge')}</span>
          <span className="spacer" />
          <ThemeToggle />
          <LangSwitch />
          <Link to="/login" className="btn btn-secondary btn-sm portal-login">
            <LogIn size={16} aria-hidden />
            <span>{t('portal.staffLogin')}</span>
          </Link>
        </header>
        <main id="main" className="dash-main" ref={mainRef}>
          <div className="route-stage">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export function DashboardLayout() {
  const { t } = useTranslation();
  const { role, user, logout, isFieldUser } = useSession();
  const { current } = useOperation();
  const { open, setOpen, navRef, toggleRef } = useDrawer();
  const { sectionsRef, mainRef } = useDashMotion();
  const location = useLocation();
  const unread = useApiData((signal) => api.get<{ unread: number }>('/api/notifications', signal), [location.pathname]);
  const queues = useQueueCounts(role ?? null, current?.id, location.pathname);

  const items: NavItem[] = [
    { to: '/app/coverage', label: t('nav.coverage'), icon: MapIcon, roles: [GC, OA, OB, SA], group: 'main' },
    { to: '/app/households', label: t('nav.households'), icon: Users, roles: [GC, OA, SA], group: 'main' },
    { to: '/app/reports', label: t('nav.reports'), icon: FileText, roles: [GC, OA, OB], group: 'main' },
    { to: '/donate', label: t('donate.nav'), icon: HandCoins, roles: [GC, OA, OB, SA], group: 'main' },
    { to: '/app/conflicts', label: t('nav.conflicts'), icon: GitCompareArrows, roles: [GC], group: 'review', queue: 'conflicts' },
    { to: '/app/duplicates', label: t('nav.duplicates'), icon: Copy, roles: [GC], group: 'review', queue: 'duplicates' },
    { to: '/app/flags', label: t('nav.flags'), icon: ShieldAlert, roles: [GC, OA], group: 'review', queue: 'flags' },
    { to: '/app/members', label: t('nav.members'), icon: UserCog, roles: [GC], group: 'setup' },
    { to: '/app/approvals', label: t('nav.approvals'), icon: UserCheck, roles: [OA], group: 'setup' },
    { to: '/app/operations', label: t('nav.operations'), icon: LayoutDashboard, roles: [OA], group: 'setup' },
    { to: '/app/join', label: t('nav.join'), icon: ListChecks, roles: [GC], group: 'setup' },
    { to: '/app/audit', label: t('nav.audit'), icon: ClipboardList, roles: [OA, SA], group: 'admin' },
    { to: '/app/admin/organisations', label: t('nav.organisations'), icon: Building2, roles: [SA], group: 'admin' },
    { to: '/app/admin/users', label: t('nav.users'), icon: Users, roles: [SA], group: 'admin' },
    { to: '/app/admin/disaster-types', label: t('nav.disasterTypes'), icon: Tags, roles: [SA], group: 'admin' },
    { to: '/app/admin/system', label: t('nav.system'), icon: Archive, roles: [SA], group: 'admin' },
  ];
  const visible = items.filter((i) => role && i.roles.includes(role));
  const groups: [NavItem['group'], string | null][] = [
    ['main', t('nav.groupMain')],
    ['review', t('nav.groupReview')],
    ['setup', t('nav.groupSetup')],
    ['admin', t('nav.groupAdmin')],
  ];
  const unreadCount = unread.data?.unread ?? 0;

  return (
    <div className="dash">
      <a className="skip-link" href="#main">
        {t('app.skip')}
      </a>
      <aside className="dash-nav" data-open={open} aria-label={t('nav.menu')} ref={navRef}>
        <div className="dash-nav-inner">
        <Link to="/app/coverage" className="brand">
          <Brand size={40} />
        </Link>
        <nav aria-label={t('nav.sections')} className="nav-sections" ref={sectionsRef}>
          <span className="nav-indicator" aria-hidden />
          {groups.map(([g, title]) => {
            const entries = visible.filter((i) => i.group === g);
            if (entries.length === 0) return null;
            return (
              <div key={g}>
                {title && <p className="group-title">{title}</p>}
                {entries.map(({ to, label, icon: Icon, queue }) => {
                  const n = queue ? (queues.data?.[queue] ?? 0) : 0;
                  return (
                    <NavLink key={to} to={to}>
                      <Icon size={18} aria-hidden />
                      <span className="nav-label">{label}</span>
                      {n > 0 && (
                        <span className="nav-count">
                          {formatNumber(n)}
                          <span className="visually-hidden"> {t('nav.waiting')}</span>
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="nav-foot">
          <div className="who">
            <span className="who-avatar" aria-hidden>
              {initials(user?.fullName)}
            </span>
            <p className="who-text">
              {user?.fullName}
              <span>
                {role ? t(`roles.${role}`) : ''}
                {user?.organisationName ? `, ${user.organisationName}` : ''}
              </span>
            </p>
          </div>
          <nav aria-label={t('nav.you')}>
            <NavLink to="/app/account">
              <UserRound size={18} aria-hidden />
              <span className="nav-label">{t('nav.account')}</span>
            </NavLink>
            {isFieldUser && (
              <NavLink to="/field">
                <Smartphone size={18} aria-hidden />
                <span className="nav-label">{t('nav.fieldApp')}</span>
              </NavLink>
            )}
          </nav>
        </div>
        </div>
      </aside>
      <button type="button" className="drawer-scrim" data-open={open} aria-hidden={!open} aria-label={t('nav.closeMenu')} tabIndex={-1} onClick={() => setOpen(false)} />
      <div className="dash-body">
        <header className="dash-top">
          <MenuToggle open={open} setOpen={setOpen} toggleRef={toggleRef} />
          <OperationSelect />
          <span className="spacer" />
          <ThemeToggle />
          <Link to="/app/notifications" className="icon-btn" aria-label={t('nav.notificationsCount', { count: unreadCount })}>
            <Bell size={20} aria-hidden />
            {unreadCount > 0 && (
              <span key={unreadCount} className="badge-count">
                {formatNumber(unreadCount)}
              </span>
            )}
          </Link>
          <LangSwitch />
          <button type="button" className="btn btn-secondary btn-sm btn-logout" onClick={() => void logout()}>
            <LogOut size={16} aria-hidden />
            <span className="logout-label">{t('auth.logout')}</span>
          </button>
        </header>
        <main id="main" className="dash-main" ref={mainRef}>
          <div className="route-stage">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}


import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import {
  Archive,
  Bell,
  Building2,
  ClipboardList,
  CloudUpload,
  Copy,
  FileText,
  GitCompareArrows,
  Home,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Map as MapIcon,
  Menu,
  PlusCircle,
  Search,
  ShieldAlert,
  Smartphone,
  Tags,
  UserCog,
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
import { LangSwitch, StatusMark, ThemeToggle, useApiData, type MarkKind } from './ui/kit';

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
          <span className="net" data-online={status.online}>
            {status.online ? <Wifi size={18} aria-hidden /> : <WifiOff size={18} aria-hidden />}
            {status.online ? t('status.online') : t('status.offline')}
          </span>
          <Link to="/field/sync" className="sync-chip" data-state={state}>
            <StatusMark kind={mark} size={14} />
            <span className="sync-chip-text">
              <span className="sync-chip-main">
                {state === 'running' ? t('status.syncing') : status.pending > 0 ? t('status.pending', { count: status.pending }) : t('status.allSynced')}
              </span>
              <span className="sync-chip-sub">{status.lastSyncAt ? t('status.lastSyncShort', { time: formatShortTime(status.lastSyncAt) }) : t('status.neverSynced')}</span>
            </span>
          </Link>
          <span className="status-actions">
            <LangSwitch compact />
            <ThemeToggle onShell />
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
      </header>
      <main id="main" className="field-main">
        <Outlet />
      </main>
      <FieldBottomBar pending={status.pending} />
    </div>
  );
}

function FieldBottomBar({ pending }: { pending: number }) {
  const { t } = useTranslation();
  return (
    <nav className="bottom-bar" aria-label={t('nav.fieldMenu')}>
      <NavLink to="/field" end>
        <Home size={22} aria-hidden />
        {t('nav.home')}
      </NavLink>
      <NavLink to="/field/search">
        <Search size={22} aria-hidden />
        {t('nav.search')}
      </NavLink>
      <NavLink to="/field/households/new" className="primary-action">
        <PlusCircle size={22} aria-hidden />
        {t('nav.newHousehold')}
      </NavLink>
      <NavLink to="/field/sync">
        <CloudUpload size={22} aria-hidden />
        {t('nav.sync')}
        {pending > 0 && <span className="badge-count nav-badge">{formatNumber(pending)}</span>}
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

export function OperationProvider({ children }: { children: ReactNode }) {
  const list = useApiData((signal) => api.get<{ operations: OperationSummary[] }>('/api/operations', signal), []);
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
    [list.data, current, list.reload],
  );
  return <OperationContext.Provider value={value}>{children}</OperationContext.Provider>;
}

// ---------- dashboard shell ----------
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
function useQueueCounts(role: Role | null, operationId: string | undefined, path: string) {
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

export function DashboardLayout() {
  const { t } = useTranslation();
  const { role, user, logout, isFieldUser } = useSession();
  const { operations, current, select } = useOperation();
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
  const unread = useApiData((signal) => api.get<{ unread: number }>('/api/notifications', signal), [location.pathname]);
  const queues = useQueueCounts(role ?? null, current?.id, location.pathname);

  const items: NavItem[] = [
    { to: '/app/coverage', label: t('nav.coverage'), icon: MapIcon, roles: [GC, OA, OB, SA], group: 'main' },
    { to: '/app/households', label: t('nav.households'), icon: Users, roles: [GC, OA, SA], group: 'main' },
    { to: '/app/reports', label: t('nav.reports'), icon: FileText, roles: [GC, OA, OB], group: 'main' },
    { to: '/app/conflicts', label: t('nav.conflicts'), icon: GitCompareArrows, roles: [GC], group: 'review', queue: 'conflicts' },
    { to: '/app/duplicates', label: t('nav.duplicates'), icon: Copy, roles: [GC], group: 'review', queue: 'duplicates' },
    { to: '/app/flags', label: t('nav.flags'), icon: ShieldAlert, roles: [GC, OA], group: 'review', queue: 'flags' },
    { to: '/app/members', label: t('nav.members'), icon: UserCog, roles: [GC], group: 'setup' },
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
    ['main', null],
    ['review', t('nav.groupReview')],
    ['setup', t('nav.groupSetup')],
    ['admin', t('nav.groupAdmin')],
  ];
  const usable = operations.filter((o) => o.relation !== 'none');
  const unreadCount = unread.data?.unread ?? 0;

  return (
    <div className="dash">
      <a className="skip-link" href="#main">
        {t('app.skip')}
      </a>
      <aside className="dash-nav" data-open={open} aria-label={t('nav.menu')} ref={navRef}>
        <div className="dash-nav-inner">
        <Link to="/app/coverage" className="brand">
          <img src="/icon.svg" alt="" width={32} height={32} />
          {t('app.name')}
        </Link>
        <nav aria-label={t('nav.sections')}>
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
          <p className="who">
            {user?.fullName}
            <span>
              {role ? t(`roles.${role}`) : ''}
              {user?.organisationName ? `, ${user.organisationName}` : ''}
            </span>
          </p>
          <nav aria-label={t('nav.you')}>
            <NavLink to="/app/notifications">
              <Bell size={18} aria-hidden />
              <span className="nav-label">{t('nav.notifications')}</span>
              {unreadCount > 0 && <span className="nav-count">{formatNumber(unreadCount)}</span>}
            </NavLink>
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
      <button type="button" className="drawer-scrim" data-open={open} aria-label={t('nav.closeMenu')} tabIndex={-1} onClick={() => setOpen(false)} />
      <div className="dash-body">
        <header className="dash-top">
          <button
            ref={toggleRef}
            type="button"
            className="icon-btn menu-toggle"
            aria-expanded={open}
            aria-label={open ? t('nav.closeMenu') : t('nav.menu')}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
          </button>
          <div className="op-select">
            <label htmlFor="op-select">{t('nav.operation')}</label>
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
          <span className="spacer" />
          <Link to="/app/notifications" className="icon-btn" aria-label={t('nav.notificationsCount', { count: unreadCount })}>
            <Bell size={20} aria-hidden />
            {unreadCount > 0 && <span className="badge-count">{formatNumber(unreadCount)}</span>}
          </Link>
          <ThemeToggle />
          <LangSwitch />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void logout()}>
            <LogOut size={16} aria-hidden />
            <span className="logout-label">{t('auth.logout')}</span>
          </button>
        </header>
        <main id="main" className="dash-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}


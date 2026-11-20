import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import {
  Bell,
  CloudUpload,
  Home,
  Menu,
  PlusCircle,
  RefreshCw,
  Search,
  Smartphone,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { Role } from '@relief/shared';
import { api } from './api/client';
import { useSession } from './auth/session';
import { formatTime } from './i18n';
import { syncManager } from './local/sync';
import { LangSwitch, useApiData } from './ui/kit';

// ---------- field app shell ----------
export function useSyncStatus() {
  return useSyncExternalStore(syncManager.subscribe, syncManager.getStatus);
}

export function FieldLayout() {
  const { t } = useTranslation();
  const status = useSyncStatus();
  const { serverSession } = useSession();
  useEffect(() => syncManager.start(() => serverSession), [serverSession]);
  return (
    <div className="field-shell">
      <a className="skip-link" href="#main">
        {t('app.skip')}
      </a>
      <header className="status-bar" aria-label={t('nav.sync')}>
        <span className={`net ${status.online ? '' : 'net-offline'}`}>
          {status.online ? <Wifi size={16} aria-hidden /> : <WifiOff size={16} aria-hidden />}
          {status.online ? t('status.online') : t('status.offline')}
        </span>
        <span aria-live="polite">
          {status.running ? t('status.syncing') : status.pending > 0 ? t('status.pending', { count: status.pending }) : t('status.allSynced')}
        </span>
        <span className="grow">{status.lastSyncAt ? t('status.lastSync', { time: formatTime(status.lastSyncAt) }) : t('status.neverSynced')}</span>
        {(!serverSession || status.needsLogin) && <Link to="/login">{t('status.loginToSync')}</Link>}
        <LangSwitch />
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
    <nav className="bottom-bar" aria-label={t('nav.menu')}>
      <NavLink to="/field" end>
        <Home size={24} aria-hidden />
        {t('nav.home')}
      </NavLink>
      <NavLink to="/field/search">
        <Search size={24} aria-hidden />
        {t('nav.search')}
      </NavLink>
      <NavLink to="/field/households/new" className="primary-action">
        <PlusCircle size={24} aria-hidden />
        {t('nav.newHousehold')}
      </NavLink>
      <NavLink to="/field/sync">
        <CloudUpload size={24} aria-hidden />
        <span>
          {t('nav.sync')} {pending > 0 && <span className="badge-count">{pending}</span>}
        </span>
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
interface NavItem {
  to: string;
  label: string;
  roles: Role[];
  group: 'main' | 'review' | 'setup' | 'admin';
}

const GC: Role = 'GROUP_COORDINATOR';
const OA: Role = 'OPERATION_ADMINISTRATOR';
const SA: Role = 'SYSTEM_ADMINISTRATOR';
const OB: Role = 'OBSERVER';

export function DashboardLayout() {
  const { t, i18n } = useTranslation();
  const { role, user, logout, isFieldUser } = useSession();
  const { operations, current, select } = useOperation();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const unread = useApiData((signal) => api.get<{ unread: number }>('/api/notifications', signal), [location.pathname]);

  const items: NavItem[] = [
    { to: '/app/coverage', label: t('nav.coverage'), roles: [GC, OA, OB, SA], group: 'main' },
    { to: '/app/households', label: t('nav.households'), roles: [GC, OA, SA], group: 'main' },
    { to: '/app/reports', label: t('nav.reports'), roles: [GC, OA, OB], group: 'main' },
    { to: '/app/conflicts', label: t('nav.conflicts'), roles: [GC], group: 'review' },
    { to: '/app/duplicates', label: t('nav.duplicates'), roles: [GC], group: 'review' },
    { to: '/app/flags', label: t('nav.flags'), roles: [GC, OA], group: 'review' },
    { to: '/app/members', label: t('nav.members'), roles: [GC], group: 'setup' },
    { to: '/app/operations', label: t('nav.operations'), roles: [OA], group: 'setup' },
    { to: '/app/join', label: t('nav.join'), roles: [GC], group: 'setup' },
    { to: '/app/audit', label: t('nav.audit'), roles: [OA, SA], group: 'admin' },
    { to: '/app/admin/organisations', label: t('nav.organisations'), roles: [SA], group: 'admin' },
    { to: '/app/admin/users', label: t('nav.users'), roles: [SA], group: 'admin' },
    { to: '/app/admin/disaster-types', label: t('nav.disasterTypes'), roles: [SA], group: 'admin' },
    { to: '/app/admin/system', label: t('nav.system'), roles: [SA], group: 'admin' },
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
      <aside className="dash-nav" data-open={open} aria-label={t('nav.menu')}>
        <Link to="/app/coverage" className="brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          {t('app.name')}
        </Link>
        <nav>
          {groups.map(([g, title]) => {
            const entries = visible.filter((i) => i.group === g);
            if (entries.length === 0) return null;
            return (
              <div key={g}>
                {title && <p className="group-title">{title}</p>}
                {entries.map((i) => (
                  <NavLink key={i.to} to={i.to}>
                    {i.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
          <p className="group-title">{user?.fullName}</p>
          <NavLink to="/app/notifications">
            {t('nav.notifications')}
            {unreadCount > 0 && <span className="badge-count">{unreadCount}</span>}
          </NavLink>
          <NavLink to="/app/account">{t('nav.account')}</NavLink>
          {isFieldUser && (
            <NavLink to="/field">
              <span>
                <Smartphone size={16} aria-hidden /> {t('nav.fieldApp')}
              </span>
            </NavLink>
          )}
        </nav>
      </aside>
      <div>
        <header className="dash-top">
          <button type="button" className="btn btn-quiet menu-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Menu size={20} aria-hidden />
            {t('nav.menu')}
          </button>
          <label className="visually-hidden" htmlFor="op-select">
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
            <span className="muted">{t('nav.noOperation')}</span>
          )}
          <span className="grow" />
          <Link to="/app/notifications" className="btn btn-quiet" aria-label={`${t('nav.notifications')}: ${unreadCount}`}>
            <Bell size={18} aria-hidden />
            {unreadCount > 0 && <span className="badge-count">{unreadCount}</span>}
          </Link>
          <LangSwitch />
          <span className="small muted">
            {user?.fullName}, {role ? t(`roles.${role}`) : ''}
          </span>
          <button type="button" className="btn btn-quiet" onClick={() => void logout()}>
            {t('auth.logout')}
          </button>
        </header>
        <main id="main" className="dash-main" lang={i18n.language}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function RefreshIcon() {
  return <RefreshCw size={18} aria-hidden />;
}

import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, createBrowserRouter, useLocation } from 'react-router';
import { useSession } from './auth/session';
import { DashboardLayout, FieldLayout, OperationProvider, PublicDashboardLayout } from './layouts';
import {
  ChangePasswordPage,
  InvitePage,
  LoginPage,
  RegisterOrganisationPage,
  RegisterPage,
  RouteErrorPage,
  SetPinPage,
  UnlockPage,
} from './pages/public';
import { homePath } from './router-paths';
import { Brand, Loading } from './ui/kit';

/**
 * Field pages and dashboard pages load as separate chunks (UI audit F33), so a volunteer's phone
 * parses only the field app and the dashboard never carries the field code. The service worker
 * still precaches every chunk, so both work offline after the first visit.
 */
const fieldPages = () => import('./pages/field');
const reviewPages = () => import('./pages/dash-review');
const adminPages = () => import('./pages/dash-admin');
const donatePages = () => import('./pages/donate');
function pick<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(async () => ({ default: (await load())[name] as unknown as ComponentType<Record<string, unknown>> }));
}

const DonatePage = pick(donatePages, 'DonatePage');
const GatewayPage = pick(donatePages, 'GatewayPage');

const FieldHome = pick(fieldPages, 'FieldHome');
const AreasPage = pick(fieldPages, 'AreasPage');
const SearchPage = pick(fieldPages, 'SearchPage');
const NewHouseholdRoute = pick(fieldPages, 'NewHouseholdRoute');
const HouseholdPage = pick(fieldPages, 'HouseholdPage');
const EditHouseholdPage = pick(fieldPages, 'EditHouseholdPage');
const DistributePage = pick(fieldPages, 'DistributePage');
const SyncPage = pick(fieldPages, 'SyncPage');
const FieldUnservedPage = pick(fieldPages, 'FieldUnservedPage');
const FieldNotificationsPage = pick(fieldPages, 'FieldNotificationsPage');
const FieldSettingsPage = pick(fieldPages, 'FieldSettingsPage');

const CoveragePage = pick(reviewPages, 'CoveragePage');
const UnservedPage = pick(reviewPages, 'UnservedPage');
const ConflictsPage = pick(reviewPages, 'ConflictsPage');
const ConflictDetailPage = pick(reviewPages, 'ConflictDetailPage');
const DuplicatesPage = pick(reviewPages, 'DuplicatesPage');
const DuplicateDetailPage = pick(reviewPages, 'DuplicateDetailPage');
const FlagsPage = pick(reviewPages, 'FlagsPage');
const FlagDetailPage = pick(reviewPages, 'FlagDetailPage');
const HouseholdsPage = pick(reviewPages, 'HouseholdsPage');
const HouseholdDetailPage = pick(reviewPages, 'HouseholdDetailPage');
const ReportsPage = pick(reviewPages, 'ReportsPage');
const NotificationsPage = pick(reviewPages, 'NotificationsPage');

const MembersPage = pick(adminPages, 'MembersPage');
const OperationsPage = pick(adminPages, 'OperationsPage');
const OperationDetailPage = pick(adminPages, 'OperationDetailPage');
const JoinPage = pick(adminPages, 'JoinPage');
const AuditPage = pick(adminPages, 'AuditPage');
const AdminOrganisationsPage = pick(adminPages, 'AdminOrganisationsPage');
const DisasterTypesPage = pick(adminPages, 'DisasterTypesPage');
const SystemPage = pick(adminPages, 'SystemPage');
const AccountPage = pick(adminPages, 'AccountPage');

/** Wraps a lazily loaded page in a skeleton while its chunk arrives. */
const l = (node: ReactNode) => <Suspense fallback={<Loading rows={5} />}>{node}</Suspense>;

function Booting() {
  const { t } = useTranslation();
  return (
    <main className="public-box" id="main" style={{ paddingTop: '20vh' }}>
      <p className="brand">
        <Brand sub={t('app.tagline')} />
      </p>
      <Loading />
    </main>
  );
}

/** Field app: field roles with an unlocked vault on this phone. */
function RequireField({ children }: { children: ReactNode }) {
  const { status, isFieldUser, user } = useSession();
  if (status === 'booting') return <Booting />;
  if (status === 'locked') return <Navigate to="/unlock" replace />;
  if (status === 'needs-pin') return <Navigate to="/set-pin" replace />;
  if (status !== 'ready' || !isFieldUser) return <Navigate to="/login" replace />;
  if (user?.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <>{children}</>;
}

/** Dashboard: a live server session for every role except field volunteers. */
function RequireDashboard({ children }: { children: ReactNode }) {
  const { status, user } = useSession();
  const location = useLocation();
  if (status === 'booting') return <Booting />;
  // A coordinator's field PIN is asked for only when the field app is opened, not for the dashboard.
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (user.role === 'FIELD_VOLUNTEER') return <Navigate to="/field" replace />;
  return <OperationProvider>{children}</OperationProvider>;
}

/** Where a visitor with a staff session (or a locked field vault) belongs; null for a member of the public. */
function useSessionHome(): string | null {
  const { status, user, local } = useSession();
  const role = user?.role ?? local?.role;
  if (user && role && role !== 'FIELD_VOLUNTEER') return homePath(role);
  if (status === 'locked') return '/unlock';
  if (status === 'needs-pin') return '/set-pin';
  if (status === 'ready' && role) return homePath(role);
  return null;
}

function RootRedirect() {
  const { status } = useSession();
  const home = useSessionHome();
  if (status === 'booting') return <Booting />;
  return <Navigate to={home ?? '/'} replace />;
}

/**
 * Public observer portal at "/": live, area-level figures for donors and citizens without logging in.
 * Staff with a session still land in their own workspace, so the field app and dashboard start as before.
 */
function PublicPortal() {
  const { status } = useSession();
  const home = useSessionHome();
  const { pathname } = useLocation();
  if (pathname === '/') {
    if (status === 'booting') return <Booting />;
    if (home) return <Navigate to={home} replace />;
  }
  return (
    <OperationProvider publicView>
      <PublicDashboardLayout />
    </OperationProvider>
  );
}

function RequireAnyUser({ children }: { children: ReactNode }) {
  const { status, user } = useSession();
  if (status === 'booting') return <Booting />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const errorElement = <RouteErrorPage />;

export const router = createBrowserRouter([
  {
    element: <PublicPortal />,
    errorElement,
    children: [
      { path: '/', element: l(<CoveragePage />) },
      { path: '/public/reports', element: l(<ReportsPage />) },
    ],
  },
  { path: '/login', element: <LoginPage />, errorElement },
  { path: '/register', element: <RegisterPage />, errorElement },
  { path: '/register-organisation', element: <RegisterOrganisationPage />, errorElement },
  { path: '/invite/:token', element: <InvitePage />, errorElement },
  { path: '/unlock', element: <UnlockPage />, errorElement },
  { path: '/set-pin', element: <SetPinPage />, errorElement },
  { path: '/donate', element: l(<DonatePage />), errorElement },
  { path: '/donate/gateway/:id', element: l(<GatewayPage />), errorElement },
  {
    path: '/change-password',
    errorElement,
    element: (
      <RequireAnyUser>
        <ChangePasswordPage />
      </RequireAnyUser>
    ),
  },
  {
    path: '/field',
    errorElement,
    element: (
      <RequireField>
        <FieldLayout />
      </RequireField>
    ),
    children: [
      { index: true, element: l(<FieldHome />) },
      { path: 'areas', element: l(<AreasPage />) },
      { path: 'search', element: l(<SearchPage />) },
      { path: 'households/new', element: l(<NewHouseholdRoute />) },
      { path: 'households/:id', element: l(<HouseholdPage />) },
      { path: 'households/:id/edit', element: l(<EditHouseholdPage />) },
      { path: 'households/:id/distribute', element: l(<DistributePage />) },
      { path: 'anonymous', element: l(<DistributePage anonymous />) },
      { path: 'sync', element: l(<SyncPage />) },
      { path: 'unserved', element: l(<FieldUnservedPage />) },
      { path: 'notifications', element: l(<FieldNotificationsPage />) },
      { path: 'settings', element: l(<FieldSettingsPage />) },
    ],
  },
  {
    path: '/app',
    errorElement,
    element: (
      <RequireDashboard>
        <DashboardLayout />
      </RequireDashboard>
    ),
    children: [
      { index: true, element: <Navigate to="/app/coverage" replace /> },
      { path: 'coverage', element: l(<CoveragePage />) },
      { path: 'coverage/:areaId/unserved', element: l(<UnservedPage />) },
      { path: 'conflicts', element: l(<ConflictsPage />) },
      { path: 'conflicts/:id', element: l(<ConflictDetailPage />) },
      { path: 'duplicates', element: l(<DuplicatesPage />) },
      { path: 'duplicates/:id', element: l(<DuplicateDetailPage />) },
      { path: 'flags', element: l(<FlagsPage />) },
      { path: 'flags/:id', element: l(<FlagDetailPage />) },
      { path: 'households', element: l(<HouseholdsPage />) },
      { path: 'households/:id', element: l(<HouseholdDetailPage />) },
      { path: 'members', element: l(<MembersPage />) },
      { path: 'approvals', element: l(<MembersPage approvals />) },
      { path: 'operations', element: l(<OperationsPage />) },
      { path: 'operations/:id', element: l(<OperationDetailPage />) },
      { path: 'join', element: l(<JoinPage />) },
      { path: 'audit', element: l(<AuditPage />) },
      { path: 'reports', element: l(<ReportsPage />) },
      { path: 'notifications', element: l(<NotificationsPage />) },
      { path: 'account', element: l(<AccountPage />) },
      { path: 'admin/organisations', element: l(<AdminOrganisationsPage />) },
      { path: 'admin/users', element: l(<MembersPage admin />) },
      { path: 'admin/disaster-types', element: l(<DisasterTypesPage />) },
      { path: 'admin/system', element: l(<SystemPage />) },
    ],
  },
  { path: '*', element: <RootRedirect />, errorElement },
]);

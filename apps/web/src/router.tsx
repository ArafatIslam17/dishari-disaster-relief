import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, createBrowserRouter, useLocation } from 'react-router';
import { useSession } from './auth/session';
import { DashboardLayout, FieldLayout, OperationProvider } from './layouts';
import {
  AccountPage,
  AdminOrganisationsPage,
  AuditPage,
  DisasterTypesPage,
  JoinPage,
  MembersPage,
  OperationDetailPage,
  OperationsPage,
  SystemPage,
} from './pages/dash-admin';
import {
  ConflictDetailPage,
  ConflictsPage,
  CoveragePage,
  DuplicateDetailPage,
  DuplicatesPage,
  FlagDetailPage,
  FlagsPage,
  HouseholdDetailPage,
  HouseholdsPage,
  NotificationsPage,
  ReportsPage,
  UnservedPage,
} from './pages/dash-review';
import {
  AreasPage,
  DistributePage,
  EditHouseholdPage,
  FieldHome,
  FieldNotificationsPage,
  FieldSettingsPage,
  FieldUnservedPage,
  HouseholdPage,
  NewHouseholdRoute,
  SearchPage,
  SyncPage,
} from './pages/field';
import {
  ChangePasswordPage,
  InvitePage,
  LoginPage,
  RegisterOrganisationPage,
  RegisterPage,
  SetPinPage,
  UnlockPage,
} from './pages/public';
import { homePath } from './router-paths';
import { Loading } from './ui/kit';

function Booting() {
  const { t } = useTranslation();
  return (
    <main className="public" id="main">
      <div className="public-box">
        <p>{t('app.name')}</p>
        <Loading />
      </div>
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

function RootRedirect() {
  const { status, user, local } = useSession();
  if (status === 'booting') return <Booting />;
  const role = user?.role ?? local?.role;
  if (user && role && role !== 'FIELD_VOLUNTEER') return <Navigate to={homePath(role)} replace />;
  if (status === 'locked') return <Navigate to="/unlock" replace />;
  if (status === 'needs-pin') return <Navigate to="/set-pin" replace />;
  if (status === 'ready' && role) return <Navigate to={homePath(role)} replace />;
  return <Navigate to="/login" replace />;
}

function RequireAnyUser({ children }: { children: ReactNode }) {
  const { status, user } = useSession();
  if (status === 'booting') return <Booting />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  { path: '/', element: <RootRedirect /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/register-organisation', element: <RegisterOrganisationPage /> },
  { path: '/invite/:token', element: <InvitePage /> },
  { path: '/unlock', element: <UnlockPage /> },
  { path: '/set-pin', element: <SetPinPage /> },
  {
    path: '/change-password',
    element: (
      <RequireAnyUser>
        <ChangePasswordPage />
      </RequireAnyUser>
    ),
  },
  {
    path: '/field',
    element: (
      <RequireField>
        <FieldLayout />
      </RequireField>
    ),
    children: [
      { index: true, element: <FieldHome /> },
      { path: 'areas', element: <AreasPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'households/new', element: <NewHouseholdRoute /> },
      { path: 'households/:id', element: <HouseholdPage /> },
      { path: 'households/:id/edit', element: <EditHouseholdPage /> },
      { path: 'households/:id/distribute', element: <DistributePage /> },
      { path: 'anonymous', element: <DistributePage anonymous /> },
      { path: 'sync', element: <SyncPage /> },
      { path: 'unserved', element: <FieldUnservedPage /> },
      { path: 'notifications', element: <FieldNotificationsPage /> },
      { path: 'settings', element: <FieldSettingsPage /> },
    ],
  },
  {
    path: '/app',
    element: (
      <RequireDashboard>
        <DashboardLayout />
      </RequireDashboard>
    ),
    children: [
      { index: true, element: <Navigate to="/app/coverage" replace /> },
      { path: 'coverage', element: <CoveragePage /> },
      { path: 'coverage/:areaId/unserved', element: <UnservedPage /> },
      { path: 'conflicts', element: <ConflictsPage /> },
      { path: 'conflicts/:id', element: <ConflictDetailPage /> },
      { path: 'duplicates', element: <DuplicatesPage /> },
      { path: 'duplicates/:id', element: <DuplicateDetailPage /> },
      { path: 'flags', element: <FlagsPage /> },
      { path: 'flags/:id', element: <FlagDetailPage /> },
      { path: 'households', element: <HouseholdsPage /> },
      { path: 'households/:id', element: <HouseholdDetailPage /> },
      { path: 'members', element: <MembersPage /> },
      { path: 'operations', element: <OperationsPage /> },
      { path: 'operations/:id', element: <OperationDetailPage /> },
      { path: 'join', element: <JoinPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: 'admin/organisations', element: <AdminOrganisationsPage /> },
      { path: 'admin/users', element: <MembersPage admin /> },
      { path: 'admin/disaster-types', element: <DisasterTypesPage /> },
      { path: 'admin/system', element: <SystemPage /> },
    ],
  },
  { path: '*', element: <RootRedirect /> },
]);

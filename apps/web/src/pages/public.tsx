import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, isRouteErrorResponse, useNavigate, useParams, useRouteError } from 'react-router';
import { LockKeyhole, LogIn } from 'lucide-react';
import { normalisePhone } from '@relief/shared';
import { api } from '../api/client';
import { useSession } from '../auth/session';
import { UnlockError, localStore } from '../local/store';
import { homePath } from '../router-paths';
import { Empty, LangSwitch, Notice, SelectField, StatusMark, TextField, ThemeToggle, issuesOf, useApiData, useConfirm, useErrorText, useIssueText, useToast, type MarkKind } from '../ui/kit';

const LEGEND: { kind: MarkKind; key: string }[] = [
  { kind: 'served', key: 'coverage.fully_served' },
  { kind: 'partly', key: 'coverage.partly_served' },
  { kind: 'not_served', key: 'coverage.not_served' },
  { kind: 'no_records', key: 'coverage.no_records' },
  { kind: 'pending', key: 'statuses.pending' },
  { kind: 'duplicate', key: 'statuses.possible' },
];

/** Public pages: an ink panel with what the product is for, and the task on paper beside it. */
export function PublicFrame({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="public">
      <aside className="public-aside" aria-label={t('app.name')}>
        <span className="brand">
          <img src="/icon.svg" alt="" width={36} height={36} />
          {t('app.name')}
        </span>
        <div className="aside-promise">
          <p className="aside-title">{t('public.promise')}</p>
          <p>{t('public.promiseSub')}</p>
        </div>
        <div>
          <ul className="signal-legend" aria-label={t('public.legend')}>
            {LEGEND.map((l) => (
              <li key={l.kind}>
                <StatusMark kind={l.kind} size={14} />
                {t(l.key)}
              </li>
            ))}
          </ul>
          <p className="aside-foot">{t('public.foot')}</p>
        </div>
      </aside>
      <main className="public-box" id="main">
        <div className="public-top">
          <span className="brand">
            <img src="/icon.svg" alt="" width={32} height={32} />
            {t('app.name')}
          </span>
          <div className="public-tools">
            <ThemeToggle />
            <LangSwitch />
          </div>
        </div>
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
        {children}
      </main>
    </div>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useSession();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const badPhone = !normalisePhone(mobile);
    setPhoneError(badPhone ? t('validation.invalid_phone') : undefined);
    setPasswordError(password ? undefined : t('validation.password_required'));
    if (badPhone) return document.querySelector<HTMLInputElement>('input[name="mobile"]')?.focus();
    if (!password) return document.querySelector<HTMLInputElement>('input[name="password"]')?.focus();
    setBusy(true);
    try {
      const user = await login(mobile, password);
      navigate(user.mustChangePassword ? '/change-password' : homePath(user.role), { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicFrame title={t('auth.loginTitle')} lead={t('auth.loginIntro')}>
      {!online && <Notice tone="offline">{t('auth.offlineLogin')}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <form onSubmit={submit} noValidate>
        <TextField
          label={t('common.mobile')}
          name="mobile"
          type="tel"
          inputMode="tel"
          autoComplete="username"
          spellCheck={false}
          placeholder="01XXXXXXXXX"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          error={phoneError}
        />
        <TextField
          label={t('auth.password')}
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={passwordError}
        />
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
          <LogIn size={20} aria-hidden />
          {busy ? t('auth.loggingIn') : t('auth.login')}
        </button>
      </form>
      <p className="small muted mt-4">{t('auth.forgot')}</p>
      <div className="public-links">
        <p>
          {t('auth.noAccount')} <Link to="/register">{t('auth.registerAccount')}</Link>
        </p>
        <p>
          {t('auth.orgQuestion')} <Link to="/register-organisation">{t('auth.registerOrg')}</Link>
        </p>
      </div>
    </PublicFrame>
  );
}

function Done({ title, text }: { title: string; text: string }) {
  const { t } = useTranslation();
  return (
    <PublicFrame title={title}>
      <Notice tone="ok">{text}</Notice>
      <Link className="btn btn-primary" to="/login">
        {t('auth.toLogin')}
      </Link>
    </PublicFrame>
  );
}

export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const issueText = useIssueText();
  const [form, setForm] = useState({ fullName: '', mobile: '', password: '', kind: 'member', organisationId: '' });
  const [query, setQuery] = useState('');
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const orgs = useApiData(
    (signal) =>
      api.get<{ organisations: { id: string; name: string; nameBn: string | null }[] }>(
        `/api/public/organisations?q=${encodeURIComponent(query)}`,
        signal,
      ),
    [query],
  );
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIssues({});
    if (!navigator.onLine) {
      setError(t('errors.network')); // UC01 1.a
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/auth/register', {
        fullName: form.fullName,
        mobile: form.mobile,
        password: form.password,
        kind: form.kind,
        organisationId: form.kind === 'member' ? form.organisationId || undefined : undefined,
      });
      setDone(true);
    } catch (err) {
      setIssues(issuesOf(err));
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) return <Done title={t('auth.registerTitle')} text={t('auth.submitted')} />;
  return (
    <PublicFrame title={t('auth.registerTitle')} lead={t('auth.registerIntro')}>
      {error && <Notice tone="error">{error}</Notice>}
      <form onSubmit={submit} noValidate>
        <TextField label={t('auth.fullName')} name="name" value={form.fullName} onChange={set('fullName')} autoComplete="name" error={issueText(issues.fullName)} />
        <TextField
          label={t('common.mobile')}
          name="mobile"
          type="tel"
          inputMode="tel"
          value={form.mobile}
          onChange={set('mobile')}
          autoComplete="tel"
          spellCheck={false}
          error={issueText(issues.mobile)}
        />
        <TextField
          label={t('auth.password')}
          name="new-password"
          type="password"
          value={form.password}
          onChange={set('password')}
          autoComplete="new-password"
          help={t('validation.password_too_short')}
          error={issueText(issues.password)}
        />
        <fieldset className="choice-group">
          <legend>{t('auth.kind')}</legend>
          <label className="check">
            <input type="radio" name="kind" value="member" checked={form.kind === 'member'} onChange={set('kind')} />
            {t('auth.kindMember')}
          </label>
          <label className="check">
            <input type="radio" name="kind" value="operation_admin" checked={form.kind === 'operation_admin'} onChange={set('kind')} />
            {t('auth.kindOpAdmin')}
          </label>
        </fieldset>
        {form.kind === 'member' && (
          <>
            <TextField label={t('auth.searchOrg')} type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" spellCheck={false} />
            <SelectField label={t('auth.chooseOrg')} value={form.organisationId} onChange={set('organisationId')} error={issueText(issues.organisationId)}>
              <option value="">{t('common.choose')}</option>
              {orgs.data?.organisations.map((o) => (
                <option key={o.id} value={o.id}>
                  {i18n.language === 'bn' && o.nameBn ? `${o.nameBn} (${o.name})` : o.name}
                </option>
              ))}
            </SelectField>
          </>
        )}
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
          {t('auth.registerAccount')}
        </button>
      </form>
      <div className="public-links">
        <p>
          {t('auth.haveAccount')} <Link to="/login">{t('auth.toLogin')}</Link>
        </p>
      </div>
    </PublicFrame>
  );
}

export function RegisterOrganisationPage() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const issueText = useIssueText();
  const [org, setOrg] = useState({ name: '', nameBn: '', orgType: 'volunteer_group', contactName: '', contactPhone: '', contactEmail: '' });
  const [coord, setCoord] = useState({ fullName: '', mobile: '', password: '' });
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIssues({});
    setBusy(true);
    try {
      await api.post('/api/auth/register-organisation', { organisation: org, coordinator: coord });
      setDone(true);
    } catch (err) {
      setIssues(issuesOf(err));
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  if (done) return <Done title={t('auth.registerOrgTitle')} text={t('auth.submittedOrg')} />;
  const o = (k: keyof typeof org) => (e: { target: { value: string } }) => setOrg({ ...org, [k]: e.target.value });
  const c = (k: keyof typeof coord) => (e: { target: { value: string } }) => setCoord({ ...coord, [k]: e.target.value });
  return (
    <PublicFrame title={t('auth.registerOrgTitle')} lead={t('auth.registerOrgIntro')}>
      {error && <Notice tone="error">{error}</Notice>}
      <form onSubmit={submit} noValidate>
        <div className="form-section">
          <h2 className="menu-group-title">{t('auth.orgDetails')}</h2>
          <TextField label={t('auth.orgName')} value={org.name} onChange={o('name')} error={issueText(issues['organisation.name'])} autoComplete="organization" />
          <TextField label={t('auth.orgNameBn')} value={org.nameBn} onChange={o('nameBn')} lang="bn" autoComplete="off" />
          <SelectField label={t('auth.orgType')} value={org.orgType} onChange={o('orgType')}>
            {(['ngo', 'volunteer_group', 'community', 'other'] as const).map((k) => (
              <option key={k} value={k}>
                {t(`auth.orgTypes.${k}`)}
              </option>
            ))}
          </SelectField>
          <TextField label={t('auth.contactName')} value={org.contactName} onChange={o('contactName')} error={issueText(issues['organisation.contactName'])} autoComplete="off" />
          <TextField
            label={t('auth.contactPhone')}
            type="tel"
            inputMode="tel"
            value={org.contactPhone}
            onChange={o('contactPhone')}
            error={issueText(issues['organisation.contactPhone'])}
            autoComplete="off"
          />
          <TextField
            label={t('auth.contactEmail')}
            type="email"
            value={org.contactEmail}
            onChange={o('contactEmail')}
            error={issueText(issues['organisation.contactEmail'])}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="form-section">
          <h2 className="menu-group-title">{t('auth.yourAccount')}</h2>
          <TextField label={t('auth.fullName')} value={coord.fullName} onChange={c('fullName')} error={issueText(issues['coordinator.fullName'])} autoComplete="name" />
          <TextField
            label={t('common.mobile')}
            type="tel"
            inputMode="tel"
            value={coord.mobile}
            onChange={c('mobile')}
            error={issueText(issues['coordinator.mobile'])}
            autoComplete="tel"
            spellCheck={false}
          />
          <TextField
            label={t('auth.password')}
            type="password"
            autoComplete="new-password"
            value={coord.password}
            onChange={c('password')}
            help={t('validation.password_too_short')}
            error={issueText(issues['coordinator.password'])}
          />
        </div>
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
          {t('auth.registerOrg')}
        </button>
      </form>
      <div className="public-links">
        <p>
          {t('auth.haveAccount')} <Link to="/login">{t('auth.toLogin')}</Link>
        </p>
      </div>
    </PublicFrame>
  );
}

export function InvitePage() {
  const { token = '' } = useParams();
  const { t } = useTranslation();
  const errorText = useErrorText();
  const issueText = useIssueText();
  const info = useApiData((signal) => api.get<{ operationName: string }>(`/api/invites/${encodeURIComponent(token)}`, signal), [token]);
  const [form, setForm] = useState({ fullName: '', mobile: '', password: '' });
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/invites/accept', { token, ...form });
      setDone(true);
    } catch (err) {
      setIssues(issuesOf(err));
      setError(errorText(err));
    }
  };
  const f = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  if (done) return <Done title={t('auth.inviteTitle')} text={t('auth.inviteAccepted')} />;
  return (
    <PublicFrame title={t('auth.inviteTitle')} lead={info.data ? t('auth.inviteIntro', { operation: info.data.operationName }) : undefined}>
      {info.error ? (
        <Empty
          title={t('auth.inviteInvalid')}
          mark="failed"
          action={
            <Link className="btn btn-secondary" to="/login">
              {t('auth.toLogin')}
            </Link>
          }
        >
          {errorText(info.error)}
        </Empty>
      ) : (
        <>
          {error && <Notice tone="error">{error}</Notice>}
          <form onSubmit={submit} noValidate>
            <TextField label={t('auth.fullName')} value={form.fullName} onChange={f('fullName')} error={issueText(issues.fullName)} autoComplete="name" />
            <TextField label={t('common.mobile')} type="tel" inputMode="tel" value={form.mobile} onChange={f('mobile')} error={issueText(issues.mobile)} autoComplete="tel" spellCheck={false} />
            <TextField
              label={t('auth.password')}
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={f('password')}
              help={t('validation.password_too_short')}
              error={issueText(issues.password)}
            />
            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={!info.data}>
              {t('auth.acceptInvite')}
            </button>
          </form>
        </>
      )}
    </PublicFrame>
  );
}

export function ChangePasswordPage({ forced = true }: { forced?: boolean }) {
  const { t } = useTranslation();
  const { refreshUser, user } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const errorText = useErrorText();
  const issueText = useIssueText();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/auth/change-password', { currentPassword: current, newPassword: next });
      await refreshUser();
      toast(t('auth.passwordChanged'));
      setCurrent('');
      setNext('');
      if (forced && user) navigate(homePath(user.role), { replace: true });
    } catch (err) {
      setIssues(issuesOf(err));
      setError(errorText(err));
    }
  };
  const body = (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      <form onSubmit={submit} noValidate>
        <TextField label={t('auth.currentPassword')} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <TextField
          label={t('auth.newPassword')}
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          help={t('validation.password_too_short')}
          error={issueText(issues.newPassword)}
        />
        <button type="submit" className={`btn btn-primary${forced ? ' btn-block btn-lg' : ''}`}>
          {t('auth.changePassword')}
        </button>
      </form>
    </>
  );
  return forced ? (
    <PublicFrame title={t('auth.changePasswordTitle')} lead={t('auth.changePasswordIntro')}>
      {body}
    </PublicFrame>
  ) : (
    body
  );
}

const PIN_RE = /^\d{4,6}$/;

export function SetPinPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const { setPin } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [pin, setPinValue] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [repeatError, setRepeatError] = useState<string | undefined>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setRepeatError(undefined);
    if (!PIN_RE.test(pin)) return setError(t('validation.pin_digits'));
    if (pin !== repeat) return setRepeatError(t('validation.pin_mismatch'));
    await setPin(pin);
    if (embedded) {
      toast(t('pin.pinChanged'));
      setPinValue('');
      setRepeat('');
    } else navigate('/field', { replace: true });
  };
  const form = (
    <form onSubmit={submit} noValidate>
      <TextField
        label={t('pin.pin')}
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={6}
        className={embedded ? undefined : 'pin-field'}
        help={t('pin.pinHelp')}
        value={pin}
        onChange={(e) => setPinValue(e.target.value)}
        error={error}
      />
      <TextField
        label={t('pin.repeat')}
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={6}
        className={embedded ? undefined : 'pin-field'}
        value={repeat}
        onChange={(e) => setRepeat(e.target.value)}
        error={repeatError}
      />
      <button type="submit" className={`btn btn-signal${embedded ? '' : ' btn-block btn-lg'}`}>
        {t('pin.setPin')}
      </button>
    </form>
  );
  return embedded ? (
    <>
      <p className="muted small">{t('pin.changeIntro')}</p>
      {form}
    </>
  ) : (
    <PublicFrame title={t('pin.setTitle')} lead={t('pin.setIntro')}>
      {form}
    </PublicFrame>
  );
}

export function UnlockPage() {
  const { t } = useTranslation();
  const { unlock, local, switchUser } = useSession();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<{ tone: 'error' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    void localStore.vaultStatus().then((v) => setLocked(v.locked));
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pin.length < 4) return setMessage({ tone: 'error', text: t('validation.pin_digits') });
    setBusy(true);
    setMessage(null);
    try {
      await unlock(pin);
      navigate('/field', { replace: true });
    } catch (err) {
      if (err instanceof UnlockError) {
        if (err.reason === 'wrong') setMessage({ tone: 'error', text: t('pin.wrong', { left: err.attemptsLeft }) });
        else if (err.reason === 'locked') {
          setLocked(true);
          setMessage({ tone: 'warn', text: t('pin.locked') });
        } else setMessage({ tone: 'warn', text: t('pin.expired') });
      } else setMessage({ tone: 'error', text: t('errors.unexpected') });
    } finally {
      setBusy(false);
      setPin('');
    }
  };
  const other = async () => {
    const count = await localStore.pendingCount();
    if (count > 0) return setMessage({ tone: 'warn', text: t('pin.switchBlocked', { n: count }) });
    // UI audit F25: the app's own dialog, translated and styled, instead of window.confirm.
    if (!(await confirm.ask(t('pin.switchConfirm'), false, { confirmLabel: t('pin.switchAction') }))) return;
    await switchUser();
    navigate('/login', { replace: true });
  };
  return (
    <PublicFrame title={t('pin.unlockTitle')} lead={t('pin.unlockIntro', { name: local?.fullName ?? '' })}>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {locked ? (
        <Link className="btn btn-primary btn-block btn-lg" to="/login">
          <LogIn size={20} aria-hidden />
          {t('auth.login')}
        </Link>
      ) : (
        <form onSubmit={submit} noValidate>
          <TextField
            label={t('pin.pin')}
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            maxLength={6}
            className="pin-field"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
          <button type="submit" className="btn btn-signal btn-block btn-lg" disabled={busy}>
            <LockKeyhole size={20} aria-hidden />
            {busy ? t('pin.unlocking') : t('pin.unlock')}
          </button>
        </form>
      )}
      <div className="public-links">
        {!locked && (
          <p>
            {t('pin.onlineInstead')} <Link to="/login">{t('auth.login')}</Link>
          </p>
        )}
        <p>
          <button type="button" className="link-button" onClick={() => void other()}>
            {t('pin.otherUser')}
          </button>
        </p>
      </div>
      {confirm.dialog}
    </PublicFrame>
  );
}

/** Shown when a route fails to render or does not exist, instead of a blank screen. */
export function RouteErrorPage() {
  const { t } = useTranslation();
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <PublicFrame title={notFound ? t('public.notFoundTitle') : t('public.errorTitle')} lead={notFound ? t('public.notFoundText') : t('public.errorText')}>
      <div className="row">
        <a className="btn btn-primary" href="/">
          {t('public.home')}
        </a>
        <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
          {t('common.retry')}
        </button>
      </div>
    </PublicFrame>
  );
}

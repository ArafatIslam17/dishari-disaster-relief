import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { LockKeyhole } from 'lucide-react';
import { normalisePhone } from '@relief/shared';
import { api } from '../api/client';
import { useSession } from '../auth/session';
import { UnlockError, localStore } from '../local/store';
import { homePath } from '../router-paths';
import { LangSwitch, Notice, SelectField, TextField, issuesOf, useApiData, useErrorText, useIssueText, useToast } from '../ui/kit';

export function PublicFrame({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <main className="public" id="main">
      <div className="public-box">
        <div className="panel-head">
          <span className="brand">
            <img src="/icon.svg" alt="" width={32} height={32} />
            {t('app.name')}
          </span>
          <LangSwitch />
        </div>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!normalisePhone(mobile)) {
      setPhoneError(t('validation.invalid_phone'));
      return;
    }
    setPhoneError(undefined);
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
    <PublicFrame title={t('auth.loginTitle')}>
      <p className="muted">{t('auth.loginIntro')}</p>
      {!navigator.onLine && <Notice tone="offline">{t('auth.offlineLogin')}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <form onSubmit={submit} noValidate>
        <TextField
          label={t('common.mobile')}
          type="tel"
          inputMode="tel"
          autoComplete="username"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          error={phoneError}
        />
        <TextField
          label={t('auth.password')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy || !password}>
          {busy ? t('auth.loggingIn') : t('auth.login')}
        </button>
      </form>
      <p className="small muted" style={{ marginTop: 16 }}>
        {t('auth.forgot')}
      </p>
      <p>
        {t('auth.noAccount')} <Link to="/register">{t('auth.registerAccount')}</Link>
      </p>
      <p>
        <Link to="/register-organisation">{t('auth.registerOrg')}</Link>
      </p>
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
    }
  };

  if (done) {
    return (
      <PublicFrame title={t('auth.registerTitle')}>
        <Notice tone="ok">{t('auth.submitted')}</Notice>
        <Link className="btn btn-primary" to="/login">
          {t('auth.toLogin')}
        </Link>
      </PublicFrame>
    );
  }
  return (
    <PublicFrame title={t('auth.registerTitle')}>
      <p className="muted">{t('auth.registerIntro')}</p>
      {error && <Notice tone="error">{error}</Notice>}
      <form onSubmit={submit} noValidate>
        <TextField label={t('auth.fullName')} value={form.fullName} onChange={set('fullName')} autoComplete="name" error={issueText(issues.fullName)} />
        <TextField label={t('common.mobile')} type="tel" inputMode="tel" value={form.mobile} onChange={set('mobile')} autoComplete="tel" error={issueText(issues.mobile)} />
        <TextField
          label={t('auth.password')}
          type="password"
          value={form.password}
          onChange={set('password')}
          autoComplete="new-password"
          help={t('validation.password_too_short')}
          error={issueText(issues.password)}
        />
        <fieldset className="field" style={{ border: 0, padding: 0 }}>
          <legend className="label">{t('auth.kind')}</legend>
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
            <TextField label={t('auth.searchOrg')} value={query} onChange={(e) => setQuery(e.target.value)} />
            <SelectField label={t('auth.chooseOrg')} value={form.organisationId} onChange={set('organisationId')} error={issueText(issues.organisationId)}>
              <option value="">—</option>
              {orgs.data?.organisations.map((o) => (
                <option key={o.id} value={o.id}>
                  {i18n.language === 'bn' && o.nameBn ? `${o.nameBn} (${o.name})` : o.name}
                </option>
              ))}
            </SelectField>
          </>
        )}
        <button type="submit" className="btn btn-primary btn-block btn-lg">
          {t('auth.registerAccount')}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        <Link to="/login">{t('auth.toLogin')}</Link>
      </p>
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
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIssues({});
    try {
      await api.post('/api/auth/register-organisation', { organisation: org, coordinator: coord });
      setDone(true);
    } catch (err) {
      setIssues(issuesOf(err));
      setError(errorText(err));
    }
  };
  if (done) {
    return (
      <PublicFrame title={t('auth.registerOrgTitle')}>
        <Notice tone="ok">{t('auth.submittedOrg')}</Notice>
        <Link className="btn btn-primary" to="/login">
          {t('auth.toLogin')}
        </Link>
      </PublicFrame>
    );
  }
  const o = (k: keyof typeof org) => (e: { target: { value: string } }) => setOrg({ ...org, [k]: e.target.value });
  const c = (k: keyof typeof coord) => (e: { target: { value: string } }) => setCoord({ ...coord, [k]: e.target.value });
  return (
    <PublicFrame title={t('auth.registerOrgTitle')}>
      <p className="muted">{t('auth.registerOrgIntro')}</p>
      {error && <Notice tone="error">{error}</Notice>}
      <form onSubmit={submit} noValidate>
        <TextField label={t('auth.orgName')} value={org.name} onChange={o('name')} error={issueText(issues['organisation.name'])} />
        <TextField label={t('auth.orgNameBn')} value={org.nameBn} onChange={o('nameBn')} lang="bn" />
        <SelectField label={t('auth.orgType')} value={org.orgType} onChange={o('orgType')}>
          {(['ngo', 'volunteer_group', 'community', 'other'] as const).map((k) => (
            <option key={k} value={k}>
              {t(`auth.orgTypes.${k}`)}
            </option>
          ))}
        </SelectField>
        <TextField label={t('auth.contactName')} value={org.contactName} onChange={o('contactName')} error={issueText(issues['organisation.contactName'])} />
        <TextField label={t('auth.contactPhone')} type="tel" value={org.contactPhone} onChange={o('contactPhone')} error={issueText(issues['organisation.contactPhone'])} />
        <TextField label={t('auth.contactEmail')} type="email" value={org.contactEmail} onChange={o('contactEmail')} error={issueText(issues['organisation.contactEmail'])} />
        <h2>{t('auth.yourAccount')}</h2>
        <TextField label={t('auth.fullName')} value={coord.fullName} onChange={c('fullName')} error={issueText(issues['coordinator.fullName'])} />
        <TextField label={t('common.mobile')} type="tel" value={coord.mobile} onChange={c('mobile')} error={issueText(issues['coordinator.mobile'])} />
        <TextField
          label={t('auth.password')}
          type="password"
          autoComplete="new-password"
          value={coord.password}
          onChange={c('password')}
          error={issueText(issues['coordinator.password'])}
        />
        <button type="submit" className="btn btn-primary btn-block btn-lg">
          {t('auth.registerOrg')}
        </button>
      </form>
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
  return (
    <PublicFrame title={t('auth.inviteTitle')}>
      {info.error ? (
        <Notice tone="error">{errorText(info.error)}</Notice>
      ) : done ? (
        <>
          <Notice tone="ok">{t('auth.inviteAccepted')}</Notice>
          <Link className="btn btn-primary" to="/login">
            {t('auth.toLogin')}
          </Link>
        </>
      ) : (
        <>
          {info.data && <p>{t('auth.inviteIntro', { operation: info.data.operationName })}</p>}
          {error && <Notice tone="error">{error}</Notice>}
          <form onSubmit={submit} noValidate>
            <TextField label={t('auth.fullName')} value={form.fullName} onChange={f('fullName')} error={issueText(issues.fullName)} />
            <TextField label={t('common.mobile')} type="tel" value={form.mobile} onChange={f('mobile')} error={issueText(issues.mobile)} />
            <TextField
              label={t('auth.password')}
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={f('password')}
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
      {forced && <p>{t('auth.changePasswordIntro')}</p>}
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
        <button type="submit" className="btn btn-primary">
          {t('auth.changePassword')}
        </button>
      </form>
    </>
  );
  return forced ? <PublicFrame title={t('auth.changePasswordTitle')}>{body}</PublicFrame> : body;
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
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!PIN_RE.test(pin)) return setError(t('validation.pin_digits'));
    if (pin !== repeat) return setError(t('validation.pin_mismatch'));
    setError(undefined);
    await setPin(pin);
    if (embedded) {
      toast(t('pin.pinChanged'));
      setPinValue('');
      setRepeat('');
    } else navigate('/field', { replace: true });
  };
  const form = (
    <>
      <p className="muted">{t('pin.setIntro')}</p>
      <form onSubmit={submit} noValidate>
        <TextField
          label={t('pin.pin')}
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
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
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
        <button type="submit" className="btn btn-signal btn-block btn-lg">
          {t('pin.setPin')}
        </button>
      </form>
    </>
  );
  return embedded ? form : <PublicFrame title={t('pin.setTitle')}>{form}</PublicFrame>;
}

export function UnlockPage() {
  const { t } = useTranslation();
  const { unlock, local, switchUser } = useSession();
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<{ tone: 'error' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    void localStore.vaultStatus().then((v) => setLocked(v.locked));
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
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
    if (!window.confirm(t('pin.switchConfirm'))) return;
    await switchUser();
    navigate('/login', { replace: true });
  };
  return (
    <PublicFrame title={t('pin.unlockTitle')}>
      <p>{t('pin.unlockIntro', { name: local?.fullName ?? '' })}</p>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {locked ? (
        <Link className="btn btn-primary btn-block btn-lg" to="/login">
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
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn btn-signal btn-block btn-lg" disabled={busy || pin.length < 4}>
            <LockKeyhole size={20} aria-hidden />
            {busy ? t('pin.unlocking') : t('pin.unlock')}
          </button>
        </form>
      )}
      <p style={{ marginTop: 16 }}>
        <Link to="/login">{t('auth.login')}</Link>
      </p>
      <p>
        <button type="button" className="link-button" onClick={() => void other()}>
          {t('pin.otherUser')}
        </button>
      </p>
    </PublicFrame>
  );
}

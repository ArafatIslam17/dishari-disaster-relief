import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowRight, Ban, BadgeCheck, ChevronRight, CircleX, CreditCard, FlaskConical, HandCoins, LockKeyhole, Printer, RotateCcw, Smartphone } from 'lucide-react';
import { normalisePhone } from '@relief/shared';
import { api } from '../api/client';
import { formatDateTime, formatNumber, formatTaka } from '../i18n';
import { RecentDonations, useDonorName, useFundSummary, type DonationReceipt, type PaymentMethod } from '../ui/fund';
import { Brand, ErrorState, LangSwitch, Loading, Notice, SelectField, TextField, ThemeToggle, issuesOf, useApiData, useErrorText, useIssueText } from '../ui/kit';

/**
 * Relief fund: a public donation form and a sandbox checkout in the style of the Bangladeshi
 * gateways (SSLCommerz / aamarPay). The checkout sends only the donor's chosen outcome and method;
 * wallet numbers, OTPs and card details stay in the browser.
 */
const PRESETS = [500, 1000, 2500, 5000];
const MIN = 10;
const MAX = 1_000_000;
const WALLETS: PaymentMethod[] = ['bkash', 'nagad', 'rocket'];
const CARDS: PaymentMethod[] = ['visa', 'mastercard'];
const TEST_CARDS: Record<string, string> = { visa: '4111 1111 1111 1111', mastercard: '5555 5555 5555 4444' };

interface Campaign {
  id: string;
  name: string;
  startDate: string;
}

/** Bangla digits and grouping commas to a plain integer string. */
function toAsciiDigits(input: string): string {
  return input.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6)).replace(/[,\s৳]/g, '');
}

function DonateShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="donate-page">
      <a className="skip-link" href="#main">
        {t('app.skip')}
      </a>
      <header className="donate-top no-print">
        <Link to="/" className="brand brand-link">
          <Brand size={40} />
        </Link>
        <div className="public-tools">
          <LangSwitch />
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="donate-main">
        {children}
      </main>
    </div>
  );
}

// ---------- /donate ----------
export function DonatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const errorText = useErrorText();
  const issueText = useIssueText();
  const campaigns = useApiData((s) => api.get<{ campaigns: Campaign[] }>('/api/donations/campaigns', s), []);
  const fund = useFundSummary();

  const start = Number(params.get('amount')) || 1000;
  const [operationId, setOperationId] = useState<string | null>(params.get('op'));
  const [preset, setPreset] = useState<number | null>(PRESETS.includes(start) ? start : null);
  const [custom, setCustom] = useState(PRESETS.includes(start) ? '' : String(start));
  const [anonymous, setAnonymous] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = campaigns.data?.campaigns ?? [];
  // Default to the Feni flood appeal when it is running, otherwise the newest active operation.
  const chosen = operationId ?? (list.find((c) => /feni/i.test(c.name)) ?? list[0])?.id ?? '';
  const amount = preset ?? (custom ? Number(toAsciiDigits(custom)) : NaN);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const next: Record<string, string | undefined> = {};
    if (!Number.isInteger(amount)) next.amount = t('validation.amount_whole');
    else if (amount < MIN) next.amount = t('validation.amount_min');
    else if (amount > MAX) next.amount = t('validation.amount_max');
    if (!anonymous && !name.trim()) next.name = t('errors.donor_name_required');
    if (phone.trim() && !normalisePhone(phone)) next.phone = t('validation.invalid_phone');
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = t('errors.invalid_email');
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      document.querySelector<HTMLInputElement>(`[data-field="${first}"]`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ donationId: string; transactionId: string; gatewayUrl: string }>('/api/donations/initiate', {
        operationId: chosen || null,
        amountBdt: amount,
        donorName: anonymous ? null : name.trim(),
        donorPhone: phone.trim() || null,
        donorEmail: email.trim() || null,
        isAnonymous: anonymous,
      });
      navigate(res.gatewayUrl);
    } catch (err) {
      const issues = issuesOf(err);
      if (issues.amountBdt) setErrors({ amount: issueText(issues.amountBdt) });
      else setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <DonateShell>
      <div className="donate-hero">
        <p className="eyebrow">
          <HandCoins size={16} aria-hidden />
          {t('donate.eyebrow')}
        </p>
        <h1>{t('donate.title')}</h1>
        <p className="lead">{t('donate.lead')}</p>
      </div>
      <div className="donate-grid">
        <form className="card donate-form" onSubmit={submit} noValidate aria-busy={busy}>
          {error && <Notice tone="error">{error}</Notice>}
          {campaigns.error ? (
            <ErrorState error={campaigns.error} onRetry={campaigns.reload} />
          ) : (
            <SelectField label={t('donate.campaign')} value={chosen} onChange={(e) => setOperationId(e.target.value)} disabled={campaigns.loading}>
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="">{t('donate.general')}</option>
            </SelectField>
          )}

          <fieldset className="amount-group">
            <legend>{t('donate.presets')}</legend>
            <div className="amount-pills">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="amount-pill"
                  aria-pressed={preset === p}
                  onClick={() => {
                    setPreset(p);
                    setCustom('');
                    setErrors((x) => ({ ...x, amount: undefined }));
                  }}
                >
                  {formatTaka(p)}
                </button>
              ))}
            </div>
            <TextField
              className="amount-custom"
              label={t('donate.custom')}
              help={t('donate.customHelp')}
              inputMode="numeric"
              autoComplete="off"
              data-field="amount"
              placeholder="৳"
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                setPreset(e.target.value ? null : 1000);
              }}
              error={errors.amount}
            />
          </fieldset>

          <h2 className="form-section">{t('donate.you')}</h2>
          <label className="check anon-toggle">
            <input type="checkbox" role="switch" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            <span className="check-text">
              <strong>{t('donate.anonymous')}</strong>
              <span className="muted small">{t('donate.anonymousHelp')}</span>
            </span>
          </label>
          {!anonymous && (
            <TextField label={t('donate.name')} autoComplete="name" data-field="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
          )}
          <div className="field-pair">
            <TextField
              label={t('donate.phone')}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              data-field="phone"
              placeholder="01XXXXXXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              error={errors.phone}
            />
            <TextField
              label={t('donate.email')}
              type="email"
              autoComplete="email"
              data-field="email"
              maxLength={120}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
            />
          </div>
          <p className="muted small">{t('donate.contactHelp')}</p>

          <div className="donate-total" aria-live="polite">
            <span>{t('donate.amount')}</span>
            <strong>{Number.isInteger(amount) && amount > 0 ? formatTaka(amount) : '৳—'}</strong>
          </div>
          <button type="submit" className="btn btn-signal btn-block btn-lg" disabled={busy}>
            {busy ? t('donate.starting') : t('donate.proceed')}
            <ArrowRight size={20} aria-hidden />
          </button>
          <p className="sandbox-note">
            <FlaskConical size={16} aria-hidden />
            {t('donate.sandboxNote')}
          </p>
        </form>

        <aside className="donate-side" aria-labelledby="fund-raised">
          <section className="card fund-hero">
            <p className="eyebrow" id="fund-raised">
              {t('donate.raised')}
            </p>
            {fund.loading && !fund.data ? (
              <Loading rows={2} />
            ) : fund.error ? (
              <ErrorState error={fund.error} onRetry={fund.reload} />
            ) : (
              <>
                <p className="fund-figure">{formatTaka(fund.data?.totalBdt ?? 0)}</p>
                <p className="fund-count">
                  {t('donate.donations', { count: fund.data?.completedCount ?? 0, n: formatNumber(fund.data?.completedCount ?? 0) })}
                </p>
              </>
            )}
          </section>
          <section className="card" aria-labelledby="recent-title">
            <div className="card-head">
              <h2 id="recent-title">{t('donate.recent')}</h2>
            </div>
            {fund.data && <RecentDonations items={fund.data.latest} />}
          </section>
          <p className="secure-pill">
            <LockKeyhole size={16} aria-hidden />
            {t('donate.secure')}
          </p>
        </aside>
      </div>
    </DonateShell>
  );
}

// ---------- /donate/gateway/:id ----------
export function GatewayPage() {
  const { id = '' } = useParams();
  const loaded = useApiData((s) => api.get<{ donation: DonationReceipt }>(`/api/donations/${id}`, s), [id]);
  const [settled, setSettled] = useState<DonationReceipt | null>(null);
  const donation = settled ?? loaded.data?.donation;

  let body: ReactNode;
  if (!donation && loaded.error) body = <ErrorState error={loaded.error} onRetry={loaded.reload} />;
  else if (!donation) body = <Loading rows={6} />;
  else if (donation.status === 'pending') body = <Checkout donation={donation} onSettled={setSettled} />;
  else body = <Receipt donation={donation} />;
  return <DonateShell>{body}</DonateShell>;
}

type Step = 'select' | 'account' | 'otp' | 'pin' | 'processing';
/** Sandbox credentials shown as hints on each step (no real wallet or card is ever contacted). */
const SANDBOX = { wallet: '01770618575', otp: '123456', pin: '12345' };
const isWallet = (m: PaymentMethod | null) => !!m && WALLETS.includes(m);

function MethodTile({ method, onPick }: { method: PaymentMethod; onPick: (m: PaymentMethod) => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="method-tile" data-brand={method} onClick={() => onPick(method)}>
      <span className="method-mark" aria-hidden />
      <span className="method-name">{t(`donate.methods.${method}`)}</span>
      <ChevronRight size={18} className="chev" aria-hidden />
    </button>
  );
}

/**
 * Sandbox checkout in steps, the way bKash / SSLCommerz walk a payer through it:
 * choose a method → account (or card) → OTP → PIN (wallets only) → processing → receipt.
 * Every step keeps quiet links to simulate a failure or cancel, so those flows stay easy to demo.
 */
function Checkout({ donation, onSettled }: { donation: DonationReceipt; onSettled: (d: DonationReceipt) => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [step, setStep] = useState<Step>('select');
  const [account, setAccount] = useState(SANDBOX.wallet);
  const [cardNumber, setCardNumber] = useState(TEST_CARDS.visa ?? '');
  const [otp, setOtp] = useState('');
  const [pin, setPin] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  // Move focus to each new step's heading (not on first load) so screen readers follow the dialog.
  useEffect(() => {
    if (moved.current) headingRef.current?.focus();
    moved.current = true;
  }, [step]);

  const wallet = isWallet(method);
  const flow: Step[] = wallet ? ['account', 'otp', 'pin'] : ['account', 'otp'];
  const methodName = method ? t(`donate.methods.${method}`) : '';
  const go = (next: Step) => {
    setFieldError(undefined);
    setError(null);
    setStep(next);
  };
  const back = () => {
    const i = flow.indexOf(step);
    if (i <= 0) {
      setMethod(null);
      go('select');
    } else go(flow[i - 1] as Step);
  };

  const settle = async (outcome: 'success' | 'fail' | 'cancel', fallback: Step) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ donation: DonationReceipt }>(`/api/donations/${donation.id}/sandbox-complete`, {
        outcome,
        ...(method ? { paymentMethod: method } : {}),
      });
      onSettled(res.donation);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(errorText(err));
      setStep(fallback);
      setBusy(false);
    }
  };
  const pay = async (from: Step) => {
    setFieldError(undefined);
    setStep('processing');
    setBusy(true);
    await new Promise((r) => setTimeout(r, 1400));
    await settle('success', from);
  };

  const pick = (m: PaymentMethod) => {
    setMethod(m);
    if (!isWallet(m)) setCardNumber(TEST_CARDS[m] ?? '');
    setOtp('');
    setPin('');
    go('account');
  };
  const submitAccount = (e: FormEvent) => {
    e.preventDefault();
    if (wallet && !normalisePhone(account)) return setFieldError(t('validation.invalid_phone'));
    if (!wallet && toAsciiDigits(cardNumber).length !== 16) return setFieldError(t('donate.gateway.cardInvalid'));
    go('otp');
  };
  const submitOtp = (e: FormEvent) => {
    e.preventDefault();
    if (toAsciiDigits(otp) !== SANDBOX.otp) return setFieldError(t('donate.gateway.otpWrong'));
    if (wallet) go('pin');
    else void pay('otp');
  };
  const submitPin = (e: FormEvent) => {
    e.preventDefault();
    if (toAsciiDigits(pin) !== SANDBOX.pin) return setFieldError(t('donate.gateway.pinWrong'));
    void pay('pin');
  };

  const stepNo = flow.indexOf(step) + 1;
  const masked = `${account.slice(0, 3)}•••••${account.slice(-3)}`;
  const confirmBtn = (
    <button type="submit" className="btn btn-brand btn-block btn-lg">
      {t('donate.gateway.confirm')}
    </button>
  );

  return (
    <section className="gateway" data-brand={method ?? undefined} data-step={step} aria-labelledby="gateway-title">
      <header className="gateway-head">
        <div className="gateway-merchant">
          <img src="/icon.svg" alt="" width={44} height={44} />
          <div>
            <p id="gateway-title" className="gateway-title">
              {method ? methodName : t('donate.gateway.title')}
            </p>
            <p>{t('donate.gateway.merchant')}</p>
          </div>
        </div>
        <span className="sandbox-badge">
          <FlaskConical size={14} aria-hidden />
          {t('donate.gateway.sandbox')}
        </span>
      </header>
      <div className="gateway-amount">
        <div>
          <span className="gateway-label">{t('donate.gateway.payable')}</span>
          <strong>{formatTaka(donation.amountBdt)}</strong>
        </div>
        <div>
          <span className="gateway-label">{t('donate.gateway.txn')}</span>
          <code>{donation.transactionId}</code>
        </div>
      </div>

      <div className="gateway-body">
        {error && <Notice tone="error">{error}</Notice>}
        {stepNo > 0 && (
          <div className="gateway-progress">
            <button type="button" className="gateway-back" onClick={back} aria-label={t('donate.gateway.back')}>
              <ArrowLeft size={18} aria-hidden />
            </button>
            <span className="gateway-stepno">{t('donate.gateway.stepOf', { n: formatNumber(stepNo), total: formatNumber(flow.length) })}</span>
            <span className="gateway-dots" aria-hidden>
              {flow.map((s, i) => (
                <span key={s} data-done={i < stepNo} />
              ))}
            </span>
          </div>
        )}

        {step === 'select' && (
          <div className="gateway-step">
            <h1 ref={headingRef} tabIndex={-1} className="gateway-step-title">
              {t('donate.gateway.choose')}
            </h1>
            <h2 className="gateway-group">
              <Smartphone size={16} aria-hidden />
              {t('donate.gateway.mobile')}
            </h2>
            <div className="method-tiles">
              {WALLETS.map((m) => (
                <MethodTile key={m} method={m} onPick={pick} />
              ))}
            </div>
            <h2 className="gateway-group">
              <CreditCard size={16} aria-hidden />
              {t('donate.gateway.cards')}
            </h2>
            <div className="method-tiles">
              {CARDS.map((m) => (
                <MethodTile key={m} method={m} onPick={pick} />
              ))}
            </div>
          </div>
        )}

        {step === 'account' && (
          <form className="gateway-step" onSubmit={submitAccount} noValidate>
            <h1 ref={headingRef} tabIndex={-1} className="gateway-step-title">
              {wallet ? t('donate.gateway.accountTitle', { method: methodName }) : t('donate.gateway.cardTitle')}
            </h1>
            {wallet ? (
              <TextField
                label={t('donate.gateway.wallet', { method: methodName })}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                className="mono-field"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                error={fieldError}
              />
            ) : (
              <>
                <TextField
                  label={t('donate.gateway.cardNumber')}
                  inputMode="numeric"
                  autoComplete="off"
                  className="mono-field"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  error={fieldError}
                />
                <div className="field-pair field-pair-3">
                  <TextField label={t('donate.gateway.expiry')} inputMode="numeric" autoComplete="off" defaultValue="12/30" />
                  <TextField label={t('donate.gateway.cvv')} inputMode="numeric" autoComplete="off" defaultValue="123" />
                  <TextField label={t('donate.gateway.cardName')} autoComplete="off" defaultValue="Sandbox Donor" />
                </div>
              </>
            )}
            <p className="gateway-hint">{t('donate.gateway.agree', { amount: formatTaka(donation.amountBdt) })}</p>
            {confirmBtn}
          </form>
        )}

        {step === 'otp' && (
          <form className="gateway-step" onSubmit={submitOtp} noValidate>
            <h1 ref={headingRef} tabIndex={-1} className="gateway-step-title">
              {t('donate.gateway.otpTitle')}
            </h1>
            <p className="gateway-text">{wallet ? t('donate.gateway.otpSent', { to: masked }) : t('donate.gateway.otpSentCard')}</p>
            <TextField
              label={t('donate.gateway.otp')}
              help={t('donate.gateway.otpHint')}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={6}
              className="code-field"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              error={fieldError}
            />
            {confirmBtn}
          </form>
        )}

        {step === 'pin' && (
          <form className="gateway-step" onSubmit={submitPin} noValidate>
            <h1 ref={headingRef} tabIndex={-1} className="gateway-step-title">
              {t('donate.gateway.pinTitle', { method: methodName })}
            </h1>
            <TextField
              label={t('donate.gateway.pinLabel', { method: methodName })}
              help={t('donate.gateway.pinHint')}
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              maxLength={5}
              className="code-field"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              error={fieldError}
            />
            {confirmBtn}
          </form>
        )}

        {step === 'processing' && (
          <div className="gateway-step gateway-processing" role="status">
            <span className="spinner" aria-hidden />
            <h1 ref={headingRef} tabIndex={-1} className="gateway-step-title">
              {t('donate.gateway.processing')}
            </h1>
            <p className="gateway-text">{t('donate.gateway.paying', { amount: formatTaka(donation.amountBdt) })}</p>
          </div>
        )}
      </div>

      {step !== 'processing' && (
        <div className="gateway-sandbox">
          <span>{t('donate.gateway.sandboxLinks')}</span>
          <button type="button" className="link-button" disabled={busy} onClick={() => void settle('fail', step)}>
            <CircleX size={15} aria-hidden />
            {t('donate.gateway.fail')}
          </button>
          <button type="button" className="link-button" disabled={busy} onClick={() => void settle('cancel', step)}>
            <Ban size={15} aria-hidden />
            {t('donate.gateway.cancel')}
          </button>
        </div>
      )}
      <p className="gateway-foot">
        <LockKeyhole size={14} aria-hidden />
        {t('donate.secure')}
      </p>
    </section>
  );
}

function Receipt({ donation: d }: { donation: DonationReceipt }) {
  const { t } = useTranslation();
  const donor = useDonorName();
  const retry = `/donate?amount=${d.amountBdt}${d.operationId ? `&op=${d.operationId}` : ''}`;
  const method = d.paymentMethod ? t(`donate.methods.${d.paymentMethod}`) : '—';

  if (d.status !== 'completed') {
    const failed = d.status === 'failed';
    return (
      <section className="card receipt receipt-bad" aria-labelledby="receipt-title">
        <div className="receipt-head">
          <span className={`receipt-icon ${failed ? 'is-failed' : 'is-cancelled'}`} aria-hidden>
            {failed ? <CircleX size={32} /> : <Ban size={32} />}
          </span>
          <div>
            <h1 id="receipt-title">{failed ? t('donate.receipt.failedTitle') : t('donate.receipt.cancelledTitle')}</h1>
            <p className="lead">{failed ? t('donate.receipt.failedText') : t('donate.receipt.cancelledText')}</p>
          </div>
        </div>
        <dl className="receipt-list">
          <div>
            <dt>{t('donate.receipt.txn')}</dt>
            <dd>
              <code>{d.transactionId}</code>
            </dd>
          </div>
          <div>
            <dt>{t('donate.receipt.amount')}</dt>
            <dd>{formatTaka(d.amountBdt)}</dd>
          </div>
          <div>
            <dt>{t('donate.receipt.status')}</dt>
            <dd>{t(`donate.statuses.${d.status}`)}</dd>
          </div>
        </dl>
        <div className="receipt-actions">
          <Link to={retry} className="btn btn-signal btn-lg">
            <RotateCcw size={18} aria-hidden />
            {t('donate.receipt.retry')}
          </Link>
          <Link to="/" className="btn btn-ghost btn-lg">
            <ArrowLeft size={18} aria-hidden />
            {t('donate.receipt.home')}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <article className="card receipt" aria-labelledby="receipt-title">
      <div className="receipt-head">
        <span className="receipt-icon is-ok" aria-hidden>
          <BadgeCheck size={32} />
        </span>
        <div>
          <p className="eyebrow">{t('donate.statuses.completed')}</p>
          <h1 id="receipt-title">{t('donate.receipt.title')}</h1>
          <p className="lead">{t('donate.receipt.thanks')}</p>
        </div>
        <img className="receipt-logo" src="/icon.svg" alt="" width={48} height={48} />
      </div>
      <p className="receipt-amount">{formatTaka(d.amountBdt)}</p>
      <dl className="receipt-list">
        <div>
          <dt>{t('donate.receipt.txn')}</dt>
          <dd>
            <code>{d.transactionId}</code>
          </dd>
        </div>
        <div>
          <dt>{t('donate.receipt.date')}</dt>
          <dd>{formatDateTime(d.completedAt ?? d.createdAt)}</dd>
        </div>
        <div>
          <dt>{t('donate.receipt.amount')}</dt>
          <dd>{formatTaka(d.amountBdt)}</dd>
        </div>
        <div>
          <dt>{t('donate.receipt.method')}</dt>
          <dd>{method}</dd>
        </div>
        <div>
          <dt>{t('donate.receipt.operation')}</dt>
          <dd>{d.operationName ?? t('donate.general')}</dd>
        </div>
        <div>
          <dt>{t('donate.receipt.donor')}</dt>
          <dd>{donor(d)}</dd>
        </div>
      </dl>
      <p className="receipt-note">{t('donate.receipt.note')}</p>
      <div className="receipt-actions no-print">
        <button type="button" className="btn btn-primary btn-lg" onClick={() => window.print()}>
          <Printer size={18} aria-hidden />
          {t('donate.receipt.print')}
        </button>
        <Link to="/donate" className="btn btn-secondary btn-lg">
          <HandCoins size={18} aria-hidden />
          {t('donate.receipt.again')}
        </Link>
        <Link to="/" className="btn btn-ghost btn-lg">
          {t('donate.receipt.home')}
        </Link>
      </div>
    </article>
  );
}

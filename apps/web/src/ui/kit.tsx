import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AlertTriangle, ArrowLeft, CheckCircle2, Delete, Info, Minus, Moon, Plus, Sun, WifiOff, X } from 'lucide-react';
import { formatShortCode, type CoverageLabel } from '@relief/shared';
import { ApiError } from '../api/client';
import { formatShortTime, setLang, type Lang } from '../i18n';
import { getTheme, resolvedTheme, setTheme, subscribeTheme, type ThemeChoice } from '../theme';
import { reducedMotion } from './motion';

/** Translates an API or validation error code into a sentence. */
export function useErrorText() {
  const { t, i18n } = useTranslation();
  return useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        const key = `errors.${err.code}`;
        const params: Record<string, string> = { ...(err.details as Record<string, string> | undefined) };
        if (err.code === 'account_locked' && params.lockedUntil) {
          params.time = formatShortTime(params.lockedUntil);
        }
        if (err.code === 'account_pending' && (params.approver === 'coordinator' || params.approver === 'sysadmin')) {
          return t(`errors.account_pending_${params.approver}`);
        }
        return i18n.exists(key) ? t(key, params) : t(err.status === 0 ? 'errors.network' : 'errors.unexpected');
      }
      if (err instanceof Error && i18n.exists(`validation.${err.message}`)) return t(`validation.${err.message}`);
      return t('errors.unexpected');
    },
    [t, i18n],
  );
}

/** Field-level messages from a 400 response, keyed by path. */
export function issuesOf(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !err.issues) return {};
  return Object.fromEntries(err.issues.map((i) => [i.path, i.message]));
}

export function useIssueText() {
  const { t, i18n } = useTranslation();
  return (message: string | undefined) => {
    if (!message) return undefined;
    return i18n.exists(`validation.${message}`) ? t(`validation.${message}`) : t('validation.required');
  };
}

// ---------- signal marks: every data state has its own shape (DESIGN.md, Overview) ----------
export type MarkKind =
  | 'served'
  | 'partly'
  | 'not_served'
  | 'no_records'
  | 'pending'
  | 'synced'
  | 'failed'
  | 'conflict'
  | 'duplicate'
  | 'neutral';

/** A 12 px geometric mark, drawn in currentColor; always paired with a text label. */
export function StatusMark({ kind, size = 12 }: { kind: MarkKind; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': true as const, focusable: 'false' as const, className: `mark mark-${kind}` };
  switch (kind) {
    case 'served':
      return (
        <svg {...common}>
          <rect x="1" y="1" width="10" height="10" fill="currentColor" />
        </svg>
      );
    case 'partly':
      return (
        <svg {...common}>
          <rect x="1.6" y="1.6" width="8.8" height="8.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M1.6 1.6V10.4H10.4Z" fill="currentColor" />
        </svg>
      );
    case 'not_served':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case 'no_records':
      return (
        <svg {...common}>
          <path d="M0.5 6H11.5" stroke="currentColor" strokeWidth="2" strokeDasharray="2.2 1.6" />
        </svg>
      );
    case 'pending':
      return (
        <svg {...common}>
          <path d="M6 1.2 10.8 6 6 10.8 1.2 6Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'synced':
      return (
        <svg {...common}>
          <rect x="1" y="1" width="10" height="10" fill="currentColor" />
          <path d="M3.3 6.1 5.2 8 8.8 4.2" fill="none" stroke="var(--mark-knock, var(--surface))" strokeWidth="1.5" />
        </svg>
      );
    case 'failed':
      return (
        <svg {...common}>
          <rect x="1" y="1" width="10" height="10" fill="currentColor" />
          <path d="M3.8 3.8 8.2 8.2M8.2 3.8 3.8 8.2" stroke="var(--mark-knock, var(--surface))" strokeWidth="1.5" />
        </svg>
      );
    case 'conflict':
      return (
        <svg {...common}>
          <path d="M1 1.5 5.6 6 1 10.5ZM11 1.5 6.4 6 11 10.5Z" fill="currentColor" />
        </svg>
      );
    case 'duplicate':
      return (
        <svg {...common}>
          <circle cx="4.4" cy="6" r="3.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="7.6" cy="6" r="3.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2.4" fill="currentColor" />
        </svg>
      );
  }
}

// ---------- form controls ----------
interface FieldProps {
  label: string;
  error?: string;
  help?: string;
}

export function TextField({ label, error, help, className, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const describedBy = [help ? `${id}-help` : null, error ? `${id}-err` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${className ? ` ${className}` : ''}`}>
      <label htmlFor={id}>{label}</label>
      {help && (
        <span id={`${id}-help`} className="help">
          {help}
        </span>
      )}
      <input id={id} aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy} {...rest} />
      {error && (
        <span id={`${id}-err`} className="error">
          <AlertTriangle size={14} aria-hidden />
          {error}
        </span>
      )}
    </div>
  );
}

export function SelectField({ label, error, help, children, className, ...rest }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  const describedBy = [help ? `${id}-help` : null, error ? `${id}-err` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${className ? ` ${className}` : ''}`}>
      <label htmlFor={id}>{label}</label>
      {help && (
        <span id={`${id}-help`} className="help">
          {help}
        </span>
      )}
      <select id={id} aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy} {...rest}>
        {children}
      </select>
      {error && (
        <span id={`${id}-err`} className="error">
          <AlertTriangle size={14} aria-hidden />
          {error}
        </span>
      )}
    </div>
  );
}

export function Stepper({
  label,
  value,
  onChange,
  min = 1,
  max = 50,
  error,
  hideLabel = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  error?: string;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel ? 'visually-hidden' : undefined}>
        {label}
      </label>
      <div className="stepper">
        <button type="button" className="btn btn-quiet" aria-label={`${label}: −1`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
          <Minus size={20} aria-hidden />
        </button>
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={Number.isFinite(value) ? String(value) : ''}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6)), 10);
            onChange(Number.isNaN(n) ? 0 : Math.min(max, n));
          }}
        />
        <button type="button" className="btn btn-quiet" aria-label={`${label}: +1`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
          <Plus size={20} aria-hidden />
        </button>
      </div>
      {error && (
        <span id={`${id}-err`} className="error">
          <AlertTriangle size={14} aria-hidden />
          {error}
        </span>
      )}
    </div>
  );
}

// ---------- display ----------
const COVERAGE_MARK: Record<CoverageLabel, MarkKind> = {
  fully_served: 'served',
  partly_served: 'partly',
  not_served: 'not_served',
  no_records: 'no_records',
};

export function CoverageChip({ label }: { label: CoverageLabel }) {
  const { t } = useTranslation();
  return (
    <span className={`chip chip-${label}`}>
      <StatusMark kind={COVERAGE_MARK[label]} />
      {t(`coverage.${label}`)}
    </span>
  );
}

const STATUS_MARK: Record<string, MarkKind> = {
  active: 'synced',
  approved: 'synced',
  resolved: 'synced',
  justified: 'synced',
  ok: 'synced',
  recorded: 'synced',
  synced: 'synced',
  linked: 'duplicate',
  possible: 'duplicate',
  likely: 'duplicate',
  rejected: 'failed',
  deactivated: 'failed',
  revoked: 'failed',
  voided: 'failed',
  failed: 'failed',
  repeat: 'failed',
  locked: 'failed',
  pending: 'pending',
  pending_review: 'pending',
  running: 'pending',
  open: 'conflict',
};

export function StatusTag({ status, label }: { status: string; label?: string }) {
  const { t } = useTranslation();
  const kind = STATUS_MARK[status] ?? 'neutral';
  return (
    <span className={`tag tag-${kind}`}>
      <StatusMark kind={kind} />
      {label ?? t(`statuses.${status}`, { defaultValue: status })}
    </span>
  );
}

export function ShortCode({ code, size = 'lg' }: { code: string; size?: 'lg' | 'sm' }) {
  const formatted = formatShortCode(code);
  return size === 'lg' ? (
    <p className="short-code" aria-label={code.split('').join(' ')} translate="no">
      {formatted}
    </p>
  ) : (
    <span className="short-code-sm" translate="no">
      {formatted}
    </span>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok' | 'offline'; children: ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'offline' ? WifiOff : tone === 'info' ? Info : AlertTriangle;
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon size={20} aria-hidden />
      <div className="notice-body">{children}</div>
    </div>
  );
}

/** A designed empty state: a mark, one line, one sentence, one next action. */
export function Empty({ title, children, mark = 'neutral', action }: { title: string; children?: ReactNode; mark?: MarkKind; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className={`empty-mark tone-${mark}`} aria-hidden>
        <StatusMark kind={mark} size={20} />
      </span>
      <h2 className="empty-title">{title}</h2>
      {children && <div className="empty-body">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Loading({ rows = 3, label }: { rows?: number; label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="loading" aria-busy="true" role="status">
      <span className="visually-hidden">{label ?? t('app.loading')}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${92 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const text = useErrorText();
  return (
    <Notice tone="error">
      <p>{text(error)}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </Notice>
  );
}

/** Page title row: optional back link, the h1, a lead sentence and actions on the right. */
export function PageHead({ title, lead, actions, back, meta }: { title: ReactNode; lead?: ReactNode; actions?: ReactNode; back?: { to: string; label?: string }; meta?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="page-head">
      {back && (
        <Link className="back-link" to={back.to}>
          <ArrowLeft size={16} aria-hidden />
          {back.label ?? t('common.back')}
        </Link>
      )}
      <div className="page-head-row">
        <h1>{title}</h1>
        {actions && <div className="page-head-actions">{actions}</div>}
      </div>
      {meta && <div className="page-head-meta">{meta}</div>}
      {lead && <p className="lead">{lead}</p>}
    </header>
  );
}

/** Segmented filter (not tabs: it filters one list in place and the URL keeps the choice). */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** EN | বাংলা segmented pill. Same control on every surface; `compact` only tightens it for the field header. */
export function LangSwitch({ compact = false }: { compact?: boolean }) {
  const { i18n, t } = useTranslation();
  const choose = (l: Lang) => setLang(l);
  const lang = i18n.language === 'bn' ? 'bn' : 'en';
  // Field header on small phones: one button that names the language it switches to ("Language: বাং").
  if (compact) {
    const next: Lang = lang === 'bn' ? 'en' : 'bn';
    return (
      <button type="button" className="lang-toggle" onClick={() => choose(next)} title={next === 'bn' ? 'বাংলা' : 'English'}>
        <span className="visually-hidden">{t('app.language')}: </span>
        <span lang={next}>{next === 'bn' ? 'বাং' : 'EN'}</span>
      </button>
    );
  }
  return (
    <div className="lang-switch" role="group" aria-label={t('app.language')}>
      <button type="button" aria-pressed={lang === 'en'} onClick={() => choose('en')} lang="en">
        EN
      </button>
      <button type="button" aria-pressed={lang === 'bn'} onClick={() => choose('bn')} lang="bn">
        বাংলা
      </button>
    </div>
  );
}

/** Dishari lockup: the PWA mark and the wordmark in the active language (Dishari or দিশারী, never both). */
export function Brand({ sub, size = 40 }: { sub?: string; size?: number }) {
  const { i18n } = useTranslation();
  const bn = i18n.language === 'bn';
  return (
    <span className="brand-lockup">
      <img className="brand-mark" src="/icon.svg" alt="" width={size} height={size} />
      <span className="brand-text">
        <span className={`brand-word${bn ? ' brand-word-bn' : ''}`} lang={bn ? 'bn' : 'en'}>
          {bn ? 'দিশারী' : 'Dishari'}
        </span>
        {sub && <span className="brand-sub">{sub}</span>}
      </span>
    </span>
  );
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribeTheme, getTheme, () => 'system' as ThemeChoice);
}

const effectiveServer = () => 'light' as const;

/**
 * One press flips light and dark. Until the user picks, the app follows the system; the label still
 * names that starting point ("system") so assistive tech knows where it came from.
 */
export function ThemeToggle({ onShell = false }: { onShell?: boolean }) {
  const { t } = useTranslation();
  const choice = useThemeChoice();
  const effective = useSyncExternalStore(subscribeTheme, resolvedTheme, effectiveServer);
  const next = effective === 'dark' ? 'light' : 'dark';
  const Icon = effective === 'dark' ? Moon : Sun;
  const label = t('theme.label', { current: t(`theme.${choice}`), next: t(`theme.${next}`) });
  // The icon turns only after a press, not every time a page mounts the toggle.
  const [turned, setTurned] = useState(false);
  return (
    <button
      type="button"
      className={`icon-btn${onShell ? ' on-shell' : ''}`}
      onClick={() => {
        setTurned(true);
        setTheme(next);
      }}
      aria-label={label}
      title={label}
    >
      <Icon key={effective} size={18} aria-hidden className={`theme-icon${turned ? ' is-turning' : ''}`} />
    </button>
  );
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/**
 * On-screen 0–9 keypad for PIN entry. CSS shows it on phone-sized screens only; the field keeps
 * focus (mousedown is cancelled) so a hardware or native keyboard still works alongside it.
 */
export function PinPad({ onDigit, onDelete }: { onDigit: (d: string) => void; onDelete: () => void }) {
  const { t, i18n } = useTranslation();
  const bn = i18n.language === 'bn';
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  const key = (d: string) => (
    <button key={d} type="button" className="pin-key" onMouseDown={keep} onClick={() => onDigit(d)}>
      {bn ? BN_DIGITS[Number(d)] : d}
    </button>
  );
  return (
    <div className="pin-pad" role="group" aria-label={t('pin.keypad')}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key)}
      <span aria-hidden />
      {key('0')}
      <button type="button" className="pin-key pin-key-del" onMouseDown={keep} onClick={onDelete} aria-label={t('pin.deleteDigit')}>
        <Delete size={22} aria-hidden />
      </button>
    </div>
  );
}

// ---------- data loading with the four states ----------
export function useApiData<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ data: s.data, loading: true }));
    loadRef
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, loading: false });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ error, loading: false });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass explicit dependencies
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}

// ---------- toasts: polite for outcomes, assertive for errors ----------
interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error';
  /** Playing its exit; already out of the live region's reading order and not interactive. */
  leaving?: boolean;
}
const TOAST_EXIT_MS = 180;
const ToastContext = createContext<(text: string, tone?: 'ok' | 'error') => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => {
    const remove = () => setToasts((ts) => ts.filter((x) => x.id !== id));
    if (reducedMotion()) return remove();
    setToasts((ts) => ts.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(remove, TOAST_EXIT_MS);
  }, []);
  const push = useCallback(
    (text: string, tone: 'ok' | 'error' = 'ok') => {
      const id = Date.now() + Math.random();
      setToasts((ts) => [...ts.slice(-2), { id, text, tone }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 5000);
    },
    [dismiss],
  );
  const render = (tone: Toast['tone']) =>
    toasts
      .filter((x) => x.tone === tone)
      .map((x) => (
        <div key={x.id} className={`toast toast-${x.tone}`} data-leaving={x.leaving || undefined} inert={x.leaving || undefined}>
          {x.tone === 'ok' ? <CheckCircle2 size={18} aria-hidden /> : <AlertTriangle size={18} aria-hidden />}
          <span className="toast-text">{x.text}</span>
          <button type="button" className="toast-close" aria-label={t('common.close')} onClick={() => dismiss(x.id)}>
            <X size={16} aria-hidden />
          </button>
        </div>
      ));
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-region">
        <div role="status" aria-live="polite" className="toast-stack">
          {render('ok')}
        </div>
        <div role="alert" aria-live="assertive" className="toast-stack">
          {render('error')}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

// ---------- confirmation (native dialog: focus trap, Escape, focus returns to the trigger) ----------
interface ConfirmRequest {
  text: string;
  withReason: boolean;
  danger: boolean;
  confirmLabel?: string;
  resolve: (value: string | false) => void;
}

export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [reason, setReason] = useState('');
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const { t } = useTranslation();
  useEffect(() => {
    if (request && ref.current && !ref.current.open) ref.current.showModal();
  }, [request]);
  const ask = useCallback(
    (text: string, withReason = false, opts: { danger?: boolean; confirmLabel?: string } = {}) =>
      new Promise<string | false>((resolve) => {
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setReason('');
        setRequest({ text, withReason, danger: opts.danger ?? true, confirmLabel: opts.confirmLabel, resolve });
      }),
    [],
  );
  const close = (ok: boolean) => {
    ref.current?.close();
    request?.resolve(ok ? (request.withReason ? reason.trim() : 'yes') : false);
    setRequest(null);
    opener.current?.focus();
  };
  const dialog = request ? (
    <dialog ref={ref} onCancel={() => close(false)} aria-labelledby="confirm-text" className="confirm">
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!request.withReason || reason.trim().length >= 3) close(true);
        }}
      >
        <p id="confirm-text" className="confirm-text">
          {request.text}
        </p>
        {request.withReason && <TextField label={t('common.reason')} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} help={t('common.reasonHelp')} />}
        <div className="form-actions form-actions-end">
          <button type="button" className="btn btn-secondary" onClick={() => close(false)}>
            {t('common.cancel')}
          </button>
          <button type="submit" className={`btn ${request.danger ? 'btn-danger-solid' : 'btn-primary'}`} disabled={request.withReason && reason.trim().length < 3}>
            {request.confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </form>
    </dialog>
  ) : null;
  return { ask, dialog };
}

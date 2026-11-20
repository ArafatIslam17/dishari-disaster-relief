import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Info, Minus, Plus, WifiOff } from 'lucide-react';
import { formatShortCode, type CoverageLabel } from '@relief/shared';
import { ApiError } from '../api/client';
import { setLang, type Lang } from '../i18n';

/** Translates an API or validation error code into a sentence. */
export function useErrorText() {
  const { t, i18n } = useTranslation();
  return useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        const key = `errors.${err.code}`;
        const params: Record<string, string> = { ...(err.details as Record<string, string> | undefined) };
        if (err.code === 'account_locked' && params.lockedUntil) {
          params.time = new Date(params.lockedUntil).toLocaleTimeString(i18n.language === 'bn' ? 'bn-BD' : 'en-GB');
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

// ---------- form controls ----------
interface FieldProps {
  label: string;
  error?: string;
  help?: string;
}

export function TextField({ label, error, help, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const describedBy = [error ? `${id}-err` : null, help ? `${id}-help` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {help && (
        <span id={`${id}-help`} className="help">
          {help}
        </span>
      )}
      <input id={id} aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy} {...rest} />
      {error && (
        <span id={`${id}-err`} className="error">
          {error}
        </span>
      )}
    </div>
  );
}

export function SelectField({ label, error, help, children, ...rest }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {help && <span className="help">{help}</span>}
      <select id={id} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? `${id}-err` : undefined} {...rest}>
        {children}
      </select>
      {error && (
        <span id={`${id}-err`} className="error">
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
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  error?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="stepper">
        <button type="button" className="btn btn-quiet" aria-label={`${label}: −1`} onClick={() => onChange(Math.max(min, value - 1))}>
          <Minus size={20} aria-hidden />
        </button>
        <input
          id={id}
          inputMode="numeric"
          value={Number.isFinite(value) ? String(value) : ''}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6)), 10);
            onChange(Number.isNaN(n) ? 0 : Math.min(max, n));
          }}
        />
        <button type="button" className="btn btn-quiet" aria-label={`${label}: +1`} onClick={() => onChange(Math.min(max, value + 1))}>
          <Plus size={20} aria-hidden />
        </button>
      </div>
      {error && (
        <span id={`${id}-err`} className="error">
          {error}
        </span>
      )}
    </div>
  );
}

// ---------- display ----------
export function CoverageChip({ label }: { label: CoverageLabel }) {
  const { t } = useTranslation();
  return <span className={`chip chip-${label}`}>{t(`coverage.${label}`)}</span>;
}

const OK = ['active', 'approved', 'resolved', 'linked', 'justified', 'ok', 'recorded'];
const BAD = ['rejected', 'deactivated', 'revoked', 'voided', 'failed', 'repeat', 'locked'];
const WAIT = ['pending', 'pending_review', 'open', 'possible', 'running', 'likely'];

export function StatusTag({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone = OK.includes(status) ? 'tag-ok' : BAD.includes(status) ? 'tag-danger' : WAIT.includes(status) ? 'tag-warn' : '';
  return <span className={`tag ${tone}`}>{t(`statuses.${status}`, { defaultValue: status })}</span>;
}

export function ShortCode({ code, size = 'lg' }: { code: string; size?: 'lg' | 'sm' }) {
  const formatted = formatShortCode(code);
  return size === 'lg' ? (
    <p className="short-code" aria-label={code.split('').join(' ')}>
      {formatted}
    </p>
  ) : (
    <span className="short-code-sm">{formatted}</span>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok' | 'offline'; children: ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'offline' ? WifiOff : tone === 'info' ? Info : AlertTriangle;
  const cls = tone === 'offline' ? 'notice-warn' : tone === 'info' ? '' : `notice-${tone}`;
  return (
    <div className={`notice ${cls}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon size={20} aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <div aria-busy="true">
      <span className="visually-hidden">{t('app.loading')}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - i * 12}%` }} />
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
        <button type="button" className="btn btn-quiet" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </Notice>
  );
}

export function LangSwitch() {
  const { i18n, t } = useTranslation();
  const choose = (l: Lang) => setLang(l);
  return (
    <div className="lang-switch" role="group" aria-label={t('app.language')}>
      <button type="button" aria-pressed={i18n.language === 'bn'} onClick={() => choose('bn')} lang="bn">
        বাংলা
      </button>
      <button type="button" aria-pressed={i18n.language === 'en'} onClick={() => choose('en')} lang="en">
        EN
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

// ---------- toasts (aria-live) ----------
interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error';
}
const ToastContext = createContext<(text: string, tone?: 'ok' | 'error') => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.tone === 'error' ? 'toast-error' : ''}`}>
            {x.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------- confirmation (native dialog) ----------
export function useConfirm() {
  const [request, setRequest] = useState<{ text: string; withReason: boolean; resolve: (value: string | false) => void } | null>(null);
  const [reason, setReason] = useState('');
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    if (request && ref.current && !ref.current.open) ref.current.showModal();
  }, [request]);
  const ask = useCallback(
    (text: string, withReason = false) =>
      new Promise<string | false>((resolve) => {
        setReason('');
        setRequest({ text, withReason, resolve });
      }),
    [],
  );
  const close = (ok: boolean) => {
    ref.current?.close();
    request?.resolve(ok ? (request.withReason ? reason.trim() : 'yes') : false);
    setRequest(null);
  };
  const dialog = request ? (
    <dialog ref={ref} onCancel={() => close(false)} aria-labelledby="confirm-text">
      <p id="confirm-text">{request.text}</p>
      {request.withReason && (
        <TextField label={t('common.reason')} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus />
      )}
      <div className="form-actions">
        <button type="button" className="btn btn-primary" disabled={request.withReason && reason.trim().length < 3} onClick={() => close(true)}>
          {t('common.confirm')}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => close(false)}>
          {t('common.cancel')}
        </button>
      </div>
    </dialog>
  ) : null;
  return { ask, dialog };
}

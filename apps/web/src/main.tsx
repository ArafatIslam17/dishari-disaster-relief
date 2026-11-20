import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { RouterProvider } from 'react-router';
import { registerSW } from 'virtual:pwa-register';
import './i18n';
import './styles/app.css';
import { SessionProvider } from './auth/session';
import { router } from './router';
import { ToastProvider } from './ui/kit';

let applyUpdate: (() => Promise<void>) | null = null;
const updateListeners = new Set<() => void>();

// Service worker: precaches the app shell and fonts so the app opens with no network (NFR08).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateListeners.forEach((fn) => fn());
    },
  });
}

/** Offers a new version without interrupting work in progress. */
function UpdatePrompt() {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const fn = () => setReady(true);
    updateListeners.add(fn);
    return () => {
      updateListeners.delete(fn);
    };
  }, []);
  if (!ready) return null;
  return (
    <div className="toast-region">
      <div className="toast" role="status">
        {t('settings.update')}{' '}
        <button type="button" className="btn btn-signal" onClick={() => void applyUpdate?.()}>
          {t('settings.reload')}
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ToastProvider>
      <SessionProvider>
        <RouterProvider router={router} />
        <UpdatePrompt />
      </SessionProvider>
    </ToastProvider>
  </StrictMode>,
);

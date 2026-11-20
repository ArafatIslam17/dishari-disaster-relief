import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FIELD_ROLES, type Role } from '@relief/shared';
import { ApiError, api, onSessionExpired, refreshSession, setAccessToken } from '../api/client';
import { localStore, type LocalSession } from '../local/store';

export interface UserView {
  id: string;
  fullName: string;
  mobile: string;
  role: Role;
  status: string;
  organisationId: string | null;
  organisationName: string | null;
  mustChangePassword: boolean;
}

interface LoginResponse {
  accessToken: string;
  user: UserView;
  device: { id: string; prefix: string; recoveryKey: string };
  serverTime: string;
}

export type SessionStatus = 'booting' | 'anonymous' | 'needs-pin' | 'locked' | 'ready';

interface SessionValue {
  status: SessionStatus;
  /** Server identity; null when working offline on the field app. */
  user: UserView | null;
  /** Field-app identity stored on this phone. */
  local: LocalSession | null;
  role: Role | null;
  serverSession: boolean;
  isFieldUser: boolean;
  login(mobile: string, password: string): Promise<UserView>;
  unlock(pin: string): Promise<void>;
  setPin(pin: string): Promise<void>;
  logout(): Promise<void>;
  switchUser(): Promise<'blocked' | 'done'>;
  refreshUser(): Promise<void>;
  setOperation(operationId: string): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionProvider missing');
  return value;
}

const isField = (role: Role | null | undefined) => !!role && FIELD_ROLES.includes(role);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('booting');
  const [user, setUser] = useState<UserView | null>(null);
  const [local, setLocal] = useState<LocalSession | null>(null);

  const loadMe = useCallback(async () => {
    const me = await api.get<{ user: UserView }>('/api/auth/me');
    setUser(me.user);
    return me.user;
  }, []);

  // Boot: a phone with a field vault always asks for the PIN; others resume the server session.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = (await localStore.getSession()) ?? null;
      const vault = await localStore.vaultStatus();
      let me: UserView | null = null;
      if (await refreshSession()) me = await loadMe().catch(() => null);
      if (cancelled) return;
      setLocal(saved);
      if (saved && vault.hasPin) setStatus('locked');
      else if (me && !isField(me.role)) setStatus('ready');
      else setStatus('anonymous');
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMe]);

  // Back online after working offline: resume the server session silently (refresh cookie), so sync can run.
  useEffect(() => {
    if (status !== 'ready' || user) return;
    const resume = () => {
      void refreshSession().then((ok) => (ok ? loadMe().catch(() => undefined) : undefined));
    };
    if (navigator.onLine) resume();
    window.addEventListener('online', resume);
    return () => window.removeEventListener('online', resume);
  }, [status, user, loadMe]);

  useEffect(
    () =>
      onSessionExpired(() => {
        setAccessToken(null);
        setUser(null);
        // Field users keep working offline; dashboard users must log in again.
        setStatus((s) => (s === 'ready' && localStore.isUnlocked() ? 'ready' : 'anonymous'));
      }),
    [],
  );

  const login = useCallback(async (mobile: string, password: string): Promise<UserView> => {
    const attempt = async () =>
      api.post<LoginResponse>('/api/auth/login', {
        mobile,
        password,
        device: { id: await localStore.deviceId(), label: deviceLabel() },
      });
    let res: LoginResponse;
    try {
      res = await attempt();
    } catch (err) {
      // A8: this browser belongs to another volunteer. Hand it over only when nothing is unsynced.
      if (err instanceof ApiError && err.code === 'device_belongs_to_another_user' && (await localStore.pendingCount()) === 0) {
        await localStore.wipe();
        res = await attempt();
      } else throw err;
    }
    setAccessToken(res.accessToken);
    setUser(res.user);
    if (isField(res.user.role)) {
      const previous = await localStore.getSession();
      await localStore.openWithRecovery(res.device.recoveryKey);
      const session: LocalSession = {
        userId: res.user.id,
        fullName: res.user.fullName,
        role: res.user.role,
        organisationId: res.user.organisationId as string,
        organisationName: res.user.organisationName ?? '',
        deviceId: res.device.id,
        devicePrefix: res.device.prefix,
        lastOnlineAuthAt: new Date().toISOString(),
        operationId: previous?.userId === res.user.id ? previous.operationId : null,
      };
      await localStore.saveSession(session);
      setLocal(session);
      setStatus((await localStore.vaultStatus()).hasPin ? 'ready' : 'needs-pin');
    } else {
      setStatus('ready');
    }
    return res.user;
  }, []);

  const unlock = useCallback(
    async (pin: string) => {
      await localStore.unlockWithPin(pin);
      setStatus('ready');
      // Online again? Resume the server session silently so sync can run.
      if (navigator.onLine && (await refreshSession())) await loadMe().catch(() => undefined);
    },
    [loadMe],
  );

  const setPin = useCallback(async (pin: string) => {
    await localStore.setPin(pin);
    setStatus('ready');
  }, []);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    if (await localStore.getSession()) {
      localStore.lock();
      setStatus('locked');
    } else setStatus('anonymous');
  }, []);

  const switchUser = useCallback(async (): Promise<'blocked' | 'done'> => {
    if ((await localStore.pendingCount()) > 0) return 'blocked';
    await localStore.wipe();
    setLocal(null);
    setUser(null);
    setAccessToken(null);
    setStatus('anonymous');
    return 'done';
  }, []);

  const refreshUser = useCallback(async () => {
    await loadMe();
  }, [loadMe]);

  const setOperation = useCallback(async (operationId: string) => {
    const current = await localStore.getSession();
    if (!current) return;
    const next = { ...current, operationId };
    await localStore.saveSession(next);
    setLocal(next);
  }, []);

  const role = user?.role ?? local?.role ?? null;
  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      local,
      role,
      serverSession: user !== null,
      isFieldUser: isField(role),
      login,
      unlock,
      setPin,
      logout,
      switchUser,
      refreshUser,
      setOperation,
    }),
    [status, user, local, role, login, unlock, setPin, logout, switchUser, refreshUser, setOperation],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const model = /Android [\d.]+; ([^;)]+)/.exec(ua)?.[1];
  if (model) return model.slice(0, 40);
  if (/Windows/.test(ua)) return 'Windows browser';
  if (/Mac OS/.test(ua)) return 'Mac browser';
  return 'Browser';
}

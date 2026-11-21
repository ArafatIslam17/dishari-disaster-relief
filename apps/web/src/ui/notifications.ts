import { useTranslation } from 'react-i18next';

/** Turns a notification type and its parameters into a sentence (shared by the field app and the dashboard). */
export function useNotificationText() {
  const { t } = useTranslation();
  return (type: string, params: Record<string, string | number>) => {
    const p: Record<string, string | number> = { ...params };
    if (typeof p.field === 'string') p.field = t(`conflicts.fields.${p.field}`, { defaultValue: p.field });
    if (typeof p.label === 'string') p.label = t(`statuses.${p.label}`, { defaultValue: p.label });
    if (typeof p.decision === 'string') p.decision = t(`statuses.${p.decision}`, { defaultValue: p.decision });
    if (typeof p.reason === 'string') p.reason = t(`errors.${p.reason}`, { defaultValue: p.reason });
    return t(`notifications.types.${type}`, { ...p, defaultValue: type });
  };
}

/** Colour theme: follows the system unless the user picked light or dark on this device. */
export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'relief.theme';
const listeners = new Set<() => void>();

/** Browser chrome colour: Crisp Daylight in light, Radar Slate in dark (matches the app bars). */
const CHROME = { light: '#F9FAFC', dark: '#0D1117' } as const;

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

let choice: ThemeChoice = read();
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function resolvedTheme(): 'light' | 'dark' {
  if (choice === 'system') return media?.matches ? 'dark' : 'light';
  return choice;
}

function apply(): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[resolvedTheme()]);
  listeners.forEach((fn) => fn());
}

export function getTheme(): ThemeChoice {
  return choice;
}

export function setTheme(next: ThemeChoice): void {
  choice = next;
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    /* storage unavailable: the choice lasts for this visit */
  }
  apply();
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

media?.addEventListener('change', apply);
apply();

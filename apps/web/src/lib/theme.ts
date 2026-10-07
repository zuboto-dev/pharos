import { useEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';

const KEY = 'pharos-theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function readTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && media().matches);
  document.documentElement.classList.toggle('dark', dark);
}

const listeners = new Set<(theme: Theme) => void>();

/**
 * The colour theme, remembered per browser; "system" follows the OS setting live. Every caller
 * shares one theme, so the app shell keeps it applied while Settings changes it.
 */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    listeners.add(setTheme);
    return () => {
      listeners.delete(setTheme);
    };
  }, []);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const query = media();
    const onChange = () => applyTheme('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);

  const choose = (next: Theme) => {
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Storage can be unavailable (private windows); the choice then lasts for this page only.
    }
    for (const listener of listeners) listener(next);
  };
  return [theme, choose];
}

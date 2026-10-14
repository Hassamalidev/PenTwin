'use client';

import { useEffect, useState } from 'react';

const KEY = 'pentwin.theme';

/**
 * Runs in the page head before the first paint: applies a theme the visitor picked
 * earlier. With none picked, the device's light or dark setting is followed.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

type Theme = 'light' | 'dark';

const current = (): Theme => {
  const set = document.documentElement.getAttribute('data-theme');
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

/** Switches between light and dark, and remembers the choice in this browser. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>();
  useEffect(() => setTheme(current()), []);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => {
        document.documentElement.setAttribute('data-theme', next);
        try {
          localStorage.setItem(KEY, next);
        } catch {
          // Storage switched off: the choice lasts until the page is left.
        }
        setTheme(next);
      }}
    >
      {theme === 'dark' ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

/**
 * Funnel events: visit -> demo used -> signup -> sample uploaded -> first export -> paid.
 *
 * Only an event name and a few fixed, non-identifying properties ever leave the browser.
 * No text the user typed, no file name, no handwriting, no document content: the
 * allow-list below makes that a property of the code, not a matter of care at each call.
 */
export type FunnelEvent =
  'demo_used' | 'signup' | 'sample_uploaded' | 'first_export' | 'export_completed' | 'paid';

/** Every property that may be sent, with the values it may take. */
const ALLOWED = {
  source: ['home', 'tool', 'editor', 'sample', 'pricing'],
  style: ['neat', 'normal', 'rushed', 'exam', 'lecture'],
  plan: ['free', 'student', 'pro'],
  interval: ['month', 'year'],
  /** Page counts are sent as a range, never the exact number. */
  pages: ['1', '2-5', '6-20', '21+'],
  file: ['docx', 'pdf', 'txt', 'typed'],
} as const;

export type EventProps = { [K in keyof typeof ALLOWED]?: (typeof ALLOWED)[K][number] };

export const pageRange = (pages: number): NonNullable<EventProps['pages']> =>
  pages <= 1 ? '1' : pages <= 5 ? '2-5' : pages <= 20 ? '6-20' : '21+';

/** Drops anything that is not an allowed property with an allowed value. */
export function sanitizeProps(props: Record<string, unknown> = {}): EventProps {
  const clean: Record<string, string> = {};
  for (const [key, values] of Object.entries(ALLOWED)) {
    const value = props[key];
    if (typeof value === 'string' && (values as readonly string[]).includes(value)) {
      clean[key] = value;
    }
  }
  return clean as EventProps;
}

declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: Record<string, string> }) => void;
  }
}

/**
 * Records a funnel event. Does nothing unless an analytics script is loaded (it is only
 * loaded when NEXT_PUBLIC_PLAUSIBLE_DOMAIN is set), and never throws.
 */
export function track(event: FunnelEvent, props?: EventProps): void {
  if (typeof window === 'undefined') return;
  try {
    window.plausible?.(event, { props: sanitizeProps(props) as Record<string, string> });
  } catch {
    // Analytics must never break the app.
  }
}

/** Records an event the first time only on this device (for "first export"). */
export function trackOnce(event: FunnelEvent, props?: EventProps): void {
  if (typeof window === 'undefined') return;
  try {
    const key = `pentwin.tracked.${event}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch {
    // Storage unavailable: count it anyway.
  }
  track(event, props);
}

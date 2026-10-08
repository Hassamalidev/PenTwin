import { buildGlyphBank, type GlyphBank, type GlyphMetadata } from '@pentwin/engine';

/** A glyph bank as it is stored and sent to the export worker. */
export interface StoredBank {
  metadata: GlyphMetadata;
  files: Record<string, string>;
}

export interface LoadedBank {
  stored: StoredBank;
  bank: GlyphBank;
  /** True when this is the built-in demo handwriting, not the user's own. */
  isDemo: boolean;
}

const KEY = 'pentwin.bank.v1';

const build = (stored: StoredBank, isDemo: boolean): LoadedBank => ({
  stored,
  isDemo,
  bank: buildGlyphBank(stored.metadata, (file) => {
    const svg = stored.files[file];
    if (svg === undefined) throw new Error(`Missing glyph file "${file}"`);
    return svg;
  }),
});

/**
 * The user's own handwriting if they have made a sample on this device, otherwise the
 * demo handwriting. The bank is kept in this browser only; nothing is uploaded.
 */
export async function loadBank(): Promise<LoadedBank> {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return build(JSON.parse(saved) as StoredBank, false);
  } catch {
    // A damaged or outdated saved bank: fall back to the demo rather than break the app.
    localStorage.removeItem(KEY);
  }
  const response = await fetch('/demo-bank.json');
  if (!response.ok) throw new Error('The demo handwriting could not be loaded.');
  return build((await response.json()) as StoredBank, true);
}

/** The built-in demo handwriting, whatever the user has saved. */
export async function loadDemoBank(): Promise<LoadedBank> {
  const response = await fetch('/demo-bank.json');
  if (!response.ok) throw new Error('The demo handwriting could not be loaded.');
  return build((await response.json()) as StoredBank, true);
}

/** Saves the bank on this device. Throws if it is not a valid bank. */
export function saveBank(stored: StoredBank): LoadedBank {
  const loaded = build(stored, false);
  localStorage.setItem(KEY, JSON.stringify(stored));
  return loaded;
}

export function clearBank(): void {
  localStorage.removeItem(KEY);
}

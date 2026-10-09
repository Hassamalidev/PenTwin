'use client';

import type { PresetName } from '@pentwin/engine';
import { useEffect, useRef, useState } from 'react';
import { track, type EventProps } from '../lib/analytics';
import type { LoadedBank } from '../lib/bank';
import { DEMO_TEXTS, DEMO_VIEW } from '../lib/gallery';

const MAX_LENGTH = 400;
const STYLES: Partial<Record<PresetName, string>> = {
  neat: 'Neat',
  normal: 'Normal',
  rushed: 'Rushed',
};

/** The engine, the demo glyphs and the preview drawing: downloaded only when needed. */
const loadTools = () =>
  Promise.all([import('@pentwin/engine'), import('../lib/bank'), import('../lib/preview')]);

/**
 * The no-signup demo: type something, see it handwritten. It runs entirely in the
 * browser with the demo handwriting. It starts with a picture rendered when the site was
 * built; the engine and the glyphs are only downloaded once the demo is touched, so they
 * cost nothing while the page loads.
 */
export function LiveDemo({ source }: { source: keyof typeof DEMO_TEXTS }) {
  const [text, setText] = useState<string>(DEMO_TEXTS[source]);
  const [style, setStyle] = useState<PresetName>('normal');
  const [image, setImage] = useState(`/gallery/demo-${source}.png`);
  const [failed, setFailed] = useState(false);
  const [edited, setEdited] = useState(false);
  const bank = useRef<Promise<LoadedBank>>(undefined);

  /** Starts the downloads early, as soon as it looks like the demo will be used. */
  const warmUp = () => {
    void loadTools()
      .then(([, { loadDemoBank }]) => (bank.current ??= loadDemoBank()))
      .catch(() => undefined);
  };

  useEffect(() => {
    if (!edited) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const [{ renderText, presetOptions }, { loadDemoBank }, { rasterizePreview }] =
            await loadTools();
          bank.current ??= loadDemoBank();
          const loaded = await bank.current;
          const { pages } = renderText(text.slice(0, MAX_LENGTH), loaded.bank, {
            seed: 'demo',
            pageSize: 'A5',
            ...presetOptions(style),
            corrections: 0,
            margins: { top: 8, left: 12, right: 12 },
          });
          // The top of the page is enough for a few lines of text.
          const url = await rasterizePreview({ ...pages[0]!, height: DEMO_VIEW.height }, 'DEMO');
          if (cancelled) return;
          setImage(url);
          setFailed(false);
          track('demo_used', { source, style: style as EventProps['style'] });
        } catch {
          if (!cancelled) setFailed(true);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [edited, text, style, source]);

  return (
    <div className="card demo" data-testid="live-demo" onPointerEnter={warmUp}>
      <div className="demo-controls">
        <div className="field">
          <label>
            Your text
            <textarea
              rows={4}
              maxLength={MAX_LENGTH}
              value={text}
              data-testid="demo-text"
              onFocus={warmUp}
              onChange={(event) => {
                setEdited(true);
                setText(event.target.value);
              }}
            />
          </label>
        </div>
        <div className="field">
          <label>
            Writing style
            <select
              value={style}
              data-testid="demo-style"
              onFocus={warmUp}
              onChange={(event) => {
                setEdited(true);
                setStyle(event.target.value as PresetName);
              }}
            >
              {Object.entries(STYLES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <a className="button primary" href="/sample">
          Use my own handwriting
        </a>
        {failed && (
          <p className="error" role="alert">
            The demo could not be loaded. Please reload the page.
          </p>
        )}
        <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
          This demo uses a sample handwriting. No sign-up, and nothing you type leaves your browser.
        </p>
      </div>
      <div className="demo-paper">
        <div className="preview">
          {/* Either a small picture made at build time or a data URL made in the browser:
              nothing for the image optimiser to do. */}
          <img
            src={image}
            width={DEMO_VIEW.pixels}
            height={Math.round((DEMO_VIEW.pixels * DEMO_VIEW.height) / DEMO_VIEW.width)}
            loading="lazy"
            alt="Your text in the demo handwriting"
            data-testid="demo-image"
          />
        </div>
      </div>
    </div>
  );
}

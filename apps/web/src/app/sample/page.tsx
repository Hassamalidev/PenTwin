'use client';

import { buildGlyphBank, renderText, REQUIRED_CHARS } from '@pentwin/engine';
import {
  applyFallbacks,
  buildSampleSheet,
  buildTopUpSheet,
  extractGlyphBank,
  extractTopUp,
  mergeTopUp,
  SAMPLE,
  SAMPLE_INSTRUCTIONS,
  sampleTextOf,
  type ExtractedBank,
  type QualityIssue,
} from '@pentwin/extractor';
import { BRAND } from '@pentwin/shared';
import { useEffect, useMemo, useState } from 'react';
import { track } from '../../lib/analytics';
import { clearBank, saveBank } from '../../lib/bank';
import { downloadBytes, readPhoto } from '../../lib/photo';
import { rasterizePreview } from '../../lib/preview';

type Status = 'strong' | 'weak' | 'derived' | 'missing';

const STATUS_TEXT: Record<Status, string> = {
  strong: 'good',
  weak: 'few samples',
  derived: 'made up',
  missing: 'missing',
};

const svgUrl = (svg: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Lets the page repaint ("Reading your handwriting...") before heavy work blocks it. */
const nextFrame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

export default function SamplePage() {
  /** The user's own glyphs only: what was cut from their photos, minus anything they removed. */
  const [own, setOwn] = useState<ExtractedBank>();
  const [working, setWorking] = useState<string>();
  const [issues, setIssues] = useState<QualityIssue[]>([]);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [seconds, setSeconds] = useState<number>();
  const [selected, setSelected] = useState<string>();
  const [sentence, setSentence] = useState(
    'The quick brown fox jumps over the lazy dog. 0123456789',
  );
  const [testUrl, setTestUrl] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState(false);

  // The bank as it will be used: the user's glyphs plus stand-ins for the gaps.
  const filled = useMemo(() => (own ? applyFallbacks(own) : undefined), [own]);

  const statusOf = (char: string): Status => {
    const variants = filled?.bank.metadata.glyphs[char] ?? [];
    const handwritten = variants.filter((v) => !v.derivedFrom).length;
    if (variants.length === 0) return 'missing';
    if (handwritten === 0) return 'derived';
    return handwritten >= 3 ? 'strong' : 'weak';
  };

  // Live test sentence, written with the bank as it stands.
  useEffect(() => {
    if (!filled) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { metadata, files } = filled.bank;
          const bank = buildGlyphBank(metadata, (file) => files[file]!);
          const { pages } = renderText(sentence, bank, {
            seed: 'review',
            pageSize: 'A5',
            lineHeight: 11,
            margins: { top: 8, bottom: 8, left: 10, right: 10 },
          });
          // Only the top of the page holds the sentence.
          const scene = { ...pages[0]!, height: Math.min(pages[0]!.height, 70) };
          const url = await rasterizePreview(scene, '');
          if (!cancelled) setTestUrl(url);
        } catch {
          if (!cancelled) setTestUrl(undefined);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filled, sentence]);

  const reset = (): void => {
    setOwn(undefined);
    setIssues([]);
    setError(undefined);
    setNote(undefined);
    setSelected(undefined);
    setSaved(false);
  };

  const onSamplePhoto = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    reset();
    setWorking('Reading your handwriting...');
    await nextFrame();
    const started = performance.now();
    try {
      const photo = await readPhoto(file);
      const result = extractGlyphBank(photo, sampleTextOf(SAMPLE));
      if (!result.bank) {
        setIssues(result.quality.issues);
        if (result.quality.issues.length === 0) {
          setError('We could not match the writing in this photo to the text. Please retake it.');
        }
        return;
      }
      setOwn(result.bank);
      track('sample_uploaded', { source: 'sample' });
      setSeconds((performance.now() - started) / 1000);
      const joined = result.flagged.filter((f) => f.reason === 'letters-joined').length;
      if (joined > 40) {
        setNote(
          'Many of your letters are joined together. Joined-up writing is not fully supported yet: ' +
            'letters we could not separate were left out. Writing with the letters apart gives a better result.',
        );
      }
    } catch (caught) {
      setError((caught as Error).message || 'This photo could not be processed.');
    } finally {
      setWorking(undefined);
    }
  };

  const topUpChars = filled ? [...filled.topUp.required, ...filled.topUp.recommended] : [];

  const onTopUpPhoto = async (file: File | undefined): Promise<void> => {
    if (!file || !own) return;
    setError(undefined);
    setWorking('Reading the extra characters...');
    await nextFrame();
    try {
      const result = extractTopUp(await readPhoto(file), topUpChars);
      if (!result.bank) {
        setIssues(result.quality.issues.filter((issue) => issue.code !== 'no-writing'));
        setError('We could not read the extra characters from this photo. Please retake it.');
        return;
      }
      const merged = mergeTopUp(own, result.bank, topUpChars);
      setOwn(merged.bank);
      const gained = Object.keys(merged.added).length;
      setNote(
        gained > 0
          ? `Added your own writing for ${gained} character${gained === 1 ? '' : 's'}.`
          : 'None of the extra characters could be read from this photo.',
      );
    } catch (caught) {
      setError((caught as Error).message || 'This photo could not be processed.');
    } finally {
      setWorking(undefined);
    }
  };

  /** Throws away one glyph the user does not like; the gaps are refilled automatically. */
  const removeVariant = (char: string, file: string): void => {
    if (!own) return;
    const metadata = structuredClone(own.metadata);
    const left = (metadata.glyphs[char] ?? []).filter((v) => v.file !== file);
    if (left.length > 0) metadata.glyphs[char] = left;
    else delete metadata.glyphs[char];
    setOwn({ metadata, files: own.files });
    setSaved(false);
  };

  const save = (): void => {
    if (!filled) return;
    try {
      saveBank(filled.bank);
      setSaved(true);
    } catch {
      setError('Your handwriting could not be saved on this device (storage may be full).');
    }
  };

  const photoButton = (label: string, testId: string, onPick: (file?: File) => Promise<void>) => (
    <label className="file-button primary">
      {label}
      <input
        className="photo-input"
        type="file"
        accept="image/*"
        data-testid={testId}
        disabled={working !== undefined}
        onChange={(event) => {
          void onPick(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </label>
  );

  const counts = REQUIRED_CHARS.reduce(
    (totals, char) => ({ ...totals, [statusOf(char)]: totals[statusOf(char)] + 1 }),
    { strong: 0, weak: 0, derived: 0, missing: 0 } as Record<Status, number>,
  );
  const selectedVariants = selected ? (filled?.bank.metadata.glyphs[selected] ?? []) : [];

  return (
    <div className="panel narrow">
      <h1>My handwriting</h1>

      {!own && (
        <section>
          <p className="lead">
            Write one short text by hand, take a photo, and {BRAND.name} learns your letters from
            it. The photo is processed on this device and is not uploaded.
          </p>
          <ol className="steps">
            {SAMPLE_INSTRUCTIONS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <div className="row">
            <button
              type="button"
              onClick={() =>
                void buildSampleSheet(SAMPLE).then((pdf) =>
                  downloadBytes(pdf, 'handwriting-sample-sheet.pdf', 'application/pdf'),
                )
              }
            >
              Get the text to copy (PDF)
            </button>
            {photoButton('Take or choose a photo', 'sample-photo', onSamplePhoto)}
          </div>
        </section>
      )}

      {working && (
        <p className="notice" role="status" data-testid="working">
          {working}
        </p>
      )}
      {issues.length > 0 && (
        <div className="notice" role="alert" data-testid="photo-issues">
          <strong>Please retake the photo</strong>
          <ul>
            {issues.map((issue) => (
              <li key={issue.code}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {note && <p className="notice">{note}</p>}

      {own && filled && (
        <section data-testid="review">
          <h2>Check your letters</h2>
          <p className="muted" data-testid="review-summary">
            {counts.strong} good, {counts.weak} with few samples, {counts.derived} made up from your
            other letters, {counts.missing} missing.
            {seconds !== undefined && ` Read in ${seconds.toFixed(1)} seconds.`}
          </p>

          <div className="field">
            <label>
              Try a sentence
              <input
                type="text"
                value={sentence}
                onChange={(event) => setSentence(event.target.value)}
                style={{ width: '100%' }}
              />
            </label>
          </div>
          {testUrl && (
            <div className="preview" style={{ marginBottom: '0.75rem' }}>
              <img
                src={testUrl}
                alt="Your test sentence in your handwriting"
                data-testid="test-sentence"
              />
            </div>
          )}

          <p className="muted">
            Tap a letter that looks wrong to see its samples and remove bad ones.
          </p>
          <div className="glyph-grid" data-testid="glyph-grid">
            {REQUIRED_CHARS.map((char) => {
              const status = statusOf(char);
              const first = filled.bank.metadata.glyphs[char]?.[0];
              return (
                <button
                  type="button"
                  key={char}
                  className={`glyph-card ${status}${selected === char ? ' selected' : ''}`}
                  data-testid={`glyph-${char.codePointAt(0)}`}
                  data-status={status}
                  onClick={() => setSelected(selected === char ? undefined : char)}
                >
                  <span className="char">{char}</span>
                  {first ? (
                    <img src={svgUrl(filled.bank.files[first.file] ?? '')} alt="" />
                  ) : (
                    <span className="thumb-empty">?</span>
                  )}
                  <span className="state">{STATUS_TEXT[status]}</span>
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="panel glyph-detail" data-testid="glyph-detail">
              <h2>Samples of &ldquo;{selected}&rdquo;</h2>
              {selectedVariants.length === 0 && (
                <p className="muted">
                  There is no sample of this character. Write it on a top-up sheet below.
                </p>
              )}
              <div className="glyph-grid">
                {selectedVariants.map((variant) => (
                  <div className="glyph-card" key={variant.file}>
                    <img src={svgUrl(filled.bank.files[variant.file] ?? '')} alt="" />
                    {variant.derivedFrom ? (
                      <span className="state">from {variant.derivedFrom}</span>
                    ) : (
                      <button
                        type="button"
                        className="small"
                        data-testid="remove-variant"
                        onClick={() => removeVariant(selected, variant.file)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {topUpChars.length > 0 && (
            <div className="notice" data-testid="top-up">
              <strong>
                {topUpChars.length} character{topUpChars.length === 1 ? '' : 's'} could be better
              </strong>
              <p style={{ margin: '0.25rem 0' }}>
                Not in your sample, or made up from other letters: {topUpChars.join(' ')}. Write
                them on a short extra sheet to use your own.
              </p>
              <div className="row">
                <button
                  type="button"
                  onClick={() =>
                    void buildTopUpSheet(topUpChars).then((pdf) =>
                      downloadBytes(pdf, 'handwriting-top-up-sheet.pdf', 'application/pdf'),
                    )
                  }
                >
                  Get the top-up sheet (PDF)
                </button>
                {photoButton('Photo of the top-up sheet', 'top-up-photo', onTopUpPhoto)}
              </div>
            </div>
          )}

          <label className="row" style={{ margin: '0.75rem 0' }}>
            <input
              type="checkbox"
              checked={confirmed}
              data-testid="own-handwriting"
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>This is my own handwriting.</span>
          </label>
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={!confirmed}
              onClick={save}
              data-testid="save-bank"
            >
              Use this handwriting
            </button>
            {photoButton('Retake the photo', 'retake-photo', onSamplePhoto)}
          </div>
          {saved && (
            <p data-testid="saved">
              Saved on this device. <a href="/editor">Open the editor</a>
            </p>
          )}
        </section>
      )}

      <p className="muted" style={{ marginTop: '1rem' }}>
        Your handwriting is kept in this browser only.{' '}
        <button
          type="button"
          className="small"
          onClick={() => {
            clearBank();
            reset();
          }}
        >
          Delete it from this device
        </button>
      </p>
    </div>
  );
}

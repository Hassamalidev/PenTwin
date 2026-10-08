'use client';

import {
  quoteExport,
  renderDocument,
  type Block,
  type ExportQuote,
  type InkName,
  type PaperSpec,
  type PresetName,
  type Ruling,
} from '@pentwin/engine';
import {
  contentToMarkup,
  describeProblems,
  markupToContent,
  normalizeBlocks,
  textToBlocks,
} from '@pentwin/importers';
import { BRAND, type PageSizeName } from '@pentwin/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { pageRange, track, trackOnce } from '../../lib/analytics';
import { loadBank, type LoadedBank } from '../../lib/bank';
import { ACCEPTED_FILES, importFile } from '../../lib/import-file';
import { rasterizePreview } from '../../lib/preview';
import {
  applyPreset,
  DEFAULT_SETTINGS,
  INK_LABELS,
  PAPER_LABELS,
  PRESET_LABELS,
  toRenderOptions,
  type Settings,
} from '../../lib/settings';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'http://localhost:8787';

type EditorBlock = Block & { id: number };

const STARTER =
  'This is your handwriting preview. Replace this text with your own, or upload a Word or PDF file.\n\n' +
  'The preview on this page is free and updates as you type. Exporting gives you the full quality PDF.';

/** The block as the engine and the worker know it, without the editor's own id. */
function stripId(block: EditorBlock): Block {
  const copy: Partial<EditorBlock> = { ...block };
  delete copy.id;
  return copy as Block;
}

const BLOCK_NAMES: Record<Block['type'], string> = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  list: 'List',
  table: 'Table',
  image: 'Picture',
  pageBreak: 'Page break',
};

/** A block's text as shown in its edit box. */
function blockToText(block: Block): string {
  switch (block.type) {
    case 'heading':
      return block.text;
    case 'paragraph':
      return contentToMarkup(block.text);
    case 'list':
      return block.items.map(contentToMarkup).join('\n');
    case 'table':
      return block.rows.map((row) => row.join(' | ')).join('\n');
    default:
      return '';
  }
}

/** The block with the edit box's text put back into it. */
function withText<T extends Block>(block: T, text: string): T {
  switch (block.type) {
    case 'heading':
      return { ...block, text: text.replace(/\n/g, ' ') };
    case 'paragraph':
      return { ...block, text: markupToContent(text.replace(/\n/g, ' ')) };
    case 'list':
      return { ...block, items: text.split('\n').map(markupToContent) };
    case 'table':
      return { ...block, rows: text.split('\n').map((row) => row.split('|').map((c) => c.trim())) };
    default:
      return block;
  }
}

interface ExportState {
  status: 'idle' | 'working' | 'done' | 'failed';
  message?: string;
  downloadUrl?: string;
  pageCount?: number;
  billablePages?: number;
}

export default function EditorPage() {
  const nextId = useRef(1);
  const withIds = (blocks: Block[]): EditorBlock[] =>
    blocks.map((block) => ({ ...block, id: nextId.current++ }));

  const [loaded, setLoaded] = useState<LoadedBank>();
  const [loadError, setLoadError] = useState<string>();
  const [blocks, setBlocks] = useState<EditorBlock[]>(() => withIds(textToBlocks(STARTER)));
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importError, setImportError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [previewError, setPreviewError] = useState<string>();
  const [problems, setProblems] = useState<string[]>([]);

  const [quote, setQuote] = useState<ExportQuote>();
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' });

  useEffect(() => {
    loadBank().then(setLoaded, (error: Error) => setLoadError(error.message));
  }, []);

  const options = useMemo(() => toRenderOptions(settings), [settings]);

  // What actually gets written: the blocks without editor bookkeeping, with typographic
  // characters made plain. The same list feeds the preview, the quote and the export.
  const prepared = useMemo(() => {
    if (!loaded) return undefined;
    const plain = blocks.map(stripId);
    return normalizeBlocks(plain, (char) => loaded.bank.glyphs.has(char));
  }, [blocks, loaded]);

  // Live preview, redrawn shortly after the last change.
  useEffect(() => {
    if (!loaded || !prepared) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { pages } = renderDocument(prepared.blocks, loaded.bank, options);
          const index = Math.min(pageIndex, pages.length - 1);
          const url = await rasterizePreview(pages[index]!, 'PREVIEW');
          if (cancelled) return;
          setPageCount(pages.length);
          if (index !== pageIndex) setPageIndex(index);
          setPreviewUrl(url);
          setPreviewError(undefined);
          setProblems(describeProblems(prepared));
        } catch (error) {
          if (!cancelled) setPreviewError((error as Error).message);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loaded, prepared, options, pageIndex]);

  const update = (id: number, change: (block: EditorBlock) => EditorBlock): void =>
    setBlocks((list) => list.map((block) => (block.id === id ? change(block) : block)));
  const remove = (id: number): void => setBlocks((list) => list.filter((b) => b.id !== id));
  const insertAfter = (id: number, block: Block): void =>
    setBlocks((list) => {
      const at = list.findIndex((b) => b.id === id);
      return [...list.slice(0, at + 1), ...withIds([block]), ...list.slice(at + 1)];
    });
  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void =>
    setSettings((current) => ({ ...current, [key]: value }));

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy(true);
    setImportError(undefined);
    try {
      const result = await importFile(file);
      if (result.blocks.length === 0) {
        throw new Error('No text was found in this file.');
      }
      setBlocks(withIds(result.blocks));
      setImportWarnings(result.warnings);
      setPageIndex(0);
    } catch (error) {
      setImportError((error as Error).message || 'This file could not be read.');
    } finally {
      setBusy(false);
    }
  };

  const openExport = (): void => {
    if (!loaded || !prepared) return;
    setQuote(quoteExport(prepared.blocks, loaded.bank, options));
    setExportState({ status: 'idle' });
  };

  const runExport = async (): Promise<void> => {
    if (!loaded || !prepared) return;
    setExportState({ status: 'working' });
    try {
      const response = await fetch(`${WORKER_URL}/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blocks: prepared.blocks, bank: loaded.stored, options }),
      });
      const body = (await response.json()) as {
        error?: string;
        downloadPath?: string;
        pageCount?: number;
        billablePages?: number;
      };
      if (!response.ok || !body.downloadPath) {
        throw new Error(body.error ?? 'The export failed. Nothing was charged.');
      }
      const pages = pageRange(body.pageCount ?? 1);
      trackOnce('first_export', { source: 'editor', pages });
      track('export_completed', { source: 'editor', pages, style: settings.preset });
      setExportState({
        status: 'done',
        downloadUrl: `${WORKER_URL}${body.downloadPath}`,
        pageCount: body.pageCount,
        billablePages: body.billablePages,
      });
    } catch (error) {
      const message =
        error instanceof TypeError
          ? 'The export service could not be reached. Nothing was charged. Please try again.'
          : (error as Error).message;
      setExportState({ status: 'failed', message });
    }
  };

  if (loadError) return <p className="error">{loadError}</p>;
  if (!loaded) return <p className="muted">Loading your handwriting...</p>;

  return (
    <div className="editor">
      <section className="panel text-panel" aria-label="Your text">
        <h1>Editor</h1>
        {loaded.isDemo && (
          <p className="notice" data-testid="demo-notice">
            You are using the demo handwriting. <a href="/sample">Add your own handwriting</a> to
            write in yours.
          </p>
        )}

        <div className="row">
          <label className="file-button">
            {busy ? 'Reading...' : 'Upload Word or PDF'}
            <input
              className="photo-input"
              type="file"
              accept={ACCEPTED_FILES}
              disabled={busy}
              data-testid="file-input"
              onChange={(event) => {
                void onFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </label>
          <button
            type="button"
            onClick={() =>
              setBlocks((list) => [...list, ...withIds([{ type: 'paragraph', text: '' }])])
            }
          >
            Add paragraph
          </button>
        </div>
        {importError && (
          <p className="error" role="alert">
            {importError}
          </p>
        )}
        {importWarnings.length > 0 && (
          <div className="notice">
            <ul>
              {importWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        <div data-testid="blocks" style={{ marginTop: '0.75rem' }}>
          {blocks.map((block) => (
            <BlockEditor
              key={block.id}
              block={block}
              onChange={(change) => update(block.id, change)}
              onRemove={() => remove(block.id)}
              onBreakAfter={() => insertAfter(block.id, { type: 'pageBreak' })}
            />
          ))}
        </div>
      </section>

      <section className="preview-column" aria-label="Preview and settings">
        <div className="panel preview-panel">
          <div className="preview" data-testid="preview">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={`Preview of page ${pageIndex + 1}`}
                data-testid="preview-image"
              />
            ) : (
              <p className="muted" style={{ padding: '2rem' }}>
                Drawing the preview...
              </p>
            )}
          </div>
          {previewError && (
            <p className="error" role="alert">
              {previewError}
            </p>
          )}
          <div className="row pager">
            <button
              type="button"
              className="small"
              disabled={pageIndex === 0}
              onClick={() => setPageIndex((i) => i - 1)}
            >
              Previous
            </button>
            <span data-testid="page-count">
              Page {pageIndex + 1} of {pageCount}
            </span>
            <button
              type="button"
              className="small"
              disabled={pageIndex >= pageCount - 1}
              onClick={() => setPageIndex((i) => i + 1)}
            >
              Next
            </button>
          </div>

          {problems.length > 0 && (
            <div className="notice" data-testid="problems">
              <strong>Check before you export</strong>
              <ul>
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="row" style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              className="primary"
              onClick={openExport}
              data-testid="export-open"
            >
              Export PDF
            </button>
            <button
              type="button"
              onClick={() => set('seed', settings.seed + 1)}
              data-testid="reroll"
            >
              Reroll look
            </button>
          </div>
        </div>

        <div className="panel settings-panel">
          <h2>Settings</h2>
          <Select
            label="Writing style"
            testId="preset"
            value={settings.preset}
            options={PRESET_LABELS}
            onChange={(value) => setSettings((s) => applyPreset(s, value as PresetName))}
          />
          <Select
            label="Pen"
            value={settings.ink}
            options={INK_LABELS}
            onChange={(value) => set('ink', value as InkName | 'preset')}
          />
          <Select
            label="Paper"
            testId="paper"
            value={settings.paper}
            options={PAPER_LABELS}
            onChange={(value) => set('paper', value as PaperSpec['kind'])}
          />
          {settings.paper === 'ruled' && (
            <Select
              label="Line spacing"
              value={settings.ruling}
              options={{ narrow: 'Narrow', college: 'College', wide: 'Wide' }}
              onChange={(value) => set('ruling', value as Ruling)}
            />
          )}
          <Select
            label="Page size"
            value={settings.pageSize}
            options={{ A4: 'A4', Letter: 'Letter', A5: 'A5' }}
            onChange={(value) => set('pageSize', value as PageSizeName)}
          />
          <Slider
            label="Writing size"
            value={settings.size}
            min={0.28}
            max={0.42}
            step={0.01}
            onChange={(v) => set('size', v)}
          />
          <Slider
            label="Unevenness"
            value={settings.unevenness}
            min={0.4}
            max={1.6}
            step={0.05}
            onChange={(v) => set('unevenness', v)}
          />
          <Slider
            label="Tiredness down the page"
            value={settings.fatigue}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => set('fatigue', v)}
          />
          <Slider
            label="Corrections"
            value={settings.corrections}
            min={0}
            max={0.05}
            step={0.005}
            onChange={(v) => set('corrections', v)}
          />
          <label className="row">
            <input
              type="checkbox"
              checked={settings.marginLine}
              onChange={(e) => set('marginLine', e.target.checked)}
            />
            Margin line
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={settings.pageNumbers}
              onChange={(e) => set('pageNumbers', e.target.checked)}
            />
            Page numbers
          </label>
        </div>
      </section>

      {quote && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Export"
          data-testid="export-dialog"
        >
          <div className="dialog">
            <h2>Export PDF</h2>
            <p className="cost" data-testid="quote">
              {quote.pageCount} {quote.pageCount === 1 ? 'page' : 'pages'}, {quote.credits}{' '}
              {quote.credits === 1 ? 'credit' : 'credits'}
            </p>
            <p className="muted">1 credit = 1 page. Previews are free.</p>
            <ul className="summary">
              {quote.settings.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {problems.length > 0 && (
              <div className="notice">
                <ul>
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            )}

            {exportState.status === 'failed' && (
              <p className="error" role="alert" data-testid="export-error">
                {exportState.message}
              </p>
            )}
            {exportState.status === 'done' && (
              <p data-testid="export-result">
                Your PDF is ready: {exportState.pageCount}{' '}
                {exportState.pageCount === 1 ? 'page' : 'pages'}
                {exportState.billablePages === 0 ? ' (same as a recent export, so free)' : ''}.
              </p>
            )}

            <div className="row">
              {exportState.status === 'done' ? (
                <a className="file-button" href={exportState.downloadUrl} data-testid="download">
                  Download PDF
                </a>
              ) : (
                <button
                  type="button"
                  className="primary"
                  disabled={exportState.status === 'working'}
                  onClick={() => void runExport()}
                  data-testid="export-confirm"
                >
                  {exportState.status === 'working' ? 'Exporting...' : 'Export'}
                </button>
              )}
              <button type="button" onClick={() => setQuote(undefined)}>
                Close
              </button>
            </div>
            <p className="muted" style={{ marginTop: '0.75rem' }}>
              {BRAND.name} writes in your own handwriting. Please do not use it to copy someone
              else&apos;s.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function BlockEditor({
  block,
  onChange,
  onRemove,
  onBreakAfter,
}: {
  block: EditorBlock;
  onChange: (change: (block: EditorBlock) => EditorBlock) => void;
  onRemove: () => void;
  onBreakAfter: () => void;
}) {
  if (block.type === 'pageBreak') {
    return (
      <div className="block page-break" data-testid="block-pageBreak">
        <div className="block-head">
          <span>Page break</span>
          <button type="button" className="small" onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
    );
  }

  const hints: Partial<Record<Block['type'], string>> = {
    paragraph: 'Use **bold** and *italic*.',
    list: 'One item per line.',
    table: 'One row per line, cells separated by |',
  };

  return (
    <div className={`block${block.skip ? ' skipped' : ''}`} data-testid={`block-${block.type}`}>
      <div className="block-head">
        <span>
          {BLOCK_NAMES[block.type]}
          {block.skip ? ' (left out)' : ''}
        </span>
        <span className="row">
          <button
            type="button"
            className="small"
            onClick={() => onChange((b) => ({ ...b, skip: !b.skip }))}
          >
            {block.skip ? 'Include' : 'Leave out'}
          </button>
          <button type="button" className="small" onClick={onBreakAfter}>
            Break after
          </button>
          <button type="button" className="small" onClick={onRemove} aria-label="Remove block">
            Remove
          </button>
        </span>
      </div>

      {block.type === 'image' ? (
        <img
          src={block.href}
          alt="Picture from the document"
          style={{ maxWidth: '100%', maxHeight: 160 }}
        />
      ) : (
        <textarea
          rows={block.type === 'heading' ? 1 : 3}
          value={blockToText(block)}
          aria-label={BLOCK_NAMES[block.type]}
          onChange={(event) => onChange((b) => withText(b, event.target.value))}
        />
      )}
      {hints[block.type] && (
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          {hints[block.type]}
        </span>
      )}

      {block.type === 'heading' && (
        <div className="row" style={{ marginTop: '0.4rem' }}>
          <label className="row" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={block.underline ?? (block.level ?? 1) === 1}
              onChange={(event) =>
                onChange((b) =>
                  b.type === 'heading' ? { ...b, underline: event.target.checked } : b,
                )
              }
            />
            Underline
          </label>
          <select
            aria-label="Heading size"
            value={String(block.scale ?? ((block.level ?? 1) === 1 ? 1.35 : 1.15))}
            onChange={(event) =>
              onChange((b) =>
                b.type === 'heading' ? { ...b, scale: Number(event.target.value) } : b,
              )
            }
          >
            <option value="1">Same as text</option>
            <option value="1.15">Slightly larger</option>
            <option value="1.35">Larger</option>
            <option value="1.6">Much larger</option>
          </select>
        </div>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  options: Record<string, string>;
  onChange: (value: string) => void;
  testId?: string;
}) {
  return (
    <div className="field">
      <label>
        {label}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          data-testid={testId}
        >
          {Object.entries(options).map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="field">
      <label>
        {label}
        <input
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </label>
    </div>
  );
}

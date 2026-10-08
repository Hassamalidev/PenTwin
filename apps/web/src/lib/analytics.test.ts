import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageRange, sanitizeProps, track } from './analytics';

describe('analytics', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lets through only allowed properties with allowed values', () => {
    expect(
      sanitizeProps({
        source: 'home',
        style: 'neat',
        plan: 'student',
        pages: '2-5',
        file: 'docx',
      }),
    ).toEqual({ source: 'home', style: 'neat', plan: 'student', pages: '2-5', file: 'docx' });
  });

  it('drops document content, file names and anything free-form', () => {
    expect(
      sanitizeProps({
        text: 'My essay about the water cycle',
        fileName: 'sara-khan-biology.docx',
        email: 'sara@example.com',
        source: 'My essay about the water cycle', // an allowed key with a free-text value
        pages: 37, // the exact number, not a range
        style: { nested: 'neat' },
        file: 'DOCX',
      }),
    ).toEqual({});
    expect(sanitizeProps()).toEqual({});
  });

  it('reports page counts as ranges', () => {
    expect([1, 2, 5, 6, 20, 21, 400].map(pageRange)).toEqual([
      '1',
      '2-5',
      '2-5',
      '6-20',
      '6-20',
      '21+',
      '21+',
    ]);
  });

  it('sends the event name and the cleaned properties, and nothing else', () => {
    const plausible = vi.fn();
    vi.stubGlobal('window', { plausible });
    track('demo_used', { source: 'home', ...({ text: 'secret words' } as object) });
    expect(plausible).toHaveBeenCalledWith('demo_used', { props: { source: 'home' } });
  });

  it('does nothing without an analytics script, and never throws', () => {
    vi.stubGlobal('window', {});
    expect(() => track('first_export', { pages: '1' })).not.toThrow();
    vi.stubGlobal('window', {
      plausible: () => {
        throw new Error('blocked');
      },
    });
    expect(() => track('paid', { plan: 'pro' })).not.toThrow();
  });
});

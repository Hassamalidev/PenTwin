import { describe, expect, it } from 'vitest';
import { BRAND } from './index';

describe('shared', () => {
  it('exports the brand', () => {
    expect(BRAND.name).not.toBe('');
  });
});

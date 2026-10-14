import { describe, expect, it } from 'vitest';
import { NO_JITTER } from './jitter';
import { presetOptions, PRESETS, type PresetName } from './presets';
import { renderText } from './render';
import { auditTells, judgeTells } from './tells';
import { loadSampleBank } from './testing';

/**
 * The tell audit as a gate: a mechanical page must fail it, and no style may regress.
 * `pnpm tells` prints the full table, with the demo handwriting too.
 */
const bank = loadSampleBank();
const TEXT =
  'It is quite likely that the first trial will be discarded, since the timer started late ' +
  'and the liquid had not settled. In the second and third trials the readings were within ' +
  'a minute of each other, which is fine for this initial test. Write it in the notebook, ' +
  'tick it off the list and fix a time to finish the remaining items with the instructor.';
const X_HEIGHT = 3;
const base = { seed: 'tells', pageSize: 'A4', xHeight: X_HEIGHT } as const;

describe('tell audit', () => {
  it('catches every tell on a page with no variation', () => {
    const { pages } = renderText(TEXT, bank, { ...base, jitter: NO_JITTER });
    const verdicts = judgeTells(auditTells(pages, X_HEIGHT));
    expect(verdicts.filter((v) => v.pass).map((v) => v.name)).toEqual([]);
  });

  it.each(Object.keys(PRESETS) as PresetName[])('passes every tell in the %s style', (name) => {
    const { pages } = renderText(TEXT, bank, { ...base, ...presetOptions(name) });
    const failed = judgeTells(auditTells(pages, X_HEIGHT)).filter((v) => !v.pass);
    expect(failed.map((v) => `${v.name}: ${v.value}`)).toEqual([]);
  });

  it('does not judge the pen of handwriting made of filled outlines', () => {
    const filled = { ...bank, paint: 'fill' as const };
    const { pages } = renderText(TEXT, filled, { ...base, ...presetOptions('normal') });
    expect(auditTells(pages, X_HEIGHT).penVariation).toBeUndefined();
  });
});

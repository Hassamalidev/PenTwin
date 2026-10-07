/**
 * Measures labeling and cutting accuracy on synthetic sample photos and prints a
 * Markdown table (the one in docs/extraction-accuracy.md).
 *
 *   pnpm extract:measure
 */
import { PRESETS } from '../packages/engine/src/index';
import {
  CONDITIONS,
  degrade,
  extractLabels,
  renderSamplePage,
  scoreAlignment,
  type Degradation,
  type SamplePage,
} from '../packages/extractor/src/testing';

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const standard = renderSamplePage();

const cases: [name: string, page: SamplePage, condition: Degradation][] = [
  ...Object.entries(CONDITIONS).map(([name, d]): [string, SamplePage, Degradation] => [
    `${name} photo`,
    standard,
    d,
  ]),
  ['neat writing', renderSamplePage({ jitter: PRESETS.neat, seed: 'neat' }), CONDITIONS.good!],
  [
    'rushed writing',
    renderSamplePage({ jitter: PRESETS.rushed, seed: 'rushed' }),
    CONDITIONS.good!,
  ],
  [
    'touching letters',
    renderSamplePage({ jitter: { ...PRESETS.normal, tracking: -0.12 }, seed: 't' }),
    CONDITIONS.good!,
  ],
];

console.log(
  '| Case | Lines | Labeled correctly | Labeled wrongly | Left out | Clean cuts | Split | Merged | Pairs refused |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [name, page, condition] of cases) {
  const { alignment, page: segmented } = extractLabels(degrade(page.gray, condition));
  const score = scoreAlignment(alignment.glyphs, page.truth);
  const count = (cut: string): number => alignment.glyphs.filter((g) => g.cut === cut).length;
  const refused = alignment.flagged.filter((f) => f.reason === 'letters-joined').length;
  console.log(
    `| ${name} | ${segmented.lines.length}/${page.lineCount} | ${pct(score.correct)} | ${pct(score.wrong)} | ` +
      `${pct(score.unlabeled)} | ${count('clean')} | ${count('split')} | ${count('merged')} | ${refused} |`,
  );
}

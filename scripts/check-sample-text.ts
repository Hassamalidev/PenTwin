/**
 * Coverage check for the copy-paragraph in docs/sample-text.json. Exits non-zero if any
 * target is missed.
 *
 *   pnpm sample:check
 */
import { readFileSync } from 'node:fs';
import { checkSampleText, type SampleText } from '../packages/extractor/src/sample-text';

const sample = JSON.parse(readFileSync('docs/sample-text.json', 'utf8')) as SampleText;
const { counts, wordCount, failures } = checkSampleText(sample);

const row = (chars: string): string => [...chars].map((c) => `${c}:${counts[c] ?? 0}`).join(' ');
console.log(`${wordCount} words`);
console.log(row('abcdefghijklmnopqrstuvwxyz'));
console.log(row('ABCDEFGHIJKLMNOPQRSTUVWXYZ'));
console.log(row('0123456789'));
console.log(row(sample.targets.punctuation));

if (failures.length > 0) {
  console.error(`\n${failures.length} target(s) missed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nAll coverage targets met.');

/**
 * Rewrites every non-ASCII character in the given source files as a backslash-u escape,
 * so no invisible or look-alike character sits in the source.
 *
 *   pnpm exec tsx scripts/escape-source.ts <file> [<file> ...]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const backslash = String.fromCharCode(92);
for (const file of process.argv.slice(2)) {
  const source = readFileSync(file, 'utf8');
  const escaped = source.replace(/[^\p{ASCII}]/gu, (char) => {
    const point = char.codePointAt(0)!;
    return point > 0xffff
      ? `${backslash}u{${point.toString(16).toUpperCase()}}`
      : `${backslash}u${point.toString(16).padStart(4, '0')}`;
  });
  if (escaped !== source) {
    writeFileSync(file, escaped);
    console.log(`escaped: ${file}`);
  }
}

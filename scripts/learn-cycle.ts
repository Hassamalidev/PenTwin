/**
 * One turn of the learning loop: measure real pages, tune the styles, then check the result.
 * If the checks fail, the previous settings are put back. See docs/learning-loop.md.
 *
 *   pnpm learn:cycle <folder of .pgm files> [--steps 70]
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const FILES = ['packages/engine/src/learned-styles.json', 'packages/engine/src/real-ranges.json'];
const folder = process.argv[2];
if (!folder) throw new Error('Usage: pnpm learn:cycle <folder of .pgm files> [--steps 70]');
const steps = process.argv[process.argv.indexOf('--steps') + 1] ?? '70';
const before = FILES.map((file) => (existsSync(file) ? readFileSync(file, 'utf8') : undefined));
const run = (command: string): void => {
  execSync(command, { stdio: 'inherit' });
};

try {
  run(`pnpm real:measure "${folder}" --write`);
  run(`pnpm learn --steps ${process.argv.includes('--steps') ? steps : '70'} --write`);
  run('pnpm tells --check');
  run('pnpm test');
  console.log('Gate passed. Look at `pnpm samples` and commit if the pages look right.');
} catch (error) {
  FILES.forEach((file, i) => {
    if (before[i] !== undefined) writeFileSync(file, before[i]!);
  });
  console.error('Gate failed: the previous settings were put back.');
  throw error;
}

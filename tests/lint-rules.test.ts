import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const code = 'export const x = Math.random();\n';

const lint = async (filePath: string) => {
  const [result] = await new ESLint().lintText(code, { filePath });
  return result?.messages ?? [];
};

// Loading ESLint and its config is slow on a cold start.
describe('lint rules', { timeout: 30_000 }, () => {
  it('bans Math.random() in packages/engine', async () => {
    const messages = await lint('packages/engine/src/example.ts');
    expect(messages.some((m) => m.ruleId === 'no-restricted-properties')).toBe(true);
  });

  it('allows Math.random() outside the engine', async () => {
    expect(await lint('packages/shared/src/example.ts')).toEqual([]);
  });
});

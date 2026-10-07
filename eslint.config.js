import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Engine output must be reproducible from a seed: use createRng from @pentwin/shared.
    files: ['packages/engine/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seeded createRng() from @pentwin/shared so renders are reproducible.',
        },
      ],
    },
  },
  prettier,
);

import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['**/dist/', '**/node_modules/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: [
      'apps/server/**/*.ts',
      'packages/**/*.ts',
      '*.js',
      'samples/**/*.mjs',
      'scripts/**/*.mjs',
      'eval/compat/**/*.mjs',
      'eval/report-refresh/**/*.mjs',
      'eval/report-doc/**/*.mjs',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
]);

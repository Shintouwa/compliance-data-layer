// @ts-check
// architecture.md Part I §3.6 — ESLint errors, never warns.
// `--max-warnings 0` in the Makefile means a warning is a build failure anyway;
// configuring rules as "error" makes that explicit rather than incidental.

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.venv/**',
      '**/.turbo/**',
      '**/.next/**',
      'apps/web/next-env.d.ts',
      // Generated artefact — checked by scripts/contract-check.sh, not by eslint.
      'packages/contracts/validator.d.ts',
      // 🔒 Drizzle-generated; reviewed as SQL, not as TypeScript. §2.10.
      'packages/db/migrations/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // Module boundaries (Part I §1.3) are NOT enforced here.
  //
  // §1.3 names eslint-plugin-boundaries. At v7.1.0 it classified none of this
  // repository's files: with `default: 'disallow'` and no allowances, a probe
  // file doing `import { openBlob } from '../ingestion/crypto'` linted CLEAN,
  // through the legacy `element-types`/`entry-point` rules and through the v7
  // `dependencies` API, with and without `boundaries/root-path`, `basePattern`
  // and `boundaries/include`. A rule that reports nothing is worse than no
  // rule: it reads as enforcement and is not.
  //
  // The constraint is therefore enforced by apps/web/architecture.test.ts,
  // which runs under `make check` and — unlike the plugin here — carries a
  // self-test proving it flags a violation before it is trusted on real files.
  // -------------------------------------------------------------------------

  {
    // Config files are not part of the type-checked project graph.
    files: ['*.mjs', '*.config.ts', 'apps/web/*.config.ts', 'apps/web/postcss.config.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
);

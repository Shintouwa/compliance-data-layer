// @ts-check
// architecture.md Part I §3.6 — ESLint errors, never warns.
// `--max-warnings 0` in the Makefile means a warning is a build failure anyway;
// configuring rules as "error" makes that explicit rather than incidental.
//
// eslint-plugin-boundaries (Part I §1.3, cross-module imports through the barrel
// only) is NOT configured here: it governs apps/web/modules/**, which does not
// exist until M1. It lands in the same commit as the first module.

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.venv/**',
      '**/.turbo/**',
      // Generated artefact — checked by scripts/contract-check.sh, not by eslint.
      'packages/contracts/validator.d.ts',
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
  {
    // Config files are not part of the type-checked project graph.
    files: ['*.mjs', '*.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
);

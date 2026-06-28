import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // Applied to all TS/TSX source files EXCEPT src/db/** where the raw pool is permitted.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/db/client', '**/db/client'],
              message:
                'Direct import of db/client is forbidden outside src/db/**. ' +
                'Use withTenant / withSuperadmin / withOwner from @/db/tenant instead.',
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;

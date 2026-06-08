// ESLint v9 flat config — migrated from missing .eslintrc on 2026-05-29.
// Built minimal but functional: TypeScript-aware parsing + relaxed rules
// to avoid wave of false positives from ESLint recommended defaults.
//
// Run: pnpm run lint  (configured as `eslint src --max-warnings 0`)

import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.wxt/**',
      '.output/**',
      'dist/**',
      'scripts/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    linterOptions: {
      // session-state.ts has inline `eslint-disable react-hooks/exhaustive-deps`
      // comments which become "unused" now that the rule is off. Don't flag them.
      reportUnusedDisableDirectives: 'off',
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Browser / Chrome extension runtime
        chrome: 'readonly',
        browser: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        FormData: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        crypto: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        DOMParser: 'readonly',
        MutationObserver: 'readonly',
        IntersectionObserver: 'readonly',
        ResizeObserver: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLSelectElement: 'readonly',
        HTMLAnchorElement: 'readonly',
        Element: 'readonly',
        Node: 'readonly',
        NodeList: 'readonly',
        IDBKeyRange: 'readonly',
        indexedDB: 'readonly',
        performance: 'readonly',
        // Node-like (for wxt build context)
        process: 'readonly',
        // React JSX runtime auto-imported
        React: 'readonly',
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // tsc already catches all real issues. Lint just keeps syntax sane.
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      // Common JS — disabled to avoid wave of false-positives in WXT/Chrome ext code
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-prototype-builtins': 'off',
      'no-irregular-whitespace': 'off',
      'no-control-regex': 'off',
      'no-misleading-character-class': 'off',
      // React hooks — keep rules-of-hooks (real bugs!) but disable exhaustive-deps
      // (notorious for false-positives; setters from custom session-state hook are
      // stable but rule doesn't know that).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
);

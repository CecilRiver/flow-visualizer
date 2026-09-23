import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'

// Only this frontend directory is linted; ArduPilot's other directories keep
// their own formatting rules.
export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'vue/multi-word-component-names': 'off',
      'vue/require-default-prop': 'off',
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Build scripts run under Node and report through the console by design.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', 'tests/**/*.ts'],
    rules: {
      'no-console': 'off',
      // A `.vue` rule, and a false positive on a test: mounting a renderer that
      // reads provide/inject needs a throwaway host in the test file to call
      // the provider, and a test has no reason to split that into a second
      // file the way a real component would.
      'vue/one-component-per-file': 'off',
    },
  },
)

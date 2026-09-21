import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // Carpetas generadas o de terceros: nunca se lintean.
    ignores: [
      'dist',
      'coverage',
      'playwright-report',
      'test-results',
      'src/lib/database.types.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat['recommended-latest'],
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Configuración de build y test: no forma parte del proyecto TS de la app,
    // así que se linteda sin reglas que requieran información de tipos.
    files: ['*.config.{js,ts}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
    },
  },
  {
    // scripts/ (DB-019 en adelante): Node real, no navegador -- `process`, `console`, etc. Se
    // agrega sobre el bloque general de `**/*.{ts,tsx}` (mismo chequeo de tipos vía
    // projectService, que ya cubre `scripts/**/*.ts` desde tsconfig.node.json), sumando los
    // globals de Node a los de browser en vez de reemplazarlos (ESLint flat config combina
    // `languageOptions.globals` de todas las configs que matchean un archivo).
    files: ['scripts/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
)

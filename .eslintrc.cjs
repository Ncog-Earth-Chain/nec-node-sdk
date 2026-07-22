// ESLint config for the necjs SDK. Lenient by design: this is a published SDK with intentional `any`
// at the JSON-RPC boundary and bundled vendor files. Rules are mostly warnings so `npm run lint` reports
// without failing CI. Run: `npm run lint`.
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2021, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, browser: true, es2021: true },
  ignorePatterns: [
    'dist/',
    'node_modules/',
    'coverage/',
    '*.js',
    '*.cjs',
    'src/noble-post-quantum.js',
    'src/webassembly/wasm-base64.ts',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-constant-condition': ['warn', { checkLoops: false }],
    'no-control-regex': 'off',
    // `declare global { var ... }` augmentation legitimately needs `var`; the KEM WASM glue relies on it.
    'no-var': 'off',
    '@typescript-eslint/ban-types': 'warn',
    '@typescript-eslint/no-inferrable-types': 'off',
    '@typescript-eslint/no-this-alias': 'warn',
    '@typescript-eslint/no-var-requires': 'warn',
    'prefer-const': 'warn',
    'prefer-rest-params': 'warn',
    'no-async-promise-executor': 'warn',
  },
};

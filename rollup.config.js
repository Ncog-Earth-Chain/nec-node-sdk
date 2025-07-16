// rollup.config.js
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import typescript from 'rollup-plugin-typescript2';
import polyfill from 'rollup-plugin-polyfill-node';
import url from '@rollup/plugin-url';
import pkg from './package.json';

const externals = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  ...require('module').builtinModules,
];

// Custom warning handler to suppress unresolved node built-in warnings in browser builds
function onWarn(warning, warn) {
  // Suppress unresolved dependency warnings for node built-ins in browser build
  if (warning.code === 'UNRESOLVED_IMPORT' && /node:(module|crypto)/.test(warning.source)) return;
  if (warning.code === 'THIS_IS_UNDEFINED') return;
  warn(warning);
}

export default [
  // ———————— CJS (Node) ————————
  {
    input: 'src/index.ts',
    external: externals,
    onwarn: onWarn,
    plugins: [
      json(),
      typescript({ tsconfigOverride: { compilerOptions: { module: 'ESNext' } } }),
      resolve({ preferBuiltins: true }),
      commonjs({ transformMixedEsModules: true }),
    ],
    output: {
      file: pkg.main,
      format: 'cjs',
      exports: 'named',
      inlineDynamicImports: true,
    },
  },

  // ———————— ESM (Node & Bundlers) ————————
  {
    input: 'src/index.ts',
    external: externals,
    onwarn: onWarn,
    plugins: [
      json(),
      typescript(),
      resolve({ preferBuiltins: true }),
      commonjs({ transformMixedEsModules: true }),
    ],
    output: {
      file: pkg.module,
      format: 'esm',
      inlineDynamicImports: true,
    },
  },

  // ———————— UMD (Browser) ————————
  {
    input: 'src/index.browser.ts',
    onwarn: onWarn,
    plugins: [
      polyfill(),
      resolve({ browser: true, preferBuiltins: false }),
      commonjs({ transformMixedEsModules: true }),
      json(),
      typescript(),
      url({ include: ['**/*.wasm'] })
    ],
    output: {
      file: 'dist/index.umd.js',
      format: 'umd',
      name: 'Ncog',
      globals: {
        axios: 'axios',
        'ethereumjs-util': 'ethereumjsUtil',
      },
      inlineDynamicImports: true,
    },
  },

  // ———————— Browser ESM ————————
  {
    input: 'src/index.browser.ts',
    onwarn: onWarn,
    plugins: [
      polyfill(),
      resolve({ browser: true, preferBuiltins: false }),
      commonjs({ transformMixedEsModules: true }),
      json(),
      typescript(),
      url({ include: ['**/*.wasm'] })
    ],
    output: {
      file: 'dist/index.browser.esm.js',
      format: 'esm',
      inlineDynamicImports: true,
    },
  },

  // ———————— ESM (Preserve Modules for Deep Imports) ————————
  {
    input: 'src/index.ts',
    external: externals,
    onwarn: onWarn,
    plugins: [
      json(),
      typescript({ useTsconfigDeclarationDir: true }),
      resolve({ preferBuiltins: true }),
      commonjs({ transformMixedEsModules: true }),
    ],
    output: {
      dir: 'dist/esm',
      format: 'esm',
      preserveModules: true,
      preserveModulesRoot: 'src',
      entryFileNames: '[name].js',
    },
  },
];

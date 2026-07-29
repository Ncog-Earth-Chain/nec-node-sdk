// rollup.config.js
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import typescript from '@rollup/plugin-typescript';
import polyfill from 'rollup-plugin-polyfill-node';
import url from '@rollup/plugin-url';
import pkg from './package.json';

const externals = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  ...require('module').builtinModules,
];

// Swap the WebSocket factory for a platform-specific one.
//
// src/websocket/factory.ts is the default (Node, and the generic "Node & Bundlers" ESM
// build) and still picks a socket at runtime, because that build is loaded in environments
// this config cannot know. The react-native and browser bundles have exactly one answer
// each, so they get a variant with no branch -- and, crucially, no reference to the Node
// `ws` package.
//
// That reference is the whole point. A runtime `if (isNode) { await import('ws') }` cannot
// be tree-shaken, so `ws` used to appear in EVERY bundle. Metro resolves dynamic imports
// statically, followed it into ws/lib/websocket.js, hit its require('net'), and failed every
// React Native release build -- forcing each consumer to alias `ws` away in their own
// metro.config.js. Choosing the module here means the import is simply not emitted.
//
// Written as a small inline plugin rather than pulling in @rollup/plugin-alias: this is a
// published package, and a build-only dependency is still one more thing to keep current
// for four lines of resolveId.
// The variants are named factory-<variant>.ts, with a HYPHEN. factory.<variant>.ts reads
// better and does not work: resolvers treat the trailing segment as a file extension, so
// `./websocket/factory.react-native` is looked up as a `.react-native` file, never resolves,
// and -- because a resolveId hook that returns nothing simply defers -- the default factory
// is silently kept. The bundle then still contains `import('ws')` and the build reports
// success, which is exactly how this went unnoticed the first time.
//
// Hence the explicit failure below: if the swap cannot happen, the build stops rather than
// emitting a bundle that is broken only on the consumer's device.
function websocketFactory(variant) {
  return {
    name: 'nec-websocket-factory',
    async resolveId(source, importer) {
      if (!importer || !/(^|\/)websocket\/factory$/.test(source)) return null;

      const target = source.replace(/factory$/, `factory-${variant}`);
      const resolved = await this.resolve(target, importer, { skipSelf: true });
      if (!resolved) {
        this.error(
          `nec-websocket-factory: cannot resolve "${target}" (imported by ${importer}). ` +
          `Without it the ${variant} bundle keeps the default factory and its import of the ` +
          `Node "ws" package, which breaks React Native consumers at bundle time.`
        );
      }
      return resolved.id;
    },
  };
}

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
      typescript({ tsconfig: './tsconfig.json', declaration: false, compilerOptions: { module: 'ESNext' } }),
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
      typescript({ tsconfig: './tsconfig.json', declaration: false }),
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
      websocketFactory('browser'),
      polyfill({
        globals: {
          BigInt: 'BigInt',
          global: 'global',
          process: 'process',
          Buffer: 'Buffer'
        }
      }),
      resolve({ browser: true, preferBuiltins: false }),
      commonjs({ transformMixedEsModules: true }),
      json(),
      typescript({ tsconfig: './tsconfig.json', declaration: false }),
      url({ include: ['**/*.wasm'] })
    ],
    output: {
      file: 'dist/index.umd.js',
      format: 'umd',
      name: 'Ncog',
      globals: {
        axios: 'axios',
        ethers: 'ethers'     
      },
      inlineDynamicImports: true,
    },
  },

  // ———————— Browser ESM ————————
  {
    input: 'src/index.browser.ts',
    onwarn: onWarn,
    plugins: [
      websocketFactory('browser'),
      polyfill({
        globals: {
          BigInt: 'BigInt',
          global: 'global',
          process: 'process',
          Buffer: 'Buffer'
        }
      }),
      resolve({ browser: true, preferBuiltins: false }),
      commonjs({ transformMixedEsModules: true }),
      json(),
      typescript({ tsconfig: './tsconfig.json', declaration: false }),
      url({ include: ['**/*.wasm'] })
    ],
    output: {
      file: 'dist/index.browser.esm.js',
      format: 'esm',
      inlineDynamicImports: true,
    },
    // No `external: ['ws']`: this bundle no longer references it at all.
  },

  // ———————— React Native ESM ————————
  {
    input: 'src/index.react-native.ts',
    onwarn: onWarn,
    plugins: [
      websocketFactory('react-native'),
      polyfill({
        globals: {
          BigInt: 'BigInt',
          global: 'global',
          process: 'process',
          Buffer: 'Buffer'
        }
      }),
      resolve({ browser: true, preferBuiltins: false }),
      commonjs({ transformMixedEsModules: true }),
      json(),
      typescript({ tsconfig: './tsconfig.json', declaration: false }),
    ],
    output: {
      file: 'dist/index.react-native.esm.js',
      format: 'esm',
      inlineDynamicImports: true,
    },
    // No `external: ['ws']`: this bundle no longer references it at all.
  }
];

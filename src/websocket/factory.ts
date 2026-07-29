// WebSocket construction, default (Node and generic-bundler) implementation.
//
// WHY THIS IS ITS OWN MODULE.
//
// Subscription used to pick a WebSocket inline, from a RUNTIME environment check:
//
//     if (isNode) {
//       const { WebSocket } = await import('ws');
//       ...
//     } else if (isReactNative) { ... }
//
// A runtime condition cannot be tree-shaken, so `import('ws')` survived into EVERY bundle,
// including the React Native one. That branch is dead code on React Native -- isNode is
// false there and the next branch uses the built-in global -- but Metro resolves dynamic
// imports STATICALLY, so it followed the import into ws/lib/websocket.js, which requires the
// Node core module `net`. React Native has no `net`, so every release bundle failed with
//
//     Unable to resolve module net from .../ws/lib/websocket.js
//
// leaving each consumer to alias `ws` away in their own metro.config.js.
//
// Putting the choice behind a module boundary lets the BUILD make it: rollup swaps this file
// for the platform variant when it builds the react-native and browser bundles (see
// rollup.config.js), so those outputs contain no reference to `ws` at all and nothing for a
// consumer's bundler to trip over.
//
// This default keeps the runtime branching deliberately. dist/index.esm.js is documented as
// "Node & Bundlers", so it is loaded in environments this file cannot know at build time,
// and its behaviour must not change.

const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
const isReactNative = typeof navigator !== 'undefined' && (navigator as any).product === 'ReactNative';

/**
 * Create a WebSocket appropriate to the current environment.
 *
 * @param url the endpoint to connect to
 * @returns a WebSocket-like object exposing onopen/onclose/onerror/onmessage/send/close
 */
export async function createWebSocket(url: string): Promise<any> {
  if (isNode) {
    const { WebSocket } = await import('ws');
    return new WebSocket(url);
  }
  if (isReactNative) {
    return new WebSocket(url); // built-in global
  }
  if (isBrowser) {
    return new window.WebSocket(url);
  }
  throw new Error('Unsupported environment for WebSocket');
}

/**
 * Whether incoming message payloads may arrive as Node Buffers, which have to be decoded
 * before JSON.parse. Only the `ws` package does this; browser and React Native sockets
 * deliver strings.
 */
export const deliversBuffers: boolean = !!isNode;

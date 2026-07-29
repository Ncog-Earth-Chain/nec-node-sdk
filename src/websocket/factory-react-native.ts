// WebSocket construction, React Native implementation.
//
// rollup swaps this in for ./factory when building dist/index.react-native.esm.js, so that
// bundle contains no reference to the Node `ws` package. See ./factory.ts for why that
// matters -- in short, Metro resolves dynamic imports statically and followed `ws` into a
// require('net') that React Native cannot satisfy, breaking every release bundle.
//
// React Native provides WebSocket as a global, so there is nothing to import.

/**
 * Create a WebSocket using the React Native global.
 *
 * @param url the endpoint to connect to
 */
export async function createWebSocket(url: string): Promise<any> {
  return new WebSocket(url);
}

/**
 * React Native delivers message payloads as strings, never as Node Buffers.
 */
export const deliversBuffers: boolean = false;

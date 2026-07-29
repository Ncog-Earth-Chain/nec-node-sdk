// WebSocket construction, browser implementation.
//
// rollup swaps this in for ./factory when building dist/index.umd.js and
// dist/index.browser.esm.js, so neither references the Node `ws` package. Those builds
// previously carried `external: ['ws']`, which left the import in the output for the
// consumer's bundler to resolve -- harmless in a browser bundler that shims it, noise
// otherwise, and needless either way since a browser has WebSocket built in.

/**
 * Create a WebSocket using the browser global.
 *
 * @param url the endpoint to connect to
 */
export async function createWebSocket(url: string): Promise<any> {
  return new window.WebSocket(url);
}

/**
 * Browsers deliver message payloads as strings or Blobs, never as Node Buffers.
 */
export const deliversBuffers: boolean = false;

/** mpegts.js's UMD build reads `self` at load time. Node vitest has no window. */
const root = globalThis as { self?: typeof globalThis };
if (root.self === undefined) root.self = globalThis;

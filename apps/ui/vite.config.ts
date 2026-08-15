import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

const CORE_PORT = process.env['TVM_CORE_PORT'] ?? '7345';

// The shell polls this exact origin while it waits for the UI, so the port must
// not drift to a fallback. /api is proxied to core so the UI always talks to a
// same-origin path, in development here and in production from core itself.
export default defineConfig({
  plugins: [react()],
  define: {
    __TVM_UI_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${CORE_PORT}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
  base: './',
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __TVM_CORE_ORIGIN__: JSON.stringify('http://127.0.0.1:7345'),
    __TVM_UI_VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});

import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [
    WxtVitest({
      dev: {
        server: {
          host: '127.0.0.1',
          port: 3333,
          origin: 'http://127.0.0.1:3333',
        },
      },
    }),
  ],
  test: {
    environment: 'node',
  },
});

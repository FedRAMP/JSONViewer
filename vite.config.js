import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.VITE_BASE_URL ?? '/',
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
});

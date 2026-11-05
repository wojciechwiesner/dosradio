import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5202,
    proxy: {
      '/radio-api': {
        target: 'http://127.0.0.1:3015',
        changeOrigin: false,
      },
      '/radio-ws': {
        target: 'ws://127.0.0.1:3015',
        ws: true,
        changeOrigin: false,
      },
    },
  },
});

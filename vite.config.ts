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
        target: process.env.DOSRADIO_API_TARGET || 'http://127.0.0.1:3015',
        changeOrigin: false,
      },
      '/radio-ws': {
        target: (process.env.DOSRADIO_API_TARGET || 'http://127.0.0.1:3015').replace('http', 'ws'),
        ws: true,
        changeOrigin: false,
      },
    },
  },
});

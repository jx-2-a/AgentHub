import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  // 生产产物落在 aiohttp 的 /static/ 下（hub/static）；dev 用根路径
  base: command === 'build' ? '/static/' : '/',
  plugins: [react()],
  build: {
    outDir: '../hub/static',      // 构建产物直接进 aiohttp add_static 目录
    emptyOutDir: true,            // outDir 在项目根之外必须显式允许清空
    assetsDir: 'assets',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8500',
      '/file': 'http://127.0.0.1:8500',
      '/theme': 'http://127.0.0.1:8500',
      '/ws': { target: 'ws://127.0.0.1:8500', ws: true },
    },
  },
}));

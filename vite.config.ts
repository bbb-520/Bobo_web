import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** 开发代理：把 /api 请求转发到本地 Java 后端。 */
const target = process.env.BACKEND_URL ?? 'http://localhost:18000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target,
        changeOrigin: true,
        // SSE(text/event-stream) 流会由 http-proxy 直接透传，
        // 无需额外配置；不要在此强行改 Accept，否则普通 JSON 接口会 406。
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});

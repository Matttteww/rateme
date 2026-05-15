import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "client",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3847",
      "/uploads": "http://127.0.0.1:3847",
      "/tg-s": {
        target: "https://t.me",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tg-s/, "/s"),
        timeout: 120000,
        proxyTimeout: 120000,
      },
      "/tg-mirror-s": {
        target: "https://tg.i-c-a.su",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tg-mirror-s/, "/s"),
        timeout: 120000,
        proxyTimeout: 120000,
      },
      "/ws": {
        target: "ws://127.0.0.1:3847",
        ws: true,
      },
    },
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
});

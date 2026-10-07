import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// API target for the dev proxy. Tests set API_PORT (see tests/helpers/testDb.ts)
// so a test Vite instance proxies to the throwaway test API, never the dev app.
const API_TARGET = `http://localhost:${process.env.API_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: Number(process.env.APP_PORT ?? 5173),
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2020",
    sourcemap: false,
  },
  define: {
    __APP_BUILD__: JSON.stringify(process.env.APP_BUILD ?? "dev"),
  },
});
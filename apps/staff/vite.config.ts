import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served by the API under /ops in production; proxied to the API in dev.
export default defineConfig({
  base: "/ops/",
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": { target: "http://localhost:8787", rewrite: (p) => p.replace(/^\/api/, "") } } },
});

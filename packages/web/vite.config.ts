import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: true,
    // Allow access via SSH hostname / reverse proxies, not just localhost.
    allowedHosts: true,
  },
});

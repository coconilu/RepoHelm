import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = process.env.REPOHELM_PORT ?? "4300";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${apiPort}`
    }
  }
});

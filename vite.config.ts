import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // Allow access through public tunnels (cloudflared / ngrok) and LAN
    allowedHosts: true,
  },
});

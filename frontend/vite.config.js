import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true, // Ensure Vite listens on all interfaces within the container
    watch: {
      // Use polling instead of fs events for Docker compatibility
      usePolling: true,
      interval: 1000 // Optional: Adjust polling interval (ms)
    }
    // proxy: { ... } // Proxy config removed as main Nginx handles it
  },
});

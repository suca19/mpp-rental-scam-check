import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const target = process.env.API_TARGET ?? 'http://localhost:3000'

// Dev proxy: the dashboard talks to the Hono server on :3000.
// The production build is served by that server at /demo/ (added 11 Nov), so built asset URLs start with /demo/.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/demo/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    // Allow ONLY Cloudflare quick-tunnel hostnames (to share the local dashboard with friends). Added 11 Nov.
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': { target, changeOrigin: true },
      '/check': { target, changeOrigin: true },
      '/health': { target, changeOrigin: true },
    },
  },
}))

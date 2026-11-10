import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const target = process.env.API_TARGET ?? 'http://localhost:3000'

// Dev proxy: the dashboard talks to the Hono server on :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/check': { target, changeOrigin: true },
      '/health': { target, changeOrigin: true },
    },
  },
})

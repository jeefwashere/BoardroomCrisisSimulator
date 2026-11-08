import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config.ts'

// Public demo over one ngrok address (docs/ngrok-demo.md). This dev server serves the app and forwards /api to the
// backend, so players' browsers only ever talk to the tunnel origin. The Host header and ngrok's X-Forwarded-Proto
// pass through unchanged, which keeps the backend's same origin check satisfied without widening its origins.
const backend = process.env.BOARDROOM_BACKEND ?? 'http://127.0.0.1:8000'

export default mergeConfig(base, defineConfig({
  server: {
    host: '127.0.0.1',
    port: Number(process.env.TUNNEL_PORT ?? 5175),
    strictPort: true,
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io'],
    proxy: {
      '/api': { target: backend, changeOrigin: false, xfwd: false },
    },
  },
}))

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
      '/api': {
        target: backend, changeOrigin: false, xfwd: false,
        // The tunnel's ngrok login is HTTP basic auth. Chrome forgets that login when any request that carried it gets
        // a 401, so a stale tab whose room session expired (backend restart) made the sign in box reappear every few
        // seconds. The app reads the error code in the body, not the status, so relay the backend's own 401 as 403.
        configure: (proxy) => {
          proxy.on('proxyRes', (response) => {
            if (response.statusCode === 401) { response.statusCode = 403; response.statusMessage = 'Forbidden' }
          })
        },
      },
    },
  },
}))

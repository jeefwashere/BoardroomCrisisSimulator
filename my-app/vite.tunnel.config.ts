import { readFileSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import type { Plugin } from 'vite'
import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config.ts'

// Public demo over one ngrok address (docs/ngrok-demo.md). This dev server serves the app and forwards /api to the
// backend, so players' browsers only ever talk to the tunnel origin. The Host header and ngrok's X-Forwarded-Proto
// pass through unchanged, which keeps the backend's same origin check satisfied without widening its origins.
const backend = process.env.BOARDROOM_BACKEND ?? 'http://127.0.0.1:8000'

// The demo login, enforced here so it protects every tunnel (ngrok, Tailscale Funnel): the backend can spend paid
// Vertex AI and ElevenLabs credit. `user:password` from TUNNEL_BASIC_AUTH or NGROK_BASIC_AUTH, else the generated
// login in .local/ngrok-demo/login (git ignored); `off` disables it.
function tunnelLogin(): string | null {
  const chosen = process.env.TUNNEL_BASIC_AUTH ?? process.env.NGROK_BASIC_AUTH
  if (chosen === 'off') return null
  if (chosen) return chosen
  try { return readFileSync(new URL('./.local/ngrok-demo/login', import.meta.url), 'utf8').trim() || null } catch { return null }
}

function requireLogin(): Plugin {
  return {
    name: 'boardroom-tunnel-login',
    configureServer(server) {
      const login = tunnelLogin()
      if (!login) return
      const expected = Buffer.from(`Basic ${Buffer.from(login).toString('base64')}`)
      server.middlewares.use((request, response, next) => {
        const given = Buffer.from(request.headers.authorization ?? '')
        if (given.length === expected.length && timingSafeEqual(given, expected)) return next()
        response.statusCode = 401
        response.setHeader('WWW-Authenticate', 'Basic realm="Boardroom demo", charset="UTF-8"')
        response.end('Login required')
      })
    },
  }
}

export default mergeConfig(base, defineConfig({
  plugins: [requireLogin()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.TUNNEL_PORT ?? 5175),
    strictPort: true,
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io', '.ts.net'],
    proxy: {
      '/api': {
        target: backend, changeOrigin: false, xfwd: false,
        // The tunnel's ngrok login is HTTP basic auth. Chrome forgets that login when any request that carried it gets
        // a 401, so a stale tab whose room session expired (backend restart) made the sign in box reappear every few
        // seconds. The app reads the error code in the body, not the status, so relay the backend's own 401 as 403.
        configure: (proxy) => {
          // Tailscale Funnel terminates HTTPS before this server; say so, as ngrok does, so the backend's same origin
          // check sees https://<machine>.ts.net as its own origin.
          proxy.on('proxyReq', (outgoing, incoming) => {
            if (!incoming.headers['x-forwarded-proto'] && /\.ts\.net(:\d+)?$/.test(incoming.headers.host ?? '')) outgoing.setHeader('X-Forwarded-Proto', 'https')
          })
          proxy.on('proxyRes', (response) => {
            if (response.statusCode === 401) { response.statusCode = 403; response.statusMessage = 'Forbidden' }
          })
        },
      },
    },
  },
}))

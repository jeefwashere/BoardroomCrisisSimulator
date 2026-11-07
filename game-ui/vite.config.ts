import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const scenario = fileURLToPath(new URL('../scenarios/cybersecurity_demo/v2', import.meta.url))
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@scenario': scenario } },
  server: { port: 5174, fs: { allow: [repoRoot] } },
})

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { dummyDocumentProcessor } from './dev/documentProcessor.ts'
import { dummySummaryApi } from './dev/summaryApi.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'dummy-document-processor',
      configureServer(server) {
        server.middlewares.use(dummyDocumentProcessor)
        server.middlewares.use(dummySummaryApi)
      },
      configurePreviewServer(server) {
        server.middlewares.use(dummyDocumentProcessor)
        server.middlewares.use(dummySummaryApi)
      },
    },
  ],
})

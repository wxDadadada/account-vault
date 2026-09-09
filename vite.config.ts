import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8188' } } },
  build: {
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules\/(?:react|react-dom|scheduler)\//,
              priority: 30,
            },
            {
              name: 'ui-vendor',
              test: /node_modules\/(?:@radix-ui|lucide-react|sonner)\//,
              priority: 20,
            },
          ],
        },
      },
    },
  },
})

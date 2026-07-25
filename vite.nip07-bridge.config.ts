import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/assets',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/nip07/content-bridge.ts'),
      formats: ['iife'],
      name: 'AttentionXNip07Bridge',
      fileName: () => 'nip07-bridge.js',
    },
  },
})

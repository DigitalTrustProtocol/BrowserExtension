import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/assets',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/lib/nostr/nip07/inject.ts'),
      formats: ['iife'],
      name: 'AttentionXNip07Inject',
      fileName: () => 'nip07-inject.js',
    },
  },
})

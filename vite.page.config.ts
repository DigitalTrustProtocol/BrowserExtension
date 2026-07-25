import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/assets',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/page-world/index.ts'),
      formats: ['iife'],
      name: 'AttentionXPageObserver',
      fileName: () => 'page-observer.js',
    },
  },
})

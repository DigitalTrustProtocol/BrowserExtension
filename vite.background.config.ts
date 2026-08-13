import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/**
 * MV3 service workers that `import` hashed Rollup chunks fail Chrome
 * registration (status code 3) after rebuilds. Keep background.js a
 * single self-contained classic worker (IIFE, no `"type": "module"`),
 * same idea as the content-script IIFE.
 */
export default defineConfig({
  publicDir: false,
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@components': resolve(__dirname, 'src/components'),
      '@assets': resolve(__dirname, 'src/assets'),
      '@lib': resolve(__dirname, 'src/lib'),
    },
  },
  build: {
    outDir: 'dist/assets',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/background/index.ts'),
      formats: ['iife'],
      name: 'AttentionXBackground',
      fileName: () => 'background.js',
    },
    rollupOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
})

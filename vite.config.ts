import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@components': resolve(__dirname, 'src/components'),
  '@assets': resolve(__dirname, 'src/assets'),
  '@lib': resolve(__dirname, 'src/lib'),
}

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  publicDir: 'public',
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        onboarding: resolve(__dirname, 'src/onboarding/index.html'),
        prompt: resolve(__dirname, 'src/prompt/index.html'),
        cockpit: resolve(__dirname, 'src/cockpit/index.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
